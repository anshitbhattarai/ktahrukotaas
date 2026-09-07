export type GameKey='kitti'|'teen-patti'|'poker';
export const games=[
 {key:'kitti' as GameKey,name:'Kitti',icon:'🃏',players:'2–5',desc:'9-card Nepali/Indian Kitti: arrange three 3-card hands and win the majority of three rounds.'},
 {key:'teen-patti' as GameKey,name:'Teen Patti',icon:'♠️',players:'2–6',desc:'Classic 3-card game with boot, blind/seen play, chaal, fold and showdown.'},
 {key:'poker' as GameKey,name:"Texas Hold’em",icon:'♥️',players:'2–9',desc:'Two hole cards, five community cards, blinds and four betting streets.'}
];
