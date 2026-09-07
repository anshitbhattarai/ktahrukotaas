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
      .subscribe();
    return()=>{supabase.removeChannel(ch)}
  },[id]);

  async function load(){
    const r=await supabase.from('rooms').select('*').eq('id',id).single();
    const p=await supabase.from('room_players').select('*').eq('room_id',id).order('seat');
    setRoom(r.data);setPlayers(p.data||[]);
    if(r.data?.game==='kitti'){
      const saved=r.data.state?.kittiHands?.[localStorage.getItem('cr_player_id')||''];
      if(saved?.length===3)setKittiHands(saved);
    }
  }

  const mine=players.find(p=>p.player_id===me);
  async function saveState(state:any){
    await supabase.from('rooms').update({state,status:state.phase==='lobby'?'waiting':state.phase==='finished'?'finished':'playing'}).eq('id',id);
    await load();
  }

  async function start(){
    if(!room||players.length<2)return setError('Need at least 2 players.');
    setBusy(true);setError('');
    const d=shuffle(deck());
    let state:any={phase:'playing',pot:0,turn:0,round:0,deck:d,community:[],hands:{},bets:{}};
    if(room.game==='teen-patti'){
      players.forEach((p,i)=>state.hands[p.player_id]=d.slice(i*3,i*3+3));
      state.deck=d.slice(players.length*3);state.boot=10;state.pot=players.length*10;state.turn=0;state.seen={};state.phase='seeing';
    }else if(room.game==='kitti'){
      players.forEach((p,i)=>state.hands[p.player_id]=d.slice(i*9,i*9+9));
      state.deck=d.slice(players.length*9);state.kittiHands={};state.ready=[];state.round=0;
      setKittiHands([[],[],[]]);setSelected([]);setActiveHand(0);
    }else{
      players.forEach((p,i)=>state.hands[p.player_id]=d.slice(i*2,i*2+2));
      state.deck=d.slice(players.length*2);state.community=[];state.stage='preflop';state.turn=0;state.pot=0;state.bets={};state.sb=10;state.bb=20;
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
      if(s.ready.length===players.length){s.phase='show';s.round=1;s.turn=0}
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
  function putSelected(handIndex:number){
    setError('');
    if(!selected.length)return setError('Select one or more cards first.');
    const chosen=(room?.state?.hands?.[me]||[]).filter((c:Card)=>selected.includes(cardKey(c)));
    const remaining=kittiHands.map(g=>g.filter(c=>!selected.includes(cardKey(c))));
    if(remaining[handIndex].length+chosen.length>3)return setError(`Hand ${handIndex+1} can contain only 3 cards.`);
    remaining[handIndex]=[...remaining[handIndex],...chosen];
    setKittiHands(remaining);setSelected([]);setActiveHand(handIndex);
  }
  function removeSelected(){
    if(!selected.length)return;
    setKittiHands(kittiHands.map(g=>g.filter(c=>!selected.includes(cardKey(c)))));
    setSelected([]);
  }
  function autoOrder(){
    if(kittiHands.some(g=>g.length!==3))return setError('Place exactly 3 cards in each hand before auto-ordering.');
    setKittiHands([...kittiHands].sort((a,b)=>cmp(teenRank(b),teenRank(a))));
    setSelected([]);setError('');
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

      {room?.state?.phase==='playing'&&isKitti&&<>
        <div className="kittiHead">
          <div><h3>Arrange your 9 cards</h3><p className="muted">Select cards to highlight them, then choose which 3-card hand they belong to. Hand 1 must be the strongest, Hand 2 next, Hand 3 weakest.</p></div>
          <div className="row"><button className="btn secondary" onClick={removeSelected} disabled={!selected.length}>Remove selected</button><button className="btn secondary" onClick={autoOrder}>Auto-order 3 hands</button></div>
        </div>
        <div className="kitti-layout">
          <div className="kitti-dealt card">
            <div className="kitti-subtitle">YOUR 9 CARDS <span className="muted">({myCards.length}/9 placed)</span></div>
            <div className="cards kitti-card-grid">
              {myCards.map((c:Card,i:number)=>{
                const key=cardKey(c);const gi=groupFor(c);const sel=selected.includes(key);
                return <button key={i} type="button" className={`cardface kitti-card ${sel?'selected':''} ${gi>=0?'assigned':''}`} onClick={()=>toggleCard(c)} title={gi>=0?`In Hand ${gi+1}`:'Select this card'}>
                  <span>{label(c)}</span>{gi>=0&&<small>H{gi+1}</small>}
                </button>
              })}
            </div>
            <div className="notice kitti-help">Select 3 cards, then click <b>Put in Hand 1/2/3</b>. You can select assigned cards too and remove them.</div>
          </div>
          <div className="kitti-hands">
            {[0,1,2].map(i=><div key={i} className={`kitti-hand ${activeHand===i?'active':''} ${kittiHands[i].length===3?'complete':''}`} onClick={()=>setActiveHand(i)}>
              <div className="kitti-hand-head"><div><b>Hand {i+1}</b><span className="muted"> · {i===0?'HIGHEST':i===1?'MIDDLE':'LOWEST'}</span></div><span>{kittiHands[i].length}/3</span></div>
              <div className="cards">{kittiHands[i].map((c,j)=><button key={j} type="button" className={`cardface kitti-card assigned ${selected.includes(cardKey(c))?'selected':''}`} onClick={(e)=>{e.stopPropagation();toggleCard(c)}}>{label(c)}</button>)}</div>
              <div className="muted kitti-rank">{rankLabel(kittiHands[i])}</div>
              <button className="btn secondary hand-add" onClick={(e)=>{e.stopPropagation();putSelected(i)}}>Put selected in Hand {i+1}</button>
            </div>)}
          </div>
        </div>
        <div className="kitti-order"><b>Required order:</b> Hand 1 ≥ Hand 2 ≥ Hand 3. The game will not let you press Ready if a lower hand is stronger than the hand before it.</div>
        <div className="actions"><button className="btn primary" onClick={()=>action('ready')}>✓ Ready — lock my 3 hands</button></div>
      </>}

      {room?.state?.phase==='playing'&&!isKitti&&room.game!=='teen-patti'&&<>
        <h3>Your cards</h3><div className="cards">{myCards.map((c:Card,i:number)=><div className="cardface" key={i}>{label(c)}</div>)}</div>
        {room.game==='poker'&&<><h3>Community</h3><div className="cards">{(st.community||[]).map((c:Card,i:number)=><div className="cardface" key={i}>{label(c)}</div>)}</div><div className="actions"><button className="btn secondary" onClick={()=>action('check')}>Check</button><button className="btn primary" onClick={()=>action('call')}>Call</button><button className="btn warn" onClick={()=>action('raise')}>Raise</button><button className="btn danger" onClick={()=>action('fold')}>Fold</button>{mine?.player_id===room.host_id&&<button className="btn success" onClick={()=>action('next')}>Next street</button>}</div></>}
      </>}

      {room?.game==='teen-patti'&&(st.phase==='seeing'||st.phase==='betting')&&<>
        <h3>Your cards</h3><div className="cards">{myCards.map((c:Card,i:number)=><div className="cardface" key={i}>{label(c)}</div>)}</div>
        {st.phase==='seeing'&&<div className="actions"><button className="btn secondary" onClick={()=>action('seen')} disabled={!!st.seen?.[me]}>{st.seen?.[me]?'✓ Cards seen — waiting...':'👀 See Cards'}</button><span className="notice compact">{players.filter(p=>!(st.folded||[]).includes(p.player_id)&&st.seen?.[p.player_id]).length}/{players.filter(p=>!(st.folded||[]).includes(p.player_id)).length} players have seen their cards.</span></div>}
        {st.phase==='betting'&&<div className="actions"><button className="btn primary" onClick={()=>action('bet')}>Chaal / Bet</button><button className="btn danger" onClick={()=>action('fold')}>Pack / Fold</button><button className="btn warn" onClick={()=>action('show')}>📤 Show</button></div>}
        {st.phase==='betting'&&<p className="muted">Turn: {players[st.turn]?.username||'—'}</p>}
      </>}

      {room?.state?.phase==='show'&&isKitti&&<div className="notice">Kitti hands are locked. Hand 1 is shown first, then Hand 2, then Hand 3. The highest-ranked 3-card hand must be Hand 1.</div>}
      {room?.state?.phase==='finished'&&<div className="notice"><b>🏆 Winner: {players.find(p=>p.player_id===st.winner)?.username||'—'}</b>{st.revealed&&st.showdown?.length>0&&<><div className="showdown"><h3>Showdown — all cards revealed</h3>{st.showdown.map((x:any)=><div className="show-row" key={x.id}><b>{players.find(p=>p.player_id===x.id)?.username||'Player'}</b><span>{(st.hands?.[x.id]||[]).map((c:Card)=>label(c)).join('  ')}</span><span>{rankLabel(st.hands?.[x.id]||[])}</span></div>)}</div></>}</div>}
      <p className="muted">Turn: {players[st.turn]?.username||'—'} · Pot: 🪙 {st.pot||0}</p>
    </div>
  </main>
}
