import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { loadReferenceStats } from '../src/lib/scoring/matchups.ts';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
const PAGE=1000;
async function page(t:string,s:string,a:any){const o:any[]=[];for(let p=0;;p++){
  const{data,error}=await a(sb.from(t).select(s)).range(p*PAGE,(p+1)*PAGE-1);
  if(error)throw error;if(!data?.length)break;o.push(...data);if(data.length<PAGE)break;}return o;}
const P=new Map((await page('players','id, primary_position',(q:any)=>q)).map((p:any)=>[p.id,p.primary_position]));
const all=(await page('player_stats','player_id, match_rating, stats',(q:any)=>q.eq('season','2025-26')))
  .filter((r:any)=>P.get(r.player_id) && Number(r.stats?.minutes_played??0)>0);
const gk=all.filter((r:any)=>P.get(r.player_id)==='GK').map((r:any)=>r.stats);
const outComposite=all.filter((r:any)=>P.get(r.player_id)!=='GK')
  .map((r:any)=>Math.max(0,Math.min(1,(Number(r.match_rating)-3.5)/6)));
const ref = await loadReferenceStats(sb as any,'2025-26') as any;

const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const psd=(a:number[])=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);};
const sig=(v:number,m:number,s:number)=>s<=0?0.5:1/(1+Math.exp(-((v-m)/s)));

type Knobs={csBase:number;gcW:number;xgcW:number;svCap:number;csFloor:number|null;wDef:number;wSav:number};
function evaluate(k:Knobs,label:string){
  const defRaw=gk.map(s=>{
    const gc=Number(s.goals_conceded??0),xgc=Number(s.expected_goals_conceded??0);
    const sv=Math.max(0,Number(s.saves??0)),rec=Math.max(0,Number(s.fpl_recoveries??0));
    const cs=!!s.clean_sheet&&Number(s.minutes_played??0)>=60;
    const gkCs=cs?k.csBase+Math.min(k.svCap,sv):0;
    const xd=Math.max(-2.5,Math.min(2.5,xgc-gc));
    const zero=(!cs&&sv===0&&gc>=1)?4.5*gc:0;
    return rec*0.4+gkCs-gc*k.gcW+xd*k.xgcW-zero;});
  const savRaw=gk.map(s=>Math.max(0,Number(s.saves??0))*2.5+Math.max(0,Number(s.penalty_saves??0))*6);
  // self-consistent reference stats, exactly what recompute would write
  const dM=med(defRaw),dS=psd(defRaw),sM=med(savRaw),sS=psd(savRaw);

  const comps=gk.map((s,i)=>{
    const gc=Number(s.goals_conceded??0),sv=Math.max(0,Number(s.saves??0));
    const cs=!!s.clean_sheet&&Number(s.minutes_played??0)>=60;
    const def=sig(defRaw[i],dM,dS);
    const shots=sv+gc, pctv=shots>0?sv/shots:(cs?1:0.70);
    let sav=sig(savRaw[i],sM,sS)*0.45+sig(pctv,0.70,0.15)*0.55;
    if(cs&&k.csFloor!=null)sav=Math.max(sav,k.csFloor);
    const bps=Math.max(0,Number(s.bps??0)-0);
    const mi=sig(bps,ref.GK.match_impact.median,ref.GK.match_impact.stddev);
    const inf=sig(Number(s.influence??0),ref.GK.influence.median,ref.GK.influence.stddev);
    let c=mi*0.14+inf*0.06+def*k.wDef+sav*k.wSav;
    c+=0.20*Math.max(sav,def);
    return {c:Math.min(1,c),cs,sv,gc,pct:pctv};});
  const cvals=comps.map(x=>x.c);
  const ratings=cvals.map(c=>3.5+6*c);
  const csR=comps.filter(x=>x.cs).map((x,i)=>3.5+6*x.c);
  const ncR=comps.filter(x=>!x.cs).map(x=>3.5+6*x.c);
  // correlation of composite with save% vs with clean-sheet flag
  const corr=(a:number[],b:number[])=>{const n=a.length,m=(v:number[])=>v.reduce((x,y)=>x+y,0)/n;
    const ma=m(a),mb=m(b);let s1=0,s2=0,s3=0;
    for(let i=0;i<n;i++){s1+=(a[i]-ma)*(b[i]-mb);s2+=(a[i]-ma)**2;s3+=(b[i]-mb)**2;}
    return s1/Math.sqrt(s2*s3);};
  console.log(label.padEnd(38)
    +psd(cvals).toFixed(3).padStart(8)
    +(cvals.reduce((x,y)=>x+y,0)/cvals.length*6+3.5).toFixed(2).padStart(8)
    +psd(csR).toFixed(2).padStart(9)
    +(csR.reduce((x,y)=>x+y,0)/csR.length).toFixed(2).padStart(8)
    +(ncR.reduce((x,y)=>x+y,0)/ncR.length).toFixed(2).padStart(8)
    +corr(cvals,comps.map(x=>x.pct)).toFixed(2).padStart(9)
    +corr(cvals,comps.map(x=>x.cs?1:0)).toFixed(2).padStart(8));
}
console.log('outfield composite sd (the target):', psd(outComposite).toFixed(3), '\n');
console.log('scheme'.padEnd(38)+'comp sd'.padStart(8)+'mean rtg'.padStart(8)+'sd(CS)'.padStart(9)+'CS rtg'.padStart(8)+'no-CS'.padStart(8)+'r:save%'.padStart(9)+'r:CS'.padStart(8));
const NOW:Knobs={csBase:20,gcW:4.2,xgcW:2.5,svCap:4,csFloor:0.86,wDef:0.42,wSav:0.18};
evaluate(NOW,'as shipped (but correct ref stats)');
evaluate({...NOW,csFloor:null},'+ drop the 0.86 save floor');
evaluate({...NOW,csFloor:null,csBase:9,gcW:2.6,xgcW:4.5,svCap:10},'+ rebalance defensive');
evaluate({...NOW,csFloor:null,csBase:9,gcW:2.6,xgcW:4.5,svCap:10,wDef:0.28,wSav:0.32},'+ reweight (full spec)');
