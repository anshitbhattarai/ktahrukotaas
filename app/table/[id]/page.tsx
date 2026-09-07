'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {deck,shuffle,label,Card,teenRank,bestFive,cmp} from '@/lib/cards';
import Link from 'next/link';

export default function Table({params}:{params:Promise<{id:string}>}){
  const [id,setId]=useState('');
  const [room,setRoom]=useState<any>();
  const [players,setPlayers]=useState<any[]>([]);
  const [me,setMe]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [activeHand,setActiveHand]=useState(0);
  const [kittiHands,setKittiHands]=useState<Card[][]>([[],[],[]]);

  useEffect(()=>{params.then(x=>setId(x.id))},[params]);
  useEffect(()=>{
    if(!id)return;
    setMe(localStorage.getItem('cr_player_id')||'');
    load();
    const ch=supabase.channel('room-'+id)
      .on('postgres_changes',{event:'*',schema:'public',table:'rooms',filter:'id=eq.'+id},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'room_players',filter:'room_id=eq.'+id},load)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'players',filter:'id=eq.'+(localStorage.getItem('cr_player_id')||'')},load)
      .subscribe();
    return()=>{supabase.removeChannel(ch)}
  },[id]);

  async function load(){
    const r=await supabase.from('rooms').select('*').eq('id',id).single();
    const p=await supabase.from('room_players').select('*').eq('room_id',id).order('seat');
    setRoom(r.data);setPlayers(p.data||[]);
    if(r.data?.game==='kitti'){
      const pid=localStorage.getItem('cr_player_id')||'';
      const saved=r.data.state?.kittiHands?.[pid];
      // Never erase an in-progress local arrangement just because another
      // realtime update arrived before it was fully saved. Restore any
      // saved 3-hand arrangement, including partially filled hands.
      if(Array.isArray(saved) && saved.length===3){
        setKittiHands(saved);
        try{localStorage.setItem(`kitti-hands-${id}-${pid}`,JSON.stringify(saved))}catch{}
      }else if(r.data?.state?.phase==='playing' && !kittiHands.some(g=>g.length)){
        try{
          const local=JSON.parse(localStorage.getItem(`kitti-hands-${id}-${pid}`)||'null');
          if(Array.isArray(local) && local.length===3)setKittiHands(local);
        }catch{}
      }
    }
  }

  const mine=players.find(p=>p.player_id===me);
  async function saveState(state:any){
    await supabase.from('rooms').update({state,status:state.phase==='lobby'?'waiting':state.phase==='finished'?'finished':'playing'}).eq('id',id);
    await load();
  }

  async function start(kittiCarryPot=0){
    if(!room||players.length<2)return setError('Need at least 2 players.');
    setBusy(true);setError('');
    const d=shuffle(deck());
    let state:any={phase:'playing',pot:0,turn:0,round:0,deck:d,community:[],hands:{},bets:{},folded:[],winner:null,revealed:false,showdown:[],tiedWinners:[]};
    if(room.game==='teen-patti'){
      players.forEach((p,i)=>state.hands[p.player_id]=d.slice(i*3,i*3+3));
      state.deck=d.slice(players.length*3);state.boot=10;state.pot=players.length*10;state.turn=0;state.seen={};state.phase='seeing';state.bets={};state.folded=[];state.winner=null;state.revealed=false;state.showdown=[];state.tiedWinners=[];
    }else if(room.game==='kitti'){
      const entry=50;
      const total=players.length*entry;
      const balances=await Promise.all(players.map(async p=>{
        const r=await supabase.from('players').select('coins').eq('id',p.player_id).single();
        return {id:p.player_id,coins:Number(r.data?.coins??0)};
      }));
      const short=balances.find(x=>x.coins<entry);
      if(short){setBusy(false);return setError(`${players.find(p=>p.player_id===short.id)?.username||'A player'} does not have enough coins to enter Kitti.`)}
      await Promise.all(balances.map(x=>supabase.from('players').update({coins:x.coins-entry}).eq('id',x.id)));
      await Promise.all(balances.map(x=>supabase.from('room_players').update({coins:x.coins-entry}).eq('room_id',id).eq('player_id',x.id)));
      players.forEach((p,i)=>state.hands[p.player_id]=d.slice(i*9,i*9+9));
      state.deck=d.slice(players.length*9);state.kittiHands={};state.ready=[];state.round=0;state.entry=entry;state.pot=total+Number(kittiCarryPot||0);state.kittiCarryPot=Number(kittiCarryPot||0);state.kittiResults=[];
      setKittiHands([[],[],[]]);setSelected([]);setActiveHand(0);
      try{localStorage.removeItem(`kitti-hands-${id}-${me}`)}catch{}
    }else{
      players.forEach((p,i)=>state.hands[p.player_id]=d.slice(i*2,i*2+2));
      state.deck=d.slice(players.length*2);state.community=[];state.stage='preflop';state.turn=0;state.pot=0;state.bets={};state.folded=[];state.winner=null;state.revealed=false;state.showdown=[];state.tiedWinners=[];state.sb=10;state.bb=20;
    }
    await saveState(state);setBusy(false);
  }

  async function action(type:string){
    if(!room)return;
    const s=structuredClone(room.state||{});
    if(room.game==='teen-patti'){
      const idx=players.findIndex(p=>p.player_id===me);
      const folded=s.folded||[];
      const alive=players.filter(p=>!folded.includes(p.player_id));
      if(s.phase==='seeing'){
        if(type!=='seen'||s.seen?.[me])return;
        s.seen={...(s.seen||{}),[me]:true};
        const allSeen=alive.every(p=>s.seen?.[p.player_id]);
        if(allSeen){
          s.phase='betting';
          const first=players.findIndex(p=>!folded.includes(p.player_id));
          s.turn=first<0?0:first;
        }
      }else if(s.phase==='betting'){
        if(s.turn!==idx)return;
        if(type==='fold')s.folded=[...folded,me];
        if(type==='bet'){const amt=s.seen?.[me]?s.boot*2:s.boot;s.pot+=amt;s.bets[me]=(s.bets[me]||0)+amt}
        if(type==='show'){
          const active=players.filter(p=>!(s.folded||[]).includes(p.player_id));
          const ranked=active.map(p=>({id:p.player_id,r:teenRank(s.hands?.[p.player_id]||[])})).sort((a,b)=>cmp(b.r,a.r));
          s.revealed=true;s.showdown=ranked;s.winner=ranked[0]?.id;s.phase='finished';
        }else{
          const remaining=players.filter(p=>!(s.folded||[]).includes(p.player_id));
          if(remaining.length===1){s.phase='finished';s.revealed=true;s.winner=remaining[0].player_id;s.showdown=[{id:remaining[0].player_id,r:teenRank(s.hands?.[remaining[0].player_id]||[])}]}
          else{
            let next=(idx+1)%players.length;
            while((s.folded||[]).includes(players[next].player_id))next=(next+1)%players.length;
            s.turn=next;
          }
        }
      }
    }else if(room.game==='kitti'&&type==='ready'){
      const groups=kittiHands;
      if(groups.some(g=>g.length!==3))return setError('You must place all 9 cards into the 3 hands.');
      if(cmp(teenRank(groups[0]),teenRank(groups[1]))<0 || cmp(teenRank(groups[1]),teenRank(groups[2]))<0)
        return setError('Your hands are out of order. Hand 1 must be strongest, then Hand 2, then Hand 3.');
      s.kittiHands={...(s.kittiHands||{}),[me]:groups};
      s.ready=[...(s.ready||[]).filter((x:string)=>x!==me),me];
      if(s.ready.length===players.length){
        const results=[0,1,2].map(handIndex=>{
          const ranked=players.map(p=>({id:p.player_id,r:teenRank(s.kittiHands[p.player_id]?.[handIndex]||[])})).sort((a,b)=>cmp(b.r,a.r));
          const top=ranked[0];
          const tied=ranked.filter(x=>cmp(x.r,top.r)===0);
          return {hand:handIndex+1,winner:tied.length===1?top.id:null,ranked};
        });
        const wins:Record<string,number>={};
        results.forEach((r:any)=>{if(r.winner)wins[r.winner]=(wins[r.winner]||0)+1});
        const max=Math.max(...Object.values(wins),0);
        const overall=Object.entries(wins).filter(([,n])=>n===max).map(([id])=>id);
        s.kittiResults=results;s.kittiWins=wins;s.winner=overall.length===1?overall[0]:null;s.tiedWinners=overall.length>1?overall:[];s.revealed=true;s.phase='finished';s.round=3;
        if(s.winner){
          const winner=players.find(p=>p.player_id===s.winner);
          if(winner){
            const current=await supabase.from('players').select('coins').eq('id',winner.player_id).single();
            const newCoins=Number(current.data?.coins??0)+Number(s.pot||0);
            await supabase.from('players').update({coins:newCoins}).eq('id',winner.player_id);
            await supabase.from('room_players').update({coins:newCoins}).eq('room_id',id).eq('player_id',winner.player_id);
          }
        }
      }
    }else if(room.game==='poker'){
      if(type==='fold')s.folded=[...(s.folded||[]),me];
      if(type==='check'){}
      if(type==='call'){s.bets[me]=(s.bets[me]||0)+s.bb;s.pot+=s.bb}
      if(type==='raise'){s.bets[me]=(s.bets[me]||0)+s.bb*2;s.pot+=s.bb*2}
      if(type==='next'){
        if(s.stage==='preflop'){s.community=s.deck.slice(0,3);s.deck=s.deck.slice(3);s.stage='flop'}
        else if(s.stage==='flop'){s.community=[...s.community,s.deck[0]];s.deck=s.deck.slice(1);s.stage='turn'}
        else if(s.stage==='turn'){s.community=[...s.community,s.deck[0]];s.deck=s.deck.slice(1);s.stage='river'}
        else{s.stage='showdown';const active=players.filter(p=>!(s.folded||[]).includes(p.player_id));const ranked=active.map(p=>({id:p.player_id,r:bestFive([...(s.hands[p.player_id]||[]),...s.community])})).sort((a,b)=>cmp(b.r,a.r));s.winner=ranked[0]?.id;s.phase='finished'}
      }
      s.turn=(s.turn+1)%players.length;
    }
    await saveState(s);
  }

  function cardKey(c:Card){return `${c.r}-${c.s}`}
  function groupFor(c:Card){return kittiHands.findIndex(g=>g.some(x=>cardKey(x)===cardKey(c)))}
  function toggleCard(c:Card){
    setError('');
    const key=cardKey(c);
    setSelected(x=>x.includes(key)?x.filter(k=>k!==key):[...x,key]);
  }
  function persistKittiHands(next:Card[][]){
    setKittiHands(next);
    try{localStorage.setItem(`kitti-hands-${id}-${me}`,JSON.stringify(next))}catch{}
    // Persist the arrangement immediately so realtime refreshes cannot make
    // cards disappear while the player is still building the three hands.
    const current=structuredClone(room?.state||{});
    current.kittiHands={...(current.kittiHands||{}),[me]:next};
    supabase.from('rooms').update({state:current}).eq('id',id).then(()=>{});
  }
  function putSelected(handIndex:number){
    setError('');
    if(!selected.length){setActiveHand(handIndex);return setError('Select one or more cards first.')}
    const chosen=(room?.state?.hands?.[me]||[]).filter((c:Card)=>selected.includes(cardKey(c)));
    const remaining=kittiHands.map(g=>g.filter(c=>!selected.includes(cardKey(c))));
    if(remaining[handIndex].length+chosen.length>3)return setError(`Hand ${handIndex+1} can contain only 3 cards.`);
    remaining[handIndex]=[...remaining[handIndex],...chosen];
    persistKittiHands(remaining);setSelected([]);setActiveHand(handIndex);
  }
  function removeSelected(){
    if(!selected.length)return;
    const next=kittiHands.map(g=>g.filter(c=>!selected.includes(cardKey(c))));
    persistKittiHands(next);
    setSelected([]);
  }
  function autoOrder(){
    const cards:Card[]=Array.isArray(myCards)?myCards:[];
    if(cards.length!==9){
      setError(`Auto-make needs all 9 cards. You currently have ${cards.length}.`);
      return;
    }
    setError('');

    // Check every unique 3+3+3 partition, then order the three hands
    // strongest-to-weakest. This guarantees the best arrangement rather
    // than relying on a greedy choice for Hand 1.
    const combinations=(arr:number[],k:number):number[][]=>{
      const out:number[][]=[];
      const walk=(start:number,pick:number,current:number[])=>{
        if(pick===0){out.push([...current]);return;}
        for(let i=start;i<=arr.length-pick;i++)walk(i+1,pick-1,[...current,arr[i]]);
      };
      walk(0,k,[]);
      return out;
    };

    const indices=Array.from({length:9},(_,i)=>i);
    const parts=combinations(indices,3);
    let best:Card[][]|null=null;
    let bestScore:number[]|null=null;

    const compareScore=(a:number[],b:number[])=>{
      for(let i=0;i<Math.max(a.length,b.length);i++){
        const av=a[i]??0;
        const bv=b[i]??0;
        if(av!==bv)return av-bv;
      }
      return 0;
    };

    const arrangementScore=(groups:Card[][])=>{
      // Groups are already sorted strongest -> weakest. Within each Teen
      // Patti rank tuple, larger values win lexicographically.
      return groups.flatMap(g=>[...teenRank(g),-1000]);
    };

    for(const firstIds of parts){
      const firstSet=new Set(firstIds);
      const rest=indices.filter(i=>!firstSet.has(i));
      for(const secondLocal of combinations(rest,3)){
        const secondSet=new Set(secondLocal);
        const thirdIds=rest.filter(i=>!secondSet.has(i));
        if(thirdIds.length!==3)continue;

        const groups:Card[][]=[
          firstIds.map(i=>cards[i]),
          secondLocal.map(i=>cards[i]),
          thirdIds.map(i=>cards[i])
        ].sort((a,b)=>cmp(teenRank(b),teenRank(a)));

        const score=arrangementScore(groups);
        if(!bestScore || compareScore(score,bestScore)>0){
          bestScore=score;
          best=groups.map(g=>[...g]);
        }
      }
    }

    if(!best){
      setError('Could not build the three Kitti hands. Please try again.');
      return;
    }

    persistKittiHands(best);
    setSelected([]);
    setActiveHand(0);
  }
  function rankLabel(cards:Card[]){
    if(cards.length!==3)return 'Waiting for 3 cards';
    const r=teenRank(cards)[0];
    return ['','High card','Pair','Color / Flush','Run','Pure Run','Trial'][r]||'Hand';
  }

  const myCards:Card[]=room?.state?.hands?.[me]||[];
  const st=room?.state||{};
  const isKitti=room?.game==='kitti';

  return <main className="wrap">
    <div className="top"><div><b>{room?.game||'Loading…'}</b>{room&&<span className="tag"> · ROOM {room.code}</span>}</div><Link className="btn secondary" href="/play">Leave</Link></div>
    {error&&<div className="notice">{error}</div>}
    <div className="card table">
      <div className="seats">{players.map(p=><div className="seat" key={p.player_id}><b>{p.username}</b><div className="muted">Seat {p.seat+1} · 🪙 {p.coins}</div>{st.winner===p.player_id&&<span>🏆 Winner</span>}</div>)}</div>
      {room?.state?.phase==='lobby'&&<div className="notice">Waiting for players. Host can start when everyone has joined.</div>}
      {room?.host_id===me&&room?.state?.phase==='lobby'&&<button className="btn primary" onClick={start} disabled={busy}>Start game</button>}
      {room?.host_id===me&&room?.state?.phase==='finished'&&<div className="actions"><button className="btn primary" onClick={()=>room.game==='kitti'&&st.tiedWinners?.length>1?start(Number(st.pot||0)):start()} disabled={busy}>{room.game==='kitti'&&st.tiedWinners?.length>1?'🤝 Tie — Add 50 Each & Continue':'🔄 Play Again'}</button><span className="muted">{room.game==='kitti'&&st.tiedWinners?.length>1?'Everyone pays 50 more coins. The current pot carries over into the next Kitti round.':'Starts a fresh '+(room.game==='teen-patti'?'Teen Patti':room.game==='kitti'?'Kitti':'Poker')+' round.'}</span></div>}

      {room?.state?.phase==='playing'&&isKitti&&<>
        <div className="kittiHead">
          <div><h3>Arrange your 9 cards</h3><p className="muted">Select cards to highlight them, then choose which 3-card hand they belong to. Hand 1 must be the strongest, Hand 2 next, Hand 3 weakest.</p></div>
          <div className="row"><button className="btn secondary" onClick={removeSelected} disabled={!selected.length}>Remove selected</button><button className="btn secondary" onClick={autoOrder}>✨ Auto-make best hands</button></div>
        </div>
        <div className="kitti-layout">
          <div className="kitti-dealt card">
            <div className="kitti-subtitle">YOUR 9 CARDS <span className="muted">({myCards.length}/9 placed)</span></div>
            <div className="cards kitti-card-grid">
              {myCards.map((c:Card,i:number)=>{
                const key=cardKey(c);const gi=groupFor(c);const sel=selected.includes(key);
                return <button key={i} type="button" className={`cardface kitti-card ${c.s===1||c.s===2?'red-suit':''} ${sel?'selected':''} ${gi>=0?'assigned':''}`} onClick={()=>toggleCard(c)} title={gi>=0?`In Hand ${gi+1}`:'Select this card'}>
                  <span>{label(c)}</span>{gi>=0&&<small>H{gi+1}</small>}
                </button>
              })}
            </div>
            <div className="notice kitti-help">Select cards, then click <b>anywhere inside Hand 1/2/3</b> to place them there. The buttons also work. You can move assigned cards too.</div>
          </div>
          <div className="kitti-hands">
            {[0,1,2].map(i=><div key={i} className={`kitti-hand ${activeHand===i?'active':''} ${kittiHands[i].length===3?'complete':''}`} onClick={()=>selected.length?putSelected(i):setActiveHand(i)}>
              <div className="kitti-hand-head"><div><b>Hand {i+1}</b><span className="muted"> · {i===0?'HIGHEST':i===1?'MIDDLE':'LOWEST'}</span></div><span>{kittiHands[i].length}/3</span></div>
              <div className="cards">{kittiHands[i].map((c,j)=><button key={j} type="button" className={`cardface kitti-card assigned ${c.s===1||c.s===2?'red-suit':''} ${selected.includes(cardKey(c))?'selected':''}`} onClick={(e)=>{e.stopPropagation();toggleCard(c)}}>{label(c)}</button>)}</div>
              <div className="muted kitti-rank">{rankLabel(kittiHands[i])}</div>
              <button className="btn secondary hand-add" onClick={(e)=>{e.stopPropagation();putSelected(i)}}>Put selected in Hand {i+1}</button>
            </div>)}
          </div>
        </div>
        <div className="kitti-order"><b>Required order:</b> Hand 1 ≥ Hand 2 ≥ Hand 3. The game will not let you press Ready if a lower hand is stronger than the hand before it.</div>
        <div className="kitti-ready-status">
          <div className="kitti-ready-count">
            <b>{(st.ready||[]).length}/{players.length} players ready</b>
            <span className="muted">{st.ready?.includes(me)?'✓ Your hands are locked in — waiting for the other players.':'Review your 3 hands, then press Ready.'}</span>
          </div>
          <div className="kitti-ready-players">
            {players.map(p=><span key={p.player_id} className={`ready-pill ${st.ready?.includes(p.player_id)?'is-ready':''}`}>{st.ready?.includes(p.player_id)?'✓':'○'} {p.username}</span>)}
          </div>
        </div>
        <div className="actions"><button className={`btn ${st.ready?.includes(me)?'success':'primary'}`} onClick={()=>action('ready')} disabled={st.ready?.includes(me) || busy}>{st.ready?.includes(me)?'✓ READY — Hands locked':'✓ Ready — lock my 3 hands'}</button></div>
      </>}

      {room?.state?.phase==='playing'&&!isKitti&&room.game!=='teen-patti'&&<>
        <h3>Your cards</h3><div className="cards">{myCards.map((c:Card,i:number)=><div className={`cardface ${c.s===1||c.s===2?'red-suit':''}`} key={i}>{label(c)}</div>)}</div>
        {room.game==='poker'&&<><h3>Community</h3><div className="cards">{(st.community||[]).map((c:Card,i:number)=><div className={`cardface ${c.s===1||c.s===2?'red-suit':''}`} key={i}>{label(c)}</div>)}</div><div className="actions"><button className="btn secondary" onClick={()=>action('check')}>Check</button><button className="btn primary" onClick={()=>action('call')}>Call</button><button className="btn warn" onClick={()=>action('raise')}>Raise</button><button className="btn danger" onClick={()=>action('fold')}>Fold</button>{mine?.player_id===room.host_id&&<button className="btn success" onClick={()=>action('next')}>Next street</button>}</div></>}
      </>}

      {room?.game==='teen-patti'&&(st.phase==='seeing'||st.phase==='betting')&&<>
        <h3>Your cards</h3><div className="cards">{myCards.map((c:Card,i:number)=><div className={`cardface ${c.s===1||c.s===2?'red-suit':''}`} key={i}>{label(c)}</div>)}</div>
        {st.phase==='seeing'&&<div className="actions"><button className="btn secondary" onClick={()=>action('seen')} disabled={!!st.seen?.[me]}>{st.seen?.[me]?'✓ Cards seen — waiting...':'👀 See Cards'}</button><span className="notice compact">{players.filter(p=>!(st.folded||[]).includes(p.player_id)&&st.seen?.[p.player_id]).length}/{players.filter(p=>!(st.folded||[]).includes(p.player_id)).length} players have seen their cards.</span></div>}
        {st.phase==='betting'&&<div className="actions"><button className="btn primary" onClick={()=>action('bet')}>Chaal / Bet</button><button className="btn danger" onClick={()=>action('fold')}>Pack / Fold</button><button className="btn warn" onClick={()=>action('show')}>📤 Show</button></div>}
        {st.phase==='betting'&&<p className="muted">Turn: {players[st.turn]?.username||'—'}</p>}
      </>}

      {room?.state?.phase==='show'&&isKitti&&<div className="notice"><b>All Kitti hands are locked.</b> The showdown is being resolved automatically.</div>}
      {room?.state?.phase==='finished'&&isKitti&&<div className="notice kitti-result">
        <h2>🃏 Kitti Results</h2>
        {st.winner?<h3>🏆 Overall Winner: {players.find(p=>p.player_id===st.winner)?.username||'—'} · Won {st.kittiWins?.[st.winner]||0}/3 hands · Pot 🪙 {st.pot||0}</h3>:<h3>🤝 Kitti is tied — no single winner</h3>}
        {st.tiedWinners?.length>1&&<p>Winners tied: {st.tiedWinners.map((id:string)=>players.find(p=>p.player_id===id)?.username||id).join(', ')}</p>}
        <div className="showdown"><h3>All 3 hands revealed</h3>
          {(st.kittiResults||[]).map((res:any)=><div className="kitti-round" key={res.hand}>
            <div className="kitti-round-title"><b>Hand {res.hand}</b>{res.winner?<span>🏆 {players.find(p=>p.player_id===res.winner)?.username||'Player'} wins</span>:<span>🤝 Tie</span>}</div>
            {res.ranked.map((x:any)=><div className="show-row" key={x.id}><b>{players.find(p=>p.player_id===x.id)?.username||'Player'}</b><span>{(st.kittiHands?.[x.id]?.[res.hand-1]||[]).map((c:Card)=>label(c)).join('  ')}</span><span>{rankLabel(st.kittiHands?.[x.id]?.[res.hand-1]||[])}</span></div>)}
          </div>)}
        </div>
      </div>}
      {room?.state?.phase==='finished'&&!isKitti&&<div className="notice"><b>🏆 Winner: {players.find(p=>p.player_id===st.winner)?.username||'—'}</b>{st.revealed&&st.showdown?.length>0&&<><div className="showdown"><h3>Showdown — all cards revealed</h3>{st.showdown.map((x:any)=><div className="show-row" key={x.id}><b>{players.find(p=>p.player_id===x.id)?.username||'Player'}</b><span>{(st.hands?.[x.id]||[]).map((c:Card)=>label(c)).join('  ')}</span><span>{rankLabel(st.hands?.[x.id]||[])}</span></div>)}</div></>}</div>}
      <p className="muted">Turn: {players[st.turn]?.username||'—'} · Pot: 🪙 {st.pot||0}</p>
    </div>
  </main>
}
