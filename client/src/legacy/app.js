const STAGES=["Order","Prepress","Plates","Printing","Finishing","Packing","Dispatched"];
const COLS=["jobs","customers","paper","moves","machines","workers","locs","items","grn","siss","ptypes","plates","punches","so","settings"];
const S={jobs:[],customers:[],paper:[],moves:[],machines:[],workers:[],locs:[],items:[],grn:[],siss:[],ptypes:[],plates:[],punches:[],so:[],settings:[]};
let db=null, tab="summary", filter="active", q="";
let navTop="home",sub={jobs:"jobs",inward:"stock",more:"customers"};
let user=null, canVerify=false, meId=null, role=null;
/* roles: owner = full control; accounts (shared as Editor) = sales orders, challans, prices; factory (shared as Contributor) = production, no prices, no sales orders, no reports */
const isOwn=()=>role==="owner",isAdm=()=>role==="owner"||role==="accounts",isAcc=()=>role==="accounts",isFac=()=>role!=="owner"&&role!=="accounts";
const ROLE_TXT={owner:"Owner",accounts:"Accounts",factory:"Factory manager"};
const TABS={owner:["jobs","entry","stock","plates","stores","customers","summary","reports","masters"],accounts:["jobs","customers","summary","reports"],factory:["jobs","entry","stock","plates","stores","customers","summary"]};
/* prices live in their own records, readable only by owner & accounts */
const PRICED=["jobs","grn","items"],RAW={jobs:[],grn:[],items:[]};let PR={};
function viewP(c,r){const pd=PR[c+"_"+r.id];
  if(c==="jobs"){const o={...r};if(pd&&pd.rate!=null)o.rate=pd.rate;
    if(r.plan&&r.plan.fab){const pf=pd&&pd.fab||[];o.plan={...r.plan,fab:r.plan.fab.map((f,i)=>{const m=(pf[i]&&pf[i].process===f.process)?pf[i]:pf.find(x=>x.process===f.process);return m?{...f,rate:m.rate,runit:m.runit}:f})}}
    if(!isAdm()){delete o.rate;if(o.plan&&o.plan.fab)o.plan={...o.plan,fab:o.plan.fab.map(f=>{const x={...f};delete x.rate;delete x.runit;return x})}}return o}
  if(c==="grn"){const o={...r,lines:(r.lines||[]).map(l=>{const m=pd&&pd.byItem&&pd.byItem[l.itemId];const x=m?{...l,rate:m.rate,gst:m.gst}:{...l};if(!isAdm()){delete x.rate;delete x.gst}return x})};return o}
  if(c==="items"){const o={...r};if(pd&&pd.rate!=null)o.rate=pd.rate;if(!isAdm())delete o.rate;return o}
  return r}
const applyP=c=>{S[c]=RAW[c].map(r=>viewP(c,r))};
function splitP(col,body){const b=JSON.parse(JSON.stringify(body));let pd=null;
  if(col==="jobs"){pd={rate:b.rate??"",fab:(b.plan&&b.plan.fab||[]).map(f=>({process:f.process||"",rate:f.rate??"",runit:f.runit??""}))};delete b.rate;if(b.plan&&b.plan.fab)b.plan.fab=b.plan.fab.map(f=>{delete f.rate;delete f.runit;return f})}
  if(col==="grn"){pd={byItem:{}};b.lines=(b.lines||[]).map(l=>{if(l.itemId)pd.byItem[l.itemId]={rate:l.rate??"",gst:l.gst??""};delete l.rate;delete l.gst;return l})}
  if(col==="items"){pd={rate:b.rate??""};delete b.rate}
  return{b,pd}}
const isPending=p=>!!p.needsVerify&&!p.verified;
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isoL=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today=()=>isoL(new Date());
const inr=n=>"₹"+Math.round(+n||0).toLocaleString("en-IN");
const fmtN=n=>(+n||0).toLocaleString("en-IN");
const fmtD=d=>d?new Date(d+"T00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}):"";
const jno=j=>"J-"+String(j.no||0).padStart(4,"0");
function toast(t){const e=$("#toast");e.textContent=t;e.style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display="none",2600)}

/* ---------- storage: shared db, or this-device fallback ---------- */
function loadLocal(){try{const d=JSON.parse(localStorage.getItem("pf-erp")||"{}");COLS.forEach(c=>S[c]=d[c]||[])}catch(e){}}
function saveLocal(){try{localStorage.setItem("pf-erp",JSON.stringify(S))}catch(e){}}
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
let MV={};S.movesOld=[];
const rebuildMoves=()=>{S.moves=[...S.movesOld,...Object.values(MV).flat()]};
const nap=t=>new Promise(r=>setTimeout(r,t));
async function withLease(ref,holder,fn){let got=false;
  for(let t=0;t<12&&!got;t++){got=(await ref.acquire({holder,ttlMs:8000})).acquired;if(!got)await nap(400+Math.random()*500)}
  if(!got)throw Object.assign(new Error("busy"),{code:"busy"});try{return await fn()}finally{if(ref.release)ref.release({holder}).catch(()=>{})}}
// paper movements are kept many-per-document (one document per month) so they don't use up the database's record limit
async function putMoves(list){
  const recs=list.map(o=>({...o,id:o.id||newId()}));
  const found=Object.keys(MV).find(k=>MV[k].some(x=>recs.some(r=>r.id===x.id)));
  let key=found;if(!key){const base=today().slice(0,7);key=base;let i=1;while((MV[key]||[]).length+recs.length>900){i++;key=base+"-"+i}}
  const ref=db.collection("mv").doc(key);
  try{await withLease(ref,recs[0].id,async()=>{const g=await ref.get();const items=g.exists?[...(g.data().items||[])]:[];
    for(const r of recs){const i=items.findIndex(x=>x.id===r.id);i>=0?items[i]=r:items.push(r)}
    await ref.set({items});MV[key]=items;rebuildMoves()})}
  catch(e){toast(e.code==="busy"?"Another phone is saving paper right now. Try again in a few seconds.":e.code==="quota_exceeded"?"Storage is full. Archive old records from More → Masters & setup → Data & archive.":"Couldn't save. Check your connection and try again.");throw e}
  render();return recs[0].id}
async function put(col,obj){
  if(db&&col==="moves")return putMoves([obj]);
  let {id,...body}=obj;
  if(db){
    const ref=id?db.collection(col).doc(id):db.collection(col).doc();
    let pd=null;if(PRICED.includes(col)){const x=splitP(col,body);body=x.b;pd=x.pd}
    try{await ref.set(body);if(pd&&isAdm())await db.collection("prices").doc(col+"_"+ref.id).set(pd)}catch(e){
      if(e.code==="quota_exceeded")toast("Storage is full. Delete old records to add more.");
      else if(e.code==="quota_exceeded")toast("Storage is full. Archive old records from More → Masters & setup → Data & archive.");
      else if(e.code==="invalid_argument")toast("You have view-only access, so changes can't be saved.");
      else toast("Couldn't save. Check your connection and try again.");
      throw e}
    return ref.id}
  const nid=id||newId(); const arr=S[col]; const i=arr.findIndex(x=>x.id===nid);
  const rec={id:nid,...body}; i>=0?arr[i]=rec:arr.push(rec); saveLocal(); render(); return nid}
async function remove(col,id){
  if(db){try{await db.collection(col).doc(id).delete();if(PRICED.includes(col)&&isAdm())await db.collection("prices").doc(col+"_"+id).delete().catch(()=>{})}catch(e){toast("Couldn't delete. Try again.")}return}
  S[col]=S[col].filter(x=>x.id!==id);saveLocal();render()}

async function init(){
  render();
  try{db=window.claude&&window.claude.use?await window.claude.use("db"):null}catch(e){db=null}
  if(db){
    try{user=window.claude&&window.claude.use?await window.claude.use("user"):null}catch(e){user=null}
    try{const own=user?await user.isOwner():false,adm=user?await user.canEdit():false;role=own?"owner":adm?"accounts":"factory";meId=user?(await user.me()).id:null}catch(e){role="factory"}
    canVerify=isOwn();setRoleUI();
    $("#sync").textContent="Live";$("#sync").classList.add("live");
    const stop=e=>{$("#sync").textContent="Sync stopped — reopen";$("#sync").classList.remove("live")};
    COLS.filter(c=>isAdm()||c!=="so").forEach(c=>db.collection(c).limit(1000).onSnapshot(
      s=>{const rows=s.docs.map(d=>({id:d.id,...d.data()}));if(c==="moves"){S.movesOld=rows;rebuildMoves()}else if(PRICED.includes(c)){RAW[c]=rows;applyP(c)}else S[c]=rows;render()},stop));
    if(isAdm())db.collection("prices").limit(1000).onSnapshot(s=>{PR={};s.docs.forEach(d=>PR[d.id]=d.data());PRICED.forEach(applyP);render()},stop);
    db.collection("mv").limit(1000).onSnapshot(s=>{MV={};s.docs.forEach(d=>MV[d.id]=d.data().items||[]);rebuildMoves();render()},stop);
  }else{role="owner";canVerify=true;setRoleUI();loadLocal();$("#sync").textContent="This phone only";render()}
  KX.init({key:"print",prefix:"P",getDb:()=>db,role:()=>role||"factory",me:()=>meId,rerender:()=>render(),
    theme:{bg:"var(--paper)",card:"var(--card)",line:"var(--line)",fg:"var(--ink)",muted:"var(--muted)",acc:"var(--cyan)",onAcc:"#fff",ok:"var(--ok)",warn:"var(--yellow)",bad:"var(--magenta)"},
    docs:()=>{const o=[];
      S.jobs.forEach(j=>(j.disp||[]).forEach(e=>{if(e.via||!e.no)return;o.push({key:"DC"+e.no,kind:"out",ref:dcNo(e.no),date:e.d,party:j.customer||"",info:jno(j)+" · "+fmtN(e.q)+" pcs"+(e.veh?" · "+e.veh:"")+(e.tr?" · "+e.tr:"")})}));
      const pi={};S.paper.forEach(p=>{if(!p.inDate)return;const b=String(p.bill||"").trim();const k="PI:"+p.inDate+"|"+b.toUpperCase();
        const g=pi[k]=pi[k]||{key:k,kind:"in",ref:b?"Paper bill "+b:"Paper inward "+fmtD(p.inDate),date:p.inDate,party:p.supply==="party"?(p.party||"Party's paper"):(p.supplier||p.mill||""),n:0};g.n++});
      Object.values(pi).forEach(g=>{g.info=g.n+" paper lot"+(g.n>1?"s":"");o.push(g)});
      S.grn.forEach(g=>{if(g.date)o.push({key:"GRN"+g.no,kind:"in",opt:true,ref:grnNo(g),date:g.date,party:g.supplier||"",info:"Stores · "+(g.lines||[]).length+" item(s)"+(g.bill?" · bill "+g.bill:"")})});
      return o}});
  render()
}

const NAV={owner:["home","jobs","inward","exp","reports","more"],accounts:["home","jobs","exp","reports","more"],factory:["home","jobs","inward","exp","more"]};
const NAVL={home:"Home",jobs:"Jobs",inward:"Inward",exp:"Expenses",reports:"Reports",more:"More"};
const NAVI={exp:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',home:'<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
 jobs:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
 inward:'<path d="M3 8.5l9-4.5 9 4.5-9 4.5z"/><path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
 reports:'<path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/>',
 more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'};
const SUBS={jobs:{owner:[["so","Sales orders"],["jobs","Job sheets"],["entry","Record production"]],accounts:[["so","Sales orders"],["jobs","Job sheets"]],factory:[["jobs","Job sheets"],["entry","Record production"]]},
 inward:{all:[["stock","Paper"],["plates","Plates"],["punch","Punches"],["stores","Stores"]]},
 more:{owner:[["customers","Parties"],["setup","Masters & setup"]],all:[["customers","Parties"],["setup","Setup & help"]]}};
const subsFor=t=>SUBS[t]?(SUBS[t][role||"factory"]||SUBS[t].all||[]):[];
function applyNav(){const r=role||"factory";if(!NAV[r].includes(navTop))navTop="home";
  const L=subsFor(navTop);if(L.length&&!L.some(x=>x[0]===sub[navTop]))sub[navTop]=L[0][0];const v=sub[navTop];
  if(navTop==="exp")tab="exp";else if(navTop==="home")tab="summary";else if(navTop==="reports")tab="reports";
  else if(navTop==="jobs"){if(v==="entry")tab="entry";else{tab="jobs";jobsMode=v}}
  else if(navTop==="inward"){if(v==="plates"||v==="punch"){tab="plates";pmode=v}else tab=v}
  else tab=v==="setup"?"masters":"customers"}
function renderNav(){$("#navIn").innerHTML=NAV[role||"factory"].map(t=>`<button data-top="${t}" aria-current="${t===navTop}"><svg viewBox="0 0 24 24" aria-hidden="true">${NAVI[t]}</svg>${NAVL[t]}${t==="exp"&&window.KX&&KX.badge()?`<b class="kx-nb">${KX.badge()}</b>`:""}</button>`).join("")}
function subBar(){const L=subsFor(navTop);if(L.length<2)return"";
  const n={so:isAdm()?S.so.filter(o=>(o.status||"draft")==="draft").length:0,entry:S.jobs.filter(j=>j.plan&&!j.act&&j.stage>=4).length};
  return `<div class="seg subs" role="group">${L.map(([k,l])=>`<button data-sub="${k}" aria-pressed="${sub[navTop]===k}">${esc(l)}${n[k]?` <b class="segn">${n[k]}</b>`:""}</button>`).join("")}</div>`}
function setRoleUI(){applyNav();renderNav();
  document.body.classList.toggle("noprice",isFac());$("nav").classList.add("ready");
  const b=$("#rolebadge");if(b){b.textContent=ROLE_TXT[role||"factory"];b.hidden=!db}}
/* ---------- helpers ---------- */
function balance(pid){const p=S.paper.find(x=>x.id===pid);if(!p)return 0;
  return (+p.opening||0)+S.moves.filter(m=>m.paperId===pid).reduce((a,m)=>a+(+m.qty||0),0)}
const OWN="Arihant Enterprises";
const pinKey=v=>String(v||"").trim().toUpperCase().replace(/\s+/g,"");
const pinDocId=k=>"p_"+k.replace(/[^A-Za-z0-9_\-~:@+]/g,c=>"~"+c.charCodeAt(0).toString(16)).slice(0,180);
const normName=v=>String(v||"").trim().toLowerCase();
const srcMatch=(p,src,party)=>!src?true:src==="party"?p.supply==="party"&&!!normName(party)&&normName(p.party)===normName(party):p.supply!=="party";
const srcOf=j=>j.paperSrc||(S.paper.find(x=>x.id===j.paperId)?.supply==="party"?"party":"own");
const SRC_OPTS=[{v:"own",t:"We supply (Arihant stock)"},{v:"party",t:"Party supplied"}];
function emptyPaperTxt(src,party){if(src!=="party")return"Not linked";if(!String(party||"").trim())return"Enter the customer first";
  return S.paper.some(p=>srcMatch(p,"party",party)&&balance(p.id)>0)?"Not linked":"No paper from "+party.trim()+" in stock"}
function fillPaperSel(sel,src,party){if(!sel)return;const cur=sel.value;
  const opts=[{v:"",t:emptyPaperTxt(src,party)},...paperOptions(cur,src,party,false)];
  sel.innerHTML=opts.map(o=>`<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("");
  sel.value=opts.some(o=>o.v===cur)?cur:""}
function paperOptions(cur,src,party,keepCur=true){return [...S.paper].filter(p=>(keepCur&&p.id===cur)||(srcMatch(p,src,party)&&(p.id===cur||balance(p.id)>0)))
  .sort((a,b)=>String(a.pin||"").localeCompare(String(b.pin||""),undefined,{numeric:true}))
  .map(p=>({v:p.id,t:paperName(p)+" ["+fmtN(balance(p.id))+" "+(p.unit||"sheets")+"]"}))}
function lastPin(){let best=null;S.paper.forEach(p=>{const m=String(p.pin||"").match(/^(.*?)(\d+)$/);if(m&&(!best||+m[2]>best.n))best={pre:m[1],n:+m[2],w:m[2].length}});return best||{pre:"",n:0,w:4}}
const fmtPin=(b,n)=>b.pre+String(n).padStart(b.w,"0");
function nextPin(){const b=lastPin();return fmtPin(b,b.n+1)}
// Auto-generate the next PIN in sequence. A shared counter (held briefly with a lease) keeps two phones from taking the same number.
async function allocPin(paperId){
  const b=lastPin();
  if(!db){for(let n=b.n+1;;n++){const pin=fmtPin(b,n);if(!(await claimPin(pin,paperId)))return{pin}}}
  const cref=db.doc("meta/pinCounter");let got=false;
  for(let i=0;i<8&&!got;i++){try{got=(await cref.acquire({holder:paperId,ttlMs:8000})).acquired}catch(e){return{err:"Couldn't get a PIN. Check your connection and try again."}}
    if(!got)await new Promise(r=>setTimeout(r,600+Math.random()*400))}
  if(!got)return{err:"Another phone is saving paper right now. Try again in a few seconds."};
  try{const g=await cref.get();const c=g.exists?g.data():{};
    let n=Math.max(+c.n||0,b.n)+1;const base={pre:c.pre??b.pre,w:+c.w||b.w};
    for(let t=0;t<20;t++,n++){const pin=fmtPin(base,n);const err=await claimPin(pin,paperId);
      if(!err){await cref.set({n,pre:base.pre,w:base.w});if(cref.release)cref.release({holder:paperId}).catch(()=>{});return{pin}}
      if(!/already used/.test(err))return{err}}
    return{err:"Couldn't find a free PIN. Try again."}
  }catch(e){return{err:"Couldn't get a PIN. Check your connection and try again."}}}
// PIN must be unique across all paper. Checked against loaded list, then claimed in a shared registry so two phones can't save the same PIN.
async function claimPin(pin,paperId,oldPin){
  const k=pinKey(pin);const clash=S.paper.find(x=>x.id!==paperId&&pinKey(x.pin)===k);
  if(clash)return `PIN ${pin} is already used (${clash.name||"another paper"}). Every paper needs its own PIN.`;
  if(!db)return null;
  try{const ref=db.collection("pins").doc(pinDocId(k));const a=await ref.acquire({holder:paperId,ttlMs:5000});
    if(!a.acquired)return "Someone else is saving this PIN right now. Try again in a few seconds.";
    const g=await ref.get();const owner=g.exists?g.data().paperId:null;
    if(owner&&owner!==paperId&&S.paper.some(x=>x.id===owner))return `PIN ${pin} is already used. Every paper needs its own PIN.`;
    await ref.set({paperId,pin});if(ref.release)ref.release({holder:paperId}).catch(()=>{});
  }catch(e){return "Couldn't check the PIN. Check your connection and try again."}
  if(oldPin&&pinKey(oldPin)!==k)releasePin(oldPin,paperId);
  return null}
async function releasePin(pin,paperId){if(!db||!pin)return;try{const r=db.collection("pins").doc(pinDocId(pinKey(pin)));const g=await r.get();if(g.exists&&g.data().paperId===paperId)await r.delete()}catch(e){}}
const toMm=(v,u)=>{const n=+v;return n>0?Math.round(n*(u==="inch"?25.4:u==="cm"?10:1)*10)/10:0};
const sizeTxt=p=>p.lmm&&p.wmm?`${fmtN(Math.round(p.lmm))} × ${fmtN(Math.round(p.wmm))} mm`:(p.size||"");
const toMm0=(v,u)=>{const n=+v;return n>0?Math.round(n*(u==="inch"?25.4:u==="cm"?10:1)):0};
const inchN=n=>String(Math.round(n*100)/100);
const sizeInch=p=>p.lin&&p.win?`${inchN(+p.lin)} × ${inchN(+p.win)} in`:p.lmm&&p.wmm?`${inchN(p.lmm/25.4)} × ${inchN(p.wmm/25.4)} in`:"";
// Weight per sheet in kg: (((L×W×gsm)÷20000)÷500), with L and W in cm
const sheetKg=(lmm,wmm,gsm)=>lmm&&wmm&&gsm?((lmm/10)*(wmm/10)*(+gsm)/20000)/500:0;
const pSheetKg=p=>sheetKg(p.lmm,p.wmm,p.gsm);
function sheetsOf(p,q){const u=p.unit||"sheets",k=pSheetKg(p);return u==="sheets"?q:u==="reams"?q*500:u==="kg"&&k?q/k:null}
function kgOf(p,q){const u=p.unit||"sheets";if(u==="kg")return q;const sh=sheetsOf(p,q),k=pSheetKg(p);return sh!=null&&k?sh*k:null}
const kgTxt=n=>n==null?"":n>=1000?(n/1000).toLocaleString("en-IN",{maximumFractionDigits:2})+" tonnes":n.toLocaleString("en-IN",{maximumFractionDigits:1})+" kg";
function convTxt(p,q){const u=p.unit||"sheets";if(u==="kg"){const sh=sheetsOf(p,q);return sh!=null?"≈ "+fmtN(Math.floor(sh))+" sheets":""}const k=kgOf(p,q);return k!=null?"≈ "+kgTxt(k):""}
const supplyTxt=p=>p.supply==="party"?"Party: "+(p.party||"not set"):OWN;
const supplyTag=p=>p.supply==="party"?`<span class="tag party">Party: ${esc(p.party||"?")}</span>`:`<span class="tag">Arihant</span>`;
const pinTxt=p=>p&&p.pin?"PIN "+p.pin:"No PIN";
const pinTag=p=>`<span class="pin${p.pin?"":" none"}">${esc(p.pin||"No PIN")}</span>`;
const paperName=p=>p?pinTxt(p)+": "+[p.name,p.gsm&&p.gsm+" gsm",sizeTxt(p)].filter(Boolean).join(", ")+(p.supply==="party"?" (party: "+(p.party||"?")+")":""):"";
let stockFilter="all";
function dueClass(j){if(!j.due||j.stage>=6)return"";const d=(new Date(j.due+"T00:00")-new Date(today()+"T00:00"))/864e5;return d<0?"due-late":d<=2?"due-soon":""}
const pipe=s=>`<div class="pipe" aria-hidden="true">${STAGES.map((_,i)=>`<span class="${i<s?"done":i===s?"now":""}"></span>`).join("")}</div>`;

/* ---------- forms ---------- */
/* ---------- masters: every editable drop-down list ---------- */
const LDEF=[
 ["ptype","Items / product types","Job sheet & sales order: Item",()=>_PTYPES],
 ["paper","Paper types","Paper inward",()=>_PAPER_TYPES],
 ["process","Fabrication processes","Plan job: Fabrication",()=>_PROCESSES],
 ["lamf","Lamination films","Plan job: lamination film with its factor (1550 × factor ÷ L ÷ W)",()=>_LAMF],
 ["jwt","Job work types","Plan job: outsourced job work",()=>_JWT],
 ["runit","Job work rate units","Plan job: outsourced rate",()=>_RUNITS],
 ["mtype","Machine types","Machines",()=>_MTYPES],
 ["pltype","Plate types","Plan job & plate inward",()=>_PLTYPES],
 ["form","Plate forms / sets","Plate inward",()=>_FORMS],
 ["putype","Punch types","Punch inward",()=>_PUTYPES],
 ["cons","Consumables","Plan job: consumable suggestions",()=>_CONSUMABLES],
 ["scat","Stores categories","Stores: GRN & products",()=>_SCATS],
 ["sunit","Units of measurement","Stores: GRN & products",()=>_SUNITS],
 ["gst","GST rates (%)","Sales order & GRN",()=>_GSTS],
 ["wst","Wastage stages","Job sheet page 2 & JS entry",()=>_WST],
 ["prodst","Production record stages","Job sheet page 1 & JS entry",()=>_PRODST]];
const LMAP=Object.fromEntries(LDEF.map(x=>[x[0],x]));
function LST(k){const m=S.settings.find(x=>x.id==="lists");const v=m&&m[k];return Array.isArray(v)&&v.length?v:LMAP[k][3]()}
const LS={get PTYPES(){return LST("ptype")},get PAPER_TYPES(){return LST("paper")},get PROCESSES(){return LST("process")},get LAMF(){return LST("lamf")},get JWT(){return LST("jwt")},
 get RUNITS(){return LST("runit").map(t=>({v:t,t}))},get MTYPES(){return LST("mtype")},get PLTYPES(){return LST("pltype")},get FORMS(){return LST("form")},get PUTYPES(){return LST("putype")},get CONSUMABLES(){return LST("cons")},
 get SCATS(){return LST("scat")},get SUNITS(){return LST("sunit")},get GSTS(){return LST("gst")},get WST(){return LST("wst")},get PRODST(){return LST("prodst")}};
function renderMasters(){if(!isOwn())return `<div class="empty">Only the owner can change masters.</div>`;
  return `<p class="meta" style="margin:4px 0 10px">Every drop-down list in the app. Tap a list to add, rename, reorder or remove entries. Changes reach everyone's phone straight away.</p>
  <div class="list">${LDEF.map(([k,t,u])=>{const L=k==="ptype"?ptypeList():LST(k);return `<button class="row" data-ml="${k}"><div class="row-top"><span class="cust">${esc(t)}</span><span class="meta">${L.length}</span></div><div class="meta">${esc(u)}</div><div class="meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(L.slice(0,6).map(x=>k==="lamf"?x.v+" ("+x.k+")":k==="gst"?x+"%":x).join(", "))}${L.length>6?"…":""}</div></button>`}).join("")}</div>
  <h2>Other masters</h2><div class="btns"><button class="btn" data-mv="mach">Machines (${S.machines.length})</button><button class="btn" data-mv="wk">Job workers (${S.workers.length})</button></div>
  <div class="btns" style="margin-top:8px"><button class="btn" data-mv="loc">Storage locations</button><button class="btn" data-mv="co">Company &amp; T&amp;C</button></div>`}
function listEditor(k){const [,title,used]=LMAP[k];const lam=k==="lamf",num=k==="gst";
  const cur=k==="ptype"?ptypeList():LST(k);
  const row=x=>`<div class="lrow" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="search lv" style="flex:1" value="${esc(lam?x.v:x??"")}"${num?' type="number" inputmode="decimal" step="any" min="0"':""} placeholder="${num?"e.g. 18":"Name"}">${lam?`<input class="search lk" style="width:76px" type="number" inputmode="decimal" step="any" min="0" value="${esc(x.k??"")}" placeholder="Factor">`:""}
    <button class="mini" type="button" data-up aria-label="Move up" style="font-size:18px;padding:4px">↑</button><button class="mini" type="button" data-dn aria-label="Move down" style="font-size:18px;padding:4px">↓</button><button class="mini" type="button" data-rm aria-label="Remove" style="color:var(--magenta);font-size:20px;padding:4px">×</button></div>`;
  sheet(`<h3>${esc(title)}</h3><p class="meta" style="margin-top:-6px">Used in: ${esc(used)}.${lam?" Factor: 108 for BOPP 10 micron, 85 for BOPP & Matte 12 micron.":""} Renaming or removing an entry doesn't change old records.</p>
  <div id="lrows">${cur.map(row).join("")}</div><button class="add" type="button" id="ladd">+ Add</button>
  <div class="btns" style="margin-top:12px"><button class="btn" id="lback">Back</button><button class="btn" id="ldef">Reset to default</button><button class="btn primary" id="save">Save list</button></div>`);
  const box=$("#lrows");
  box.addEventListener("click",e=>{const r=e.target.closest(".lrow");if(!r)return;
    if(e.target.closest("[data-rm]"))r.remove();else if(e.target.closest("[data-up]")&&r.previousElementSibling)box.insertBefore(r,r.previousElementSibling);else if(e.target.closest("[data-dn]")&&r.nextElementSibling)box.insertBefore(r.nextElementSibling,r)});
  $("#ladd").onclick=()=>{box.insertAdjacentHTML("beforeend",row(lam?{v:"",k:""}:""));box.lastElementChild.querySelector("input").focus()};
  $("#lback").onclick=()=>{closeSheet();render()};
  $("#ldef").onclick=()=>{box.innerHTML=LMAP[k][3]().map(row).join("")};
  $("#save").onclick=async e=>{if(db&&!canVerify){toast("Only the owner can change masters.");return}
    const out=[],seen=new Set();
    for(const r of box.querySelectorAll(".lrow")){const v=r.querySelector(".lv").value.trim().replace(/\s+/g," ");if(!v)continue;const key=v.toLowerCase();if(seen.has(key)){toast(`"${v}" is listed twice.`);return}seen.add(key);
      if(num){if(!(+v>=0)){toast("GST rates must be numbers.");return}out.push(+v)}
      else if(lam){const f=+r.querySelector(".lk").value;if(!(f>0)){toast(`Enter the factor for ${v}.`);return}out.push({v,k:f})}else out.push(v)}
    if(!out.length){toast("Keep at least one entry.");return}
    if(num)out.sort((a,b)=>a-b);
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    const doc=S.settings.find(x=>x.id==="lists")||{};
    try{await put("settings",{...doc,id:"lists",[k]:out});
      if(k==="ptype"){const keep=new Set(out.map(x=>x.toLowerCase()));for(const t of S.ptypes.filter(t=>!keep.has(String(t.name||"").toLowerCase())))await remove("ptypes",t.id)}}
    catch(x){btn.disabled=false;return}
    toast(title+" saved");closeSheet();render()}}
function fields(list,v={}){return list.map(f=>{
  const val=v[f.k]??f.def??"";
  if(f.row)return `<div class="two" style="--n:${f.row.length}">${fields(f.row,v)}</div>`;
  if(f.html)return f.html;
  if(f.type==="select")return `<label>${f.label}<select name="${f.k}">${f.options.map(o=>`<option value="${esc(o.v)}"${String(o.v)===String(val)?" selected":""}>${esc(o.t)}</option>`).join("")}</select></label>`;
  if(f.type==="textarea")return `<label>${f.label}<textarea name="${f.k}" rows="2">${esc(val)}</textarea></label>`;
  return `<label>${f.label}<input name="${f.k}" type="${f.type||"text"}" value="${esc(val)}"${f.type==="number"?' inputmode="decimal" step="any"':""}${f.list?` list="${f.list}"`:""}${f.ph?` placeholder="${esc(f.ph)}"`:""}></label>`}).join("")}
function read(){const o={};$("#sheet-body").querySelectorAll("[name]").forEach(i=>o[i.name]=i.value.trim());return o}
function sheet(html){const o=$("#sheet-body"),n=o.cloneNode(false);o.replaceWith(n);n.innerHTML=html;n.querySelectorAll('input[type="number"]').forEach(i=>i.min="0");$("#sheetwrap").classList.add("open");const f=$("#sheet-body").querySelector("input,select,button");f&&f.focus({preventScroll:true})}
function closeSheet(){$("#sheetwrap").classList.remove("open")}
$("#scrim").onclick=closeSheet;
/* no negative numbers anywhere */
document.addEventListener("keydown",e=>{const t=e.target;if(t&&t.matches&&t.matches('input[type="number"]')&&(e.key==="-"||e.key==="Subtract")){e.preventDefault();toast("Negative values are not allowed.")}},true);
document.addEventListener("input",e=>{const t=e.target;if(t&&t.matches&&t.matches('input[type="number"]')&&(String(t.value).includes("-")||+t.value<0)){t.value=String(t.value).replace(/-/g,"");toast("Negative values are not allowed.")}},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeSheet()});
function armDelete(btn,fn){if(btn.dataset.armed){fn();closeSheet();return}btn.dataset.armed=1;btn.classList.add("armed");btn.textContent="Tap again to delete";setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.classList.remove("armed");btn.textContent="Delete"}},3000)}

/* ---------- jobs ---------- */
const _PTYPES=["Envelope","Book","Leaflet","Brochure","Catalogue","Booklet","Magazine","Mono carton","Box","Visiting card","Letterhead","Bill book","Invoice / form","Sticker / label","Tag","Poster","Calendar","Diary","Notebook","Folder / file","Certificate","Other"];
const ptypeList=()=>{const m=new Map();for(const x of [...LS.PTYPES,...S.ptypes.map(t=>t.name)]){const t=String(x||"").trim();if(t&&!m.has(t.toLowerCase()))m.set(t.toLowerCase(),t)}return[...m.values()]};
const jobDesc=j=>[j.ptype,j.item].filter(Boolean).join(": ");
function jobForm(j={}){
  const src0=srcOf(j);
  const paperOpts=[{v:"",t:emptyPaperTxt(src0,j.customer)},...paperOptions(j.paperId,src0,j.customer,false)];
  sheet(`<h3>${j.id?"Edit "+jno(j):"New job"}</h3>
  <datalist id="custlist">${S.customers.map(c=>`<option value="${esc(c.name)}">`).join("")}</datalist>
  ${fields([
    {html:(()=>{const cur=String(j.ptype||"").trim();const L=ptypeList();const opts=[{v:"",t:"Select item"},...L.map(x=>({v:x,t:x})),...(cur&&!L.some(x=>x.toLowerCase()===cur.toLowerCase())?[{v:cur,t:cur}]:[]),{v:"__new",t:"+ Add new item"}];
      return fields([{k:"ptype",label:"Item",type:"select",options:opts}],{ptype:L.find(x=>x.toLowerCase()===cur.toLowerCase())||cur})+`<div id="ptnew" hidden>${fields([{k:"ptype_new",label:"New item",ph:"e.g. Wedding card"}])}</div>`})()},
    {k:"item",label:"Job name",ph:"e.g. ABC Ltd letterhead envelope 9×4"},
    {k:"customer",label:"Customer",list:"custlist"},
    {k:"qty",label:"Quantity",type:"number"},
    {html:(()=>{const z=j.fsl?{fsl:j.fsl,fsw:j.fsw,fsu:j.fsu}:parseSz(j.size);return `<div class="two" style="grid-template-columns:1fr 1fr 1.1fr">${fields([{k:"fsl",label:"Final cut size L",type:"number"},{k:"fsw",label:"W",type:"number"},{k:"fsu",label:"In",type:"select",options:FSU}],{fsu:"mm",...z})}</div>${!z.fsl&&j.size?`<p class="meta" style="margin:-4px 0 8px">Old size: ${esc(j.size)}</p>`:""}`})()},
    {k:"paperSrc",label:"Paper supplied by",type:"select",options:SRC_OPTS,def:src0},
    {k:"paperId",label:"Paper (PIN)",type:"select",options:paperOpts},
    {html:`<div class="calc" id="jcalc" hidden></div>`},
    {row:[{k:"colors",label:"Colours",ph:"e.g. 4+0"},{k:"finishing",label:"Finishing",ph:"Lamination, UV…"}]},
    {row:[{k:"due",label:"Delivery date",type:"date"},...(isAdm()?[{k:"rate",label:"Rate per piece (₹)",type:"number"}]:[])]},
    {k:"notes",label:"Notes",type:"textarea"},
    {html:kidsOf(j).length?`<p class="meta">Linked job sheets dispatched with this one: ${kidsOf(j).map(jno).join(", ")}.</p>`:fields([{k:"withJob",label:"Dispatched along with (main job sheet)",type:"select",options:[{v:"",t:"No, this job is dispatched on its own"},...S.jobs.filter(x=>x.id!==j.id&&!x.withJob&&(x.stage<6||x.id===j.withJob)).sort((a,b)=>(normName(b.customer)===normName(j.customer||""))-(normName(a.customer)===normName(j.customer||""))||b.no-a.no).map(x=>({v:x.id,t:jno(x)+" "+x.customer+": "+[x.ptype,x.item].filter(Boolean).join(" ")}))]}],j)+`<p class="meta" style="margin:-4px 0 10px">For a book cover, pick the inner paper job sheet. This job will then go out only on that job's challan.</p>`}],j)}
  <div class="btns"><button class="btn" onclick="closeSheet()">Cancel</button><button class="btn primary" id="save">${j.id?"Save changes":"Create job"}</button></div>`);
  const jwarn=()=>{const f=read();const p=S.paper.find(x=>x.id===f.paperId);let need=0;
    if(p&&j.plan){const r=paperCalc({...j,qty:f.qty},j.plan,p.id);const done=j.id?jobMoves(j).filter(m=>m.paperId===p.id).reduce((a,m)=>a+(sheetsOf(p,-(+m.qty||0))||0),0):0;need=Math.max(0,Math.ceil(r.full-done))}
    const t=stockWarn(p,need,j.id);$("#jcalc").innerHTML=t;$("#jcalc").hidden=!t};
  $('[name="paperId"]').addEventListener("change",jwarn);$('[name="qty"]').addEventListener("input",jwarn);jwarn();
  {const refill=()=>{const f=read();fillPaperSel($('[name="paperId"]'),f.paperSrc,f.customer);jwarn()};
   $('[name="paperSrc"]').onchange=refill;$('[name="customer"]').addEventListener("input",refill);$('[name="customer"]').addEventListener("change",refill)}
  $('[name="ptype"]').addEventListener("change",e=>{const n=$("#ptnew");n.hidden=e.target.value!=="__new";if(!n.hidden)n.querySelector("input").focus()});
  $("#save").onclick=async()=>{
    const v=read();
    if(v.ptype==="__new"){v.ptype=(v.ptype_new||"").trim();if(!v.ptype){toast("Type the new item.");return}}
    delete v.ptype_new;
    if(!v.ptype){toast("Select the item first.");return}
    if(!v.item){toast("Type the job name.");return}
    if(!v.customer){toast("Add the customer.");return}
    if(!!v.fsl!==!!v.fsw){toast("Enter both L and W of the final cut size.");return}
    v.size=fsTxt(v.fsl,v.fsw,v.fsu)||(j.fsl?"":j.size||"");
    if(v.withJob){const m=S.jobs.find(x=>x.id===v.withJob);if(m&&normName(m.customer)!==normName(v.customer)){toast(`${jno(m)} is for ${m.customer}. Link only jobs of the same party.`);return}}
    if(!ptypeList().some(x=>x.toLowerCase()===v.ptype.toLowerCase()))await put("ptypes",{name:v.ptype});
    const rec={...j,...v};
    if(!j.id){rec.no=S.jobs.reduce((a,x)=>Math.max(a,+x.no||0),0)+1;rec.stage=0;rec.created=today();rec.log=[{s:0,d:today()}]}
    if(v.customer&&!S.customers.some(c=>c.name.toLowerCase()===v.customer.toLowerCase()))await put("customers",{name:v.customer});
    await put("jobs",rec);closeSheet();toast(j.id?"Job saved":`${jno(rec)} created`)}
}
/* partial / complete progress for Printing (3) and Finishing (4) */
const PROG_ST=[3];
const progTarget=(j,s)=>s===3&&j.plan?.printSheets?{n:+j.plan.printSheets,u:"sheets"}:{n:+j.qty||0,u:"pcs"};
const progList=(j,s)=>(j.prog&&j.prog[s])||[];
const progDone=(j,s)=>progList(j,s).reduce((a,e)=>a+(+e.q||0),0);
function progTxt(j,s){const d=progDone(j,s);if(!d)return"";const t=progTarget(j,s);return `Partial: ${fmtN(d)}${t.n?" of "+fmtN(t.n):""} ${t.u}${t.n?" ("+Math.min(100,Math.round(d/t.n*100))+"%)":""}`}
function partForm(j){const s=j.stage,t=progTarget(j,s),d=progDone(j,s);
  sheet(`<h3>${STAGES[s]} partly done: ${jno(j)}</h3>
  <p class="meta" style="margin-top:-6px">${t.n?`Target ${fmtN(t.n)} ${t.u}. `:""}Done so far ${fmtN(d)} ${t.u}.</p>
  ${fields([{row:[{k:"q",label:`Done now (${t.u})`,type:"number"},{k:"d",label:"Date",type:"date",def:today()}]},{k:"note",label:"Note",ph:"e.g. Machine, operator, shift"}])}
  <div class="calc" id="ptcalc" hidden></div>
  <div class="btns"><button class="btn" id="pcancel">Cancel</button><button class="btn primary" id="save">Save</button></div>`);
  const pc=()=>{const n=+read().q;let x="";if(n>0&&t.n){const tot=d+n;x=tot>t.n?`<span class="caution">Total ${fmtN(tot)} is more than the target ${fmtN(t.n)} ${t.u}.</span>`:`Total after this: <b>${fmtN(tot)}</b> of ${fmtN(t.n)} ${t.u}, ${fmtN(t.n-tot)} left`}
    $("#ptcalc").innerHTML=x;$("#ptcalc").hidden=!x};
  $("#sheet-body").addEventListener("input",pc);
  $("#pcancel").onclick=()=>jobView(j.id);
  $("#save").onclick=async()=>{const v=read();const n=+v.q;if(!(n>0)){toast("Enter a quantity above 0.");return}
    const prog={...(j.prog||{})};prog[s]=[...progList(j,s),{q:n,d:v.d||today(),note:v.note||"",at:Date.now()}];
    await put("jobs",{...j,prog});toast(STAGES[s]+" progress saved");jobView(j.id)}}
/* ---------- fabrication steps, packing inward, dispatch ---------- */
const fabSteps=j=>j.plan?.fab||[];
const stepDone=(j,i)=>(j.fabDone||[]).find(e=>e.i===i&&e.process===fabSteps(j)[i]?.process);
const nextStep=j=>fabSteps(j).findIndex((_,i)=>!stepDone(j,i));
const sumQ=a=>a.reduce((t,e)=>t+(+e.q||0),0);
const inQty=j=>sumQ(j.inward||[]),dispQty=j=>sumQ(j.disp||[]),readyQty=j=>inQty(j)-dispQty(j);
const dcNo=n=>"DC-"+String(n).padStart(4,"0");
const kidsOf=j=>j&&j.id?S.jobs.filter(x=>x.withJob===j.id):[];
const mainOf=j=>j&&j.withJob?S.jobs.find(x=>x.id===j.withJob):null;
const dispMax=j=>Math.min(readyQty(j),...kidsOf(j).map(readyQty));
function stageExtra(j){if(j.stage===4){const st=fabSteps(j);if(!st.length)return"";const ns=nextStep(j);return ns<0?"all steps closed, inward pending":`step ${ns+1} of ${st.length}: ${st[ns].process}`}
  if(j.stage===5)return `ready ${fmtN(readyQty(j))}, dispatched ${fmtN(dispQty(j))} of ${fmtN(j.qty)}${mainOf(j)?", delivered with "+jno(mainOf(j)):""}`;return mainOf(j)?"delivered with "+jno(mainOf(j)):kidsOf(j).length?"with "+kidsOf(j).map(jno).join(", "):""}
function stepForm(j,i){const f=fabSteps(j)[i];const out=f.mode==="Outsource";
  sheet(`<h3>Close step ${i+1}: ${esc(f.process)}</h3><p class="meta" style="margin-top:-6px">${jno(j)}${out?` · outsourced${f.worker?" to "+esc(f.worker):""}`:""}</p>
  ${fields([{row:[{k:"d",label:out?"Received back on":"Done on",type:"date",def:today()},{k:"q",label:out?"Qty received (pcs)":"Qty OK (pcs)",type:"number",def:j.qty||""}]},{k:"note",label:"Note"}])}
  <div class="btns"><button class="btn" id="sc">Cancel</button><button class="btn primary" id="save">Close step</button></div>`);
  $("#sc").onclick=()=>jobView(j.id);
  $("#save").onclick=async()=>{const v=read();const fabDone=[...(j.fabDone||[]).filter(e=>e.i!==i),{i,process:f.process,d:v.d||today(),q:+v.q||0,note:v.note||""}];
    await put("jobs",{...j,fabDone});const nj={...j,fabDone};toast(nextStep(nj)<0?"All fabrication steps closed. Inward the material for packing.":"Step closed");jobView(j.id)}}
function inwardForm(j){const done=inQty(j),bal=Math.max(0,(+j.qty||0)-done);
  sheet(`<h3>Inward for packing: ${jno(j)}</h3><p class="meta" style="margin-top:-6px">Order ${fmtN(j.qty)} pcs, inwarded so far ${fmtN(done)} pcs.</p>
  ${fields([{row:[{k:"q",label:"Qty ready (pcs)",type:"number",def:bal||""},{k:"d",label:"Date",type:"date",def:today()}]},{k:"note",label:"Note",ph:"e.g. 20 boxes of 500"}])}
  <div class="calc" id="icalc" hidden></div>
  <div class="btns"><button class="btn" id="ic">Cancel</button><button class="btn primary" id="save">Inward</button></div>`);
  const ic=()=>{const n=+read().q;let t="";if(n>0){const tot=done+n;t=tot>j.qty?`<span class="caution">Total ${fmtN(tot)} is ${fmtN(tot-j.qty)} more than the order qty.</span>`:`After this: ${fmtN(tot)} of ${fmtN(j.qty)} pcs inwarded${tot<j.qty?", "+fmtN(j.qty-tot)+" still in fabrication":""}`}
    $("#icalc").innerHTML=t;$("#icalc").hidden=!t};
  $("#sheet-body").addEventListener("input",ic);ic();
  $("#ic").onclick=()=>jobView(j.id);
  $("#save").onclick=async()=>{const v=read();const n=+v.q;if(!(n>0)){toast("Enter a quantity above 0.");return}
    const inward=[...(j.inward||[]),{q:n,d:v.d||today(),note:v.note||"",at:Date.now()}];
    const rec={...j,inward};if(j.stage<5){rec.stage=5;rec.log=[...(j.log||[]),{s:5,d:today()}]}
    await put("jobs",rec);toast(`${fmtN(n)} pcs moved to packing`);jobView(j.id)}}
function dispatchForm(j){if(mainOf(j)){toast(`${jno(j)} is delivered with ${jno(mainOf(j))}. Dispatch from that job.`);return}
  const kids=kidsOf(j);const ready=dispMax(j),sent=dispQty(j);
  const closeDef=sent+ready>=(+j.qty||0)?"yes":"no";
  sheet(`<h3>Dispatch: ${jno(j)}</h3><p class="meta" style="margin-top:-6px">${esc(j.customer)} · ready in packing <b>${fmtN(readyQty(j))} pcs</b>, dispatched so far ${fmtN(sent)} of ${fmtN(j.qty)}.</p>
  ${kids.length?`<div class="note">Goes out together with ${kids.map(k=>`<b>${jno(k)}</b> ${esc(k.ptype||"")} (ready ${fmtN(readyQty(k))})`).join(", ")}. You can dispatch up to <b>${fmtN(ready)}</b>, the lowest ready quantity.</div>`:""}
  ${fields([{row:[{k:"q",label:"Qty to dispatch (pcs)",type:"number",def:ready||""},{k:"d",label:"Date",type:"date",def:today()}]},
    {row:[{k:"pk",label:"Boxes / bundles",ph:"e.g. 20 boxes"},{k:"veh",label:"Vehicle no.",ph:"e.g. MH 04 AB 1234"}]},
    {k:"tr",label:"Transport / driver",ph:"Name, phone"},{k:"note",label:"Note on challan"},
    {k:"close",label:"After this dispatch",type:"select",options:[{v:"no",t:"Keep job open (more to dispatch)"},{v:"yes",t:"Close job, mark Dispatched"}],def:closeDef}])}
  <div class="calc" id="dcalc" hidden></div>
  <div class="btns"><button class="btn" id="dc">Cancel</button><button class="btn primary" id="save">Dispatch &amp; print challan</button></div>`);
  const dc=()=>{const n=+read().q;let t="";if(n>ready)t=`<span class="caution">Only ${fmtN(ready)} pcs are ready${kids.length?" in all linked job sheets":" in packing"}. Inward more first.</span>`;else if(n>0)t=`Left in packing after this: ${fmtN(ready-n)} pcs`;
    $("#dcalc").innerHTML=t;$("#dcalc").hidden=!t};
  $("#sheet-body").addEventListener("input",dc);dc();
  $("#dc").onclick=()=>jobView(j.id);
  $("#save").onclick=async()=>{const v=read();const n=+v.q;if(!(n>0)){toast("Enter a quantity above 0.");return}
    if(n>ready){toast(`Only ${fmtN(ready)} pcs are inwarded and ready${kids.length?" in all linked job sheets":""}.`);return}
    const no=S.jobs.reduce((a,x)=>Math.max(a,...(x.disp||[]).map(e=>+e.no||0)),0)+1;
    const e={no,q:n,d:v.d||today(),pk:v.pk||"",veh:v.veh||"",tr:v.tr||"",note:v.note||"",at:Date.now()};
    const rec={...j,disp:[...(j.disp||[]),e]};
    if(v.close==="yes"){rec.stage=6;rec.dispatched=e.d;rec.log=[...(j.log||[]),{s:6,d:e.d}]}
    for(const k of kids){const ke={...e,via:j.id};const kr={...k,disp:[...(k.disp||[]),ke]};if(v.close==="yes"){kr.stage=6;kr.dispatched=e.d;kr.log=[...(k.log||[]),{s:6,d:e.d}]}await put("jobs",kr)}
    await put("jobs",rec);closeSheet();toast(dcNo(no)+" saved");challanPrint(rec,e)}}
function challanPrint(j,e){if(e&&e.via){const m=S.jobs.find(x=>x.id===e.via);const me=m&&(m.disp||[]).find(x=>x.no===e.no);if(m&&me){j=m;e=me}}
  const kids=S.jobs.filter(k=>(k.disp||[]).some(x=>x.no===e.no&&x.via===j.id));const c=S.customers.find(x=>normName(x.name)===normName(j.customer))||{};const C=CO();
  const upto=sumQ((j.disp||[]).filter(x=>(+x.no||0)<=(+e.no||0)));const so=j.soId&&S.so.find(x=>x.id===j.soId);
  showPrint(`Challan ${dcNo(e.no)} ${jno(j)}`,`${LHP}<div class="dcw"><div class="hd"><div><div class="big">DELIVERY CHALLAN</div></div><div style="text-align:right"><div class="big">${dcNo(e.no)}</div><div>Date: ${fmtD(e.d)}</div></div></div>
    <table>${trs([["To",`<b>${esc(j.customer)}</b>`],["Address",esc([c.address,c.city].filter(Boolean).join(", "))],["Phone / GSTIN",[c.phone,c.gst&&"GSTIN: "+c.gst].filter(Boolean).map(esc).join(" &middot; ")],
      ["Sales order / PO",[j.soNo&&j.soNo+(so&&so.date?" dated "+fmtDY(so.date):""),so&&so.po&&"Party PO "+so.po+(so.poDate?" dated "+fmtDY(so.poDate):"")].filter(Boolean).map(esc).join(" &middot; ")],["Dispatched from",esc(C.dispatch||"")]])}</table>
    <table class="t"><tr><th>#</th><th>Description</th><th>Job no.</th><th>Packages</th><th>Qty (pcs)</th></tr>
    <tr><td>1</td><td>${j.ptype?esc(j.ptype)+"<br>":""}<b>${esc(j.item)}</b>${j.size?"<br>Size: "+esc(j.size):""}${kids.length?`<br><span style="font-size:11px">Complete with ${kids.map(k=>esc(k.ptype||k.item)).join(", ")}</span>`:""}</td><td>${jno(j)}${kids.length?"<br>"+kids.map(jno).join("<br>"):""}</td><td>${esc(e.pk)}</td><td class="big">${fmtN(e.q)}</td></tr></table>
    <table class="t"><tr><th>Order qty</th><th>Dispatched till date</th><th>Balance</th><th>Vehicle no.</th><th>Transport / driver</th></tr><tr><td>${fmtN(j.qty)} pcs</td><td>${fmtN(upto)} pcs</td><td>${fmtN(Math.max(0,j.qty-upto))} pcs</td><td>${esc(e.veh)}</td><td>${esc(e.tr)}</td></tr></table>${e.note?`<p style="margin:0 0 8px"><b>Note:</b> ${esc(e.note)}</p>`:""}
    <div class="dct">${termsHtml("Delivery &amp; material acceptance terms","dcTerms",DEF_DC_TERMS)}</div>
    <p style="font-size:11.5px;margin:10px 0 0"><b>Received the above goods in the stated number of packages and in good outward condition, subject to the terms above.</b></p>
    <div class="fbox"><div class="fr"><div class="fl"><b>Receiver's name:</b><i></i></div><div class="fl" style="flex:.8"><b>Mobile no.:</b><i></i></div></div>
    <div class="fr"><div class="fl"><b>Date of receipt:</b><i></i></div><div class="fl"><b>Time:</b><i></i></div><div class="fl"><b>No. of packages received:</b><i></i></div></div>
    <div class="sb" style="grid-template-columns:1fr 1fr 1fr"><div><b>Receiver's signature &amp; stamp</b></div><div><b>Driver / transporter</b><small>Signature</small></div><div><b>For ${OWN.toUpperCase()}</b><small>Authorised signatory</small></div></div></div></div>`)}

function jobView(id){
  const j=S.jobs.find(x=>x.id===id);if(!j)return closeSheet();
  const p=S.paper.find(x=>x.id===j.paperId);
  const ps=paperStatus(j);const usedPins=[...new Set(jobMoves(j).map(m=>{const pm=S.paper.find(x=>x.id===m.paperId);return pm?pinTxt(pm):m.pin?"PIN "+m.pin:""}).filter(Boolean))];
  const at=i=>(j.log||[]).filter(l=>l.s===i).pop();
  const next=j.stage<6?STAGES[j.stage+1]:null;
  sheet(`<h3>${jno(j)}: ${esc(j.customer)}</h3>
  <dl>${j.ptype?`<dt>Item</dt><dd>${esc(j.ptype)}</dd>`:""}<dt>Job name</dt><dd>${esc(j.item)}</dd>
  <dt>Quantity</dt><dd class="num">${fmtN(j.qty)}${j.size?" ("+esc(j.size)+")":""}</dd>
  ${p?`<dt>Paper</dt><dd>${pinTag(p)}${esc(paperName(p).replace(/^[^:]*: /,""))}<br><span class="${ps.cls}">${ps.text}</span>${allocTxt(j)?`<br><span class="meta">Allotted: ${esc(allocTxt(j))}</span>`:""}${usedPins.length?`<br><span class="meta">Issued from ${esc(usedPins.join(", "))}</span>`:""}</dd>`:""}
  ${j.colors?`<dt>Colours</dt><dd>${esc(j.colors)}</dd>`:""}
  ${j.finishing?`<dt>Finishing</dt><dd>${esc(j.finishing)}</dd>`:""}
  ${j.due?`<dt>Delivery</dt><dd class="${dueClass(j)}">${fmtD(j.due)}</dd>`:""}
  ${j.rate?`<dt>Value</dt><dd class="num">${inr(j.qty*j.rate)} <span class="meta">@ ₹${esc(j.rate)}</span></dd>`:""}
  ${j.notes?`<dt>Notes</dt><dd>${esc(j.notes)}</dd>`:""}
  ${mainOf(j)?`<dt>Delivered with</dt><dd><button class="mini" data-job="${mainOf(j).id}">${jno(mainOf(j))}</button> ${esc(mainOf(j).ptype||"")}: ${esc(mainOf(j).item)}<br><span class="meta">This job sheet is dispatched only along with ${jno(mainOf(j))}.</span></dd>`:""}
  ${kidsOf(j).length?`<dt>Linked job sheets</dt><dd>${kidsOf(j).map(k=>`<button class="mini" data-job="${k.id}">${jno(k)}</button> ${esc(k.ptype||"")}: ${esc(k.item)} <span class="meta">· ${STAGES[k.stage]}, ready ${fmtN(readyQty(k))}</span>`).join("<br>")}<br><span class="meta">Dispatched together from this job sheet.</span></dd>`:""}</dl>
  <div class="sec"><h4>Production plan <button class="mini" id="plan">${j.plan?"Edit plan":"Plan job"}</button></h4>${planSummary(j)}</div>
  <div class="btns" style="margin-bottom:12px"><button class="btn" id="slip">Cutting slip</button><button class="btn" id="jsp">Print job sheet</button><button class="btn" id="jse">${j.act?"Edit production record":"Record production"}</button>${jwReady(j)?`<button class="btn" id="jwc">Job work card</button>`:""}</div>
  <ol class="steps">${STAGES.map((s,i)=>`<li class="${i<j.stage?"done":i===j.stage?"now":""}">${s}${at(i)?`<small>${fmtD(at(i).d)}</small>`:""}${PROG_ST.includes(i)&&i===j.stage&&progDone(j,i)?`<small class="due-soon">${progTxt(j,i)}</small>`:""}</li>`).join("")}</ol>
  ${(()=>{const si=S.siss.filter(x=>x.jobId===j.id).sort((a,b)=>(a.date||"").localeCompare(b.date||""));return si.length?`<div class="sec"><h4>Stores material issued</h4>${si.map(x=>{const it=S.items.find(i=>i.id===x.itemId)||{};return `<p class="meta" style="margin:2px 0">${fmtD(x.date)}: <b class="num">${qtyTxt(x.qty)} ${esc(it.unit||"")}</b> ${esc(it.name||x.name)}${it.cat?` <span class="tag">${esc(it.cat)}</span>`:""}</p>`}).join("")}</div>`:""})()}
  ${PROG_ST.includes(j.stage)&&progList(j,j.stage).length?`<div class="sec"><h4>${STAGES[j.stage]} entries</h4>${progList(j,j.stage).map(e=>`<p class="meta" style="margin:2px 0">${fmtD(e.d)}: <b class="num">${fmtN(e.q)}</b> ${progTarget(j,j.stage).u}${e.note?" · "+esc(e.note):""}</p>`).join("")}</div>`:""}
  ${j.stage>=4&&fabSteps(j).length?`<div class="sec"><h4>Fabrication steps</h4><ol class="steps">${fabSteps(j).map((f,i)=>{const d=stepDone(j,i);return `<li class="${d?"done":i===nextStep(j)&&j.stage===4?"now":""}">${i+1}. ${esc(f.process)}${f.mode==="Outsource"?` <span class="meta">(outsourced${f.worker?", "+esc(f.worker):""})</span>`:""}${d?`<small>${fmtD(d.d)}${d.q?" · "+fmtN(d.q):""}</small>`:""}</li>`}).join("")}</ol></div>`:""}
  ${(j.inward||[]).length||(j.disp||[]).length?`<div class="sec"><h4>Packing &amp; dispatch</h4>
    <p style="margin:0 0 6px">Inwarded <b class="num">${fmtN(inQty(j))}</b> of ${fmtN(j.qty)} · Dispatched <b class="num">${fmtN(dispQty(j))}</b> · Ready in packing <b class="num">${fmtN(readyQty(j))}</b></p>
    ${(j.inward||[]).map(e=>`<p class="meta" style="margin:2px 0">Inward ${fmtD(e.d)}: <b class="num">${fmtN(e.q)}</b> pcs${e.note?" · "+esc(e.note):""}</p>`).join("")}
    ${(j.disp||[]).map((e,i)=>`<p class="meta" style="margin:4px 0">${dcNo(e.no)} ${fmtD(e.d)}: <b class="num">${fmtN(e.q)}</b> pcs${e.veh?" · "+esc(e.veh):""} <button class="mini" data-dc="${i}">Print challan</button></p>`).join("")}</div>`:""}
  ${PROG_ST.includes(j.stage)?`<div class="btns" style="margin-bottom:8px"><button class="btn" id="part">Partly done</button><button class="btn primary" id="adv">Complete, move to ${next}</button></div>`
   :j.stage===4?(nextStep(j)>=0?`<div class="btns" style="margin-bottom:8px">${(j.fabDone||[]).length?`<button class="btn" id="reopen">Reopen last step</button>`:""}<button class="btn primary" id="step">Close step ${nextStep(j)+1}: ${esc(fabSteps(j)[nextStep(j)].process)}</button></div>`
     :`<div class="btns" style="margin-bottom:8px">${(j.fabDone||[]).length?`<button class="btn" id="reopen">Reopen last step</button>`:""}<button class="btn primary" id="inw">Inward for packing</button></div>`)
   :j.stage===5?`<div class="btns" style="margin-bottom:8px">${inQty(j)<j.qty?`<button class="btn" id="inw">Inward more</button>`:""}${mainOf(j)?`<span class="meta" style="flex:2;align-self:center">Dispatch happens from ${jno(mainOf(j))}.</span>`:dispMax(j)>0?`<button class="btn primary" id="disp">Dispatch</button>`:readyQty(j)>0&&kidsOf(j).length?`<span class="meta" style="flex:2;align-self:center">Waiting for ${kidsOf(j).filter(k=>readyQty(k)<=0).map(jno).join(", ")} to be inwarded.</span>`:dispQty(j)?`<button class="btn" id="adv">Close job, mark Dispatched</button>`:""}</div>`
   :next?`<button class="btn primary" style="width:100%;margin-bottom:8px" id="adv">Move to ${next}</button>`:""}
  <div class="btns">
    ${j.stage>0?`<button class="btn" id="back">Back to ${STAGES[j.stage-1]}</button>`:""}
    ${p||j.plan?`<button class="btn${ps.done?"":" primary"}" id="issue">${ps.btn}</button>`:""}
    ${jobMoves(j).length?`<button class="btn" id="ret">Return unused</button>`:""}
    <button class="btn" id="sti">Issue stores item</button>
    <button class="btn" id="edit">Edit</button>
    <button class="btn danger" id="del">Delete</button></div>`);
  const setStage=async s=>{if(s===6&&dispQty(j)<=0){toast("Nothing has been dispatched yet. Inward the goods and dispatch them first.");return}const log=[...(j.log||[]),{s,d:today()}];await put("jobs",{...j,stage:s,log,...(s===6?{dispatched:today()}:{})});jobView(id)};
  $("#adv")&&($("#adv").onclick=()=>setStage(j.stage+1));
  $("#step")&&($("#step").onclick=()=>stepForm(j,nextStep(j)));
  $("#reopen")&&($("#reopen").onclick=async()=>{const last=[...(j.fabDone||[])].sort((a,b)=>b.i-a.i)[0];await put("jobs",{...j,fabDone:(j.fabDone||[]).filter(e=>e!==last)});jobView(id)});
  $("#inw")&&($("#inw").onclick=()=>inwardForm(j));
  $("#disp")&&($("#disp").onclick=()=>dispatchForm(j));
  $("#sheet-body").querySelectorAll("[data-dc]").forEach(b=>b.onclick=()=>{closeSheet();challanPrint(j,j.disp[+b.dataset.dc])});
  PROG_ST.includes(j.stage)&&($("#part").onclick=()=>partForm(j));
  j.stage>0&&($("#back").onclick=()=>setStage(j.stage-1));
  $("#issue")&&($("#issue").onclick=()=>multiIssue(j));
  jobMoves(j).length&&($("#ret").onclick=()=>{const last=S.paper.find(x=>x.id===jobMoves(j).sort((a,b)=>(b.at||0)-(a.at||0))[0].paperId)||p;last&&moveForm(last,1,j)});
  $("#edit").onclick=()=>jobForm(j);
  $("#sti").onclick=()=>storesPick(j);
  $("#plan").onclick=()=>planForm(j.id);$("#slip").onclick=()=>{closeSheet();cuttingSlip(j)};$("#jsp").onclick=()=>{closeSheet();jobSheetPrint(j)};$("#jse").onclick=()=>jsEntry(j.id);
  jwReady(j)&&($("#jwc").onclick=()=>jwPick(j));
  $("#del").onclick=e=>armDelete(e.target,()=>remove("jobs",j.id));
  const drop=ids=>ids.forEach(i=>{const e=$("#sheet-body #"+i);e&&e.remove()});
  if(isAcc())drop(["plan","slip","jwc","part","step","reopen","inw","back","issue","ret","sti","edit","del",...(j.stage===5?[]:["adv"])]);
  if(isFac())drop(["disp"]);
}
function jobsSwitch(){const n=S.so.filter(o=>(o.status||"draft")==="draft").length;
  return `<div class="seg" role="tablist"><button data-jm="so" aria-pressed="${jobsMode==="so"}">Sales orders${n?` <b class="segn">${n}</b>`:""}</button><button data-jm="jobs" aria-pressed="${jobsMode==="jobs"}">Job sheets</button></div>`}
function renderJobs(){
  const active=S.jobs.filter(j=>j.stage<6);
  const chips=[["active","Active",active.length],...STAGES.map((s,i)=>[String(i),s,S.jobs.filter(j=>j.stage===i).length]),["all","All",S.jobs.length]];
  let list=S.jobs.filter(j=>filter==="all"?true:filter==="active"?j.stage<6:j.stage===+filter);
  if(q){const t=q.toLowerCase();list=list.filter(j=>[jno(j),j.customer,j.ptype,j.item].join(" ").toLowerCase().includes(t))}
  list.sort((a,b)=>filter==="6"?String(b.dispatched).localeCompare(a.dispatched):(a.due||"9999").localeCompare(b.due||"9999")||a.no-b.no);
  return `<input class="search" id="q" type="search" placeholder="Search job no, customer, item" value="${esc(q)}">
  <div class="chips">${chips.map(([k,t,n])=>`<button class="chip" data-f="${k}" aria-pressed="${filter===k}">${t}<b>${n}</b></button>`).join("")}</div>
  <div class="list">${list.length?list.map(j=>`<button class="row" data-job="${j.id}">
    <div class="row-top"><span><span class="jno">${jno(j)}</span> <span class="cust">${esc(j.customer)}</span></span>${j.due&&j.stage<6?`<span class="meta ${dueClass(j)}">${fmtD(j.due)}</span>`:""}</div>
    <div class="meta">${j.ptype?`<span class="tag" style="margin:0 6px 0 0">${esc(j.ptype)}</span>`:""}${esc(j.item)}${j.qty?", "+fmtN(j.qty)+" pcs":""}</div>
    ${pipe(j.stage)}<div class="stage-name">${STAGES[j.stage]}${stageExtra(j)?` <span class="meta">· ${esc(stageExtra(j))}</span>`:""}${PROG_ST.includes(j.stage)&&progDone(j,j.stage)?` <span class="due-soon">· ${progTxt(j,j.stage)}</span>`:""}${(()=>{const p=S.paper.find(x=>x.id===j.paperId);const st=p&&paperStatus(j);return st&&st.over?` <span class="low">· excess paper +${fmtN(st.excess)}</span>`:""})()}</div></button>`).join("")
    :`<div class="empty">${S.jobs.length?"No jobs match.":"No jobs yet. Tap New job to add your first order."}</div>`}</div>`}

/* ---------- paper stock ---------- */
const locTxt=p=>[p.factory,p.gala&&"Gala "+p.gala,p.floor&&p.floor+(/floor/i.test(p.floor)?"":" floor"),p.pillar&&"Pillar "+p.pillar].filter(Boolean).join(", ");
const uniqVals=k=>[...new Set(S.paper.map(p=>String(p[k]||"").trim()).filter(Boolean))].sort();
/* storage location masters: factory, gala, floor, pillar */
const LOCK=[["factory","Factory name"],["gala","Gala no."],["floor","Floor"],["pillar","Pillar no."]];
const numSort=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"});
function locSeeds(k){return S.locs.length?[]:[...uniqVals(k),...(k==="floor"?["Ground","Mezzanine","1st","2nd","3rd"]:[])]}
function locVals(k){const m=new Map();for(const x of [...S.locs.filter(l=>l.kind===k).map(l=>l.name),...locSeeds(k)]){const t=String(x||"").trim();if(t&&!m.has(t.toLowerCase()))m.set(t.toLowerCase(),t)}const fr=x=>/^ground/i.test(x)?-2:/^mezz/i.test(x)?-1:(parseInt(x)||99);return[...m.values()].sort(k==="floor"?(a,b)=>fr(a)-fr(b)||numSort(a,b):numSort)}
let seeding=false;
async function seedLocs(){if(S.locs.length||seeding)return;seeding=true;try{for(const[k] of LOCK)for(const n of locSeeds(k))await put("locs",{kind:k,name:n})}finally{seeding=false}}
async function addLoc(k,name){name=String(name||"").trim();if(!name)return;if(locVals(k).some(x=>x.toLowerCase()===name.toLowerCase())&&S.locs.some(l=>l.kind===k&&l.name.toLowerCase()===name.toLowerCase()))return;await seedLocs();await put("locs",{kind:k,name})}
function locSelects(v){return `<h4 style="margin:4px 0 8px">Stored at</h4>`+LOCK.map(([k,lab])=>{const vals=locVals(k);const cur=String(v[k]||"").trim();
    const opts=[{v:"",t:"Select"},...vals.map(x=>({v:x,t:x})),...(cur&&!vals.some(x=>x.toLowerCase()===cur.toLowerCase())?[{v:cur,t:cur}]:[]),{v:"__new",t:"+ Add new"}];
    const sv=vals.find(x=>x.toLowerCase()===cur.toLowerCase())||cur;
    return `<div class="locf">${fields([{k,label:lab,type:"select",options:opts}],{[k]:sv})}<div class="locnew" hidden>${fields([{k:k+"_new",label:"New "+lab.toLowerCase()}])}</div></div>`}).join("")}
function wireLocSelects(body){body.querySelectorAll(".locf select").forEach(sl=>sl.addEventListener("change",()=>{const nw=sl.closest(".locf").querySelector(".locnew");nw.hidden=sl.value!=="__new";if(!nw.hidden)nw.querySelector("input").focus()}))}
async function readLocs(f){const o={};for(const[k,lab] of LOCK){if(f[k]==="__new"){const n=(f[k+"_new"]||"").trim();if(!n){toast("Type the new "+lab.toLowerCase()+".");return null}o[k]=n}else o[k]=f[k]||""}
  for(const[k] of LOCK)if(f[k]==="__new")await addLoc(k,o[k]);return o}
function locsView(){seedLocs();
  sheet(`<h3>Storage locations</h3><p class="meta" style="margin-top:-6px">These lists fill the drop-downs in Paper inward. Removing a name doesn't change papers already stored there.</p>
  ${LOCK.map(([k,lab])=>`<div class="sec"><h4>${lab}</h4><div class="chips" style="flex-wrap:wrap">${locVals(k).map(x=>`<span class="chip" aria-pressed="false">${esc(x)} <button class="mini" data-rmloc="${esc(k)}" data-n="${esc(x)}" aria-label="Remove ${esc(x)}">×</button></span>`).join("")||'<span class="meta">None yet</span>'}</div>
    <div class="two" style="--n:2;align-items:end">${fields([{k:"add_"+k,label:"Add "+lab.toLowerCase()}])}<button class="btn" data-addloc="${k}" style="margin-bottom:12px">Add</button></div></div>`).join("")}
  <div class="btns"><button class="btn" onclick="closeSheet()">Done</button></div>`);
  const b=$("#sheet-body");
  b.querySelectorAll("[data-addloc]").forEach(x=>x.onclick=async()=>{const k=x.dataset.addloc;const n=read()["add_"+k];if(!n){toast("Type a name first.");return}await addLoc(k,n);locsView()});
  b.querySelectorAll("[data-rmloc]").forEach(x=>x.onclick=async()=>{await seedLocs();const k=x.dataset.rmloc,n=x.dataset.n.toLowerCase();for(const l of S.locs.filter(l=>l.kind===k&&l.name.toLowerCase()===n))await remove("locs",l.id);locsView()})}
const _PAPER_TYPES=["Art Paper Gloss","Art Paper Matt","Maplitho","Chromo","Bond","Duplex Board Grey Back","Duplex Board White Back","SBS Board","FBB Board","Kraft","Newsprint","Sticker"];
// dropdown list: standard types + any new type already saved on paper, so a type added once shows up for everyone
function paperTypes(cur){const seen=new Map();[...LS.PAPER_TYPES,...S.paper.map(x=>x.name),cur].forEach(t=>{t=String(t||"").trim();if(t&&!seen.has(t.toLowerCase()))seen.set(t.toLowerCase(),t)});return[...seen.values()]}
function paperForm(p={}){
  const v={...p,len:p.lin||p.lmm||"",wid:p.win||p.wmm||"",sunit:p.lin?"inch":p.lmm?"mm":"inch",supply:p.supply||"own"};
  v.pin=p.id?(p.pin||""):nextPin();v.inDate=p.inDate||today();
  if(!p.id){const last=[...S.paper].sort((a,b)=>String(b.inDate||"").localeCompare(String(a.inDate||"")))[0];if(last&&last.factory)v.factory=last.factory}
  sheet(`<h3>${p.id?"Edit "+esc(pinTxt(p)):"Paper inward"}</h3>
  <datalist id="custlist">${S.customers.map(c=>`<option value="${esc(c.name)}">`).join("")}</datalist>
  ${fields([
    {html:`<div class="calc" style="margin:0 0 12px">PIN (paper inward no.): <b class="pin${p.pin?"":" none"}" style="font-size:18px">${esc(p.pin||nextPin())}</b><br>${p.pin?"PINs are fixed and can't be changed.":"Generated automatically in sequence when you save."}</div>`},
    {k:"inDate",label:"Inward date",type:"date"},
    {html:`<label>Paper type<select name="name"><option value="">Select paper type</option>${paperTypes(v.name).map(t=>`<option value="${esc(t)}"${t===v.name?" selected":""}>${esc(t)}</option>`).join("")}<option value="__new">+ Add new type…</option></select></label><div id="newtypewrap" hidden>${fields([{k:"newtype",label:"New paper type",ph:"Type the new paper type"}],{})}</div>`},
    {row:[{k:"gsm",label:"GSM",type:"number"},{k:"supply",label:"Supplied by",type:"select",options:[{v:"own",t:OWN},{v:"party",t:"Party supplied"}]}]},
    {html:`<div id="partywrap"${v.supply==="party"?"":" hidden"}>${fields([{k:"party",label:"Which party",list:"custlist",ph:"Customer name"}],v)}</div>`},
    {row:[{k:"len",label:"Length",type:"number"},{k:"wid",label:"Width",type:"number"},{k:"sunit",label:"Size in",type:"select",options:[{v:"inch",t:"Inches"},{v:"cm",t:"cm"},{v:"mm",t:"mm"}]}]},
    {html:`<div class="calc" id="calc">Enter size and GSM to see sheet weight.</div>`},
    {row:[{k:"unit",label:"Stock counted in",type:"select",options:[{v:"sheets",t:"Sheets"},{v:"reams",t:"Reams (500)"},{v:"kg",t:"Kg"}]},{k:"min",label:"Alert below",type:"number"}]},
    {k:"bill",label:"Supplier bill / challan no."},
    {k:"packing",label:"Packing details",ph:"e.g. 10 bundles × 100 sheets, 2 pallets"},
    {html:locSelects(v)},
    ...(p.id?[]:[{k:"opening",label:"Quantity received",type:"number"}])],v)}
  <div class="btns"><button class="btn" onclick="closeSheet()">Cancel</button><button class="btn primary" id="save">${p.id?"Save changes":"Save inward"}</button></div>`);
  const body=$("#sheet-body");wireLocSelects(body);
  const calc=()=>{const f=read();$("#partywrap").hidden=f.supply!=="party";$("#newtypewrap").hidden=f.name!=="__new";
    const l=toMm0(f.len,f.sunit),w=toMm0(f.wid,f.sunit),k=sheetKg(l,w,f.gsm);
    let t=l&&w?`Size <b>${fmtN(l)} × ${fmtN(w)} mm</b>`:"Enter size and GSM to see sheet weight.";
    if(k){t+=`<br>1 sheet = <b>${(k*1000).toLocaleString("en-IN",{maximumFractionDigits:2})} g</b>, 500 sheets = <b>${kgTxt(k*500)}</b>`;
      const op=+f.opening;if(op>0){const tmp={lmm:l,wmm:w,gsm:f.gsm,unit:f.unit};t+=`<br>Current stock ${convTxt(tmp,op)}`}}
    $("#calc").innerHTML=t};
  body.addEventListener("input",calc);body.addEventListener("change",calc);calc();
  $("#save").onclick=async e=>{const f=read();if(f.name==="__new"){f.name=f.newtype.replace(/\s+/g," ");if(!f.name){toast("Type the new paper type.");return}const m=paperTypes().find(t=>t.toLowerCase()===f.name.toLowerCase());if(m)f.name=m}if(!f.name){toast("Choose a paper type.");return}
    if(f.supply==="party"&&!f.party){toast("Choose which party supplied this paper.");return}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    const L=await readLocs(f);if(!L){btn.disabled=false;return}Object.assign(f,L);
    const id=p.id||(db?db.collection("paper").doc().id:newId());
    let pin=p.pin;if(!pin){const r=await allocPin(id);if(r.err){btn.disabled=false;toast(r.err);return}pin=r.pin}
    const rec={...p,id,pin,inDate:f.inDate,bill:f.bill,name:f.name,gsm:f.gsm,supply:f.supply,party:f.supply==="party"?f.party:"",lmm:toMm0(f.len,f.sunit),wmm:toMm0(f.wid,f.sunit),lin:f.sunit==="inch"&&+f.len>0?+f.len:"",win:f.sunit==="inch"&&+f.wid>0?+f.wid:"",unit:f.unit,min:f.min,factory:f.factory,gala:f.gala,floor:f.floor,pillar:f.pillar,packing:f.packing};
    if(!p.id)rec.needsVerify=true;else if(p.verified&&!canVerify){delete rec.verified;rec.needsVerify=true}
    delete rec.size; if(!rec.lmm&&p.size)rec.size=p.size;
    if(!p.id)rec.opening=+f.opening||0;
    if(f.supply==="party"&&!S.customers.some(c=>c.name.toLowerCase()===f.party.toLowerCase()))await put("customers",{name:f.party});
    try{await put("paper",rec)}catch(x){btn.disabled=false;return}closeSheet();toast(pinTxt(rec)+" saved")}}
// Paper issued to a job vs the planned full sheets
function jobMoves(j){return S.moves.filter(m=>m.jobId===j.id)}
function jobIssuedSheets(j){let sh=0;for(const m of jobMoves(j)){const pm=S.paper.find(x=>x.id===m.paperId);const v=pm?sheetsOf(pm,-(+m.qty||0)):null;if(v==null)return null;sh+=v}return sh}
function paperStatus(j){
  const any=jobMoves(j).length,need=j.plan?.fullSheets||0,issSh=jobIssuedSheets(j);
  const base={issSh,need,excess:0,remaining:0,done:false,over:false};
  if(!need)return{...base,btn:any?"Issue more paper":"Issue paper",cls:"meta",text:any?(issSh!=null?fmtN(Math.round(issSh))+" sheets issued":"Paper issued"):"Not issued yet. Plan the job to see sheets needed."};
  if(issSh==null)return{...base,btn:"Issue paper",cls:"meta",text:`Paper issued (plan needs ${fmtN(need)} sheets)`};
  const rem=Math.max(0,Math.ceil(need-issSh-1e-6)),excess=Math.max(0,Math.round(issSh-need));
  if(excess)return{...base,excess,done:true,over:true,btn:"Issue extra paper",cls:"caution",text:`Caution: ${fmtN(Math.round(issSh))} sheets issued, ${fmtN(excess)} more than the plan needs (${fmtN(need)})`};
  if(!rem)return{...base,done:true,btn:"Issue extra paper",cls:"plus",text:`Fully issued: ${fmtN(Math.round(issSh))} of ${fmtN(need)} sheets`};
  return{...base,remaining:rem,btn:issSh?`Issue remaining ${fmtN(rem)} sheets`:`Issue ${fmtN(rem)} sheets`,cls:issSh?"due-soon":"meta",text:issSh?`Part issued: ${fmtN(Math.round(issSh))} of ${fmtN(need)} sheets`:`Needs ${fmtN(need)} sheets, not issued yet`}}
/* sheets of a PIN still planned for other open jobs (planned but not yet issued) */
function allocOf(j){const a=j.plan?.alloc;if(a&&a.length)return a.filter(x=>x.pid);return j.paperId?[{pid:j.paperId,sh:+j.plan?.fullSheets||0}]:[]}
function pinIssuedSh(j,pid){let sh=0;for(const m of jobMoves(j))if(m.paperId===pid){const pm=S.paper.find(x=>x.id===pid);const v=pm?sheetsOf(pm,-(+m.qty||0)):null;sh+=v==null?0:v}return sh}
const stockSh=p=>{const v=sheetsOf(p,balance(p.id));return v==null?balance(p.id):v};
const allocTxt=j=>allocOf(j).length>1?allocOf(j).map(a=>{const pp=S.paper.find(x=>x.id===a.pid);return (pp?pinTxt(pp):"PIN ?")+": "+fmtN(a.sh)+" sheets"}).join(", "):"";
function reservedSheets(pid,exceptId){return S.jobs.filter(x=>x.id!==exceptId&&x.stage<6&&x.plan?.fullSheets).reduce((t,x)=>{const a=allocOf(x).find(y=>y.pid===pid);if(!a)return t;
  return t+(x.plan?.alloc?.length?Math.max(0,Math.ceil((+a.sh||0)-pinIssuedSh(x,pid))):(paperStatus(x).remaining||0))},0)}
function stockWarn(p,need,jobId){if(!p)return"";const st=sheetsOf(p,balance(p.id));if(st==null)return"";
  const res=reservedSheets(p.id,jobId),free=Math.floor(st-res),pin=esc(pinTxt(p));
  if(need>0){const after=Math.floor(st-res-need);if(after>=0)return"";
    return `<span class="caution">${pin} will go negative by ${fmtN(-after)} sheets. In stock ${fmtN(Math.floor(st))}${res?`, already planned for other jobs ${fmtN(res)}`:""}, this job needs ${fmtN(need)}.</span>`}
  if(free<=0)return `<span class="caution">${pin} has no free stock: ${fmtN(Math.floor(st))} sheets in stock, ${fmtN(res)} already planned for other jobs.</span>`;
  return""}
function moveForm(p,sign,job,keep){
  const rs=job&&sign<0?paperStatus(job).remaining:0;
  const pre=keep?keep.qty:rs?(p.unit==="reams"?Math.ceil(rs/500):p.unit==="kg"?Math.ceil(pSheetKg(p)*rs*10)/10:rs):"";
  const title=sign>0?"Return to stock":"Issue paper";
  sheet(`<h3>${title}${job?" for "+jno(job):""}</h3>
  ${job?fields([{k:"pinSel",label:"From PIN",type:"select",options:paperOptions(p.id,srcOf(job),job.customer)}],{pinSel:p.id}):`<p style="margin:-4px 0 8px">${pinTag(p)}${esc(paperName(p).replace(/^[^:]*: /,""))}</p>`}
  ${isPending(p)?`<span class="caution" style="margin-bottom:8px">This inward is not verified yet.</span>`:""}
  ${locTxt(p)?`<p style="margin:0 0 4px">📍 <b>${esc(locTxt(p))}</b></p>`:""}
  <p class="meta">In stock: <b class="num">${fmtN(balance(p.id))} ${esc(p.unit||"sheets")}</b> ${convTxt(p,balance(p.id))}</p>
  ${fields([{row:[{k:"qty",label:`Quantity (${p.unit||"sheets"})`,type:"number",def:pre||""},{k:"date",label:"Date",type:"date",def:keep?.date||today()}]},
    ...(!job?[{k:"jobId",label:sign>0?"Returned from job":"For job",type:"select",options:[{v:"",t:"No job"},...S.jobs.filter(j=>sign>0?jobMoves(j).some(m=>m.paperId===p.id):j.stage<6).map(j=>({v:j.id,t:jno(j)+" "+j.customer}))]}]:[]),
    {k:"note",label:sign>0?"Reason":"Note",def:keep?.note||""}])}
  <div class="calc" id="mcalc"></div>
  <div class="btns"><button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="save">${sign>0?"Return to stock":"Issue"}</button></div>`);
  $("#mcancel").onclick=()=>job?jobView(job.id):paperView(p.id);
  if(job){$('[name="pinSel"]').onchange=e=>{const np=S.paper.find(x=>x.id===e.target.value);const f=read();np&&moveForm(np,sign,job,{qty:"",date:f.date,note:f.note})}}
  const jst=job&&sign<0?paperStatus(job):null;
  const overBy=n=>{if(!jst||!jst.need||jst.issSh==null)return 0;const sh=sheetsOf(p,n);return sh==null?0:Math.round(jst.issSh+sh-jst.need)};
  const mc=()=>{const n=+read().qty;let t=n>0?esc(fmtN(n)+" "+(p.unit||"sheets")+" "+convTxt(p,n)):"";
    const ob=n>0?overBy(n):0;if(ob>0)t+=`<span class="caution">Caution: this is ${fmtN(ob)} sheets more than the job needs. Add a reason in the note.</span>`;
    if(sign<0&&n<=balance(p.id)){const st=sheetsOf(p,balance(p.id)-n),res=reservedSheets(p.id,job?job.id:read().jobId);
      if(st!=null&&res>st)t+=`<span class="caution">After this, ${esc(pinTxt(p))} will be short by ${fmtN(Math.ceil(res-st))} sheets for other jobs already planned on it.</span>`}
    if(sign<0&&n>balance(p.id))t+=`<span class="caution">Only ${fmtN(balance(p.id))} ${esc(p.unit||"sheets")} left in ${esc(pinTxt(p))}.</span>`;
    $("#mcalc").innerHTML=t;$("#mcalc").hidden=!t};
  $("#sheet-body").addEventListener("input",mc);mc();
  $("#save").onclick=async()=>{const v=read();const n=+v.qty;if(!(n>0)){toast("Enter a quantity above 0.");return}
    const jid=job?job.id:v.jobId;const jj=S.jobs.find(x=>x.id===jid);
    if(overBy(n)>0&&!v.note){toast("Add a reason for issuing extra paper.");return}
    if(sign<0&&n>balance(p.id)){toast(`Not enough stock in ${pinTxt(p)}. Pick another PIN or issue less.`);return}
    if(sign>0&&jj){const iss=-S.moves.filter(m=>m.jobId===jj.id&&m.paperId===p.id).reduce((a,m)=>a+(+m.qty||0),0);if(n>iss+1e-9){toast(`Only ${fmtN(Math.max(0,iss))} ${p.unit||"sheets"} of ${pinTxt(p)} were issued to ${jno(jj)}.`);return}}
    await put("moves",{paperId:p.id,pin:p.pin||"",qty:sign*n,date:v.date||today(),note:v.note||"",jobId:jid||"",jobNo:jj?jno(jj):"",at:Date.now()});
    job?jobView(job.id):paperView(p.id)}}
function multiIssue(j){const st=paperStatus(j);
  const opts=()=>[...S.paper].filter(p=>srcMatch(p,srcOf(j),j.customer)&&balance(p.id)>0).sort((a,b)=>(b.id===j.paperId)-(a.id===j.paperId)||String(a.pin||"").localeCompare(String(b.pin||""),undefined,{numeric:true}));
  const L=opts();if(!L.length){toast("No paper in stock for this job. Do a paper inward first.");return}
  const first=L.find(p=>p.id===j.paperId)||L[0];
  const inUnit=(p,sh)=>p.unit==="reams"?Math.ceil(sh/500):p.unit==="kg"?Math.ceil(pSheetKg(p)*sh*10)/10:Math.ceil(sh);
  const pre0=j.plan?.alloc?.length?j.plan.alloc.map(a=>({p:L.find(x=>x.id===a.pid),rem:Math.max(0,(+a.sh||0)-pinIssuedSh(j,a.pid))})).filter(x=>x.p&&x.rem>0).map(x=>[x.p.id,inUnit(x.p,Math.min(x.rem,stockSh(x.p)))]):null;
  const pre=p=>st.remaining?(p.unit==="reams"?Math.ceil(st.remaining/500):p.unit==="kg"?Math.ceil(pSheetKg(p)*st.remaining*10)/10:st.remaining):"";
  const row=(pid,q)=>`<div class="rrow mi"><button class="rx" type="button" aria-label="Remove">×</button><label>PIN<select data-m="pid">${L.map(p=>`<option value="${p.id}"${p.id===pid?" selected":""}>${esc(pinTxt(p)+" · "+paperName(p).replace(/^[^:]*: /,"")+" · "+fmtN(balance(p.id))+" "+(p.unit||"sheets"))}</option>`).join("")}</select></label>
    <label><span class="mul">Quantity</span><input data-m="q" type="number" inputmode="decimal" step="any" min="0" value="${esc(q??"")}"></label><p class="meta mst" style="margin:-4px 0 8px"></p></div>`;
  sheet(`<h3>Issue paper for ${jno(j)}</h3><p class="meta" style="margin-top:-6px">${esc(st.text)}. Issue from one PIN or several.</p>
  ${j.plan?.alloc?.length?`<p class="meta" style="margin:0 0 8px">Allotted in plan: ${esc(allocTxt(j))}</p>`:""}
  <div id="mil">${pre0&&pre0.length?pre0.map(([id,q])=>row(id,q)).join(""):row(first.id,pre(first))}</div><button class="add" type="button" id="miadd">+ Issue from another PIN</button>
  ${fields([{row:[{k:"date",label:"Date",type:"date",def:today()},{k:"note",label:"Note"}]}])}
  <div class="calc" id="mitot"></div>
  <div class="btns"><button class="btn" id="mic">Cancel</button>${jobMoves(j).length?`<button class="btn" id="miret">Return unused</button>`:""}<button class="btn primary" id="save">Issue</button></div>`);
  const box=$("#mil");
  const read2=()=>[...box.querySelectorAll(".mi")].map(r=>({r,p:S.paper.find(x=>x.id===r.querySelector('[data-m="pid"]').value),n:+r.querySelector('[data-m="q"]').value||0}));
  const calc=()=>{const rs=read2();const used={};let sh=0,bad="";
    for(const x of rs){if(!x.p)continue;x.r.querySelector(".mul").textContent=`Quantity (${x.p.unit||"sheets"})`;used[x.p.id]=(used[x.p.id]||0)+x.n;const s2=sheetsOf(x.p,x.n);if(s2!=null)sh+=s2;
      const left=balance(x.p.id)-used[x.p.id];x.r.querySelector(".mst").innerHTML=`📍 ${esc(locTxt(x.p)||"—")} · in stock ${fmtN(balance(x.p.id))} ${esc(x.p.unit||"sheets")}${x.n?" "+esc(convTxt(x.p,x.n)):""}`+(left<-1e-9?` <span class="low">· short by ${fmtN(-left)}</span>`:"");if(left<-1e-9)bad=pinTxt(x.p)}
    const ob=st.need&&st.issSh!=null?Math.round(st.issSh+sh-st.need):0;
    $("#mitot").innerHTML=`Total this issue: <b>${fmtN(Math.round(sh))} sheets</b>${st.need?` · job needs ${fmtN(st.remaining)} more`:""}${ob>0?`<span class="caution">${fmtN(ob)} sheets more than the plan. Add a reason in the note.</span>`:""}${bad?`<span class="caution">Not enough stock in ${esc(bad)}.</span>`:""}`;return{rs,used,ob,bad}};
  box.addEventListener("input",calc);box.addEventListener("change",calc);
  box.addEventListener("click",e=>{if(!e.target.closest(".rx"))return;if(box.querySelectorAll(".mi").length<2){toast("Keep at least one PIN.");return}e.target.closest(".mi").remove();calc()});
  $("#miadd").onclick=()=>{const usedIds=read2().map(x=>x.p&&x.p.id);const nx=L.find(p=>!usedIds.includes(p.id))||L[0];box.insertAdjacentHTML("beforeend",row(nx.id,""));box.lastElementChild.querySelector('[data-m="q"]').focus();calc()};
  calc();
  $("#mic").onclick=()=>jobView(j.id);
  $("#miret")&&($("#miret").onclick=()=>{const last=S.paper.find(x=>x.id===jobMoves(j).sort((a,b)=>(b.at||0)-(a.at||0))[0].paperId);last&&moveForm(last,1,j)});
  $("#save").onclick=async e=>{const f=read();const {rs,used,ob,bad}=calc();const ok=rs.filter(x=>x.p&&x.n>0);
    if(!ok.length){toast("Enter a quantity above 0.");return}
    if(rs.some(x=>x.p&&!(x.n>0))){toast("Enter a quantity for every PIN, or remove the empty row.");return}
    if(bad){toast(`Not enough stock in ${bad}. Issue less or pick another PIN.`);return}
    if(ob>0&&!f.note){toast("Add a reason for issuing extra paper.");return}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    const now=Date.now();const list=ok.map((x,i)=>({paperId:x.p.id,pin:x.p.pin||"",qty:-x.n,date:f.date||today(),note:f.note||"",jobId:j.id,jobNo:jno(j),at:now+i}));
    try{if(db)await putMoves(list);else for(const m of list)await put("moves",m)}catch(x){btn.disabled=false;return}
    if(!j.paperId)await put("jobs",{...j,paperId:ok[0].p.id});
    toast(ok.length>1?`Issued from ${ok.length} PINs`:"Paper issued");jobView(j.id)}}
function paperView(id){
  const p=S.paper.find(x=>x.id===id);if(!p)return closeSheet();
  const mv=S.moves.filter(m=>m.paperId===id).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,40);
  const b=balance(id);
  sheet(`<h3>${pinTag(p)}${esc(p.name)}</h3>
  <p class="meta" style="margin:-6px 0 6px">${[p.gsm&&p.gsm+" gsm",sizeTxt(p)].filter(Boolean).map(esc).join(", ")}</p>
  ${p.pin?"":`<div class="caution" style="margin-bottom:8px">This paper has no PIN. Tap Edit, then Save changes, to give it the next PIN.</div>`}
  <p style="margin:0 0 4px">${supplyTag(p)}</p>
  ${isPending(p)?`<div class="caution" style="margin:6px 0">Inward not verified yet${canVerify?"":". Ask the owner to verify it."}</div>${canVerify?`<button class="btn primary" style="width:100%;margin-bottom:8px" id="ver">Verify inward</button>`:""}`
    :p.verified?`<p class="plus" style="margin:4px 0">✓ Verified ${fmtD(p.verified.d)}${p.verified.by?` by <span id="vby">…</span>`:""}</p>`:""}
  ${p.packing?`<p style="margin:4px 0"><b>Packing:</b> ${esc(p.packing)}</p>`:""}
  <p style="margin:4px 0"><b>Stored at:</b> ${locTxt(p)?esc(locTxt(p)):'<span class="meta">not set. Tap Edit to add.</span>'}</p>
  <p class="meta" style="margin:4px 0">Inward ${p.inDate?fmtD(p.inDate):"date not set"}: ${fmtN(p.opening)} ${esc(p.unit||"sheets")}${p.bill?", bill "+esc(p.bill):""}</p>
  <p style="margin:6px 0"><span class="bal num ${p.min&&b<+p.min?"low":""}">${fmtN(b)}</span> ${esc(p.unit||"sheets")} in stock <span class="meta">${convTxt(p,b)}</span>${p.min?`<br><span class="meta">Alert below ${fmtN(p.min)}</span>`:""}</p>
  ${pSheetKg(p)?`<p class="meta" style="margin:0 0 12px">1 sheet = ${(pSheetKg(p)*1000).toLocaleString("en-IN",{maximumFractionDigits:2})} g, 500 sheets = ${kgTxt(pSheetKg(p)*500)}</p>`:""}
  <div class="btns"><button class="btn primary" id="out">Issue</button><button class="btn" id="in">Return to stock</button>${isPending(p)?"":`<button class="btn" id="lbl">Print PIN label</button>`}</div>
  <h2>Movements</h2>
  ${mv.length?mv.map(m=>`<div class="mv"><span>${fmtD(m.date)} <span class="meta">${esc([m.jobNo,m.note].filter(Boolean).join(", "))}</span></span><span class="num ${m.qty>0?"plus":"minus"}">${m.qty>0?"+":"−"}${fmtN(Math.abs(m.qty))} <span class="meta">${convTxt(p,Math.abs(m.qty))}</span></span></div>`).join("")
   :`<p class="meta">Opening stock ${fmtN(p.opening)}. No movements yet.</p>`}
  <div class="btns" style="margin-top:14px"><button class="btn" id="edit">Edit</button><button class="btn danger" id="del">Delete</button></div>`);
  $("#in").onclick=()=>moveForm(p,1);$("#out").onclick=()=>moveForm(p,-1);
  $("#edit").onclick=()=>paperForm(p);
  $("#ver")&&($("#ver").onclick=()=>verifyView(p));
  $("#lbl")&&($("#lbl").onclick=()=>labelStart(p));
  if(p.verified?.by&&user)user.profiles([p.verified.by]).then(ps=>{const e=$("#vby");if(e)e.textContent=(ps[p.verified.by]&&ps[p.verified.by].name)||"Someone"}).catch(()=>{});
  $("#del").onclick=e=>armDelete(e.target,()=>{if(S.moves.some(m=>m.paperId===p.id)){toast("This PIN has issues recorded, so it can't be deleted.");return}releasePin(p.pin,p.id);remove("paper",p.id)});}
function verifyView(p){
  sheet(`<h3>Verify inward ${esc(pinTxt(p))}</h3><p class="meta" style="margin-top:-6px">Check the paper against these details before confirming.</p>
  <dl><dt>Owned by</dt><dd>${esc(p.supply==="party"?(p.party||"Party"):OWN)}</dd><dt>Paper</dt><dd>${esc(p.name)}</dd><dt>GSM</dt><dd>${esc(p.gsm||"-")}</dd><dt>Size</dt><dd>${esc(sizeTxt(p)||"-")}</dd>
  <dt>Qty received</dt><dd class="num">${fmtN(p.opening)} ${esc(p.unit||"sheets")} <span class="meta">${convTxt(p,+p.opening||0)}</span></dd>
  <dt>Packing</dt><dd>${esc(p.packing||"-")}</dd><dt>Bill / challan</dt><dd>${esc(p.bill||"-")}</dd><dt>Inward date</dt><dd>${p.inDate?fmtD(p.inDate):"-"}</dd><dt>Stored at</dt><dd>${esc(locTxt(p)||"-")}</dd></dl>
  <div class="btns"><button class="btn" id="vb">Back</button><button class="btn" id="ve">Edit details</button><button class="btn primary" id="vok">Confirm verified</button></div>`);
  $("#vb").onclick=()=>paperView(p.id);$("#ve").onclick=()=>paperForm(p);
  $("#vok").onclick=async()=>{if(!canVerify){toast("Only the owner can verify.");return}
    try{await put("paper",{...p,verified:{by:meId||"",d:today(),at:Date.now()}})}catch(e){return}toast(pinTxt(p)+" verified");paperView(p.id)}}
function labelStart(p){const b=balance(p.id);
  if(b===(+p.opening||0)&&!S.moves.some(m=>m.paperId===p.id)){closeSheet();labelPrint(p);return}
  sheet(`<h3>PIN label ${esc(pinTxt(p))}</h3><p class="meta" style="margin-top:-6px">Stock has moved since inward, so the label will show the current balance.</p>
  <p style="margin:0 0 8px">Inward ${fmtN(p.opening)} · Current balance <b class="num">${fmtN(b)} ${esc(p.unit||"sheets")}</b> <span class="meta">${convTxt(p,b)}</span></p>
  ${fields([{k:"packingNow",label:"Packing details now",ph:"e.g. 3 bundles × 100 sheets"}],{packingNow:p.packingNow??p.packing??""})}
  <div class="btns"><button class="btn" id="lb">Back</button><button class="btn primary" id="lp">Print label</button></div>`);
  $("#lb").onclick=()=>paperView(p.id);
  $("#lp").onclick=async()=>{const pn=read().packingNow;let rec=p;if(pn!==(p.packingNow??p.packing??"")){rec={...p,packingNow:pn};try{await put("paper",rec)}catch(e){}}
    closeSheet();labelPrint(rec,b)}}
function labelPrint(p,bal){const owner=p.supply==="party"?(p.party||"Party"):OWN;const cur=bal!=null;const q=cur?bal:(+p.opening||0);const pack=cur?(p.packingNow??p.packing):p.packing;
  showPrint(`PIN ${p.pin||""} label`,`<style>.lbl{border:3px solid #000;padding:14px}.lbl .lo{font-size:14px;text-transform:uppercase;letter-spacing:1px}.lbl .lov{font-size:26px;font-weight:800;margin-bottom:6px}
    .lbl .lpin{font-size:120px;font-weight:900;text-align:center;border:4px solid #000;line-height:1.15;margin:8px 0 14px;letter-spacing:2px}.lbl .lpin small{display:block;font-size:16px;font-weight:700;letter-spacing:1px}
    .lbl td{font-size:22px;font-weight:700}.lbl th{font-size:16px}</style>
    <div class="lbl"><div class="lo">Paper owned by</div><div class="lov">${esc(owner)}</div>
    <div class="lpin"><small>PIN</small>${esc(p.pin||"No PIN")}</div>
    <table>${trs([["GSM",esc(p.gsm||"")],["Size",sizeTxt(p)?`${esc(sizeInch(p))}<br>${esc(sizeTxt(p))}`:""],[cur?`Current balance<br><span style="font-weight:400;font-size:13px">as on ${fmtD(today())}</span>`:"Quantity",q||cur?`${fmtN(q)} ${esc(p.unit||"sheets")}${convTxt(p,q)?` <span style="font-size:15px;font-weight:400">(${esc(convTxt(p,q))})</span>`:""}`:""],["Packing details",esc(pack||"")]])}</table></div>`)}
function renderStock(){
  let list=[...S.paper];if(q){const t=q.toLowerCase();list=list.filter(p=>(paperName(p)+" "+supplyTxt(p)+" "+(p.bill||"")+" "+locTxt(p)).toLowerCase().includes(t))}
  const own=S.paper.filter(p=>p.supply!=="party"),party=S.paper.filter(p=>p.supply==="party");
  if(stockFilter==="own")list=list.filter(p=>p.supply!=="party");if(stockFilter==="party")list=list.filter(p=>p.supply==="party");
  if(stockFilter==="empty")list=list.filter(p=>balance(p.id)<=0);else list=list.filter(p=>balance(p.id)>0||q);
  list.sort((a,b)=>String(a.pin||"").localeCompare(String(b.pin||""),undefined,{numeric:true}));
  const tot=arr=>kgTxt(arr.reduce((a,p)=>a+(kgOf(p,balance(p.id))||0),0));
  return `<input class="search" id="q" type="search" placeholder="Search PIN, paper, party, bill or location" value="${esc(q)}">
  <div class="chips">${[["all","In stock",S.paper.filter(p=>balance(p.id)>0).length],["own","Arihant",own.filter(p=>balance(p.id)>0).length],["party","Party supplied",party.filter(p=>balance(p.id)>0).length],["empty","Used up",S.paper.filter(p=>balance(p.id)<=0).length]].map(([k,t,n])=>`<button class="chip" data-sf="${k}" aria-pressed="${stockFilter===k}">${t}<b>${n}</b></button>`).join("")}</div>
  ${S.paper.length?`<p class="meta" style="margin:6px 0 0">Total weight: Arihant ${tot(own)||"0 kg"}, party ${tot(party)||"0 kg"}</p>`:""}
  <div class="list">${list.length?list.map(p=>{const b=balance(p.id);const low=p.min&&b<+p.min;return `<button class="row" data-paper="${p.id}">
    <div class="row-top"><span class="cust">${pinTag(p)}${esc(p.name)}${supplyTag(p)}${isPending(p)?'<span class="tag party">To verify</span>':""}</span><span class="bal num ${low?"low":""}">${fmtN(b)}</span></div>
    <div class="row-top meta"><span>${[p.gsm&&p.gsm+" gsm",sizeTxt(p)].filter(Boolean).map(esc).join(", ")}</span><span>balance ${esc(p.unit||"sheets")}${low?", low":""}</span></div>
    <div class="row-top meta"><span>Inward <b class="num">${fmtN(+p.opening||0)}</b>${p.inDate?" on "+fmtD(p.inDate):""}</span><span>Used <b class="num">${fmtN(Math.max(0,(+p.opening||0)-b))}</b></span></div>
    ${convTxt(p,b)||locTxt(p)?`<div class="row-top meta"><span>${locTxt(p)?"📍 "+esc(locTxt(p)):""}</span><span>${convTxt(p,b)}</span></div>`:""}</button>`}).join("")
   :`<div class="empty">${S.paper.length?"No paper here.":"No paper yet. Tap Paper inward to record paper with its PIN."}</div>`}</div>`}

/* ---------- customers ---------- */
function custForm(c={}){
  sheet(`<h3>${c.id?"Edit customer":"Add customer"}</h3>${fields([{k:"name",label:"Name"},{row:[{k:"phone",label:"Phone",type:"tel"},{k:"city",label:"City"}]},{k:"gst",label:"GSTIN"},{k:"address",label:"Address (for challan)",type:"textarea"}],c)}
  <div class="btns"><button class="btn" onclick="closeSheet()">Cancel</button><button class="btn primary" id="save">${c.id?"Save changes":"Add customer"}</button></div>`);
  $("#save").onclick=async()=>{const v=read();if(!v.name){toast("Add a name.");return}await put("customers",{...c,...v});closeSheet();toast("Customer saved")}}
function custView(id){
  const c=S.customers.find(x=>x.id===id);if(!c)return closeSheet();
  const jobs=S.jobs.filter(j=>(j.customer||"").toLowerCase()===c.name.toLowerCase()).sort((a,b)=>b.no-a.no);
  sheet(`<h3>${esc(c.name)}</h3>
  <dl>${c.phone?`<dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>`:""}${c.city?`<dt>City</dt><dd>${esc(c.city)}</dd>`:""}${c.gst?`<dt>GSTIN</dt><dd>${esc(c.gst)}</dd>`:""}</dl>
  <h2>Jobs (${jobs.length})</h2><div class="list">${jobs.map(j=>`<button class="row" data-job="${j.id}"><div class="row-top"><span class="jno">${jno(j)}</span><span class="meta">${STAGES[j.stage]}</span></div><div class="meta">${esc(jobDesc(j))}</div></button>`).join("")||'<p class="meta">No jobs yet.</p>'}</div>
  <div class="btns" style="margin-top:14px"><button class="btn" id="edit">Edit</button><button class="btn danger" id="del">Delete</button></div>`);
  $("#edit").onclick=()=>custForm(c);$("#del").onclick=e=>armDelete(e.target,()=>remove("customers",c.id));}
function renderCustomers(){
  let list=[...S.customers];if(q){const t=q.toLowerCase();list=list.filter(c=>[c.name,c.city,c.phone].join(" ").toLowerCase().includes(t))}
  list.sort((a,b)=>a.name.localeCompare(b.name));
  return `<input class="search" id="q" type="search" placeholder="Search customers" value="${esc(q)}">
  <div class="list">${list.length?list.map(c=>{const js=S.jobs.filter(j=>(j.customer||"").toLowerCase()===c.name.toLowerCase());const a=js.filter(j=>j.stage<6).length;
   return `<button class="row" data-cust="${c.id}"><div class="row-top"><span class="cust">${esc(c.name)}</span><span class="meta">${a} active</span></div><div class="meta">${[c.city,c.phone].filter(Boolean).map(esc).join(", ")||js.length+" jobs"}</div></button>`}).join("")
   :`<div class="empty">${S.customers.length?"No customers match.":"No customers yet. They're added automatically when you create a job."}</div>`}</div>`}

/* ---------- machines ---------- */
const _MTYPES=["Printing","Cutting","Lamination","UV","Die cutting","Foiling","Pasting","Binding","Other"];
const machName=id=>{const m=S.machines.find(x=>x.id===id);return m?m.name:""};
function machOpts(type){const ms=[...S.machines].sort((a,b)=>(a.type===type?0:1)-(b.type===type?0:1)||a.name.localeCompare(b.name));return[{v:"",t:"Not selected"},...ms.map(m=>({v:m.id,t:m.name+" ("+m.type+")"}))]}
function machinesView(){
  sheet(`<h3>Machines</h3><div class="list">${[...S.machines].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name)).map(m=>`<button class="row" data-mach="${m.id}"><div class="row-top"><span class="cust">${esc(m.name)}</span><span class="meta">${esc(m.type)}</span></div>${m.notes?`<div class="meta">${esc(m.notes)}</div>`:""}</button>`).join("")||'<p class="meta">No machines yet.</p>'}</div>
  <div class="btns" style="margin-top:10px"><button class="btn primary" id="addm">Add machine</button></div>`);
  $("#addm").onclick=()=>machForm()}
function machForm(m={}){
  sheet(`<h3>${m.id?"Edit machine":"Add machine"}</h3>${fields([{k:"name",label:"Machine name",ph:"e.g. Heidelberg SM 74, 4 colour"},{k:"type",label:"Type",type:"select",options:LS.MTYPES.map(t=>({v:t,t}))},{k:"notes",label:"Max sheet size / notes",ph:"e.g. 52×74 cm"}],m)}
  <div class="btns"><button class="btn" id="mb">Back</button>${m.id?'<button class="btn danger" id="del">Delete</button>':""}<button class="btn primary" id="save">Save machine</button></div>`);
  $("#mb").onclick=machinesView;
  m.id&&($("#del").onclick=e=>{if(e.target.dataset.armed){remove("machines",m.id);machinesView();return}armDelete(e.target,()=>{})});
  $("#save").onclick=async()=>{const v=read();if(!v.name){toast("Add a machine name.");return}await put("machines",{...m,...v});machinesView()}}

/* ---------- production planning ---------- */
const _PROCESSES=["Lamination gloss","Lamination matt","Varnish","UV coating","Spot UV","Foil stamping","Embossing","Debossing","Die cutting","Creasing","Window patching","Pasting","Folding","Perfect binding","Centre stitching","Spiral binding","Numbering","Perforation","Packing"];
const _CONSUMABLES=["Ink cyan","Ink magenta","Ink yellow","Ink black","Pantone ink","Varnish","Lamination film","Foil","Glue","Fountain solution","Blanket","Strapping","Corrugated box"];
const colourCount=c=>{const m=String(c||"").match(/\d+/g);return m?m.reduce((a,x)=>a+ +x,0):0};
function bestCuts(L,W,l,w){if(!(L&&W&&l&&w))return 0;return Math.max(Math.floor(L/l)*Math.floor(W/w),Math.floor(L/w)*Math.floor(W/l))}
function paperCalc(j,pl,paperId){
  const p=S.paper.find(x=>x.id===(paperId??j.paperId));const ups=+pl.ups||1,cuts=+pl.cuts||1;
  const print=Math.ceil((+j.qty||0)/ups),waste=+pl.waste||0,full=Math.ceil((print+waste)/cuts);
  const kg=p?sheetKg(p.lmm,p.wmm,p.gsm)*full:0;return{p,print,waste,full,kg,cuts,ups}}
const inp=(k,v,ph,type)=>`<label>${ph}<input data-k="${k}" value="${esc(v??"")}"${type?` type="${type}" inputmode="decimal" step="any"`:""}${k==="item"?' list="conslist"':k==="process"?' list="proclist"':""}></label>`;
const sel=(k,v,opts,lab)=>`<label>${lab}<select data-k="${k}">${opts.map(o=>`<option value="${esc(o.v)}"${String(o.v)===String(v??"")?" selected":""}>${esc(o.t)}</option>`).join("")}</select></label>`;
const consRow=(c={})=>`<div class="rrow r-cons"><button class="rx" aria-label="Remove">×</button><div class="two" style="--n:3">${inp("item",c.item,"Item")}${inp("qty",c.qty,"Qty","number")}${inp("unit",c.unit||"kg","Unit")}</div></div>`;
const _RUNITS=["per 1,000","per pc","per sheet","per kg","lump sum"];
const _LAMF=[{v:"BOPP 10 micron",k:108},{v:"BOPP & Matte 12 micron",k:85}];
const _JWT=["With material","Without material"];
const isLam=p=>/lamin/i.test(p||"");
const r2=n=>Math.round(n*100)/100;
function lamCalc(x){const k=(LS.LAMF.find(f=>f.v===x.lfilm)||LS.LAMF[0]).k;const L=+x.ll,W=+x.lw;if(!(L>0&&W>0))return null;const spk=1550*k/L/W;const sh=(+x.lsheets||0)*(+x.lsides||1);return{k,spk,sh,kg:sh?sh/spk:0}}
const lamTxt=f=>isLam(f.process)&&f.ll&&f.lw?`${f.lfilm||LS.LAMF[0].v}, ${+f.lsides===2?"both sides":"one side"}, sheet ${f.ll}×${f.lw} in, ${fmtN(f.lspk)} sheets/kg${f.lkg?`, ${fmtN(f.lsheets)} sheets ≈ ${fmtN(f.lkg)} kg film`:""}`:"";
const modeTxt=f=>f.mode==="Outsource"?"Outsource"+(f.jw?" · Job work "+f.jw.toLowerCase():""):"In house";
const fabRow=(f={})=>`<div class="rrow r-fab"><button class="rx" aria-label="Remove">×</button>${inp("process",f.process,"1. Fabrication")}
  <div class="lam"${isLam(f.process)?"":" hidden"}><div class="calc" style="margin:0 0 10px;padding-bottom:2px"><b>Lamination film required</b>
    <div class="two">${sel("lfilm",f.lfilm||LS.LAMF[0].v,LS.LAMF.map(x=>({v:x.v,t:x.v})),"Film")}${sel("lsides",f.lsides||"",[{v:"",t:"Select…"},{v:1,t:"One side"},{v:2,t:"Both sides"}],"One side / Both sides")}</div>
    <div class="meta" style="margin:2px 0 4px;font-weight:600">Sheet size</div>
    <div class="two" style="--n:3">${inp("ll",f.ll,"Length (inch)","number")}${inp("lw",f.lw,"Width (inch)","number")}${inp("lsheets",f.lsheets,"Sheets","number")}</div>
    <p class="lamout" style="margin:0 0 8px"></p></div></div>
  <div class="two">${inp("details",f.details,"Details / specs")}${sel("machine",f.machine,machOpts(""),"Machine")}</div>${sel("mode",f.mode||"In house",[{v:"In house",t:"In house"},{v:"Outsource",t:"Outsource"}],"2. In house / Outsource")}
  <div class="osx"${f.mode==="Outsource"?"":" hidden"}>${sel("jw",f.jw||LS.JWT[0],LS.JWT.map(t=>({v:t,t})),"3. Job work")}<label>Job worker<input data-k="worker" list="wlist" value="${esc(f.worker||"")}" placeholder="Select or type a name"></label>
  ${isAdm()?`<div class="two"><label>Rate (₹ or TBD)<input data-k="rate" value="${esc(f.rate||"")}" placeholder="e.g. 450 or TBD"></label>${sel("runit",f.runit||"per 1,000",LS.RUNITS,"Rate")}</div>
  <div class="tbdrow"><button type="button" class="mini tbd">Set rate to TBD</button></div>`:""}</div>
  ${inp("remark",f.remark,"Remark")}</div>`;
const rows=cls=>[...$("#sheet-body").querySelectorAll("."+cls)].map(r=>{const o={};r.querySelectorAll("[data-k]").forEach(i=>o[i.dataset.k]=i.value.trim());return o});
function planForm(id){
  const j=S.jobs.find(x=>x.id===id);if(!j)return;const pl=j.plan||{};
  const cc=colourCount(j.colors);
  const v={machine:pl.machine||"",paperId:j.paperId||"",paperSrc:srcOf(j),cl:pl.cutL||"",cw:pl.cutW||"",cu:"mm",cuts:pl.cuts||"",ups:pl.ups||1,waste:pl.waste??"",
    pcount:pl.plates?.count??(cc||""),psize:pl.plates?.size||"",ptype:pl.plates?.type||"CTP new",pnote:pl.plates?.notes||""};
  sheet(`<h3>Plan ${jno(j)}</h3><p class="meta" style="margin-top:-6px">${esc(j.customer)}: ${esc(jobDesc(j))}, ${fmtN(j.qty)} pcs${j.colors?", "+esc(j.colors):""}</p>
  <datalist id="conslist">${LS.CONSUMABLES.map(c=>`<option value="${c}">`).join("")}</datalist>
  <datalist id="wlist">${S.workers.map(w=>`<option value="${esc(w.name)}">`).join("")}</datalist>
  <datalist id="proclist">${LS.PROCESSES.map(c=>`<option value="${c}">`).join("")}</datalist>
  <div class="sec"><h4>Machine <button class="mini" id="mm">Manage machines</button></h4>
  ${fields([{k:"machine",label:"Printing machine",type:"select",options:machOpts("Printing")}],v)}</div>
  <div class="sec"><h4>Paper</h4>
  ${fields([{k:"paperSrc",label:"Paper supplied by",type:"select",options:SRC_OPTS},
    {k:"paperId",label:"Paper (PIN)",type:"select",options:[{v:"",t:emptyPaperTxt(srcOf(j),j.customer)},...paperOptions(j.paperId,srcOf(j),j.customer,false)]},
    {row:[{k:"cl",label:"Cut length",type:"number"},{k:"cw",label:"Cut width",type:"number"},{k:"cu",label:"In",type:"select",options:[{v:"mm",t:"mm"},{v:"cm",t:"cm"},{v:"inch",t:"Inches"}]}]},
    {row:[{k:"cuts",label:"Cuts per sheet",type:"number"},{k:"ups",label:"Ups per cut sheet",type:"number"},{k:"waste",label:"Wastage sheets",type:"number"}]}],v)}
  <div id="alx"></div><button class="add" type="button" id="aladd" style="margin-bottom:10px">+ Allot from another PIN</button>
  <div class="calc" id="pcalc"></div></div>
  <div class="sec"><h4>Plates <button class="mini" id="plin">+ Plate inward</button></h4>
  ${platePick(j,pl.plates?.ids||[],pl.plates?.sets||[])}<div style="height:10px"></div>
  ${fields([{row:[{k:"pcount",label:"No. of plates",type:"number"},{k:"psize",label:"Plate size",ph:"e.g. 605×745"}]},
    {k:"ptype",label:"Plate type",type:"select",options:LS.PLTYPES.map(t=>({v:t,t}))},{k:"pnote",label:"Plate notes"}],v)}</div>
  <div class="sec"><h4>Punch <button class="mini" id="puin">+ Punch inward</button></h4>${punchPick(j,pl.punch?.ids||[])}</div>
  <div class="sec"><h4>Consumables</h4><div id="list-cons">${(pl.consumables||[]).map(consRow).join("")}</div><button class="add" data-addrow="cons">Add consumable</button></div>
  <div class="sec"><h4>Fabrication</h4><div id="list-fab">${(pl.fab||[]).map(fabRow).join("")}</div><button class="add" data-addrow="fab">Add process</button></div>
  <div class="btns" style="margin-top:14px"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save plan</button></div>`);
  const body=$("#sheet-body");const cutsEl=body.querySelector('[name="cuts"]');
  const alOpts=(src,cur)=>[...S.paper].filter(p=>p.id===cur||(srcMatch(p,src,j.customer)&&balance(p.id)>0));
  const alRow=(a={})=>{const L=alOpts(body.querySelector('[name="paperSrc"]').value,a.pid);return `<div class="rrow alr"><button class="rx" type="button" aria-label="Remove">×</button><div class="two" style="grid-template-columns:1.6fr 1fr"><label>Also from PIN<select data-a="pid">${L.map(p=>`<option value="${p.id}"${p.id===a.pid?" selected":""}>${esc(pinTxt(p)+" · "+paperName(p).replace(/^[^:]*: /,"")+" · "+fmtN(Math.floor(stockSh(p)))+" sh")}</option>`).join("")}</select></label><label>Sheets<input data-a="sh" type="number" inputmode="numeric" min="0" value="${esc(a.sh??"")}"></label></div></div>`};
  (pl.alloc||[]).slice(1).forEach(a=>$("#alx").insertAdjacentHTML("beforeend",alRow(a)));
  const alRead=()=>[...body.querySelectorAll(".alr")].map(r=>({pid:r.querySelector('[data-a="pid"]').value,sh:+r.querySelector('[data-a="sh"]').value||0}));
  if(pl.cuts)cutsEl.dataset.touched=1;
  cutsEl.addEventListener("input",()=>cutsEl.dataset.touched=1);
  const calc=()=>{const f=read();const p=S.paper.find(x=>x.id===f.paperId);
    const l=toMm(f.cl,f.cu),w=toMm(f.cw,f.cu);
    if(!cutsEl.dataset.touched&&p&&l&&w){const bc=bestCuts(p.lmm,p.wmm,l,w);if(bc)cutsEl.value=bc}
    const r=paperCalc(j,{cuts:cutsEl.value,ups:f.ups,waste:f.waste},f.paperId);
    let t=l&&w?`Cut size <b>${fmtN(l)} × ${fmtN(w)} mm</b><br>`:"";
    t+=`Printing sheets <b>${fmtN(r.print)}</b> + wastage ${fmtN(r.waste)}<br>Full sheets to issue <b>${fmtN(r.full)}</b>${r.kg?` (≈ ${kgTxt(r.kg)})`:""}`;
    const ex=alRead();const exSh=ex.reduce((a,x)=>a+x.sh,0);const prim=Math.max(0,r.full-exSh);
    if(ex.length){t+=`<br><b>Allotment</b>: ${p?esc(pinTxt(p)):"Main PIN not selected"} ${fmtN(prim)} sheets`+ex.map(x=>{const pp=S.paper.find(y=>y.id===x.pid);return ` + ${pp?esc(pinTxt(pp)):"?"} ${fmtN(x.sh)}`}).join("")+` = <b>${fmtN(prim+exSh)}</b> of ${fmtN(r.full)}`;
      if(exSh>r.full)t+=`<span class="caution">Other PINs add up to more than the ${fmtN(r.full)} sheets needed.</span>`;
      for(const x of ex){const pp=S.paper.find(y=>y.id===x.pid);if(pp&&x.sh>stockSh(pp)+1e-9)t+=`<span class="caution">${esc(pinTxt(pp))} has only ${fmtN(Math.floor(stockSh(pp)))} sheets in stock.</span>`}}
    if(p){const done=jobMoves(j).filter(m=>m.paperId===p.id).reduce((a,m)=>a+(sheetsOf(p,-(+m.qty||0))||0),0);t+=stockWarn(p,Math.max(0,Math.ceil((ex.length?prim:r.full)-done)),j.id)}
    $("#pcalc").innerHTML=t;
    const inch=x=>x?r2(x/25.4):"";
    body.querySelectorAll(".r-fab").forEach(row=>{const g=k=>row.querySelector(`[data-k="${k}"]`);const lam=row.querySelector(".lam");const on=isLam(g("process").value);lam.hidden=!on;if(!on)return;
      if(!g("ll").value&&l)g("ll").value=inch(l);if(!g("lw").value&&w)g("lw").value=inch(w);if(!g("lsheets").value&&r.print)g("lsheets").value=r.print+(r.waste||0);
      const c=lamCalc({lfilm:g("lfilm").value,lsides:g("lsides").value,ll:g("ll").value,lw:g("lw").value,lsheets:g("lsheets").value});
      row.querySelector(".lamout").innerHTML=(g("lsides").value?"":`<span class="caution" style="margin:0 0 6px">Choose one side or both sides.</span>`)+(c?`1550 × ${c.k} ÷ ${g("ll").value} ÷ ${g("lw").value} = <b>${fmtN(r2(c.spk))} sheets per kg</b>${c.kg?`<br>${fmtN(c.sh)} sheet sides ÷ ${fmtN(r2(c.spk))} = <b style="font-size:17px">${fmtN(r2(c.kg))} kg film required</b>`:""}`:"Enter sheet length and width in inches.")})};
  body.querySelector('[name="paperSrc"]').onchange=e=>{fillPaperSel(body.querySelector('[name="paperId"]'),e.target.value,j.customer);$("#alx").innerHTML="";calc()};
  $("#aladd").onclick=()=>{const f=read();if(!f.paperId){toast("Select the main PIN first.");return}const r0=paperCalc(j,{cuts:cutsEl.value,ups:f.ups,waste:f.waste},f.paperId);
    const L=alOpts(f.paperSrc).filter(p=>p.id!==f.paperId&&!alRead().some(x=>x.pid===p.id));if(!L.length){toast("No other PIN with stock for this job.");return}
    const pp=S.paper.find(x=>x.id===f.paperId);const short=Math.max(0,Math.ceil(r0.full-alRead().reduce((a,x)=>a+x.sh,0)-(pp?Math.floor(stockSh(pp)):0)));
    $("#alx").insertAdjacentHTML("beforeend",alRow({pid:L[0].id,sh:short?Math.min(short,Math.floor(stockSh(L[0]))):""}));$("#alx").lastElementChild.querySelector("input").focus();calc()};
  $("#alx").addEventListener("click",e=>{if(e.target.closest(".rx"))setTimeout(calc,0)});
  body.addEventListener("input",calc);body.addEventListener("change",calc);calc();
  body.addEventListener("click",e=>{const a=e.target.closest("[data-addrow]");if(a){const c=a.dataset.addrow;const box=$("#list-"+c);box.insertAdjacentHTML("beforeend",c==="cons"?consRow():fabRow());box.lastElementChild.querySelector("input").focus()}
    if(e.target.classList.contains("rx"))e.target.parentElement.remove();
    if(e.target.classList.contains("tbd")){const ri=e.target.closest(".osx").querySelector('[data-k="rate"]');ri.value="TBD"}});
  body.addEventListener("change",e=>{if(e.target.dataset.k==="mode"){const o=e.target.closest(".r-fab").querySelector(".osx");o.hidden=e.target.value!=="Outsource";if(!o.hidden)o.querySelector("input").focus()}});
  $("#mm").onclick=machinesView;$("#cancel").onclick=()=>jobView(id);
  $("#plin").onclick=()=>plateForm({},()=>planForm(id));$("#puin").onclick=()=>punchForm({},()=>planForm(id));
  const pickIds=()=>[...body.querySelectorAll('#plpick input:checked')].map(i=>i.value);
  body.querySelector("#plpick")?.addEventListener("change",()=>{const vals=pickIds();const ps=[...new Set(vals.map(v=>v.split("|")[0]))].map(x=>S.plates.find(p=>p.id===x)).filter(Boolean);if(!ps.length)return;
    body.querySelector('[name="pcount"]').value=vals.reduce((a,v)=>{const [id,sn]=v.split("|");const pp=S.plates.find(x=>x.id===id);if(!pp)return a;if(sn){const st=(pp.sets||[]).find(x=>x.sno===sn);return a+(st?+st.pps||0:0)}return a+(+pp.qty||0)},0);
    const sz=body.querySelector('[name="psize"]');if(!sz.value&&ps[0].size)sz.value=ps[0].size;
    const ty=body.querySelector('[name="ptype"]');if(ps[0].type)ty.value=ps[0].type});
  $("#save").onclick=async()=>{const f=read();
    const fab=rows("r-fab").filter(x=>x.process);
    for(const x of fab){if(isLam(x.process)&&!x.lsides){toast(`Choose one side or both sides for ${x.process}.`);return}}
    for(const x of fab){if(isLam(x.process)){const c=lamCalc(x);x.lspk=c?r2(c.spk):"";x.lkg=c?r2(c.kg):""}else{for(const k of ["lfilm","lsides","ll","lw","lsheets"])delete x[k]}
      if(x.mode!=="Outsource"){x.worker="";x.rate="";x.runit="";x.jw="";continue}
      if(!isAdm()){delete x.rate;delete x.runit;continue}
      const r=String(x.rate||"").replace(/,/g,"").replace(/^₹\s*/,"").trim();
      if(/^tbd$/i.test(r))x.rate="TBD";else if(r&&!(+r>=0)){toast(`Rate for ${x.process} must be a number or TBD.`);return}else x.rate=r}
    const newW=[...new Set(fab.filter(x=>x.worker&&!S.workers.some(w=>normName(w.name)===normName(x.worker))).map(x=>x.worker.trim()))];
    for(const n of newW)await put("workers",{name:n});
    const ex=alRead();
    if(ex.length){if(!f.paperId){toast("Select the main PIN first.");return}
      const ids=[f.paperId,...ex.map(x=>x.pid)];if(new Set(ids).size!==ids.length){toast("The same PIN is selected twice.");return}
      for(const x of ex){const pp=S.paper.find(y=>y.id===x.pid);if(!(x.sh>0)){toast("Enter the sheets for every extra PIN, or remove it.");return}if(pp&&x.sh>stockSh(pp)+1e-9){toast(`${pinTxt(pp)} has only ${fmtN(Math.floor(stockSh(pp)))} sheets in stock.`);return}}}
    const plan={machine:f.machine,cutL:toMm(f.cl,f.cu),cutW:toMm(f.cw,f.cu),cuts:+cutsEl.value||1,ups:+f.ups||1,waste:+f.waste||0,
      plates:{count:+f.pcount||0,size:f.psize,type:f.ptype,notes:f.pnote,ids:[...new Set(pickIds().map(v=>v.split("|")[0]))],sets:pickIds().filter(v=>v.includes("|")).map(v=>v.split("|").slice(1).join("|"))},punch:{ids:[...body.querySelectorAll('#pupick input:checked')].map(i=>i.value)},
      consumables:rows("r-cons").filter(c=>c.item),fab,planned:today()};
    const r=paperCalc(j,plan,f.paperId);plan.printSheets=r.print;plan.fullSheets=r.full;
    if(ex.length){const exSh=ex.reduce((a,x)=>a+x.sh,0);if(exSh>r.full){toast(`Extra PINs add up to ${fmtN(exSh)}, more than the ${fmtN(r.full)} sheets needed.`);return}plan.alloc=[{pid:f.paperId,sh:r.full-exSh},...ex]}else plan.alloc=null;
    await put("jobs",{...j,paperId:f.paperId,paperSrc:f.paperSrc,plan});toast("Plan saved");jobView(id)}}
function planSummary(j){const pl=j.plan;if(!pl)return`<p class="meta">Not planned yet.</p>`;
  const r=paperCalc(j,pl);
  return `<dl>${pl.machine?`<dt>Machine</dt><dd>${esc(machName(pl.machine))}</dd>`:""}
  <dt>Paper</dt><dd>${fmtN(r.full)} full sheets${r.kg?` (≈ ${kgTxt(r.kg)})`:""}<br><span class="meta">${pl.cutL?`Cut ${fmtN(pl.cutL)}×${fmtN(pl.cutW)} mm, `:""}${r.cuts} cuts, ${r.ups} ups, ${fmtN(r.print)} printing sheets</span></dd>
  ${pl.plates?.count||platesOf(j).length?`<dt>Plates</dt><dd>${pl.plates.count?`${pl.plates.count} ${esc(pl.plates.type)}${pl.plates.size?", "+esc(pl.plates.size):""}`:""}${jobPlateNos(j).map(({p,ss})=>`<br><button class="mini" data-plate="${p.id}">${esc(ss?ss.map(s=>s.sno).join(", "):p.pno)}</button> <span class="meta">${esc(p.vendor||"")}${ss?" · "+esc(ss.map(s=>s.form).join(", ")):plSets(p)?" · "+esc(plSetTxt(p)):""}</span>`).join("")}</dd>`:""}
  ${punchesOf(j).length?`<dt>Punch</dt><dd>${punchesOf(j).map(u=>`<button class="mini" data-punch="${u.id}">${esc(u.pno)}</button> <span class="meta">${esc([u.type,u.size].filter(Boolean).join(", "))}</span>`).join("<br>")}</dd>`:""}</dl>
  ${pl.consumables?.length?`<table class="pt"><tr><th>Consumable</th><th>Qty</th></tr>${pl.consumables.map(c=>`<tr><td>${esc(c.item)}</td><td class="num">${esc(c.qty)} ${esc(c.unit)}</td></tr>`).join("")}</table>`:""}
  ${pl.fab?.length?`<table class="pt"><tr><th>Fabrication</th><th>Details</th><th>In house / Outsource</th></tr>${pl.fab.map(f=>`<tr><td>${esc(f.process)}</td><td>${esc([f.details,machName(f.machine),lamTxt(f),f.remark&&"Remark: "+f.remark].filter(Boolean).join(", "))}</td><td class="oh ${f.mode==="Outsource"?"out":"in"}">${esc(modeTxt(f))}${f.mode==="Outsource"&&f.worker?`<br><span class="meta">${esc(f.worker)}${isAdm()&&rateTxt(f)?" · "+esc(rateTxt(f)):""}</span>`:""}</td></tr>`).join("")}</table>`:""}`}
const rateTxt=f=>!f.rate?"":f.rate==="TBD"?"TBD":"₹"+fmtN(+f.rate)+" "+(f.runit||"");

/* ---------- printouts ---------- */
const DOCCSS=`.doc h1{font-size:20px;margin:0}.doc .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px}
.doc table{width:100%;border-collapse:collapse;margin:0 0 12px}.doc th,.doc td{border:1px solid #000;padding:5px 6px;text-align:left;vertical-align:top}
.doc th{background:#eee;width:34%}.doc .t th{width:auto}.doc h2{font-size:14px;margin:12px 0 5px;text-transform:none}.doc .big{font-size:22px;font-weight:700}
.doc .pinbig{font-size:26px;font-weight:800;border:2px solid #000;padding:2px 10px;display:inline-block}
.doc .caut{border:2px solid #000;background:#ffe3ea;padding:8px 10px;font-weight:700;margin:0 0 12px}
.doc .sign{display:flex;justify-content:space-between;margin-top:36px}.doc .sign span{border-top:1px solid #000;padding-top:4px;min-width:30%;text-align:center}
.doc .fr{display:flex;gap:22px}.doc .fl{flex:1;display:flex;align-items:flex-end;gap:8px;height:34px;font-size:11.5px}.doc .fl b{white-space:nowrap;font-weight:700}.doc .fl i{flex:1;border-bottom:1px solid #000;height:1px}
.doc .sb{display:grid;gap:14px;margin-top:14px}.doc .sb div{border:1px solid #000;height:82px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;text-align:center;font-size:11px;padding:4px 6px;line-height:1.25}.doc .sb small{color:#555;font-size:10px}.doc .fbox{break-inside:avoid;page-break-inside:avoid}`;
let printName="";
function showPrint(name,html){printName=name;$("#p-doc").innerHTML=`<style>${DOCCSS}</style><div class="doc">${html}</div>`;$("#print").classList.add("on");window.scrollTo(0,0)}
$("#p-close").onclick=()=>$("#print").classList.remove("on");
$("#p-print").onclick=()=>{try{window.print()}catch(e){toast("Printing isn't available here. Use Download, then print the file.")}};
$("#p-dl").onclick=async()=>{let dl=null;try{dl=window.claude&&window.claude.use?await window.claude.use("downloads"):null}catch(e){}
  if(!dl){toast("Download isn't available here.");return}
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(printName)}</title><style>body{margin:0}${DOCCSS}</style></head><body>${$("#p-doc").innerHTML}</body></html>`;
  try{await dl.save({filename:printName+".html",data:html})}catch(e){if(e.code!=="declined")toast("Couldn't download the file.")}};
const docHead=(title,j)=>`<div class="hd"><div><h1>${OWN}</h1><div>${title}</div></div><div style="text-align:right"><div class="big">${jno(j)}</div><div>Date: ${fmtD(today())}</div></div></div>`;
const trs=a=>a.filter(x=>x[1]!==""&&x[1]!=null).map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join("");
function issueBlock(j){const st=paperStatus(j);
  const mv=jobMoves(j).sort((a,b)=>(a.at||0)-(b.at||0));
  const row=m=>{const pm=S.paper.find(x=>x.id===m.paperId);const u=pm?.unit||"sheets";const sh=pm&&u!=="sheets"?sheetsOf(pm,Math.abs(m.qty)):null;
    return `<tr><td>${fmtD(m.date)}</td><td><b>${esc(pm?.pin||m.pin||"-")}</b></td><td>${m.qty<0?"Issued":"Returned"} ${fmtN(Math.abs(m.qty))} ${esc(u)}${sh!=null?` (${fmtN(Math.round(sh))} sheets)`:""}</td><td>${esc(m.note)}</td></tr>`};
  return `${st.over?`<div class="caut">CAUTION: ${fmtN(Math.round(st.issSh))} sheets issued against ${fmtN(st.need)} planned. Excess ${fmtN(st.excess)} sheets.</div>`:""}
  <h2>Paper issued</h2>${mv.length?`<table class="t"><tr><th>Date</th><th>PIN</th><th>Qty</th><th>Note</th></tr>${mv.map(row).join("")}
  <tr><th colspan="2">Net issued</th><th>${st.issSh!=null?fmtN(Math.round(st.issSh))+" sheets":""}</th><th>${st.need?(st.over?`Excess ${fmtN(st.excess)} sheets`:st.remaining?`Balance ${fmtN(st.remaining)} sheets`:"Matches plan"):""}</th></tr></table>`:"<p>Not issued yet.</p>"}`}
function cuttingSlip(j){const pl=j.plan||{};const r=paperCalc(j,pl);const p=r.p;
  showPrint(`Cutting slip ${jno(j)}`,docHead("Paper cutting slip",j)+`<table>${trs([
    ["Customer",esc(j.customer)],["Item",esc(j.ptype)],["Job name",esc(j.item)],["Order qty",fmtN(j.qty)+" pcs"],
    ["PIN",allocTxt(j)?allocOf(j).map(a=>{const pp=S.paper.find(x=>x.id===a.pid);return `<span class="pinbig">${esc(pp?.pin||"?")}</span> ${fmtN(a.sh)} sheets${pp&&locTxt(pp)?" · <b>"+esc(locTxt(pp))+"</b>":""}`}).join("<br>"):p?`<span class="pinbig">${esc(p.pin||"No PIN")}</span>`:""],
    ["Paper",p?esc(p.name)+(p.gsm?", "+esc(p.gsm)+" gsm":""):"Not linked"],["Full sheet size",p?esc(sizeTxt(p)):""],
    ["Stored at",p&&locTxt(p)?`<b>${esc(locTxt(p))}</b>`:""],
    ["Supplied by",p?esc(supplyTxt(p)):""],
    ["Sheets planned",`<span class="big">${fmtN(r.full)}</span>${r.kg?` (≈ ${kgTxt(r.kg)})`:""}`],
    ["Cut size",pl.cutL?`<span class="big">${fmtN(pl.cutL)} × ${fmtN(pl.cutW)} mm</span>`:"Not set"],
    ["Cuts per sheet",r.cuts],["Total cut sheets",fmtN(r.full*r.cuts)],["For printing / wastage",fmtN(r.print)+" / "+fmtN(r.waste)],
    ["Machine",esc(machName(pl.machine))],["Delivery",fmtD(j.due)]])}</table>
    ${issueBlock(j)}
    <table><tr><th>Sheets actually cut</th><td style="height:30px"></td></tr><tr><th>Remarks</th><td style="height:50px"></td></tr></table>
    <div class="sign"><span>Issued by</span><span>Cut by</span><span>Checked by</span></div>`)}
const _WST=["Make-ready / setting","Printing (running)","Lamination","Cutting","Die cutting / punching","Pasting / binding","Packing / counting","Other"];
const _PRODST=["Plates","Printing","Finishing","Packing"];
function jsBom(j){const pl=j.plan||{};const r=paperCalc(j,pl);const p=r.p;const bom=[];
  if(allocTxt(j))for(const a of allocOf(j)){const pp=S.paper.find(x=>x.id===a.pid);bom.push({mat:"Paper: "+(pp?(pp.pin?pp.pin+" · ":"")+paperName(pp).replace(/^[^:]*: /,""):"PIN ?"),planned:fmtN(a.sh)+" sheets"})}
  else if(p||r.full)bom.push({mat:"Paper"+(p?": "+(p.pin?p.pin+" · ":"")+paperName(p).replace(/^[^:]*: /,""):""),planned:fmtN(r.full)+" sheets"});
  if(pl.plates?.count)bom.push({mat:"Plates: "+[pl.plates.type,pl.plates.size].filter(Boolean).join(", "),planned:fmtN(pl.plates.count)+" nos"});
  for(const c of pl.consumables||[])bom.push({mat:c.item,planned:[c.qty,c.unit].filter(Boolean).join(" ")});
  for(const f of pl.fab||[])if(isLam(f.process)&&f.lkg)bom.push({mat:"Lamination film: "+(f.lfilm||LS.LAMF[0].v)+(+f.lsides===2?", both sides":""),planned:fmtN(f.lkg)+" kg"});
  return bom}
const jsHead=(t,j)=>`<div class="hd"><div><div class="big">JOB SHEET</div><div>${t}</div></div><div style="text-align:right"><div class="big">${jno(j)}</div><div>Date: ${fmtD(today())}</div></div></div>`;
function jobSheetPrint(j){const pl=j.plan||{};const r=paperCalc(j,pl);const p=r.p;const A=j.act||{};
  const bom=(A.bom&&A.bom.length?A.bom:jsBom(j)).map(x=>({...x}));while(bom.length<8)bom.push({});
  const wv=k=>(A.wst||[]).find(x=>x.stage===k)||{};const pv=k=>(A.prod||[]).find(x=>x.stage===k)||{};
  const sty=`<style>.doc .p2{break-before:page;page-break-before:always;border-top:2px dashed #999;margin-top:22px;padding-top:12px}.doc .p2 td{height:18px;padding-top:2px;padding-bottom:2px}.doc .p2 h2{margin:8px 0 4px}.doc .mgr{break-inside:avoid;page-break-inside:avoid}.doc .ln{border-bottom:1px solid #000;min-height:22px;font-size:12px;padding-top:4px}.doc .fr{display:flex;gap:22px}.doc .fl{flex:1;display:flex;align-items:flex-end;gap:8px;height:30px;font-size:11.5px}.doc .fl b{white-space:nowrap}.doc .fl i{flex:1;border-bottom:1px solid #000;height:auto;min-height:1px;font-style:normal;font-size:12px;padding:0 4px 1px;line-height:1.2}.doc .sbx{border:1px solid #000;height:62px;display:flex;align-items:flex-end;justify-content:center;font-size:11px;padding:4px;margin-top:10px}@media print{.doc .p2{border-top:0;margin-top:0;padding-top:0}}</style>`;
  showPrint(`Job sheet ${jno(j)}`,LHP+sty+jsHead("Page 1 of 2",j)+`<table>${trs([
    ["Customer",esc(j.customer)],["Item",esc(j.ptype)],["Job name",esc(j.item)],["Quantity",fmtN(j.qty)+" pcs"],["Final cut size",esc(j.size)],
    ["Colours",esc(j.colors)],["Finishing",esc(j.finishing)],["Delivery date",fmtD(j.due)],["Notes",esc(j.notes)]])}</table>
    <h2>Printing</h2><table>${trs([["Machine",esc(machName(pl.machine))||"&nbsp;"],
    ["PIN",allocTxt(j)?allocOf(j).map(a=>{const pp=S.paper.find(x=>x.id===a.pid);return `<span class="pinbig">${esc(pp?.pin||"?")}</span> ${fmtN(a.sh)} sheets${pp&&locTxt(pp)?" · "+esc(locTxt(pp)):""}`}).join("<br>"):p?`<span class="pinbig">${esc(p.pin||"No PIN")}</span>`:""],["Paper",p?esc(paperName(p).replace(/^[^:]*: /,"")):"Not linked"],["Supplied by",p?esc(supplyTxt(p)):""],["Stored at",p?esc(locTxt(p)):""],
    ["Full sheets",fmtN(r.full)+(r.kg?` (≈ ${kgTxt(r.kg)})`:"")],["Cut size",pl.cutL?`${fmtN(pl.cutL)} × ${fmtN(pl.cutW)} mm`:""],
    ["Cuts / ups",`${r.cuts} cuts per sheet, ${r.ups} ups`],["Printing sheets",fmtN(r.print)+" + "+fmtN(r.waste)+" wastage"],
    ["Plates",pl.plates?.count?`${pl.plates.count} ${esc(pl.plates.type)}${pl.plates.size?", "+esc(pl.plates.size):""}${pl.plates.notes?", "+esc(pl.plates.notes):""}`:""],
    ["Plate nos.",jobPlateTxt(j)],["Punch nos.",punchesOf(j).map(u=>`<b>${esc(u.pno)}</b> ${esc([u.type,u.size,+u.ups>1?u.ups+" ups":""].filter(Boolean).join(", "))}${u.loc?" · "+esc(u.loc):""}`).join("<br>")]])}</table>
    ${issueBlock(j)}
    ${pl.fab?.length?`<h2>Fabrication</h2><table class="t" style="font-size:11.5px"><tr><th>#</th><th>Fabrication</th><th>Details</th><th>In house / Outsource</th><th>Done</th><th>Remark</th></tr>${pl.fab.map((f,i)=>`<tr><td>${i+1}</td><td><b>${esc(f.process)}</b></td><td>${esc([f.details,machName(f.machine),lamTxt(f)].filter(Boolean).join(" · "))}</td><td><b>${esc(f.mode==="Outsource"?"Outsource":"In house")}</b>${f.mode==="Outsource"?(f.jw?"<br>Job work "+esc(f.jw.toLowerCase()):"")+(f.worker?"<br>"+esc(f.worker)+(isAdm()&&rateTxt(f)?", "+esc(rateTxt(f)):""):""):""}</td><td></td><td>${esc(f.remark||"")}</td></tr>`).join("")}</table>`:""}
    <h2>Production record</h2><table class="t"><tr><th>Stage</th><th>Date</th><th>Qty OK</th><th>Operator</th></tr>${LS.PRODST.map(s=>{const v=pv(s);return `<tr><td>${s}</td><td>${v.date?fmtDY(v.date):""}</td><td>${esc(v.qty||"")}</td><td>${esc(v.op||"")}</td></tr>`}).join("")}</table>
    <div class="sign"><span>Planned by</span><span>Production</span><span>Quality check</span></div>
    <div class="p2">${jsHead("Page 2 of 2: bill of material &amp; wastage",j)}
    <p style="font-size:11px;margin:0 0 4px">${esc(j.customer)} · ${esc(jobDesc(j))} · ${fmtN(j.qty)} pcs. ${j.act?"Entered from the physical job sheet.":"Fill in by hand at the end of the job."}</p>
    <h2>Bill of material (BOM)</h2><table class="t" style="font-size:11.5px"><tr><th style="width:4%">Sr</th><th style="width:32%">Material</th><th>Planned</th><th>Issued</th><th>Used</th><th>Wastage</th><th>Returned</th><th>Remarks</th></tr>
    ${bom.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.mat||"")}</td><td>${esc(b.planned||"")}</td><td>${esc(b.iss||"")}</td><td>${esc(b.used||"")}</td><td>${esc(b.waste||"")}</td><td>${esc(b.ret||"")}</td><td>${esc(b.rem||"")}</td></tr>`).join("")}</table>
    <h2>Wastage report</h2><table class="t" style="font-size:11.5px"><tr><th style="width:30%">Stage</th><th>Wastage (sheets / pcs)</th><th>Reason</th></tr>
    ${LS.WST.map(w=>{const v=wv(w);return `<tr><td>${w}</td><td>${esc(v.qty||"")}</td><td>${esc(v.reason||"")}</td></tr>`}).join("")}<tr><td><b>Total wastage</b></td><td><b>${A.wst?fmtN((A.wst||[]).reduce((a,x)=>a+(+x.qty||0),0)):""}</b></td><td></td></tr></table>
    <div class="mgr"><h2>Remarks of on-duty manager</h2>${A.mrem?`<div class="ln">${esc(A.mrem)}</div>`:`<div class="ln"></div><div class="ln"></div>`}
    <div class="fr"><div class="fl"><b>On-duty manager:</b><i>${esc(A.mgr||"")}</i></div><div class="fl" style="flex:.6"><b>Shift:</b><i>${esc(A.shift||"")}</i></div><div class="fl" style="flex:.6"><b>Date:</b><i>${A.mdate?fmtDY(A.mdate):""}</i></div></div>
    <div class="fr"><div class="sbx" style="flex:1"><b>Signature of on-duty manager</b></div><div class="sbx" style="flex:1"><b>Verified by</b>${A.ver?"&nbsp;"+esc(A.ver):""}</div></div></div></div>`)}

/* ---------- JS entry: data entry from the physical job sheet ---------- */
let jsFilter="todo";
function renderEntry(){const t=q.toLowerCase();
  const F={todo:j=>j.plan&&!j.act&&j.stage>=4,done:j=>!!j.act,all:j=>!!j.plan};
  const cnt={};for(const k in F)cnt[k]=S.jobs.filter(F[k]).length;
  let list=S.jobs.filter(F[jsFilter]||F.todo);
  if(t)list=list.filter(j=>[jno(j),j.customer,jobDesc(j)].join(" ").toLowerCase().includes(t));
  list.sort((a,b)=>(b.no||0)-(a.no||0));
  return `<input class="search" id="q" type="search" placeholder="Search job no., party or job" value="${esc(q)}">
  <p class="meta" style="margin:8px 0 0">Record production from the physical job sheet: BOM, wastage, quantities and the manager's remarks.</p>
  <div class="chips">${[["todo","To enter",cnt.todo],["done","Entered",cnt.done],["all","All planned",cnt.all]].map(([k,l,n])=>`<button class="chip" data-jsf="${k}" aria-pressed="${jsFilter===k}">${l}<b>${n}</b></button>`).join("")}</div>
  <div class="list">${list.map(j=>`<button class="row" data-js="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> <span class="cust">${esc(j.customer)}</span></span><span class="meta">${STAGES[j.stage]}</span></div>
    <div class="row-top meta"><span>${esc(jobDesc(j))} · ${fmtN(j.qty)} pcs</span><span class="${j.act?"plus":"due-soon"}">${j.act?"Entered "+fmtD(j.act.on):"To enter"}</span></div></button>`).join("")
    ||`<div class="empty">${jsFilter==="todo"?"No job sheets waiting. Jobs show here once they reach Finishing.":"Nothing here yet."}</div>`}</div>`}
function jsEntry(id){const j=S.jobs.find(x=>x.id===id);if(!j)return;const A=j.act||{};
  const bom=A.bom&&A.bom.length?A.bom:jsBom(j);const wv=k=>(A.wst||[]).find(x=>x.stage===k)||{};const pv=k=>(A.prod||[]).find(x=>x.stage===k)||{};
  const I=(k,v,lab,type,ph)=>`<label>${lab}<input data-b="${k}" value="${esc(v??"")}"${type?` type="${type}"`:""}${type==="number"?' inputmode="decimal" step="any"':""}${ph?` placeholder="${esc(ph)}"`:""}></label>`;
  const bRow=(b={})=>`<div class="rrow jb"><button class="rx" type="button" aria-label="Remove">×</button>${I("mat",b.mat,"Material")}${b.planned?`<p class="meta" style="margin:-4px 0 8px">Planned: <b>${esc(b.planned)}</b></p><input data-b="planned" type="hidden" value="${esc(b.planned)}">`:`<input data-b="planned" type="hidden" value="">`}
    <div class="two" style="--n:4">${I("iss",b.iss,"Issued")}${I("used",b.used,"Used")}${I("waste",b.waste,"Wastage")}${I("ret",b.ret,"Returned")}</div>${I("rem",b.rem,"Remarks")}</div>`;
  sheet(`<h3>Record production: ${jno(j)}</h3><p class="meta" style="margin-top:-6px">${esc(j.customer)}: ${esc(jobDesc(j))}, ${fmtN(j.qty)} pcs</p>
  <div class="sec"><h4>Bill of material</h4><div id="jbl">${bom.map(bRow).join("")}</div><button class="add" type="button" id="jbadd">+ Add material</button></div>
  <div class="sec"><h4>Wastage report <span class="meta" id="wtot" style="font-weight:400"></span></h4>${LS.WST.map((w,i)=>`<div class="two jw" data-st="${esc(w)}" style="grid-template-columns:1fr 1.4fr"><label>${w}<input data-w="qty" type="number" inputmode="decimal" step="any" value="${esc(wv(w).qty||"")}" placeholder="sheets / pcs"></label><label>Reason<input data-w="reason" value="${esc(wv(w).reason||"")}"></label></div>`).join("")}</div>
  <div class="sec"><h4>Production record</h4>${LS.PRODST.map(s=>`<div class="two jp" data-st="${s}" style="--n:3"><label>${s}: date<input data-p="date" type="date" value="${esc(pv(s).date||"")}"></label><label>Qty OK<input data-p="qty" type="number" inputmode="decimal" step="any" value="${esc(pv(s).qty||"")}"></label><label>Operator<input data-p="op" value="${esc(pv(s).op||"")}"></label></div>`).join("")}</div>
  <div class="sec"><h4>On-duty manager</h4>
  ${fields([{k:"mrem",label:"Remarks of on-duty manager",type:"textarea"},{row:[{k:"mgr",label:"Manager's name"},{k:"shift",label:"Shift",ph:"Day / Night"}]},{row:[{k:"mdate",label:"Date",type:"date"},{k:"ver",label:"Verified by"}]}],{mdate:today(),...A})}</div>
  <div class="btns"><button class="btn" id="jeb">Back</button><button class="btn primary" id="save">${j.act?"Save changes":"Save production record"}</button></div>`);
  const box=$("#jbl");
  const wt=()=>{const t=[...document.querySelectorAll('.jw [data-w="qty"]')].reduce((a,i)=>a+(+i.value||0),0);$("#wtot").textContent=t?"Total "+fmtN(t):""};
  $("#sheet-body").addEventListener("input",e=>{if(e.target.dataset.w)wt();
    const r=e.target.closest(".jb");if(r&&["iss","used","ret"].includes(e.target.dataset.b)){const g=k=>+r.querySelector(`[data-b="${k}"]`).value||0;const w=r.querySelector('[data-b="waste"]');const x=g("iss")-g("used")-g("ret");w.placeholder=g("iss")&&g("used")?fmtN(r2(x)):""}});wt();
  box.addEventListener("click",e=>{if(e.target.closest(".rx"))e.target.closest(".jb").remove()});
  $("#jbadd").onclick=()=>{box.insertAdjacentHTML("beforeend",bRow());box.lastElementChild.querySelector("input").focus()};
  $("#jeb").onclick=()=>jobView(id);
  $("#save").onclick=async e=>{const f=read();
    const bom=[...box.querySelectorAll(".jb")].map(r=>{const o={};r.querySelectorAll("[data-b]").forEach(i=>o[i.dataset.b]=i.value.trim());if(!o.waste){const x=(+o.iss||0)-(+o.used||0)-(+o.ret||0);if(o.iss&&o.used)o.waste=String(r2(x))}return o}).filter(o=>o.mat||o.iss||o.used);
    const wst=[...document.querySelectorAll(".jw")].map(r=>({stage:r.dataset.st,qty:r.querySelector('[data-w="qty"]').value.trim(),reason:r.querySelector('[data-w="reason"]').value.trim()})).filter(x=>x.qty||x.reason);
    const prod=[...document.querySelectorAll(".jp")].map(r=>({stage:r.dataset.st,date:r.querySelector('[data-p="date"]').value,qty:r.querySelector('[data-p="qty"]').value.trim(),op:r.querySelector('[data-p="op"]').value.trim()})).filter(x=>x.date||x.qty||x.op);
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    const act={bom,wst,prod,mrem:f.mrem,mgr:f.mgr,shift:f.shift,mdate:f.mdate,ver:f.ver,on:A.on||today(),by:A.by||meId||"",edited:j.act?today():""};
    try{await put("jobs",{...j,act})}catch(x){btn.disabled=false;return}
    toast("Production record saved");setTimeout(()=>jobView(id),300)}}

/* ---------- job work card (outsourced fabrication / binding) ---------- */
const outFab=j=>(j.plan?.fab||[]).filter(f=>f.mode==="Outsource");
const jwReady=j=>outFab(j).length>0&&(j.stage>=4||(j.stage===3&&progDone(j,3)>0));
function jwGroups(j){const g=new Map();for(const f of outFab(j)){const k=normName(f.worker);if(!g.has(k))g.set(k,{name:(f.worker||"").trim(),items:[]});g.get(k).items.push(f)}return[...g.values()]}
function jwPick(j){const gs=jwGroups(j);if(gs.length===1){closeSheet();jobWorkCard(j,gs[0]);return}
  sheet(`<h3>Job work card: ${jno(j)}</h3><p class="meta" style="margin-top:-6px">This job goes to more than one job worker. Pick whose card to print.</p>
  <div class="list">${gs.map((g,i)=>`<button class="row" data-jw="${i}"><div class="row-top"><span class="cust">${esc(g.name||"Job worker not selected")}</span></div><div class="meta">${esc(g.items.map(x=>x.process).join(", "))}</div></button>`).join("")}</div>
  <div class="btns" style="margin-top:10px"><button class="btn" id="jwb">Back</button></div>`);
  $("#jwb").onclick=()=>jobView(j.id);
  $("#sheet-body").querySelectorAll("[data-jw]").forEach(b=>b.onclick=()=>{closeSheet();jobWorkCard(j,gs[+b.dataset.jw])})}
function jobWorkCard(j,g){const pl=j.plan||{};const r=paperCalc(j,pl);const p=r.p;
  const w=S.workers.find(x=>normName(x.name)===normName(g.name))||{};
  const printed=progDone(j,3)||pl.printSheets||r.print;
  showPrint(`Job work card ${jno(j)}${g.name?" "+g.name:""}`,docHead("Job work card",j)+`<table>${trs([
    ["Job worker",g.name?`<b>${esc(g.name)}</b>`:"&nbsp;"],["Phone",esc(w.phone||"")],["Address",esc(w.address||"")]])}</table>
    <h2>Job specs</h2><table>${trs([
    ["Job no.",`<span class="big">${jno(j)}</span>`],["Item",esc(j.ptype)],["Job name",esc(j.item)],["Quantity",fmtN(j.qty)+" pcs"],["Final cut size",esc(j.size)],
    ["Printed sheet size",pl.cutL?`${fmtN(pl.cutL)} × ${fmtN(pl.cutW)} mm`:""],["Ups per sheet",pl.ups>1?String(pl.ups):""],
    ["Printed sheets",printed?fmtN(printed):""],["Paper",p?esc([p.name,p.gsm&&p.gsm+" gsm"].filter(Boolean).join(", ")):""]])}</table>
    <h2>Work to be done</h2><table class="t"><tr><th>#</th><th>Process</th><th>Specs / instructions</th>${isAdm()?`<th>Rate</th>`:""}</tr>
    ${g.items.map((f,i)=>`<tr><td>${i+1}</td><td><b>${esc(f.process)}</b></td><td>${esc([f.details,f.jw&&"Job work "+f.jw.toLowerCase(),lamTxt(f),f.remark].filter(Boolean).join(" · "))}</td>${isAdm()?`<td>${esc(rateTxt(f))||"&nbsp;"}</td>`:""}</tr>`).join("")}</table>
    <table class="t"><tr><th>Qty sent</th><th>Date sent</th><th>Return by</th><th>Qty received</th><th>Date received</th></tr><tr><td style="height:30px"></td><td></td><td></td><td></td><td></td></tr></table>
    <table><tr><th>Remarks</th><td style="height:50px"></td></tr></table>
    <p style="font-size:12px">Please mention job no. <b>${jno(j)}</b> on your delivery challan and bill.</p>
    <div class="sign"><span>Sent by</span><span>Job worker</span><span>Received &amp; checked</span></div>`)}
function workersView(){
  sheet(`<h3>Job workers</h3><div class="list">${[...S.workers].sort((a,b)=>a.name.localeCompare(b.name)).map(w=>`<button class="row" data-wk="${w.id}"><div class="row-top"><span class="cust">${esc(w.name)}</span><span class="meta">${esc(w.phone||"")}</span></div>${w.works?`<div class="meta">${esc(w.works)}</div>`:""}</button>`).join("")||'<p class="meta">No job workers yet. They are also added when you type a new name in a job plan.</p>'}</div>
  <div class="btns" style="margin-top:10px"><button class="btn primary" id="addw">Add job worker</button></div>`);
  $("#addw").onclick=()=>workerForm();
  $("#sheet-body").querySelectorAll("[data-wk]").forEach(b=>b.onclick=()=>{const w=S.workers.find(x=>x.id===b.dataset.wk);w&&workerForm(w)})}
function workerForm(w={}){
  sheet(`<h3>${w.id?"Edit job worker":"Add job worker"}</h3>${fields([{k:"name",label:"Name"},{k:"phone",label:"Phone",type:"tel"},{k:"address",label:"Address",type:"textarea"},{k:"works",label:"Work they do",ph:"e.g. Lamination, die cutting, binding"}],w)}
  <div class="btns"><button class="btn" id="wb">Back</button>${w.id?'<button class="btn danger" id="del">Delete</button>':""}<button class="btn primary" id="save">Save</button></div>`);
  $("#wb").onclick=workersView;
  w.id&&($("#del").onclick=e=>{if(e.target.dataset.armed){remove("workers",w.id);workersView();return}armDelete(e.target,()=>{})});
  $("#save").onclick=async()=>{const v=read();if(!v.name){toast("Add a name.");return}
    if(S.workers.some(x=>x.id!==w.id&&normName(x.name)===normName(v.name))){toast("A job worker with this name already exists.");return}
    await put("workers",{...w,...v});workersView()}}

/* ---------- stores: GRN for consumables & raw material other than paper ---------- */
const _SCATS=["Ink","Plates","Chemicals","Lamination film","Varnish & coating","Foil","Adhesive / glue","Blankets & rollers","Packing material","Spares","Other raw material","Other consumable"];
const _SUNITS=["kg","ltr","nos","pcs","rolls","sets","boxes","metres","packets"];
const _GSTS=[0,5,12,18,28];
const grnNo=g=>"GRN-"+String(g.no||0).padStart(4,"0");
let storeView="items",storeCat="";
const SZU=["in","mm"];
const FSU=[{v:"mm",t:"mm"},{v:"inch",t:"Inches"}];
function parseSz(sz){const m=String(sz||"").match(/([\d.]+)\s*[x×*]\s*([\d.]+)\s*(mm|cm|in|inch|inches|")?/i);if(!m)return{};const u=(m[3]||"").toLowerCase();return{fsl:m[1],fsw:m[2],fsu:u==="mm"?"mm":u?"inch":""}}
const fsTxt=(L,W,u)=>L&&W?`${L} × ${W} ${u==="mm"?"mm":"inch"}`:"";
const itemSpec=x=>[x.size&&("Size "+x.size+" "+(x.sunit||"in")),+x.micron&&(x.micron+" micron")].filter(Boolean).join(" · ");
const itemLabel=x=>[x.name,x.size&&(x.size+" "+(x.sunit||"in")),+x.micron&&(x.micron+" mic")].filter(Boolean).join(" ");
const szNorm=v=>String(v||"").toLowerCase().replace(/\s*[x×*]\s*/g,"x").replace(/\s+/g," ").trim();
const itemKey=x=>[normName(x.name),szNorm(x.size),x.size?(x.sunit||"in"):"",+x.micron||""].join("|");
const storeCats=()=>{const m=new Map();for(const c of [...LS.SCATS,...S.items.map(i=>i.cat)]){const t=String(c||"").trim();if(t&&!m.has(t.toLowerCase()))m.set(t.toLowerCase(),t)}return [...m.values()]};
const catList=()=>`<datalist id="catlist">${storeCats().map(c=>`<option value="${esc(c)}">`).join("")}</datalist>`;
const accQ=l=>Math.max(0,(+l.qty||0)-(+l.rej||0));
const lineTax=l=>accQ(l)*(+l.rate||0);
function grnTotal(g){let tax=0,gst=0;for(const l of g.lines||[]){const a=lineTax(l);tax+=a;gst+=a*(+l.gst||0)/100}return{tax,gst,total:tax+gst}}
function itemIn(id,upto){let s=0;for(const g of S.grn){if(upto&&(g.date||"")>upto)continue;for(const l of g.lines||[])if(l.itemId===id)s+=accQ(l)}return s}
function itemOut(id,upto){return S.siss.filter(x=>x.itemId===id&&(!upto||(x.date||"")<=upto)).reduce((a,x)=>a+(+x.qty||0),0)}
function itemBal(id,upto){const it=S.items.find(i=>i.id===id);return (+it?.opening||0)+itemIn(id,upto)-itemOut(id,upto)}
function lastRate(id){let best=null;for(const g of S.grn)for(const l of g.lines||[])if(l.itemId===id&&+l.rate>0&&(!best||(g.date||"")>=best.d))best={d:g.date||"",r:+l.rate};return best?best.r:(+S.items.find(i=>i.id===id)?.rate||0)}
const isLowItem=it=>it.min!==""&&it.min!=null&&+it.min>0&&itemBal(it.id)<+it.min;
const qtyTxt=n=>(+n||0).toLocaleString("en-IN",{maximumFractionDigits:3});
const suppliers=()=>[...new Map(S.grn.filter(g=>g.supplier).map(g=>[normName(g.supplier),g.supplier.trim()])).values()].sort();

/* ---------- how to use ---------- */
const HELP={
owner:`<p>You see everything and are the only one who can approve sales orders, verify paper inward, change Company &amp; T&amp;C, and archive old data.</p>
<h4>Daily flow</h4><ol>
<li><b>Jobs → Sales orders:</b> Accounts books the order. You open it and tap <b>Approve</b> or <b>Reject</b>. Once approved, tap <b>Send to job sheet</b>: a job sheet is made for each job in the order. Orders waiting for you also show on Home.</li>
<li><b>Repeat jobs:</b> New sales order → <b>Repeat an earlier order</b>, or open any old order and tap <b>Repeat order</b>. Everything is copied; just check qty, rate, PO and dates.</li>
<li><b>Jobs → Job sheets → New job:</b> for work without a sales order.</li>
<li><b>Plan the job:</b> machine, paper PIN, cut size, plates from Plate inward, consumables, fabrication (in house or outsourced with rate).</li>
<li>The factory manager runs the job: issue paper, move stages, close fabrication steps, inward for packing.</li>
<li>Accounts dispatches and prints the delivery challan for billing.</li>
<li><b>Jobs → Record production:</b> when the job is over, copy the handwritten BOM, wastage, production record and manager's remarks from the physical job sheet. Reprinting the job sheet then shows the entered figures.</li></ol>
<h4>Inward</h4><ul><li><b>Paper:</b> every lot gets a PIN. Verify each new inward from Home.</li><li><b>Plates:</b> plate no., vendor, sets (16 pg, 8 pg…).</li><li><b>Stores:</b> GRN for ink, chemicals, film, glue, spares. Rates are visible only to you and Accounts.</li></ul>
<h4>Reports to watch</h4><ul><li><b>Monthly business summary:</b> jobs received, job value, jobs completed and dispatched value, month by month.</li><li><b>Party-wise business:</b> parties ranked by the value of jobs they give you. <b>Month by month</b> shows each party's trend.</li><li><b>Complete stock:</b> paper, ink, lamination film, other stores and unused plates in one list.</li><li><b>Material used per job:</b> paper, stores items and plates used on each job.</li></ul>
<h4>Your team</h4><ul><li>Give each person their own login from More → Masters &amp; setup → <b>Logins &amp; passwords</b>: Accounts with the <b>Accounts</b> role, the factory manager with the <b>Factory manager</b> role. The app gives each person their screens from that.</li>
<li>Don't give the Accounts or Owner role to anyone else: those roles can see prices and sales orders.</li></ul>`,
accounts:`<p>You handle sales orders and delivery challans for billing. You see rates; you don't see paper, plates or stores.</p>
<h4>Book a sales order</h4><ol>
<li><b>Jobs → Sales orders → New sales order.</b></li>
<li>Fill party, PO no., delivery date, payment days. For each job: item, job name, qty, size, paper, colours, finishing, rate and GST.</li>
<li>Save. It shows <b>Awaiting approval</b> until the owner approves it.</li>
<li>Once the owner approves it, open it and tap <b>Send to job sheet</b>. If the owner rejects it, it shows as <b>Rejected</b>.</li>
<li><b>Repeat order:</b> tap <b>Repeat an earlier order</b> in a new order, or <b>Repeat order</b> on any old one, to copy it.</li>
<li><b>Print order</b> prints it with the terms &amp; conditions for the party to sign.</li></ol>
<h4>Dispatch &amp; challan</h4><ol>
<li><b>Jobs → Job sheets</b>, open the job when it shows <b>Packing</b> with quantity ready.</li>
<li>Tap <b>Dispatch</b>, enter qty, boxes, vehicle, transport. The challan prints with T&amp;C.</li>
<li>Reprint any challan from the job's Packing &amp; dispatch section.</li></ol>
<h4>Reports</h4><p>Sales order register, job register, pending jobs and dispatch register, as print/PDF or Excel.</p>`,
factory:`<p>You run production: job sheets, recording production, paper, plates and stores. Costs, prices, sales orders and reports are not shown to you.</p>
<h4>A job on the floor</h4><ol>
<li><b>Jobs → New job:</b> create the job sheet. Open it and tap <b>Plan job</b> to set machine, paper PIN, cut size, plates and fabrication steps.</li>
<li>Print the <b>job sheet</b> and <b>cutting slip</b>. Tap <b>Issue paper</b> to issue sheets from the PIN.</li>
<li>Move the job through stages: Prepress → Plates → Printing (record partly done) → Finishing.</li>
<li>Whenever ink, lamination film, foil, glue or other stores material goes to the job, open the job and tap <b>Issue stores item</b>.</li>
<li>In Finishing, close each step. For outsourced work print the <b>Job work card</b>.</li>
<li>When goods are ready, tap <b>Inward for packing</b>. Accounts then dispatches.</li></ol>
<h4>Inward</h4><ul><li><b>Inward → Paper:</b> each lot gets a PIN. Print the PIN label and stick it on the stack. The owner verifies it.</li>
<li><b>Inward → Plates:</b> plate no., vendor, sets.</li>
<li><b>Inward → Stores → New GRN:</b> enter qty received and rejected. Accounts adds the rates. Use <b>Issue to floor</b> when you use material.</li></ul>`};
function helpView(){const r=role||"factory";
  sheet(`<h3>How to use Print Floor</h3><p class="meta" style="margin-top:-6px">You're signed in as <b>${ROLE_TXT[r]}</b>.</p><div class="help">${HELP[r]}</div>
  <div class="btns" style="margin-top:12px"><button class="btn" onclick="closeSheet()">Close</button></div>`)}

/* ---------- sales orders ---------- */
const DEF_TERMS=["Order confirmation: The buyer may confirm this order by signing and returning it, or by confirmation through SMS / WhatsApp / email or a phone call from the buyer or its staff. Any such confirmation is as binding as a signed copy, and we may start work on it. Rates are valid for 15 days from the order date.","Deemed acceptance: If the buyer does not suggest any changes in writing within 2 working days of receiving this order, the order shall be deemed accepted and in effect, even if it has not been signed and returned.","Obligation to accept: Material produced under this order is made specifically for the buyer and cannot be sold elsewhere. The buyer is bound to take delivery of, and pay for, the full quantity produced (within the agreed tolerance).", "Proof approval: The buyer must check and sign off the final proof. Once a proof is approved, we are not responsible for any error in text, spelling, numbers, design, colour or layout.", "Colour variation: Slight variation in colour and shade from the proof, screen, sample or an earlier print run is normal in printing and is not a ground for rejection.", "Quantity tolerance: The delivered quantity may be up to 10% more or less than ordered. Billing will be for the actual quantity delivered.", "Party supplied paper / material: It must reach us on time, in the agreed size, GSM and quantity, and fit for printing. Normal wastage of up to 5% is allowed. We are not responsible for defects caused by poor material, or for any shortfall in it.", "Artwork and content: The buyer confirms they own or have the right to use all artwork, logos, text and content supplied, and shall indemnify us against any copyright, trademark or other legal claim arising from it.", "Delivery: Delivery dates are estimates and depend on proof approval, timely payment and receipt of material. We are not liable for any loss caused by delay. Goods are dispatched from our Bhiwandi works.", "Changes and cancellation: Changes after approval will be charged extra and may extend the delivery date. If an order is cancelled after work has begun, the buyer shall pay for all work done and material used up to that point.", "Payment strictly by crossed cheque / demand draft (payable at Mumbai) / NEFT / RTGS in favour of 'ARIHANT ENTERPRISES' payee's account, as per the payment terms stated in this order.", "MSME: Arihant Enterprises is a Small Enterprise registered under Udyam (UDYAM-MH-19-0097059). Payment must be made within the agreed period, which shall not exceed 45 days from acceptance, as per Section 15 of the MSMED Act, 2006. On delayed payment we are entitled to compound interest with monthly rests at three times the RBI bank rate under Section 16 of the Act, and may refer the matter to the MSE Facilitation Council.", "Interest @ 24% p.a. will be charged if the bill is not paid on or within the due date, without prejudice to our rights under the MSMED Act. Cheque return charges are payable by the buyer.", "Lien: We may hold back finished goods, plates, positives and party supplied material until all dues are paid in full.", "Plates, positives, dies and blocks remain our property unless separately paid for.", "Storage: Goods ready for dispatch must be collected within 7 days of intimation. After that they are stored entirely at the buyer's risk and may attract storage charges.", "Our responsibility and risk ceases the moment the goods leave our premises. Freight, packing and transit insurance are to the buyer's account unless stated otherwise.", "When the goods / consignment is accepted by any staff member, worker or authorised signatory of the buyer, it is presumed that he has the authority to accept delivery, whether or not a rubber stamp is affixed.", "Claims: The buyer must check the goods at the time of delivery. Any complaint about quality or quantity must reach us in writing within 24 hours of delivery, with the goods kept unused for inspection. No complaint will be entertained if the material is cut, processed or used in any form, and no deduction will be permitted at the time of payment. Goods once sold will not be taken back or exchanged.", "Limit of liability: Our liability is limited to reprinting or crediting the value of the defective portion of that job only. We are not liable for any indirect or consequential loss, including loss of business or the value of the buyer's product.", "Force majeure: We are not liable for delay or failure caused by events beyond our control, such as power failure, machine breakdown, strikes, natural calamities or government action.", "GST and other government levies as applicable on the date of dispatch are payable by the buyer, irrespective of anything stated otherwise in the order.", "This sale is subject to Mumbai jurisdiction only.", "All conditions of sale and delivery above are taken as read and agreed to by the buyer on signing, confirming or acting on this order, or on its deemed acceptance as above."].join("\n");
const DEF_CO={address:"11/C, Nikadwari Lane, Gr Floor, Khotachi Wadi, Opp Jain Clinic, Girgaum, Mumbai 400004",gst:"27AAEPS3314H1ZS",state:"Maharashtra, Code: 27",udyam:"UDYAM-MH-19-0097059 (Small)",dispatch:"H 5-6, Jayshree Ram Complex, Anjur Phata Road, Dapoda Village, Off. Mankoli Naka, Bhiwandi, Dist. Thane 421302",landmark:"Opp. Sarnava Veg Hotel & Near Gajanan Petrol Pump",map:"https://maps.app.goo.gl/vh7Cia9MbG59REFA7"};
const DEF_DC_TERMS=["These goods are supplied against the sales order referred to above. The terms and conditions of that sales order apply in addition to these delivery terms.", "Checking at delivery: The receiver must count the packages and check their outer condition against this challan before signing. Any shortage, damage, wetness or tampering must be written on this challan and countersigned by our driver or transporter at the time of delivery.", "Proof of delivery: A signature or stamp on this challan, without remarks, is final proof that the goods were received in the number of packages stated and in good outward condition. No claim for transit shortage or damage will be accepted afterwards.", "Contents of packages: Quantity per package is as packed by us. Any shortfall found on opening the packages must be reported within the claim period in the sales order, with the packages, labels and packing kept for inspection.", "Unloading: Unloading at the delivery point is to be arranged by the buyer at its own cost. Detention of the vehicle beyond 1 hour for reasons attributable to the buyer will be charged.", "Refusal or failure to receive: If the buyer refuses or fails to receive goods offered for delivery without valid reason, the return freight, re-delivery and storage costs will be borne by the buyer, and the goods will be treated as delivered for billing.", "Part deliveries: Each challan is a separate delivery. A part delivery is not a reason to withhold payment for the quantity already delivered.", "Delivery address: Goods are delivered only to the address on this challan. A change of address must be informed in writing before dispatch, and any extra freight will be charged.", "Returns: No goods may be returned without our written consent and a returnable challan. Goods returned otherwise will not be accepted or credited.", "Care after delivery: The buyer must store the goods in a dry place, away from moisture and heat, and within safe stacking limits. We are not responsible for damage caused by storage or handling after delivery.", "Party supplied material: Unused or balance material of the buyer, if returned, is shown on this challan. Our record of the buyer's material is final unless disputed in writing within 7 days of this challan.", "This challan is not a tax invoice. The tax invoice will be raised separately."].join("\n");
const LHP=`<style>@page{size:A4;margin:50.8mm 14mm 14mm 14mm}.doc .lh{height:50.8mm;border:1px dashed #999;color:#888;display:flex;align-items:center;justify-content:center;font-size:12px;margin:-18px -16px 12px}.doc .dct>div{font-size:9.8px!important;line-height:1.28!important;margin-top:8px!important}.doc .dct li{margin:0 0 1px}.doc .rcv{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 18px;margin-top:6px}.doc .rcv div{border-bottom:1px solid #000;padding-top:16px;font-size:10.5px}.doc .dcw th,.doc .dcw td{padding:3px 6px}.doc .dcw table{margin-bottom:8px}.doc .dcw .sign{margin-top:28px}.doc .dcw .sb div{height:72px}.doc .dcw .fl{height:30px}@media print{.doc .lh{display:none}}</style><div class="lh">Letterhead area (2 inches) &middot; left blank when printed</div>`;
const CO=()=>({...DEF_CO,...(S.settings.find(x=>x.id==="company")||{})});
const termsList=(k="terms",d=DEF_TERMS)=>String(CO()[k]??d).split(/\n+/).map(t=>t.replace(/^\s*\d+[\).]\s*/,"").trim()).filter(Boolean);
const termsHtml=(title,k,d)=>`<div style="margin-top:14px;font-size:10.5px;line-height:1.35"><b>${title||"Terms &amp; conditions"}</b><ol style="margin:4px 0 0;padding-left:18px">${termsList(k,d).map(t=>`<li>${esc(t)}</li>`).join("")}</ol></div>`;
const coHead=()=>{const c=CO();const l=[c.address&&"Regd. office: "+c.address,c.dispatch&&"Works & dispatch: "+c.dispatch+(c.landmark?" (Landmark: "+c.landmark+")":""),c.map&&"Location: "+c.map,[c.phone&&"Ph: "+c.phone,c.email].filter(Boolean).join(" · "),[c.gst&&"GSTIN: "+c.gst,c.state&&"State: "+c.state].filter(Boolean).join(" · "),c.udyam&&"Udyam: "+c.udyam].filter(Boolean);return l.length?`<div style="font-size:11px">${l.map(esc).join("<br>")}</div>`:""};
const soNo=o=>"SO-"+String(o.no||0).padStart(4,"0");
const SO_ST={draft:"Awaiting approval",approved:"Approved, send to job sheet",sent:"Sent to job sheet",done:"Sent to job sheet",rejected:"Rejected",cancelled:"Cancelled"};
let jobsMode="jobs",soFilter="open";
const soLines=o=>o.lines||[];
const soLineAmt=l=>(+l.qty||0)*(+l.rate||0);
function soTot(o){let tax=0,gst=0;for(const l of soLines(o)){const a=soLineAmt(l);tax+=a;gst+=a*(+l.gst||0)/100}return{tax,gst,total:tax+gst}}
const soJob=l=>l&&l.jobId?(S.jobs.find(j=>j.id===l.jobId)||{id:l.jobId}):null;
const soPendingJobs=o=>o.status==="approved";
function soDone(o){return o.status==="sent"||o.status==="done"}
const soDead=o=>o.status==="cancelled"||o.status==="rejected";
const soStat=o=>SO_ST[o.status||"draft"];
const soStCls=o=>soDead(o)?"meta":soDone(o)?"plus":o.status==="approved"?"due-soon":"low";

function renderSO(){const t=q.toLowerCase();
  const F={open:o=>!soDead(o)&&!soDone(o),draft:o=>(o.status||"draft")==="draft",approved:o=>o.status==="approved",done:soDone,rejected:soDead,all:()=>true};
  const cnt={};for(const k in F)cnt[k]=S.so.filter(F[k]).length;
  let list=S.so.filter(F[soFilter]||F.open);
  if(t)list=list.filter(o=>[soNo(o),o.customer,o.po,...soLines(o).map(l=>l.ptype+" "+l.item)].join(" ").toLowerCase().includes(t));
  list.sort((a,b)=>(b.no||0)-(a.no||0));
  return `<input class="search" id="q" type="search" placeholder="Search SO no., party, PO or job" value="${esc(q)}">
  <div class="chips">${[["open","Open",cnt.open],["draft","To approve",cnt.draft],["approved","To send",cnt.approved],["done","Sent to job sheet",cnt.done],["rejected","Rejected",cnt.rejected],["all","All",cnt.all]].map(([k,l,n])=>`<button class="chip" data-sof="${k}" aria-pressed="${soFilter===k}">${l}<b>${n}</b></button>`).join("")}</div>
  <div class="list">${list.map(o=>`<button class="row" data-so="${o.id}"><div class="row-top"><span><span class="jno">${soNo(o)}</span> <span class="cust">${esc(o.customer)}</span></span><span class="meta">${fmtD(o.date)}</span></div>
    <div class="row-top meta"><span>${esc(soLines(o).map(l=>[l.ptype,l.item].filter(Boolean).join(": ")).join(", "))}</span><span class="num">${inr(soTot(o).total)}</span></div>
    <div class="row-top"><span class="${soStCls(o)}" style="font-size:14px">${soStat(o)}</span>${o.due?`<span class="meta">Delivery ${fmtD(o.due)}</span>`:""}</div></button>`).join("")
    ||`<div class="empty">${S.so.length?"No sales orders here.":"No sales orders yet. Tap New sales order to book one."}</div>`}</div>`}

function soLineRow(l={},locked){const L=ptypeList();const cur=l.ptype||"";
  return `<div class="rrow soline"${l.jobId?` data-job-id="${esc(l.jobId)}"`:""}>${locked?"":`<button class="rx" type="button" aria-label="Remove line">×</button>`}
  <label>Item<select data-o="ptype"><option value="">Select item</option>${[...L,...(cur&&!L.includes(cur)?[cur]:[])].map(x=>`<option${x===cur?" selected":""}>${esc(x)}</option>`).join("")}</select></label>
  <label>Job name<input data-o="item" value="${esc(l.item||"")}" placeholder="e.g. ABC Ltd 9×4 envelope"></label>
  <div class="two" style="--n:1"><label>Quantity (pcs)<input data-o="qty" type="number" inputmode="numeric" value="${esc(l.qty??"")}"></label></div>${(()=>{const z=l.fsl?{fsl:l.fsl,fsw:l.fsw,fsu:l.fsu}:parseSz(l.size);return `<div class="two" style="grid-template-columns:1fr 1fr 1.1fr"><label>Final cut size L<input data-o="fsl" type="number" inputmode="decimal" step="any" value="${esc(z.fsl||"")}"></label><label>W<input data-o="fsw" type="number" inputmode="decimal" step="any" value="${esc(z.fsw||"")}"></label><label>In<select data-o="fsu">${FSU.map(o=>`<option value="${o.v}"${o.v===(z.fsu||"mm")?" selected":""}>${o.t}</option>`).join("")}</select></label></div>${!z.fsl&&l.size?`<p class="meta" style="margin:-4px 0 8px">Old size: ${esc(l.size)}</p>`:""}`})()}
  <div class="two"><label>Paper / board<input data-o="paper" value="${esc(l.paper||"")}" placeholder="e.g. Maplitho 100 gsm"></label><label>Paper by<select data-o="paperSrc">${SRC_OPTS.map(o=>`<option value="${o.v}"${o.v===(l.paperSrc||"own")?" selected":""}>${o.v==="own"?"Arihant":"Party"}</option>`).join("")}</select></label></div>
  <div class="two"><label>Colours<input data-o="colors" value="${esc(l.colors||"")}" placeholder="e.g. 4+0"></label><label>Finishing<input data-o="finishing" value="${esc(l.finishing||"")}" placeholder="Lamination, UV…"></label></div>
  <div class="two"><label>Rate ₹ per pc<input data-o="rate" type="number" inputmode="decimal" step="any" value="${esc(l.rate??"")}"></label><label>GST<select data-o="gst">${LS.GSTS.map(g=>`<option value="${g}"${+g===+(l.gst??18)?" selected":""}>${g}%</option>`).join("")}</select></label></div>
  <label>Line notes<input data-o="notes" value="${esc(l.notes||"")}"></label><p class="meta samt" style="margin:-2px 0 10px"></p></div>`}

function soForm(o={}){const v={date:today(),payDays:"30",...o};const no=o.no||S.so.reduce((a,x)=>Math.max(a,+x.no||0),0)+1;
  sheet(`<h3>${o.id?"Edit "+soNo(o):"New sales order"}</h3>${!o.id&&o.repeatOf?`<div class="note">Copied from ${esc(o.repeatOf)}. Check quantity, rate, PO and delivery date before saving.</div>`:""}${!o.id&&!o.repeatOf&&S.so.length?`<button class="btn" type="button" id="sorep" style="width:100%;margin-bottom:12px">Repeat an earlier order</button>`:""}
  <datalist id="custlist">${S.customers.map(c=>`<option value="${esc(c.name)}">`).join("")}</datalist>
  ${fields([{html:`<div class="calc" style="margin:0 0 12px">SO no. <b style="font-size:18px">${soNo({no})}</b>${o.id?"":"<br>Given automatically when you save."}</div>`},
    {row:[{k:"date",label:"Order date",type:"date"},{k:"due",label:"Delivery date",type:"date"}]},
    {k:"customer",label:"Party",list:"custlist"},
    {row:[{k:"po",label:"Party PO no."},{k:"poDate",label:"PO date",type:"date"}]},
    {row:[{k:"payDays",label:"Payment due (days)",type:"number"},{k:"contact",label:"Contact person"}]},
    {k:"delAt",label:"Deliver at",ph:"Leave blank for party's address"}],v)}
  <div class="sec"><h4>Jobs in this order</h4><div id="solines">${(soLines(o).length?soLines(o):[{}]).map(l=>soLineRow(l,!!l.jobId)).join("")}</div><button class="add" type="button" id="soadd">+ Add another job</button></div>
  <div class="calc" id="sotot" style="margin-top:12px"></div>
  ${fields([{k:"notes",label:"Order remarks",type:"textarea"}],v)}
  <p class="meta" style="margin:0 0 10px">The terms &amp; conditions print on the order automatically. Edit them from More → Masters & setup → Company &amp; T&amp;C.</p>
  <div class="btns"><button class="btn" id="socan">${o.id?"Back":"Cancel"}</button><button class="btn primary" id="save">${o.id?"Save changes":"Save sales order"}</button></div>`);
  const box=$("#solines");
  const calc=()=>{let tax=0,gst=0;box.querySelectorAll(".soline").forEach(r=>{const g=k=>r.querySelector(`[data-o="${k}"]`).value;const a=(+g("qty")||0)*(+g("rate")||0),gs=a*(+g("gst")||0)/100;tax+=a;gst+=gs;
      r.querySelector(".samt").innerHTML=a?`Amount <b>${inr(a)}</b> + GST ${inr(gs)}`:""});
    $("#sotot").innerHTML=`Taxable <b>${inr(tax)}</b> · GST <b>${inr(gst)}</b> · Order value <b>${inr(tax+gst)}</b>`};
  box.addEventListener("input",calc);box.addEventListener("change",calc);
  box.addEventListener("click",e=>{if(!e.target.closest(".rx"))return;if(box.querySelectorAll(".soline").length<2){toast("An order needs at least one job.");return}e.target.closest(".soline").remove();calc()});
  $("#soadd").onclick=()=>{box.insertAdjacentHTML("beforeend",soLineRow());box.lastElementChild.querySelector("select").focus();calc()};calc();
  $("#socan").onclick=()=>o.id?soView(o.id):closeSheet();
  $("#sorep")&&($("#sorep").onclick=()=>soPick(($('[name="customer"]')||{}).value||""));
  $("#save").onclick=async e=>{const f=read();
    const lines=[...box.querySelectorAll(".soline")].map((r,i)=>{const x={};r.querySelectorAll("[data-o]").forEach(el=>x[el.dataset.o]=el.value.trim());{const old=soLines(o)[i]||{};x.size=fsTxt(x.fsl,x.fsw,x.fsu)||(x.fsl||x.fsw?"":old.size||"");if(!x.fsl||!x.fsw){if(x.fsl||x.fsw)x.badsz=1;x.fsl="";x.fsw=""}}
      if(r.dataset.jobId)x.jobId=r.dataset.jobId;x.qty=+x.qty||0;x.rate=+x.rate||0;x.gst=+x.gst||0;return x}).filter(l=>l.ptype||l.item||l.qty);
    if(!f.customer){toast("Add the party.");return}
    if(!lines.length){toast("Add at least one job.");return}
    for(const l of lines){if(l.badsz){toast(`Enter both L and W of the final cut size for ${l.item||"each job"}.`);return}delete l.badsz;if(!l.ptype){toast("Select the item for every job.");return}if(!l.item){toast(`Type the job name for the ${l.ptype}.`);return}if(!(l.qty>0)){toast(`Enter the quantity for ${l.item}.`);return}}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    const rec={...o,...f,lines};
    if(!o.id){rec.no=S.so.reduce((a,x)=>Math.max(a,+x.no||0),0)+1;rec.status="draft";rec.created=today();rec.by=meId||""}
    else if(o.status==="approved"&&!canVerify){rec.status="draft";delete rec.approved}
    try{if(!S.customers.some(c=>normName(c.name)===normName(f.customer)))await put("customers",{name:f.customer});
      const id=await put("so",rec);rec.id=rec.id||id}catch(x){btn.disabled=false;return}
    toast(`${soNo(rec)} saved${rec.status==="draft"?", awaiting approval":""}`);setTimeout(()=>soView(rec.id),300)}}

function soView(id){const o=S.so.find(x=>x.id===id);if(!o)return closeSheet();const T=soTot(o),st=o.status||"draft";
  const c=S.customers.find(x=>normName(x.name)===normName(o.customer))||{};
  sheet(`<h3>${soNo(o)}: ${esc(o.customer)}</h3>
  <p class="${soStCls(o)}" style="margin:-6px 0 8px;font-weight:700">${soStat(o)}${o.approved?` <span class="meta" style="font-weight:400">· approved ${fmtD(o.approved.d)}${o.approved.by?` by <span id="soby">…</span>`:""}</span>`:""}</p>
  <dl><dt>Order date</dt><dd>${fmtDY(o.date)}</dd>${o.due?`<dt>Delivery</dt><dd>${fmtDY(o.due)}</dd>`:""}${o.po?`<dt>Party PO</dt><dd>${esc(o.po)}${o.poDate?" dated "+fmtDY(o.poDate):""}</dd>`:""}
  ${o.payDays?`<dt>Payment</dt><dd>${esc(o.payDays)} days</dd>`:""}${o.contact?`<dt>Contact</dt><dd>${esc(o.contact)}</dd>`:""}${c.phone?`<dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>`:""}
  ${o.delAt?`<dt>Deliver at</dt><dd>${esc(o.delAt)}</dd>`:""}${o.notes?`<dt>Remarks</dt><dd>${esc(o.notes)}</dd>`:""}</dl>
  <div class="list">${soLines(o).map((l,i)=>{const j=soJob(l);return `<div class="rrow" style="padding-bottom:10px"><div class="row-top"><span class="cust">${i+1}. ${l.ptype?`<span class="tag" style="margin:0 6px 0 0">${esc(l.ptype)}</span>`:""}${esc(l.item)}</span><span class="num">${inr(soLineAmt(l))}</span></div>
    <div class="meta">${fmtN(l.qty)} pcs${l.rate?" @ ₹"+esc(l.rate):""}${l.gst!=null?" + "+l.gst+"% GST":""}${[l.size,l.paper&&(l.paper+(l.paperSrc==="party"?" (party)":"")),l.colors,l.finishing].filter(Boolean).map(x=>" · "+esc(x)).join("")}</div>
    ${l.notes?`<div class="meta">${esc(l.notes)}</div>`:""}
    </div>`}).join("")}</div>
  <div class="calc">Taxable <b>${inr(T.tax)}</b> · GST <b>${inr(T.gst)}</b> · Order value <b>${inr(T.total)}</b></div>
  ${st==="draft"?(canVerify?`<div class="btns" style="margin:0 0 8px"><button class="btn danger" id="sorej">Reject</button><button class="btn primary" id="soapp">Approve</button></div>`:`<div class="caution" style="margin-bottom:8px">Waiting for the owner to approve or reject.</div>`):""}
  ${st==="approved"?`<div class="note">Approved. Send it to job sheet to start production.</div><button class="btn primary" style="width:100%;margin-bottom:8px" id="somk">Send to job sheet</button>`:""}
  ${soDone(o)?`<div class="note">Sent to job sheet${o.sentOn?" on "+fmtD(o.sentOn):""}: ${soLines(o).map(l=>{const j=soJob(l);return j&&j.no?`<a href="#" data-jobl="${j.id}">${jno(j)}</a>`:""}).filter(Boolean).join(", ")||"job sheets"}.</div>`:""}
  ${st==="rejected"?`<div class="caution" style="margin-bottom:8px">Rejected${o.rejected&&o.rejected.d?" on "+fmtD(o.rejected.d):""}.</div>`:""}
  <div class="btns"><button class="btn" id="sopr">Print order</button><button class="btn" id="sorpt">Repeat order</button>${(st==="draft"||(st==="approved"&&canVerify))?`<button class="btn" id="soed">Edit</button>`:""}
  ${st==="approved"&&canVerify?`<button class="btn" id="sounap">Undo approval</button>`:""}
  ${st==="approved"?`<button class="btn danger" id="socx">Cancel order</button>`:""}${soDead(o)&&canVerify?`<button class="btn" id="soreo">Reopen</button>`:""}</div>`);
  if(o.approved?.by&&user)user.profiles([o.approved.by]).then(ps=>{const e=$("#soby");if(e)e.textContent=(ps[o.approved.by]&&ps[o.approved.by].name)||"Someone"}).catch(()=>{});
  $("#sopr").onclick=()=>{closeSheet();soPrint(o)};
  $("#soed")&&($("#soed").onclick=()=>soForm(o));
  $("#soapp")&&($("#soapp").onclick=async()=>{if(!canVerify){toast("Only the owner can approve.");return}
    try{await put("so",{...o,status:"approved",approved:{by:meId||"",d:today(),at:Date.now()}})}catch(e){return}toast(soNo(o)+" approved");setTimeout(()=>soView(id),300)});
  $("#sounap")&&($("#sounap").onclick=async()=>{const r={...o,status:"draft"};delete r.approved;try{await put("so",r)}catch(e){return}setTimeout(()=>soView(id),300)});
  $("#socx")&&($("#socx").onclick=e=>{const b=e.target;if(!b.dataset.armed){b.dataset.armed=1;b.classList.add("armed");b.textContent="Tap again to cancel";setTimeout(()=>{if(b.isConnected){delete b.dataset.armed;b.classList.remove("armed");b.textContent="Cancel order"}},3000);return}
    put("so",{...o,status:"cancelled"}).then(()=>setTimeout(()=>soView(id),300)).catch(()=>{})});
  $("#soreo")&&($("#soreo").onclick=async()=>{try{await put("so",{...o,status:"draft"})}catch(e){return}setTimeout(()=>soView(id),300)});
  $("#sorej")&&($("#sorej").onclick=e=>{const b=e.target;if(!canVerify){toast("Only the owner can reject.");return}if(!b.dataset.armed){b.dataset.armed=1;b.classList.add("armed");b.textContent="Tap again to reject";setTimeout(()=>{if(b.isConnected){delete b.dataset.armed;b.classList.remove("armed");b.textContent="Reject"}},3000);return}
    put("so",{...o,status:"rejected",rejected:{by:meId||"",d:today(),at:Date.now()}}).then(()=>{toast(soNo(o)+" rejected");setTimeout(()=>soView(id),300)}).catch(()=>{})});
  $("#somk")&&($("#somk").onclick=e=>soMakeJobs(o,soLines(o).map((_,i)=>i),e.target));
  $("#sorpt").onclick=()=>soRepeat(o);
  document.querySelectorAll("[data-jobl]").forEach(a=>a.onclick=ev=>{ev.preventDefault();jobView(a.dataset.jobl)})}
function soRepeat(o){soForm({customer:o.customer,contact:o.contact||"",payDays:o.payDays||"30",delAt:o.delAt||"",notes:o.notes||"",repeatOf:soNo(o),
  lines:soLines(o).map(l=>{const x={...l};delete x.jobId;return x})})}
function soPick(party){let t=party||"";
  const draw=()=>{const k=t.toLowerCase().trim();const L=[...S.so].sort((a,b)=>(b.no||0)-(a.no||0)).filter(o=>!k||[soNo(o),o.customer,o.po,...soLines(o).map(l=>l.ptype+" "+l.item)].join(" ").toLowerCase().includes(k)).slice(0,40);
    $("#pkl").innerHTML=L.map(o=>`<button class="row" data-pk="${o.id}"><div class="row-top"><span><span class="jno">${soNo(o)}</span> <span class="cust">${esc(o.customer)}</span></span><span class="meta">${fmtD(o.date)}</span></div>
      <div class="meta">${esc(soLines(o).map(l=>[l.ptype,l.item].filter(Boolean).join(": ")+" · "+fmtN(l.qty)+" pcs").join(", "))}</div></button>`).join("")||`<div class="empty">No orders match.</div>`};
  sheet(`<h3>Repeat an earlier order</h3><p class="meta" style="margin-top:-6px">Pick an order. Its party, jobs, specs and rates are copied into a new order.</p>
  <input class="search" id="pkq" type="search" placeholder="Search party, job or SO no." value="${esc(t)}"><div class="list" id="pkl"></div>
  <div class="btns" style="margin-top:12px"><button class="btn" id="pkb">Back</button></div>`);
  draw();$("#pkq").oninput=e=>{t=e.target.value;draw()};
  $("#pkl").onclick=e=>{const b=e.target.closest("[data-pk]");if(!b)return;const o=S.so.find(x=>x.id===b.dataset.pk);if(o)soRepeat(o)};
  $("#pkb").onclick=()=>soForm()}

async function soMakeJobs(o,idx,btn){if(o.status!=="approved"){toast("Approve the order first.");return}if(!isAdm()){toast("Only the owner or Accounts can send it.");return}if(btn.disabled)return;btn.disabled=true;
  const lines=soLines(o).map(l=>({...l}));let first=null;let no=S.jobs.reduce((a,x)=>Math.max(a,+x.no||0),0);
  try{for(const i of idx){const l=lines[i];if(soJob(l))continue;no++;
      const rec={no,stage:0,created:today(),log:[{s:0,d:today()}],customer:o.customer,ptype:l.ptype,item:l.item,qty:l.qty,size:l.size||"",fsl:l.fsl||"",fsw:l.fsw||"",fsu:l.fsu||"",colors:l.colors||"",finishing:l.finishing||"",
        due:o.due||"",rate:l.rate||"",paperSrc:l.paperSrc||"own",paperId:"",paperSpec:l.paper||"",notes:[l.paper&&"Paper: "+l.paper,l.notes,o.notes].filter(Boolean).join(". "),soId:o.id,soNo:soNo(o),soLine:i};
      const jid=await put("jobs",rec);l.jobId=jid;first=first||jid}
    await put("so",{...o,lines,status:"sent",sentOn:today()})}catch(e){btn.disabled=false;return}
  toast(idx.length>1?"Sent to job sheet. Plan each job next.":"Sent to job sheet. Plan it next.");
  setTimeout(()=>{first&&isOwn()&&S.jobs.some(j=>j.id===first)?planForm(first):soView(o.id)},400)}

function soPrint(o){const T=soTot(o);const c=S.customers.find(x=>normName(x.name)===normName(o.customer))||{};const r=n=>`<td style="text-align:right;white-space:nowrap">${n}</td>`;
  const st=(o.status||"draft")==="draft"?" (awaiting approval)":o.status==="cancelled"?" (CANCELLED)":o.status==="rejected"?" (REJECTED)":"";
  const LH=`<style>@page{size:A4;margin:50.8mm 14mm 14mm 14mm}.doc .lh{height:50.8mm;border:1px dashed #999;color:#888;display:flex;align-items:center;justify-content:center;font-size:12px;margin:-18px -16px 12px}.doc .pg2{break-before:page;page-break-before:always;border-top:2px dashed #999;margin-top:22px;padding-top:12px}.doc .pgn{font-size:11px;color:#444}.doc .ack{border:2px solid #000;padding:8px 10px;margin-top:10px;break-inside:avoid;page-break-inside:avoid}.doc .ackg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 18px;margin-top:6px}.doc .ackg div{border-bottom:1px solid #000;padding-top:18px;font-size:10.5px}.doc .sigs{display:flex;justify-content:space-between;gap:22px;margin-top:34px}.doc .h2l{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:4px;font-size:12px}.doc .tc>div{font-size:9.6px!important;line-height:1.27!important;margin-top:6px!important}.doc .tc li{margin:0 0 1px}.doc .sigs span{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center;font-size:12px}.doc .nb{border:1px solid #000;background:#f4f4f4;padding:7px 9px;font-size:11.5px;margin-top:10px}@media print{.doc .lh{display:none}.doc .pg2{border-top:0;margin-top:0;padding-top:0}}</style>`;
  const head=(pg)=>`<div class="hd"><div><div class="big">SALES ORDER</div><div>${st?st.trim():""}</div></div><div style="text-align:right"><div class="big" style="white-space:nowrap">${soNo(o)}</div><div style="white-space:nowrap">Date: ${fmtDY(o.date)}</div><div class="pgn">Page ${pg} of 2</div></div></div>`;
  showPrint(`${soNo(o)} ${o.customer||""}`.trim(),`${LH}<div class="lh">Letterhead area (2 inches) &middot; left blank when printed</div>
  ${head(1)}
  <table>${trs([["Party",`<b>${esc(o.customer)}</b>`],["Address",esc([c.address,c.city].filter(Boolean).join(", "))],["GSTIN",esc(c.gst||"")],["Phone",esc(c.phone||"")],["Contact",esc(o.contact)],
    ["Party PO",o.po?esc(o.po)+(o.poDate?" dated "+fmtDY(o.poDate):""):""],["Delivery date",fmtDY(o.due)],["Deliver at",esc(o.delAt)],["Payment",o.payDays?esc(o.payDays)+" days from bill date":""]])}</table>
  <table class="t" style="font-size:11.5px"><tr><th>Sr</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate ₹</th><th style="text-align:right">GST</th><th style="text-align:right">Amount ₹</th></tr>
  ${soLines(o).map((l,i)=>`<tr><td>${i+1}</td><td><b>${esc(l.ptype)}</b>: ${esc(l.item)}<br><span style="color:#444">${[l.size&&"Final cut size "+l.size,l.paper&&(l.paper+(l.paperSrc==="party"?" (party supplied)":"")),l.colors&&"Colours "+l.colors,l.finishing].filter(Boolean).map(esc).join(" · ")}${l.notes?"<br>"+esc(l.notes):""}</span></td>${r(fmtN(l.qty))}${r(l.rate?String(l.rate):"")}${r((+l.gst||0)+"%")}${r(fmtN(Math.round(soLineAmt(l)*100)/100))}</tr>`).join("")}
  <tr><td colspan="5" style="text-align:right">Taxable value</td>${r(fmtN(Math.round(T.tax)))}</tr><tr><td colspan="5" style="text-align:right">GST</td>${r(fmtN(Math.round(T.gst)))}</tr>
  <tr><td colspan="5" style="text-align:right"><b>Order value</b></td>${r("<b>"+fmtN(Math.round(T.total))+"</b>")}</tr></table>
  ${o.notes?`<p><b>Remarks:</b> ${esc(o.notes)}</p>`:""}
  <div class="nb">This sales order has 2 pages. The terms and conditions on page 2 form part of this order. Please sign the acknowledgement on page 2, which covers both pages. If no changes are suggested within 2 working days, this order will be treated as accepted even if it is not signed. Confirmation by SMS, WhatsApp, email or phone call is also accepted.</div>
  <div class="pg2"><div class="h2l"><b style="font-size:14px">SALES ORDER ${soNo(o)}</b><span>Date: ${fmtDY(o.date)} &middot; ${esc(o.customer)} &middot; Page 2 of 2</span></div>
  <div class="tc">${termsHtml("Sales order &amp; delivery terms and conditions")}</div>
  <div class="ack"><b>Acknowledgement by party</b><div style="font-size:11px;margin-top:3px">We, <b>${esc(o.customer)}</b>, have read, understood and accept Sales Order ${soNo(o)} dated ${fmtDY(o.date)}, consisting of page 1 (order details) and page 2 (terms and conditions).</div>
  <div class="fr"><div class="fl"><b>Name of authorised person:</b><i></i></div></div>
  <div class="fr"><div class="fl"><b>Designation:</b><i></i></div><div class="fl"><b>Mobile no.:</b><i></i></div><div class="fl" style="flex:.7"><b>Date:</b><i></i></div></div>
  <div class="sb" style="grid-template-columns:1fr 1fr"><div><b>Party's signature &amp; stamp</b></div><div><b>For ${OWN.toUpperCase()}</b><small>Authorised signatory</small></div></div></div></div>`)}

function companyForm(){const c=CO();
  sheet(`<h3>Company &amp; T&amp;C</h3><p class="meta" style="margin-top:-6px">Sales orders and delivery challans print on your letterhead, with 2 inches left blank at the top.</p>
  ${fields([{k:"address",label:"Registered office address",type:"textarea"},{k:"dispatch",label:"Works / dispatch address",type:"textarea"},{k:"landmark",label:"Dispatch landmark"},{k:"map",label:"Dispatch map link"},{row:[{k:"phone",label:"Phone",type:"tel"},{k:"gst",label:"GSTIN"}]},{row:[{k:"state",label:"State & code"},{k:"udyam",label:"Udyam no."}]},{k:"email",label:"Email"}],c)}
  <label>Sales order terms (one per line)<textarea name="terms" rows="14" style="font-size:14px">${esc(c.terms??DEF_TERMS)}</textarea></label>
  <label>Delivery challan terms (one per line)<textarea name="dcTerms" rows="10" style="font-size:14px">${esc(c.dcTerms??DEF_DC_TERMS)}</textarea></label>
  <div class="btns"><button class="btn" onclick="closeSheet()">Cancel</button><button class="btn" id="tdef">Reset T&amp;C</button><button class="btn primary" id="save">Save</button></div>`);
  $("#tdef").onclick=()=>{$('[name="terms"]').value=DEF_TERMS;$('[name="dcTerms"]').value=DEF_DC_TERMS};
  $("#save").onclick=async()=>{if(db&&!canVerify){toast("Only the owner can change these.");return}const v=read();try{await put("settings",{...c,id:"company",...v})}catch(e){return}closeSheet();toast("Saved")}}

/* ---------- printing plate inward ---------- */
const _FORMS=["32 pg","16 pg","8 pg","4 pg","2 pg","Single sheet","Cover","Front","Back","Other"];
const _PLTYPES=["CTP new","PS new","Old / reuse"];
const _PUTYPES=["Flat die","Rotary die","Embossing block","Debossing block","Foil block","Perforation die","Other"];
let pmode="plates";
const plSets=p=>(p.sets||[]).reduce((a,s)=>a+(+s.n||0),0);
const plSnos=p=>(p.sets||[]).map(s=>s.sno).filter(Boolean);
const setJobs=sno=>S.jobs.filter(j=>(j.plan?.plates?.sets||[]).includes(sno));
const allSnos=exceptId=>{const m=new Set();S.plates.forEach(x=>{if(x.id===exceptId)return;m.add(pinKey(x.pno));plSnos(x).forEach(n=>m.add(pinKey(n)))});return m};
function jobPlateNos(j){const sel=j.plan?.plates?.sets||[];if(sel.length){const out=[];for(const p of platesOf(j)){const ss=(p.sets||[]).filter(s=>sel.includes(s.sno));if(ss.length)out.push({p,ss})}return out}return platesOf(j).map(p=>({p,ss:null}))}
const jobPlateTxt=j=>jobPlateNos(j).map(({p,ss})=>ss?ss.map(s=>`<b>${esc(s.sno)}</b> ${esc(s.form)}${+s.pps?" ("+s.pps+" plates)":""}`).join("<br>")+`<br><span style="font-size:11px">${esc(p.vendor||"")}${p.size?", "+esc(p.size):""}</span>`:`<b>${esc(p.pno)}</b> (${esc(p.vendor||"")}${plSets(p)?": "+esc(plSetTxt(p)):""})`).join("<br>");
const plFromSets=p=>(p.sets||[]).reduce((a,s)=>a+(+s.n||0)*(+s.pps||0),0);
const plSetTxt=p=>{const g=new Map();for(const s of (p.sets||[]).filter(s=>+s.n)){const k=s.form+"|"+(+s.pps||0);g.set(k,(g.get(k)||0)+(+s.n))}return [...g].map(([k,n])=>{const [f,pp]=k.split("|");return `${n} × ${f}${+pp?` (${pp} plates/set)`:""}`}).join(", ")};
const plJobs=id=>S.jobs.filter(j=>(j.plan?.plates?.ids||[]).includes(id));
function nextPlateNo(){let best=null;S.plates.forEach(p=>{const m=String(p.pno||"").match(/^(.*?)(\d+)$/);if(m&&(!best||+m[2]>best.n))best={pre:m[1],n:+m[2],w:m[2].length}});
  const b=best||{pre:"PL-",n:0,w:4};return b.pre+String(b.n+1).padStart(b.w,"0")}
function plateRows(){let list=[...S.plates].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||String(b.pno).localeCompare(String(a.pno),undefined,{numeric:true}));
  const t=q.toLowerCase();if(t)list=list.filter(p=>[p.pno,p.vendor,p.ref,p.bill,p.size,plSetTxt(p),...plSnos(p),...plJobs(p.id).map(j=>jno(j)+" "+jobDesc(j))].join(" ").toLowerCase().includes(t));
  return list.map(p=>{const js=plJobs(p.id);return `<button class="row" data-plate="${p.id}"><div class="row-top"><span><span class="pin">${esc(p.pno)}</span><span class="cust">${esc(p.vendor||"")}</span></span><span class="meta">${fmtD(p.date)}</span></div>
    <div class="row-top meta"><span>${esc(p.ref||"")}${p.size?(p.ref?" · ":"")+esc(p.size):""}</span><span><b class="num">${fmtN(p.qty)}</b> plates${plSets(p)?`, ${fmtN(plSets(p))} sets`:""}</span></div>
    ${plSnos(p).length?`<div class="meta">Plate nos: ${esc(plSnos(p).length>4?plSnos(p).slice(0,3).join(", ")+" … "+plSnos(p).slice(-1)[0]:plSnos(p).join(", "))}</div>`:""}
    <div class="meta">${js.length?"Used in "+esc(js.map(jno).join(", ")):'<span class="plus">Not used in any job yet</span>'}</div></button>`}).join("")
    ||`<div class="empty">${S.plates.length?"No plates match.":"No plates yet. Tap Plate inward when plates come from the vendor."}</div>`}

const setRow=(s={})=>`<div class="rrow pset"><button class="rx" type="button" aria-label="Remove set">×</button><div class="two" style="grid-template-columns:1fr .8fr 1.3fr">
  <label>Form<select data-s="form">${LS.FORMS.map(f=>`<option${f===(s.form||"16 pg")?" selected":""}>${esc(f)}</option>`).join("")}</select></label>
  <label>Plates / set<input data-s="pps" type="number" inputmode="numeric" value="${esc(s.pps??4)}"></label>
  <label>Plate no.<input data-s="sno" value="${esc(s.sno||"")}"${s.sno?' data-touched="1"':""}></label></div></div>`;
function plateForm(p={},back){const v={date:today(),type:"CTP new",pno:p.id?p.pno:nextPlateNo(),...p};
  const vendors=[...new Set(S.plates.map(x=>(x.vendor||"").trim()).filter(Boolean))].sort();
  const rows0=[];for(const s0 of (p.sets&&p.sets.length?p.sets:[{n:1}]))for(let i=0;i<Math.max(1,+s0.n||1);i++)rows0.push({form:s0.form,pps:s0.pps,sno:s0.sno||(s0.snos&&s0.snos[i])||""});
  sheet(`<h3>${p.id?"Edit plate inward "+esc(p.pno):"Plate inward"}</h3>
  <datalist id="pvlist">${vendors.map(x=>`<option value="${esc(x)}">`).join("")}</datalist>
  ${fields([{row:[{k:"pno",label:"Inward no."},{k:"date",label:"Date",type:"date"}]},
    {k:"vendor",label:"Plate vendor",list:"pvlist"},
    {k:"ref",label:"For job / title",ph:"e.g. ABC Ltd catalogue, Std 5 maths book"},
    {row:[{k:"size",label:"Plate size",ph:"e.g. 605×745"},{k:"type",label:"Plate type",type:"select",options:LS.PLTYPES.map(t=>({v:t,t}))}]},
    {k:"bill",label:"Vendor challan / bill no."}],v)}
  <div class="sec"><h4>Sets <span class="meta" style="font-weight:400;font-size:13px">one row per set, each with its own plate no.</span></h4>
  <div id="psets">${rows0.map(setRow).join("")}</div>
  <div class="two" style="grid-template-columns:70px 1fr auto;align-items:end"><label>Sets<input id="psn" type="number" inputmode="numeric" min="1" value="1"></label><label>of form<select id="psf">${LS.FORMS.map(f=>`<option>${esc(f)}</option>`).join("")}</select></label><button class="btn" type="button" id="psadd" style="margin-bottom:10px;flex:none">+ Add</button></div></div>
  <div class="calc" id="pscalc" style="margin-top:4px"></div>
  ${fields([{row:[{k:"qty",label:"Total plates",type:"number"},{k:"loc",label:"Stored at",ph:"e.g. Plate rack 2"}]},{k:"notes",label:"Notes",type:"textarea"}],v)}
  <div class="btns"><button class="btn" id="pcan">${p.id?"Back":"Cancel"}</button><button class="btn primary" id="save">${p.id?"Save changes":"Save plate inward"}</button></div>`);
  const box=$("#psets"),qtyEl=$('[name="qty"]'),pnoEl=$('[name="pno"]');if(p.id)qtyEl.dataset.touched=1;qtyEl.addEventListener("input",()=>qtyEl.dataset.touched=1);
  const renum=()=>{const base=pnoEl.value.trim();box.querySelectorAll(".pset").forEach((r,i)=>{const x=r.querySelector('[data-s="sno"]');if(!x.dataset.touched)x.value=base?`${base}-${i+1}`:""})};
  box.addEventListener("input",e=>{if(e.target.dataset.s==="sno")e.target.dataset.touched=1});pnoEl.addEventListener("input",renum);
  const readSets=()=>[...box.querySelectorAll(".pset")].map(r=>{const o={};r.querySelectorAll("[data-s]").forEach(i=>o[i.dataset.s]=i.value.trim());return{form:o.form,n:1,pps:+o.pps||0,sno:o.sno}});
  const calc=()=>{const ss=readSets(),sets=ss.length,pl=ss.reduce((a,s)=>a+s.pps,0);
    if(!qtyEl.dataset.touched&&pl)qtyEl.value=pl;const tq=+qtyEl.value||0;
    $("#pscalc").innerHTML=sets?`Total sets <b>${fmtN(sets)}</b> · plates from sets <b>${fmtN(pl)}</b>${tq&&tq!==pl?`<span class="caution">Total plates (${fmtN(tq)}) doesn't match the sets (${fmtN(pl)}). Check the count.</span>`:""}`:"Add the sets received."};
  $("#sheet-body").addEventListener("input",calc);$("#sheet-body").addEventListener("change",calc);
  box.addEventListener("click",e=>{if(!e.target.closest(".rx"))return;if(box.querySelectorAll(".pset").length<2){toast("Keep at least one set.");return}e.target.closest(".pset").remove();renum();calc()});
  $("#psadd").onclick=()=>{const n=Math.min(64,Math.max(1,+$("#psn").value||1));const last=readSets().slice(-1)[0];for(let i=0;i<n;i++)box.insertAdjacentHTML("beforeend",setRow({form:$("#psf").value,pps:last?last.pps:4}));renum();calc()};
  renum();calc();
  $("#pcan").onclick=()=>back?back():p.id?plateView(p.id):closeSheet();
  $("#save").onclick=async e=>{const f=read();const sets=readSets();
    if(!f.pno){toast("Enter the inward no.");return}
    const taken=allSnos(p.id);
    if(taken.has(pinKey(f.pno))){toast(`${f.pno} is already used.`);return}
    if(!f.vendor){toast("Add the plate vendor.");return}
    const mine=new Set();for(const st of sets){if(!st.sno){toast("Every set needs a plate no.");return}const k=pinKey(st.sno);if(mine.has(k)||taken.has(k)){toast(`Plate no. ${st.sno} is already used.`);return}if(!(st.pps>0)){toast(`Enter plates per set for ${st.sno}.`);return}mine.add(k)}
    if(p.id){const usedS=new Set(S.jobs.flatMap(j=>j.plan?.plates?.sets||[]));const gone=plSnos(p).filter(n=>usedS.has(n)&&!sets.some(x=>x.sno===n));if(gone.length){toast(`Plate no. ${gone[0]} is selected in a job plan, so it can't be removed or renamed.`);return}}
    const qty=+f.qty||plFromSets({sets});if(!(qty>0)){toast("Enter the total plates received.");return}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    const rec={...p,pno:f.pno,date:f.date||today(),vendor:f.vendor,ref:f.ref,size:f.size,type:f.type,bill:f.bill,sets,qty,loc:f.loc,notes:f.notes};
    let id;try{id=await put("plates",rec)}catch(x){btn.disabled=false;return}
    toast(`Plate inward ${f.pno} saved`);back?setTimeout(back,300):p.id?setTimeout(()=>plateView(p.id),300):closeSheet()}}
function plateView(id){const p=S.plates.find(x=>x.id===id);if(!p)return closeSheet();const js=plJobs(id);
  sheet(`<h3><span class="pin">${esc(p.pno)}</span>${esc(p.ref||"Plates")}</h3>
  <dl><dt>Vendor</dt><dd>${esc(p.vendor)}</dd><dt>Date</dt><dd>${fmtDY(p.date)}</dd>${p.bill?`<dt>Challan / bill</dt><dd>${esc(p.bill)}</dd>`:""}
  <dt>Plates</dt><dd><b class="num">${fmtN(p.qty)}</b> ${esc(p.type||"")}${p.size?", "+esc(p.size):""}</dd>${p.loc?`<dt>Stored at</dt><dd>${esc(p.loc)}</dd>`:""}${p.notes?`<dt>Notes</dt><dd>${esc(p.notes)}</dd>`:""}</dl>
  ${(p.sets||[]).length?`<table class="pt"><tr><th>Plate no.</th><th>Form</th><th>Plates</th><th>Used in</th></tr>${p.sets.map(s=>`<tr><td><b>${esc(s.sno||"—")}</b>${+s.n>1?` <span class="meta">× ${s.n} sets</span>`:""}</td><td>${esc(s.form)}</td><td class="num">${fmtN((+s.n||1)*s.pps)}</td><td>${s.sno?esc(setJobs(s.sno).map(jno).join(", "))||'<span class="plus">Free</span>':""}</td></tr>`).join("")}
    <tr><th>Total</th><th>${fmtN(plSets(p))} sets</th><th class="num">${fmtN(plFromSets(p))}</th><th></th></tr></table>`:""}
  <h2>Used in jobs</h2><div class="list">${js.map(j=>`<button class="row" data-job="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> ${esc(j.customer)}</span><span class="meta">${STAGES[j.stage]}</span></div><div class="meta">${esc(jobDesc(j))}</div></button>`).join("")||'<p class="meta">Not used yet. Select it in a job\'s plan under Plates.</p>'}</div>
  <div class="btns" style="margin-top:14px"><button class="btn" id="ped">Edit</button><button class="btn danger" id="pdel">Delete</button></div>`);
  $("#ped").onclick=()=>plateForm(p);
  $("#pdel").onclick=e=>{if(js.length){toast("These plates are selected in a job plan, so they can't be deleted.");return}armDelete(e.target,()=>remove("plates",p.id))}}
/* plate picker inside job planning */
function platePick(j,sel,selSets){const mine=new Set(sel),ss=new Set(selSets||[]);
  const list=[...S.plates].sort((a,b)=>(mine.has(b.id)-mine.has(a.id))||(plJobs(a.id).length?1:0)-(plJobs(b.id).length?1:0)||(b.date||"").localeCompare(a.date||""));
  if(!list.length)return `<p class="meta">No plates in Plate inward yet. Tap + Plate inward to add them.</p>`;
  const cb=(val,on,label,meta)=>`<label style="display:flex;gap:10px;align-items:flex-start;margin:7px 0;color:var(--ink)"><input type="checkbox" value="${val}"${on?" checked":""} style="width:20px;height:20px;margin:2px 0 0;flex:none"><span>${label}${meta?`<br><span class="meta">${meta}</span>`:""}</span></label>`;
  return `<p class="meta" style="margin:0 0 6px">Tick the plate sets for this job:</p><div id="plpick" style="max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:var(--r-sm);padding:4px 10px">${list.map(p=>{
    if(plSnos(p).length)return `<div style="margin:8px 0 2px;font-size:13px;color:var(--muted)"><b style="color:var(--ink)">${esc(p.pno)}</b> ${esc(p.ref||p.vendor||"")}${p.size?" · "+esc(p.size):""}</div>`+(p.sets||[]).filter(s=>s.sno).map(s=>{const others=setJobs(s.sno).filter(x=>x.id!==j.id);
      return cb(`${p.id}|${esc(s.sno)}`,ss.has(s.sno)||(!ss.size&&mine.has(p.id)),`<span class="pin">${esc(s.sno)}</span>${esc(s.form)}`,`${fmtN(s.pps)} plates${others.length?` · <span class="due-soon">also in ${esc(others.map(jno).join(", "))}</span>`:""}`)}).join("");
    const others=plJobs(p.id).filter(x=>x.id!==j.id);
    return cb(p.id,mine.has(p.id),`<span class="pin">${esc(p.pno)}</span>${esc(p.ref||p.vendor||"")}`,`${fmtN(p.qty)} plates${plSets(p)?" · "+esc(plSetTxt(p)):""}${p.size?" · "+esc(p.size):""}${others.length?` · <span class="due-soon">also in ${esc(others.map(jno).join(", "))}</span>`:""}`)}).join("")}</div>`}
const platesOf=j=>(j.plan?.plates?.ids||[]).map(id=>S.plates.find(p=>p.id===id)).filter(Boolean);

function renderPlates(){const tg="";
  if(pmode==="punch"){const used=S.punches.filter(u=>punchJobs(u.id).length).length;
    return tg+`<input class="search" id="q" type="search" placeholder="Search punch no., vendor, job or title" value="${esc(q)}">
    ${S.punches.length?`<p class="meta" style="margin:8px 0 0">${fmtN(S.punches.length)} punches · ${fmtN(S.punches.length-used)} not yet used in a job</p>`:""}<div class="list">${punchRows()}</div>`}
  const used=S.plates.filter(p=>plJobs(p.id).length).length;
  return tg+`<input class="search" id="q" type="search" placeholder="Search plate no., vendor, job or title" value="${esc(q)}">
  ${S.plates.length?`<p class="meta" style="margin:8px 0 0">${fmtN(S.plates.length)} plate inwards · ${fmtN(S.plates.reduce((a,p)=>a+(+p.qty||0),0))} plates · ${fmtN(S.plates.length-used)} not yet used in a job</p>`:""}
  <div class="list">${plateRows()}</div>`}
/* ---------- punch inward (dies, blocks) ---------- */
const punchJobs=id=>S.jobs.filter(j=>(j.plan?.punch?.ids||[]).includes(id));
const punchesOf=j=>(j.plan?.punch?.ids||[]).map(id=>S.punches.find(u=>u.id===id)).filter(Boolean);
function nextPunchNo(){let best=null;S.punches.forEach(u=>{const m=String(u.pno||"").match(/^(.*?)(\d+)$/);if(m&&(!best||+m[2]>best.n))best={pre:m[1],n:+m[2],w:m[2].length}});const b=best||{pre:"PU-",n:0,w:4};return b.pre+String(b.n+1).padStart(b.w,"0")}
function punchRows(){let list=[...S.punches].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||String(b.pno).localeCompare(String(a.pno),undefined,{numeric:true}));
  const t=q.toLowerCase();if(t)list=list.filter(u=>[u.pno,u.vendor,u.ref,u.bill,u.size,u.type,u.loc,...punchJobs(u.id).map(j=>jno(j)+" "+jobDesc(j))].join(" ").toLowerCase().includes(t));
  return list.map(u=>{const js=punchJobs(u.id);return `<button class="row" data-punch="${u.id}"><div class="row-top"><span><span class="pin">${esc(u.pno)}</span><span class="cust">${esc(u.ref||u.vendor||"")}</span></span><span class="meta">${fmtD(u.date)}</span></div>
    <div class="row-top meta"><span>${esc([u.type,u.size,+u.ups>1?u.ups+" ups":""].filter(Boolean).join(" · "))}</span><span>${u.loc?"📍 "+esc(u.loc):""}</span></div>
    <div class="meta">${js.length?"Used in "+esc(js.map(jno).join(", ")):'<span class="plus">Not used in any job yet</span>'}</div></button>`}).join("")
    ||`<div class="empty">${S.punches.length?"No punches match.":"No punches yet. Tap Punch inward when a punch / die comes in."}</div>`}
function punchForm(u={},back){const v={date:today(),type:LS.PUTYPES[0],qty:1,pno:u.id?u.pno:nextPunchNo(),...u};
  const vendors=[...new Set(S.punches.map(x=>(x.vendor||"").trim()).filter(Boolean))].sort();
  sheet(`<h3>${u.id?"Edit punch "+esc(u.pno):"Punch inward"}</h3><datalist id="puvlist">${vendors.map(x=>`<option value="${esc(x)}">`).join("")}</datalist>
  ${fields([{row:[{k:"pno",label:"Punch no."},{k:"date",label:"Date",type:"date"}]},{k:"vendor",label:"Punch maker / vendor",list:"puvlist"},
    {k:"ref",label:"For job / title",ph:"e.g. ABC Ltd mono carton 4 ups"},
    {row:[{k:"type",label:"Punch type",type:"select",options:LS.PUTYPES.map(t=>({v:t,t}))},{k:"size",label:"Punch / die size",ph:"e.g. 20×28 in"}]},
    {row:[{k:"ups",label:"Ups",type:"number"},{k:"qty",label:"No. of pieces",type:"number"}]},
    {row:[{k:"bill",label:"Vendor challan / bill no."},{k:"loc",label:"Stored at",ph:"e.g. Die rack 1"}]},{k:"notes",label:"Notes",type:"textarea"}],v)}
  <div class="btns"><button class="btn" id="ucan">${u.id?"Back":"Cancel"}</button><button class="btn primary" id="save">${u.id?"Save changes":"Save punch inward"}</button></div>`);
  $("#ucan").onclick=()=>back?back():u.id?punchView(u.id):closeSheet();
  $("#save").onclick=async e=>{const f=read();if(!f.pno){toast("Enter the punch no.");return}
    if(S.punches.some(x=>x.id!==u.id&&pinKey(x.pno)===pinKey(f.pno))){toast(`Punch no. ${f.pno} is already used.`);return}
    if(!f.vendor){toast("Add the punch maker / vendor.");return}if(!(+f.qty>0)){toast("Enter the number of pieces.");return}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    try{await put("punches",{...u,...f,ups:+f.ups||"",qty:+f.qty||1})}catch(x){btn.disabled=false;return}
    toast(`Punch ${f.pno} saved`);back?setTimeout(back,300):u.id?setTimeout(()=>punchView(u.id),300):closeSheet()}}
function punchView(id){const u=S.punches.find(x=>x.id===id);if(!u)return closeSheet();const js=punchJobs(id);
  sheet(`<h3><span class="pin">${esc(u.pno)}</span>${esc(u.ref||"Punch")}</h3>
  <dl><dt>Type</dt><dd>${esc(u.type||"")}</dd>${u.size?`<dt>Size</dt><dd>${esc(u.size)}</dd>`:""}${+u.ups?`<dt>Ups</dt><dd>${esc(u.ups)}</dd>`:""}<dt>Pieces</dt><dd>${fmtN(u.qty||1)}</dd>
  <dt>Vendor</dt><dd>${esc(u.vendor||"")}</dd><dt>Date</dt><dd>${fmtDY(u.date)}</dd>${u.bill?`<dt>Challan / bill</dt><dd>${esc(u.bill)}</dd>`:""}${u.loc?`<dt>Stored at</dt><dd>${esc(u.loc)}</dd>`:""}${u.notes?`<dt>Notes</dt><dd>${esc(u.notes)}</dd>`:""}</dl>
  <h2>Used in jobs</h2><div class="list">${js.map(j=>`<button class="row" data-job="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> ${esc(j.customer)}</span><span class="meta">${STAGES[j.stage]}</span></div><div class="meta">${esc(jobDesc(j))}</div></button>`).join("")||'<p class="meta">Not used yet. Select it in a job\'s plan under Punch.</p>'}</div>
  <div class="btns" style="margin-top:14px"><button class="btn" id="ued">Edit</button><button class="btn danger" id="udel">Delete</button></div>`);
  $("#ued").onclick=()=>punchForm(u);
  $("#udel").onclick=e=>{if(js.length){toast("This punch is selected in a job plan, so it can't be deleted.");return}armDelete(e.target,()=>remove("punches",u.id))}}
function punchPick(j,sel){const mine=new Set(sel);const list=[...S.punches].sort((a,b)=>(mine.has(b.id)-mine.has(a.id))||(normName(b.ref||"").includes(normName(j.customer||"#"))-normName(a.ref||"").includes(normName(j.customer||"#")))||(b.date||"").localeCompare(a.date||""));
  if(!list.length)return `<p class="meta">No punches in Punch inward yet. Tap + Punch inward to add one.</p>`;
  return `<div id="pupick" style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:var(--r-sm);padding:4px 10px">${list.map(u=>{const others=punchJobs(u.id).filter(x=>x.id!==j.id);
    return `<label style="display:flex;gap:10px;align-items:flex-start;margin:7px 0;color:var(--ink)"><input type="checkbox" value="${u.id}"${mine.has(u.id)?" checked":""} style="width:20px;height:20px;margin:2px 0 0;flex:none"><span><span class="pin">${esc(u.pno)}</span>${esc(u.ref||u.vendor||"")}<br><span class="meta">${esc([u.type,u.size,+u.ups>1?u.ups+" ups":""].filter(Boolean).join(" · "))}${others.length?` · <span class="due-soon">also in ${esc(others.map(jno).join(", "))}</span>`:""}</span></span></label>`}).join("")}</div>`}
function renderStores(){
  const t=q.toLowerCase();const low=S.items.filter(isLowItem);
  const chips=`<div class="chips">${[["items","Items",S.items.length],["grn","GRNs",S.grn.length],["low","Low stock",low.length]].map(([k,l,n])=>`<button class="chip" data-sv="${k}" aria-pressed="${storeView===k}">${l}<b>${n}</b></button>`).join("")}</div>`;
  let body;
  if(storeView==="grn"){let list=[...S.grn].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.no||0)-(a.no||0));
    if(t)list=list.filter(g=>[grnNo(g),g.supplier,g.bill,...(g.lines||[]).map(l=>l.name)].join(" ").toLowerCase().includes(t));
    body=list.map(g=>`<button class="row" data-grn="${g.id}"><div class="row-top"><span><span class="jno">${grnNo(g)}</span> <span class="cust">${esc(g.supplier||"")}</span></span><span class="meta">${fmtD(g.date)}</span></div>
      <div class="row-top meta"><span>${esc((g.lines||[]).map(itemLabel).join(", "))}</span><span class="num price">${inr(grnTotal(g).total)}</span></div>${g.bill?`<div class="meta">Bill ${esc(g.bill)}</div>`:""}</button>`).join("")
      ||`<div class="empty">${S.grn.length?"No GRN matches.":"No GRNs yet. Tap New GRN when consumables or raw material arrive."}</div>`}
  else if(storeView==="items"&&!t&&!storeCat){
    const cats=storeCats().map(c=>{const its=S.items.filter(i=>normName(i.cat||"Other consumable")===normName(c));return{c,n:its.length,lw:its.filter(isLowItem).length}}).filter(x=>x.n);
    body=cats.length?`<p class="meta" style="margin:10px 0 0">Pick a category to see its products.</p><div class="grid">${cats.map(x=>`<button class="tile" data-scat="${esc(x.c)}"><div class="n">${x.n}</div><div class="l"><b style="color:var(--ink)">${esc(x.c)}</b><br>${x.n===1?"1 product":x.n+" products"}${x.lw?` · <span class="low">${x.lw} low</span>`:""}</div></button>`).join("")}</div>`
      :`<div class="empty">No items yet. Tap New GRN when material arrives, or add an item with its opening stock.</div>`}
  else{let list=storeView==="low"?low:[...S.items];
    if(storeView==="items"&&storeCat&&!t)list=list.filter(i=>normName(i.cat||"Other consumable")===normName(storeCat));
    if(t)list=list.filter(i=>[i.name,i.cat,i.loc,i.size,i.micron&&i.micron+" micron"].join(" ").toLowerCase().includes(t));
    list.sort((a,b)=>(a.cat||"").localeCompare(b.cat||"")||a.name.localeCompare(b.name)||szNorm(a.size).localeCompare(szNorm(b.size))||(+a.micron||0)-(+b.micron||0));
    const inCat=storeView==="items"&&storeCat&&!t;
    body=(inCat?`<div class="row-top" style="margin-top:12px;align-items:center"><button class="mini" id="scback">‹ All categories</button><b>${esc(storeCat)}</b></div>`:"")+(list.map(it=>{const b=itemBal(it.id),lw=isLowItem(it),r=lastRate(it.id),sp=itemSpec(it);return `<button class="row" data-item="${it.id}">
      <div class="row-top"><span class="cust">${esc(it.name)}${inCat?"":`<span class="tag">${esc(it.cat||"Other")}</span>`}</span><span class="bal num ${lw?"low":""}">${qtyTxt(b)} <span style="font-size:13px;font-weight:600">${esc(it.unit||"")}</span></span></div>
      ${sp?`<div class="meta">${esc(sp)}</div>`:""}
      <div class="row-top meta"><span>Received ${qtyTxt((+it.opening||0)+itemIn(it.id))} · Issued ${qtyTxt(itemOut(it.id))}</span><span>${lw?'<span class="low">Low</span>':""}</span></div>
      ${isAdm()||it.loc?`<div class="meta">${isAdm()?(r?"Last rate "+inr(r)+" / "+esc(it.unit||""):"No rate yet"):""}${it.loc?(isAdm()?" · ":"")+"📍 "+esc(it.loc):""}</div>`:""}</button>`}).join("")
      ||`<div class="empty">${storeView==="low"?"Nothing below its alert level.":"No items match."}</div>`)}
  const val=S.items.reduce((a,i)=>a+Math.max(0,itemBal(i.id))*lastRate(i.id),0);
  return `<input class="search" id="q" type="search" placeholder="${storeView==="grn"?"Search GRN no., supplier, bill or item":"Search items, category or location"}" value="${esc(q)}">${chips}
  ${isAdm()&&S.items.length&&(storeView==="items"||storeView==="low")?`<p class="meta" style="margin:6px 0 0">Stores value at last rate: <b class="num">${inr(val)}</b> (before GST)</p>`:""}
  ${storeView==="items"?`<div class="btns" style="margin-top:8px"><button class="btn" id="additem">${storeCat&&!t?"Add product to "+esc(storeCat):"Add item / opening stock"}</button></div>`:""}
  <div class="list">${body}</div>`}

let glid=0;
function itemNamesFor(cat){const its=S.items.filter(i=>!cat||normName(i.cat)===normName(cat));const m=new Map();its.forEach(i=>m.set(normName(i.name),i.name));
  if(!cat||!its.length)LS.CONSUMABLES.forEach(c=>m.has(normName(c))||m.set(normName(c),c));return [...m.values()].sort().map(n=>`<option value="${esc(n)}">`).join("")}
function grnLineRow(l={}){const dl="il"+(++glid);const sel=(k,opts,cur)=>`<select data-l="${k}">${opts.map(o=>`<option value="${esc(o)}"${String(o)===String(cur)?" selected":""}>${esc(k==="gst"?o+"%":o)}</option>`).join("")}</select>`;
  return `<div class="rrow gline"><button class="rx" type="button" aria-label="Remove item">×</button>
  <label>1. Category<input data-l="cat" list="catlist" value="${esc(l.cat||"")}" placeholder="e.g. Ink, Lamination film"></label>
  <label>2. Product<input data-l="name" list="${dl}" value="${esc(l.name||"")}" placeholder="e.g. Ink black, BOPP film"><datalist id="${dl}">${itemNamesFor(l.cat)}</datalist></label>
  <div class="two" style="--n:3"><label>Size<input data-l="size" value="${esc(l.size||"")}" placeholder="e.g. 20×30"></label><label>Size in${sel("sunit",SZU,l.sunit||"in")}</label><label>Microns<input data-l="micron" type="number" inputmode="decimal" step="any" value="${esc(l.micron||"")}" placeholder="If any"></label></div>
  <div class="two" style="--n:3"><label>Unit${sel("unit",LS.SUNITS,l.unit||"kg")}</label><label>Qty received<input data-l="qty" type="number" inputmode="decimal" step="any" value="${esc(l.qty??"")}"></label><label>Rejected<input data-l="rej" type="number" inputmode="decimal" step="any" value="${esc(l.rej||"")}" placeholder="0"></label></div>
  ${isAdm()?`<div class="two price"><label>Rate ₹ per unit<input data-l="rate" type="number" inputmode="decimal" step="any" value="${esc(l.rate||"")}"></label><label>GST${sel("gst",LS.GSTS,l.gst??18)}</label></div>`:""}
  <p class="meta gamt" style="margin:-2px 0 10px"></p></div>`}
function readLines(){return[...document.querySelectorAll("#glines .gline")].map(r=>{const o={};r.querySelectorAll("[data-l]").forEach(i=>o[i.dataset.l]=i.value.trim());return o}).filter(l=>l.name||l.qty||l.rate)}

function grnForm(g={}){
  const v={date:today(),...g};const no=g.no||S.grn.reduce((a,x)=>Math.max(a,+x.no||0),0)+1;
  sheet(`<h3>${g.id?"Edit "+grnNo(g):"New GRN"}</h3>
  <p class="meta" style="margin:-6px 0 10px">Consumables and raw material other than paper. Paper still goes in Inward → Paper.</p>
  <datalist id="suplist">${suppliers().map(s=>`<option value="${esc(s)}">`).join("")}</datalist>${catList()}
  ${fields([{html:`<div class="calc" style="margin:0 0 12px">GRN no. <b style="font-size:18px">${grnNo({no})}</b>${g.id?"":"<br>Given automatically when you save."}</div>`},
    {row:[{k:"date",label:"Received on",type:"date"},{k:"bill",label:"Bill / challan no."}]},
    {k:"supplier",label:"Supplier",list:"suplist"},
    {row:[{k:"billDate",label:"Bill date",type:"date"},{k:"vehicle",label:"Vehicle no."}]},
    {k:"recBy",label:"Received by"}],v)}
  <div class="sec"><h4>Items received</h4><div id="glines">${(g.lines&&g.lines.length?g.lines:[{}]).map(grnLineRow).join("")}</div><button class="add" type="button" id="gadd">+ Add another item</button></div>
  <div class="calc price" id="gtot" style="margin-top:12px"></div>
  ${fields([{k:"notes",label:"Remarks",type:"textarea",ph:"e.g. 2 tins dented, short by 1 roll"}],v)}
  <div class="btns"><button class="btn" onclick="closeSheet()">Cancel</button><button class="btn primary" id="save">${g.id?"Save changes":"Save GRN"}</button></div>`);
  const box=$("#glines");
  const recalc=()=>{let tax=0,gst=0;box.querySelectorAll(".gline").forEach(r=>{const o={};r.querySelectorAll("[data-l]").forEach(i=>o[i.dataset.l]=i.value);
      const a=lineTax(o),gs=a*(+o.gst||0)/100;tax+=a;gst+=gs;const acc=accQ(o);
      r.querySelector(".gamt").innerHTML=+o.qty?`Accepted <b>${qtyTxt(acc)} ${esc(o.unit)}</b>${a&&isAdm()?` · Amount <b>${inr(a)}</b> + GST ${inr(gs)}`:""}`:""});
    $("#gtot").innerHTML=`Taxable <b>${inr(tax)}</b> · GST <b>${inr(gst)}</b> · Total <b>${inr(tax+gst)}</b>`};
  const known=(r,k)=>{const g=n=>r.querySelector(`[data-l="${n}"]`);
    if(k==="cat"){const d=r.querySelector("datalist");d&&(d.innerHTML=itemNamesFor(g("cat").value.trim()));return}
    const row={name:g("name").value,size:g("size").value,sunit:g("sunit").value,micron:g("micron").value};
    let it=S.items.find(i=>itemKey(i)===itemKey(row));
    if(!it&&k==="name"&&!row.size&&!row.micron){const same=S.items.filter(i=>normName(i.name)===normName(row.name));if(same.length===1){it=same[0];g("size").value=it.size||"";g("sunit").value=it.sunit||"in";g("micron").value=it.micron||""}}
    if(!it)return;
    if(!g("cat").value.trim())g("cat").value=it.cat||"Other consumable";g("unit").value=it.unit||"kg";
    const rt=r.querySelector('[data-l="rate"]');if(!rt.value&&lastRate(it.id))rt.value=lastRate(it.id);recalc()};
  box.addEventListener("input",recalc);box.addEventListener("change",e=>{const k=e.target.dataset.l;if(["cat","name","size","sunit","micron"].includes(k))known(e.target.closest(".gline"),k);recalc()});
  box.addEventListener("click",e=>{if(!e.target.closest(".rx"))return;const rows=box.querySelectorAll(".gline");if(rows.length<2){toast("A GRN needs at least one item.");return}e.target.closest(".gline").remove();recalc()});
  $("#gadd").onclick=()=>{box.insertAdjacentHTML("beforeend",grnLineRow());box.lastElementChild.querySelector("input").focus();recalc()};
  recalc();
  $("#save").onclick=async e=>{const f=read();const lines=readLines();
    if(!f.supplier){toast("Add the supplier.");return}
    if(!lines.length){toast("Add at least one item.");return}
    for(const l of lines){if(!l.cat){toast("Choose the category for every item.");return}if(!l.name){toast("Every row needs a product name.");return}if(!(+l.qty>0)){toast(`Enter the quantity received for ${l.name}.`);return}
      if(+l.rej<0||+l.rej>+l.qty){toast(`Rejected can't be more than received for ${l.name}.`);return}}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    // link each row to an item, creating new items as needed (once per name)
    const made=new Map();
    try{for(const l of lines){if(!l.size)l.micron=l.micron||"";const k=itemKey(l);const it=S.items.find(i=>itemKey(i)===k);
      if(it)l.itemId=it.id;else if(made.has(k))l.itemId=made.get(k);else{l.itemId=await put("items",{name:l.name,cat:l.cat,unit:l.unit,size:l.size||"",sunit:l.size?(l.sunit||"in"):"",micron:+l.micron||"",opening:0,min:"",loc:""});made.set(k,l.itemId)}}}
    catch(x){btn.disabled=false;return}
    const newLines=lines.map(l=>({itemId:l.itemId,name:l.name,cat:l.cat,unit:l.unit,size:l.size||"",sunit:l.size?(l.sunit||"in"):"",micron:+l.micron||"",qty:+l.qty,rej:+l.rej||0,rate:+l.rate||0,gst:+l.gst||0}));
    const d=new Map();for(const l of g.lines||[])d.set(l.itemId,(d.get(l.itemId)||0)-accQ(l));for(const l of newLines)d.set(l.itemId,(d.get(l.itemId)||0)+accQ(l));
    for(const[id,x] of d)if(itemBal(id)+x< -1e-9){btn.disabled=false;toast(`${S.items.find(i=>i.id===id)?.name||"An item"} would go below zero, as some of it is already issued.`);return}
    const rec={...g,date:f.date||today(),bill:f.bill,supplier:f.supplier,billDate:f.billDate,vehicle:f.vehicle,recBy:f.recBy,notes:f.notes,lines:newLines};
    if(!g.id){rec.no=S.grn.reduce((a,x)=>Math.max(a,+x.no||0),0)+1;rec.created=today()}
    try{const id=await put("grn",rec);rec.id=rec.id||id}catch(x){btn.disabled=false;return}
    toast(`${grnNo(rec)} saved`);closeSheet()}}

function grnView(id){const g=S.grn.find(x=>x.id===id);if(!g)return closeSheet();const T=grnTotal(g);
  sheet(`<h3>${grnNo(g)}</h3>
  <dl><dt>Received on</dt><dd>${fmtDY(g.date)}</dd><dt>Supplier</dt><dd>${esc(g.supplier)}</dd>${g.bill?`<dt>Bill / challan</dt><dd>${esc(g.bill)}${g.billDate?" dated "+fmtDY(g.billDate):""}</dd>`:""}${g.vehicle?`<dt>Vehicle</dt><dd>${esc(g.vehicle)}</dd>`:""}${g.recBy?`<dt>Received by</dt><dd>${esc(g.recBy)}</dd>`:""}</dl>
  <div class="rwrap"><table class="rt"><tr><th>Item</th><th class="n">Accepted</th><th class="n price">Rate</th><th class="n price">Amount</th></tr>
  ${(g.lines||[]).map(l=>`<tr><td><button class="mini" data-item="${l.itemId}">${esc(l.name)}</button>${itemSpec(l)?`<br><span class="meta" style="font-size:12px">${esc(itemSpec(l))}</span>`:""}${+l.rej?`<br><span class="low" style="font-size:12px">${qtyTxt(l.rej)} rejected of ${qtyTxt(l.qty)}</span>`:""}</td><td class="n">${qtyTxt(accQ(l))} ${esc(l.unit)}</td><td class="n price">${l.rate?inr(l.rate):""}</td><td class="n price">${inr(lineTax(l))}</td></tr>`).join("")}
  <tr class="tot price"><td colspan="3">Total incl. GST ${inr(T.gst)}</td><td class="n">${inr(T.total)}</td></tr></table></div>
  ${g.notes?`<p class="meta">Remarks: ${esc(g.notes)}</p>`:""}
  <div class="btns"><button class="btn primary" id="gp">Print GRN</button><button class="btn" id="ge">Edit</button><button class="btn danger" id="gd">Delete</button></div>`);
  $("#gp").onclick=()=>{closeSheet();grnPrint(g)};$("#ge").onclick=()=>grnForm(g);
  $("#gd").onclick=e=>{for(const l of g.lines||[])if(itemBal(l.itemId)-accQ(l)< -1e-9){toast(`Can't delete: ${l.name} from this GRN is already issued.`);return}armDelete(e.target,()=>remove("grn",g.id))}}

function grnPrint(g){const T=grnTotal(g),P=isAdm();const r=n=>`<td style="text-align:right;white-space:nowrap">${n}</td>`;
  showPrint(`${grnNo(g)} ${g.supplier||""}`.trim(),`<div class="hd"><div><h1>${OWN}</h1><div>Goods Received Note: consumables &amp; raw material</div></div><div style="text-align:right"><div class="big" style="white-space:nowrap">${grnNo(g)}</div><div style="white-space:nowrap">Date: ${fmtDY(g.date)}</div></div></div>
  <table>${trs([["Supplier",esc(g.supplier)],["Bill / challan no.",esc(g.bill)],["Bill date",fmtDY(g.billDate)],["Vehicle no.",esc(g.vehicle)],["Received by",esc(g.recBy)]])}</table>
  <table class="t" style="font-size:11.5px"><tr><th>Sr</th><th>Item</th><th style="text-align:right">Recd</th><th style="text-align:right">Rej</th><th style="text-align:right">Accepted</th>${P?`<th style="text-align:right">Rate ₹</th><th style="text-align:right">GST</th><th style="text-align:right">Amount ₹</th>`:""}</tr>
  ${(g.lines||[]).map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.name)}<br><span style="color:#555">${esc([l.cat,itemSpec(l)].filter(Boolean).join(" · "))}</span></td>${r(qtyTxt(l.qty))}${r(+l.rej?qtyTxt(l.rej):"")}${r("<b>"+qtyTxt(accQ(l))+"</b> "+esc(l.unit))}${P?r(l.rate?fmtN(l.rate):"")+r((+l.gst||0)+"%")+r(fmtN(Math.round(lineTax(l)))):""}</tr>`).join("")}
  ${P?`<tr><td colspan="7" style="text-align:right">Taxable value</td>${r(fmtN(Math.round(T.tax)))}</tr>
  <tr><td colspan="7" style="text-align:right">GST</td>${r(fmtN(Math.round(T.gst)))}</tr>
  <tr><td colspan="7" style="text-align:right"><b>Total</b></td>${r("<b>"+fmtN(Math.round(T.total))+"</b>")}</tr>`:""}</table>
  ${g.notes?`<p><b>Remarks:</b> ${esc(g.notes)}</p>`:""}
  <p style="font-size:11px">Stock is added for the accepted quantity only. Rejected material is to be returned to the supplier.</p>
  <div class="sign"><span>Received by</span><span>Checked by (QC)</span><span>Store in-charge</span></div>`)}

function itemMoves(id){const m=[];
  for(const g of S.grn)for(const l of g.lines||[])if(l.itemId===id)m.push({d:g.date||"",q:accQ(l),in:true,gid:g.id,ref:grnNo(g),who:g.supplier||""});
  for(const x of S.siss.filter(x=>x.itemId===id)){const j=S.jobs.find(j=>j.id===x.jobId);m.push({d:x.date||"",at:x.at||0,q:+x.qty||0,in:false,iid:x.id,ref:j?jno(j):x.jobNo||"General use",who:[machName(x.machine),x.to].filter(Boolean).join(", ")})}
  return m.sort((a,b)=>b.d.localeCompare(a.d)||(b.at||0)-(a.at||0))}
function itemView(id){const it=S.items.find(i=>i.id===id);if(!it)return closeSheet();const b=itemBal(id),r=lastRate(id),lw=isLowItem(it),mv=itemMoves(id);
  sheet(`<h3>${esc(it.name)}<span class="tag">${esc(it.cat||"Other")}</span></h3>
  <dl>${it.size?`<dt>Size</dt><dd>${esc(it.size)} ${esc(it.sunit||"in")}</dd>`:""}${+it.micron?`<dt>Microns</dt><dd>${esc(it.micron)}</dd>`:""}<dt>Unit</dt><dd>${esc(it.unit||"")}</dd>
  <dt>Received</dt><dd>${qtyTxt((+it.opening||0)+itemIn(id))} ${esc(it.unit||"")}${+it.opening?` <span class="meta">(incl. opening ${qtyTxt(it.opening)})</span>`:""}</dd><dt>Issued</dt><dd>${qtyTxt(itemOut(id))} ${esc(it.unit||"")}</dd><dt>Balance</dt><dd><b class="bal num ${lw?"low":""}">${qtyTxt(b)}</b> ${esc(it.unit||"")}${lw?' <span class="low">below alert</span>':""}</dd>
  ${r?`<dt>Last rate</dt><dd>${inr(r)} / ${esc(it.unit||"")}</dd><dt>Stock value</dt><dd>${inr(Math.max(0,b)*r)} (before GST)</dd>`:""}
  ${+it.min?`<dt>Alert below</dt><dd>${qtyTxt(it.min)} ${esc(it.unit||"")}</dd>`:""}${it.loc?`<dt>Kept at</dt><dd>${esc(it.loc)}</dd>`:""}
</dl>
  <div class="btns"><button class="btn primary" id="iiss"${b>0?"":" disabled"}>Issue to floor</button><button class="btn" id="ied">Edit item</button></div>
  <h2>Movements</h2>${mv.map(m=>`<div class="mv"><span>${fmtD(m.d)} · ${m.in?`<button class="mini" data-grn="${m.gid}">${esc(m.ref)}</button>`:esc(m.ref)}${m.who?` <span class="meta">${esc(m.who)}</span>`:""}${m.iid?` <button class="mini" data-undo="${m.iid}" style="color:var(--magenta);margin-left:4px">Delete</button>`:""}</span><span class="${m.in?"plus":"minus"} num">${m.in?"+":"−"}${qtyTxt(m.q)}</span></div>`).join("")||'<p class="meta">No GRN or issue yet.</p>'}`);
  $("#iiss").onclick=()=>issueForm(it);$("#ied").onclick=()=>itemForm(it);
  $("#sheet-body").querySelectorAll("[data-undo]").forEach(bt=>bt.onclick=async()=>{if(!bt.dataset.armed){bt.dataset.armed=1;bt.textContent="Tap again";setTimeout(()=>{if(bt.isConnected){delete bt.dataset.armed;bt.textContent="Delete"}},3000);return}
    await remove("siss",bt.dataset.undo);toast("Issue deleted");setTimeout(()=>itemView(id),300)})}

function storesPick(j){const planned=new Set((j.plan?.consumables||[]).map(c=>normName(c.item)));
  const its=S.items.filter(i=>itemBal(i.id)>0).sort((a,b)=>(planned.has(normName(b.name))-planned.has(normName(a.name)))||(a.cat||"").localeCompare(b.cat||"")||a.name.localeCompare(b.name));
  sheet(`<h3>Issue stores item to ${jno(j)}</h3><p class="meta" style="margin-top:-6px">Ink, lamination film, foil, glue and other material used on this job. Items in the job's plan are listed first.</p>
  <div class="list">${its.map(it=>`<button class="row" data-pick="${it.id}"><div class="row-top"><span class="cust">${esc(itemLabel(it))}<span class="tag">${esc(it.cat||"Other")}</span>${planned.has(normName(it.name))?'<span class="tag party">In plan</span>':""}</span><span class="num">${qtyTxt(itemBal(it.id))} ${esc(it.unit||"")}</span></div></button>`).join("")||'<p class="meta">No stores items in stock. Record the GRN first in Stores.</p>'}</div>
  <div class="btns" style="margin-top:10px"><button class="btn" id="spb">Back</button></div>`);
  $("#spb").onclick=()=>jobView(j.id);
  $("#sheet-body").querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{const it=S.items.find(i=>i.id===b.dataset.pick);it&&issueForm(it,j)})}
function issueForm(it,job){const b=itemBal(it.id);
  const jobs=S.jobs.filter(j=>j.stage<6).sort((a,b)=>b.no-a.no);
  sheet(`<h3>Issue ${esc(itemLabel(it))}</h3><div class="calc">In stock: <b>${qtyTxt(b)} ${esc(it.unit||"")}</b></div>
  ${fields([{row:[{k:"date",label:"Date",type:"date"},{k:"qty",label:`Quantity (${esc(it.unit||"")})`,type:"number"}]},
    {k:"jobId",label:"For job (optional)",type:"select",options:[{v:"",t:"General use, no job"},...jobs.map(j=>({v:j.id,t:jno(j)+" "+(j.customer||"")+": "+jobDesc(j)}))]},
    {row:[{k:"machine",label:"Machine",type:"select",options:machOpts("")},{k:"to",label:"Issued to"}]},
    {k:"note",label:"Note"}],{date:today(),jobId:job?job.id:""})}
  <div class="btns"><button class="btn" id="ib">Back</button><button class="btn primary" id="save">Save issue</button></div>`);
  $("#ib").onclick=()=>job?storesPick(job):itemView(it.id);
  $("#save").onclick=async e=>{const f=read();const qn=+f.qty;if(!(qn>0)){toast("Enter the quantity issued.");return}
    if(qn>itemBal(it.id)+1e-9){toast(`Only ${qtyTxt(itemBal(it.id))} ${it.unit||""} in stock. Record the GRN first.`);return}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;const j=S.jobs.find(x=>x.id===f.jobId);
    try{await put("siss",{itemId:it.id,name:itemLabel(it),date:f.date||today(),qty:qn,jobId:f.jobId,jobNo:j?jno(j):"",machine:f.machine,to:f.to,note:f.note,at:Date.now()})}catch(x){btn.disabled=false;return}
    toast(`${qtyTxt(qn)} ${it.unit||""} issued`);setTimeout(()=>job?jobView(job.id):itemView(it.id),300)}}

function itemForm(it={}){const used=it.id&&(S.siss.some(x=>x.itemId===it.id)||S.grn.some(g=>(g.lines||[]).some(l=>l.itemId===it.id)));
  sheet(`<h3>${it.id?"Edit product":"Add product"}</h3>${catList()}<datalist id="ifn">${itemNamesFor(it.cat)}</datalist>
  ${fields([{k:"cat",label:"1. Category",list:"catlist",ph:"e.g. Ink, Lamination film"},{k:"name",label:"2. Product",list:"ifn",ph:"e.g. Ink black, BOPP film"},
    {row:[{k:"size",label:"Size",ph:"e.g. 20×30"},{k:"sunit",label:"Size in",type:"select",options:SZU.map(t=>({v:t,t}))},{k:"micron",label:"Microns",type:"number",ph:"If any"}]},
    {row:[{k:"unit",label:"Unit",type:"select",options:LS.SUNITS.map(t=>({v:t,t}))},{k:"opening",label:"Opening stock",type:"number"},{k:"min",label:"Alert below",type:"number"}]},
    ...(isAdm()?[{k:"rate",label:"Rate ₹ per unit (until the first GRN)",type:"number"}]:[]),{k:"loc",label:"Kept at",ph:"e.g. Ink room, rack 2"}],{unit:"kg",sunit:"in",...it})}
  <div class="btns"><button class="btn" id="ib">${it.id?"Back":"Cancel"}</button>${it.id&&!used?'<button class="btn danger" id="del">Delete</button>':""}<button class="btn primary" id="save">Save product</button></div>`);
  $('[name="cat"]').onchange=e=>{$("#ifn").innerHTML=itemNamesFor(e.target.value.trim())};
  $("#ib").onclick=()=>it.id?itemView(it.id):closeSheet();
  $("#del")&&($("#del").onclick=e=>armDelete(e.target,()=>remove("items",it.id)));
  $("#save").onclick=async e=>{const v=read();if(!v.cat){toast("Choose the category.");return}if(!v.name){toast("Add the product name.");return}
    v.micron=+v.micron||"";if(!v.size)v.sunit="";
    if(S.items.some(x=>x.id!==it.id&&itemKey(x)===itemKey(v))){toast("This product with the same size and microns already exists.");return}
    const rec={...it,...v,opening:+v.opening||0};
    if(it.id&&itemBal(it.id)-(+it.opening||0)+rec.opening< -1e-9){toast("Opening stock is too low for what's already issued.");return}
    const btn=e.target;if(btn.disabled)return;btn.disabled=true;
    let id;try{id=await put("items",rec)}catch(x){btn.disabled=false;return}
    toast("Product saved");it.id?setTimeout(()=>itemView(it.id),300):closeSheet()}}

/* ---------- data capacity & archive ---------- */
const CAP=5000;
function usage(){const live=S.jobs.length+S.customers.length+S.paper.length+S.machines.length+S.workers.length+S.locs.length+S.movesOld.length+S.items.length+S.grn.length+S.siss.length+S.ptypes.length+S.plates.length+S.punches.length+S.so.length+S.settings.length;
  const pins=S.paper.filter(p=>p.pin).length,mvDocs=Object.keys(MV).length,arc=ARCN;
  return{used:live+pins+mvDocs+arc+2,live,pins,mvDocs,arc}}
let ARC=null,ARCN=0,arcLoading=false;
async function loadArc(force){if(!db){ARC={jobs:[],paper:[]};return}if(arcLoading||(ARC&&!force))return;arcLoading=true;
  try{const s=await db.collection("arc").get();const a={jobs:[],paper:[],docs:{}};ARCN=s.docs.length;
    s.docs.forEach(d=>{const x=d.data();a.docs[d.id]=x;(a[x.kind]||(a[x.kind]=[])).push(...(x.items||[]))});ARC=a}
  catch(e){ARC=ARC||{jobs:[],paper:[]}}finally{arcLoading=false}render()}
const daysAgo=n=>{const d=new Date(today()+"T00:00");d.setDate(d.getDate()-n);return isoL(d)};
function arcCandidates(){const cut=daysAgo(60);
  const jobs=S.jobs.filter(j=>j.stage===6&&(j.dispatched||"9999")<cut);
  const linked=new Set(S.jobs.filter(j=>j.stage<6).map(j=>j.paperId));
  const paper=S.paper.filter(p=>balance(p.id)<=0&&!linked.has(p.id)&&!S.moves.some(m=>m.paperId===p.id&&(m.date||"")>=cut)&&(p.inDate||"")<cut);
  return{jobs,paper,moves:S.movesOld}}
async function arcAppend(kind,items){if(!items.length)return;await loadArc(true);
  const mine=Object.entries(ARC.docs||{}).filter(([,x])=>x.kind===kind).sort(([a],[b])=>a.localeCompare(b));
  let n=mine.length,[cid,cur]=mine.length?mine[mine.length-1]:[null,null];let buf=cur?[...(cur.items||[])]:[];
  if(!cid){n=1;cid=kind+"-"+String(n).padStart(3,"0")}
  for(const it of items){if(JSON.stringify(buf).length+JSON.stringify(it).length>200000){await db.collection("arc").doc(cid).set({kind,items:buf});n++;cid=kind+"-"+String(n).padStart(3,"0");buf=[]}buf.push(it)}
  await db.collection("arc").doc(cid).set({kind,items:buf})}
async function runArchive(btn){btn.disabled=true;btn.textContent="Archiving…";const c=arcCandidates();
  try{await withLease(db.doc("meta/archiveLock"),meId||"me",async()=>{
    if(c.moves.length){await putMoves(c.moves);for(const m of c.moves)await db.collection("moves").doc(m.id).delete()}
    if(c.jobs.length){await arcAppend("jobs",c.jobs);for(const j of c.jobs)await db.collection("jobs").doc(j.id).delete()}
    if(c.paper.length){await arcAppend("paper",c.paper);for(const p of c.paper){await db.collection("paper").doc(p.id).delete();await releasePin(p.pin,p.id)}}});
    toast("Archive done");await loadArc(true)}catch(e){toast(e.code==="busy"?"Someone else is archiving. Try again shortly.":"Archive stopped part-way. Run it again to finish.")}
  dataView()}
function dataView(){if(!ARC)loadArc();const u=usage(),c=arcCandidates();
  sheet(`<h3>Data &amp; archive</h3>
  <p style="margin:0">Records used: <b class="num">${fmtN(u.used)}</b> of ${fmtN(CAP)}</p><div class="meter"><span style="width:${Math.min(100,u.used/CAP*100)}%"></span></div>
  <p class="meta">Jobs ${fmtN(S.jobs.length)}, paper ${fmtN(S.paper.length)} (+ ${fmtN(u.pins)} PIN records), customers ${fmtN(S.customers.length)}, stores items ${fmtN(S.items.length)}, GRNs ${fmtN(S.grn.length)}, stores issues ${fmtN(S.siss.length)}, movement files ${fmtN(u.mvDocs)}, archive files ${fmtN(u.arc)}. Paper issues and returns are stored in monthly files, so they take very little space.</p>
  <div class="sec"><h4>Ready to archive</h4>
  <p class="meta" style="margin:2px 0">Jobs dispatched more than 60 days ago: <b>${fmtN(c.jobs.length)}</b></p>
  <p class="meta" style="margin:2px 0">Used-up paper with no movement for 60 days: <b>${fmtN(c.paper.length)}</b></p>
  ${c.moves.length?`<p class="meta" style="margin:2px 0">Older paper movements to compact: <b>${fmtN(c.moves.length)}</b></p>`:""}
  <p class="meta">Archived records leave the day-to-day lists but stay in Reports.</p></div>
  <div class="btns"><button class="btn" onclick="closeSheet()">Close</button>${c.jobs.length+c.paper.length+c.moves.length?`<button class="btn primary" id="arcgo">Archive now</button>`:""}</div>`);
  $("#arcgo")&&($("#arcgo").onclick=e=>runArchive(e.target))}

/* ---------- reports ---------- */
const fmtDY=d=>d?new Date(d+"T00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"";
const monthStart=()=>today().slice(0,8)+"01";
let REP={type:"allstock",from:monthStart(),to:today()};
const REPORTS=[["monthly","Monthly business summary"],["party","Party-wise business (ranking)"],["partymonth","Party-wise month by month"],["so","Sales order register"],["allstock","Complete stock: paper, stores, plates"],["jobmat","Material used per job"],["stock","Paper stock register"],["inward","Paper inward register"],["issue","Paper issue & return register"],["jobpaper","Paper used per job"],["jobs","Job register"],["pending","Pending jobs"],["dispatch","Dispatch register"],["worker","Job worker register"],["plates","Plate inward register"],["sstock","Stores stock (consumables & RM)"],["sgrn","Stores GRN register"],["sissue","Stores issue register"]];
const ASON=t=>t==="stock"||t==="sstock"||t==="allstock";
const RANGELESS=["pending"];
const monthsIn=(a,b)=>{const out=[];let[y,m]=a.slice(0,7).split("-").map(Number);const[ey,em]=b.slice(0,7).split("-").map(Number);while((y<ey||(y===ey&&m<=em))&&out.length<36){out.push(y+"-"+String(m).padStart(2,"0"));m++;if(m>12){m=1;y++}}return out};
const monTxt=k=>new Date(k+"-01T00:00").toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
const jVal=j=>(+j.qty||0)*(+j.rate||0);
function repData(){const {type,from,to}=REP;const inR=d=>!!d&&d>=from&&d<=to;
  const allJ=[...S.jobs,...(ARC?.jobs||[])],allP=[...S.paper,...(ARC?.paper||[])];
  const P=new Map(allP.map(p=>[p.id,p])),J=new Map(allJ.map(j=>[j.id,j]));
  const N=v=>v===""||v==null?"":{n:+v||0},owner=p=>p.supply==="party"?(p.party||"Party"):OWN;
  const shOf=(m)=>{const p=P.get(m.paperId);return p?sheetsOf(p,Math.abs(+m.qty||0)):null};
  if(type==="stock"){const rows=[];let kg=0;
    for(const p of allP){if((p.inDate||"")>to)continue;const mv=S.moves.filter(m=>m.paperId===p.id&&(m.date||"")<=to);
      const iss=-mv.filter(m=>m.qty<0).reduce((a,m)=>a+(+m.qty||0),0),ret=mv.filter(m=>m.qty>0).reduce((a,m)=>a+(+m.qty||0),0),bal=(+p.opening||0)-iss+ret;
      if(Math.abs(bal)<1e-9)continue;const k=kgOf(p,bal)||0;kg+=k;
      rows.push([p.pin||"",p.name||"",p.gsm||"",sizeTxt(p),owner(p),locTxt(p),fmtDY(p.inDate),N(p.opening),N(iss),N(ret),N(bal),p.unit||"sheets",N(Math.round(k))])}
    rows.sort((a,b)=>String(a[0]).localeCompare(String(b[0]),undefined,{numeric:true}));
    return{title:`Paper stock as on ${fmtDY(to)}`,cols:["PIN","Paper","GSM","Size","Owned by","Stored at","Inward date","Inward","Issued","Returned","Balance","Unit","≈ Kg"],rows,tot:{12:Math.round(kg)}}}
  if(type==="inward"){const rows=allP.filter(p=>inR(p.inDate)).sort((a,b)=>(a.inDate||"").localeCompare(b.inDate||"")||String(a.pin).localeCompare(String(b.pin),undefined,{numeric:true}))
      .map(p=>[fmtDY(p.inDate),p.pin||"",p.name||"",p.gsm||"",sizeTxt(p),owner(p),N(p.opening),p.unit||"sheets",p.packing||"",p.bill||"",isPending(p)?"Pending":"Verified"]);
    return{title:"Paper inward register",cols:["Date","PIN","Paper","GSM","Size","Owned by","Qty","Unit","Packing","Bill / challan","Verification"],rows}}
  if(type==="issue"){let si=0,sr=0;const rows=S.moves.filter(m=>inR(m.date)).sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.at||0)-(b.at||0)).map(m=>{const p=P.get(m.paperId)||{};const j=J.get(m.jobId);const sh=shOf(m);
      if(m.qty<0)si+=sh||0;else sr+=sh||0;
      return[fmtDY(m.date),p.pin||m.pin||"",p.name||"",m.qty<0?"Issued":"Returned",N(Math.abs(m.qty)),p.unit||"sheets",N(sh!=null?Math.round(sh):""),m.jobNo||(j?jno(j):""),j?.customer||"",m.note||""]});
    return{title:"Paper issue & return register",cols:["Date","PIN","Paper","Type","Qty","Unit","Sheets","Job","Customer","Note"],rows,foot:`Issued ${fmtN(Math.round(si))} sheets, returned ${fmtN(Math.round(sr))} sheets, net ${fmtN(Math.round(si-sr))} sheets`}}
  if(type==="jobpaper"){const ids=new Set(S.moves.filter(m=>m.jobId&&inR(m.date)).map(m=>m.jobId));
    const rows=[...ids].map(id=>J.get(id)).filter(Boolean).sort((a,b)=>a.no-b.no).map(j=>{let sh=0;for(const m of S.moves.filter(m=>m.jobId===j.id)){const v=shOf(m);sh+=(m.qty<0?1:-1)*(v||0)}
      const need=+j.plan?.fullSheets||0;return[jno(j),j.customer||"",j.ptype||"",j.item||"",N(j.qty),N(need||""),N(Math.round(sh)),N(need?Math.round(sh-need):""),STAGES[j.stage]||""]});
    return{title:"Paper used per job",cols:["Job","Customer","Item","Job name","Qty (pcs)","Planned sheets","Issued sheets (net)","Excess (+) / short (−)","Stage"],rows}}
  if(type==="jobs"){let v=0;const rows=allJ.filter(j=>inR(j.created)).sort((a,b)=>a.no-b.no).map(j=>{const val=(+j.qty||0)*(+j.rate||0);v+=val;return[jno(j),fmtDY(j.created),j.customer||"",j.ptype||"",j.item||"",N(j.qty),STAGES[j.stage]||"",fmtDY(j.due),N(val?Math.round(val):"")]});
    return{title:"Job register",cols:["Job","Created","Customer","Item","Job name","Qty (pcs)","Stage","Delivery","Value ₹"],rows,tot:{8:Math.round(v)}}}
  if(type==="pending"){const rows=S.jobs.filter(j=>j.stage<6).sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999")).map(j=>{const late=j.due&&j.due<today()?Math.round((new Date(today())-new Date(j.due))/864e5):"";
      return[jno(j),j.customer||"",j.ptype||"",j.item||"",N(j.qty),STAGES[j.stage],stageExtra(j)||"",fmtDY(j.due),N(late)]});
    return{title:`Pending jobs as on ${fmtDY(today())}`,cols:["Job","Customer","Item","Job name","Qty (pcs)","Stage","Progress","Delivery","Days late"],rows}}
  if(type==="dispatch"){let q=0;const rows=[];for(const j of allJ)for(const e of j.disp||[])if(inR(e.d)){q+=+e.q||0;rows.push([dcNo(e.no),fmtDY(e.d),jno(j),j.customer||"",j.ptype||"",j.item||"",N(e.q),e.pk||"",e.veh||"",e.tr||""])}
    rows.sort((a,b)=>a[0].localeCompare(b[0]));return{title:"Dispatch register",cols:["Challan","Date","Job","Customer","Item","Job name","Qty (pcs)","Packages","Vehicle","Transport"],rows,tot:{6:q}}}
  if(type==="worker"){const rows=[];for(const j of allJ){const st=j.plan?.fab||[];for(const e of j.fabDone||[]){const f=st[e.i];if(!f||f.mode!=="Outsource"||!inR(e.d))continue;
      rows.push([fmtDY(e.d),jno(j),f.worker||"",f.process||"",f.details||"",N(e.q),f.rate==="TBD"?"TBD":f.rate?N(f.rate):"",f.rate&&f.rate!=="TBD"?f.runit||"":""])}}
    rows.sort((a,b)=>String(a[2]).localeCompare(String(b[2]))||0);
    return{title:"Job worker register (outsourced steps received back)",cols:["Received","Job","Job worker","Process","Specs","Qty","Rate ₹","Per"],rows}}
  if(type==="so"){let tv=0;const rows=[];for(const o of [...S.so].filter(o=>inR(o.date)).sort((a,b)=>(a.no||0)-(b.no||0)))soLines(o).forEach((l,i)=>{const a=soLineAmt(l),t=a*(1+(+l.gst||0)/100);if(!soDead(o))tv+=t;const j=soJob(l);
      rows.push([soNo(o),fmtDY(o.date),o.customer||"",o.po||"",l.ptype||"",l.item||"",N(l.qty),N(l.rate||""),N(Math.round(t)),fmtDY(o.due),soStat(o)])});
    return{title:"Sales order register",cols:["SO","Date","Party","Party PO","Item","Job name","Qty (pcs)","Rate ₹","Value incl. GST ₹","Delivery","Status"],rows,tot:{8:Math.round(tv)},foot:"Cancelled orders are listed but not counted in the total."}}
  if(type==="plates"){let tq=0,ts=0;const rows=S.plates.filter(p=>inR(p.date)).sort((a,b)=>(a.date||"").localeCompare(b.date||"")||String(a.pno).localeCompare(String(b.pno),undefined,{numeric:true})).map(p=>{tq+=+p.qty||0;ts+=plSets(p);
      return[fmtDY(p.date),p.pno||"",p.vendor||"",p.ref||"",p.size||"",p.type||"",plSetTxt(p),N(plSets(p)||""),N(p.qty),p.bill||"",plJobs(p.id).map(jno).join(", ")]});
    return{title:"Plate inward register",cols:["Date","Plate no.","Vendor","For job / title","Size","Type","Sets","Total sets","Total plates","Challan / bill","Used in jobs"],rows,tot:{7:ts,8:tq}}}
  if(type==="sstock"){let v=0;const rows=[...S.items].sort((a,b)=>(a.cat||"").localeCompare(b.cat||"")||a.name.localeCompare(b.name)).map(it=>{const i=itemIn(it.id,to),o=itemOut(it.id,to),b=(+it.opening||0)+i-o,r=lastRate(it.id),val=Math.max(0,b)*r;v+=val;
      return[itemLabel(it),it.cat||"",it.unit||"",N(+it.opening||0),N(i),N(o),N(Math.round(b*1000)/1000),N(r||""),N(val?Math.round(val):"")]});
    return{title:`Stores stock as on ${fmtDY(to)}`,cols:["Item","Category","Unit","Opening","Received","Issued","Balance","Last rate ₹","Value ₹"],rows,tot:{8:Math.round(v)}}}
  if(type==="sgrn"){let tx=0,tt=0;const rows=[];for(const g of [...S.grn].filter(g=>inR(g.date)).sort((a,b)=>(a.date||"").localeCompare(b.date||"")||a.no-b.no))for(const l of g.lines||[]){const a=lineTax(l),t=a*(1+(+l.gst||0)/100);tx+=a;tt+=t;
      rows.push([fmtDY(g.date),grnNo(g),g.supplier||"",g.bill||"",itemLabel(l)||"",l.cat||"",N(l.qty),N(+l.rej||""),N(accQ(l)),l.unit||"",N(l.rate||""),(+l.gst||0)+"%",N(Math.round(a)),N(Math.round(t))])}
    return{title:"Stores GRN register (consumables & raw material)",cols:["Date","GRN","Supplier","Bill / challan","Item","Category","Received","Rejected","Accepted","Unit","Rate ₹","GST","Taxable ₹","Total ₹"],rows,tot:{12:Math.round(tx),13:Math.round(tt)}}}
  if(type==="sissue"){const rows=S.siss.filter(x=>inR(x.date)).sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.at||0)-(b.at||0)).map(x=>{const it=S.items.find(i=>i.id===x.itemId)||{};const j=J.get(x.jobId);
      return[fmtDY(x.date),(it.name?itemLabel(it):x.name||""),it.cat||"",N(x.qty),it.unit||"",j?jno(j):x.jobNo||"",j?.customer||"",machName(x.machine),x.to||"",x.note||""]});
    return{title:"Stores issue register",cols:["Date","Item","Category","Qty","Unit","Job","Customer","Machine","Issued to","Note"],rows}}
  if(type==="monthly"){const ms=monthsIn(from,to);const T=[0,0,0,0,0,0,0,0];
    const rows=ms.map(mk=>{const inM=d=>!!d&&d.startsWith(mk)&&inR(d);
      const cr=allJ.filter(j=>inM(j.created)),dn=allJ.filter(j=>j.stage===6&&inM(j.dispatched));let dq=0,dv=0;
      for(const j of allJ)for(const e of j.disp||[])if(inM(e.d)){dq+=+e.q||0;dv+=(+e.q||0)*(+j.rate||0)}
      const cv=cr.reduce((a,j)=>a+jVal(j),0),pc=new Set(cr.map(j=>normName(j.customer))).size,sov=S.so.filter(o=>!soDead(o)&&inM(o.date)).reduce((a,o)=>a+soTot(o).total,0);
      [cr.length,cv,pc,dn.length,dq,dv,sov].forEach((v,i)=>T[i]+=v);
      return[monTxt(mk),N(cr.length),N(Math.round(cv)),N(pc),N(dn.length),N(dq),N(Math.round(dv)),N(Math.round(sov))]});
    return{title:"Monthly business summary",cols:["Month","Jobs received","Job value ₹","Parties","Jobs completed","Pcs dispatched","Dispatched value ₹","Sales orders incl. GST ₹"],rows,
      tot:{1:T[0],2:Math.round(T[1]),4:T[3],5:T[4],6:Math.round(T[5]),7:Math.round(T[6])},foot:"Jobs received = job sheets created in the month. Job value = quantity × rate per piece (before GST). Jobs completed = closed as Dispatched."}}
  if(type==="party"){const M=new Map();const g=c=>{const k=normName(c)||"-";if(!M.has(k))M.set(k,{name:String(c||"").trim()||"(no party)",jobs:0,qty:0,val:0,done:0,dq:0,dv:0,last:""});return M.get(k)};
    for(const j of allJ){if(inR(j.created)){const x=g(j.customer);x.jobs++;x.qty+=+j.qty||0;x.val+=jVal(j);if((j.created||"")>x.last)x.last=j.created}
      const dv=(j.disp||[]).filter(e=>inR(e.d));if(dv.length||(j.stage===6&&inR(j.dispatched))){const x=g(j.customer);const q=sumQ(dv);x.dq+=q;x.dv+=q*(+j.rate||0);if(j.stage===6&&inR(j.dispatched))x.done++}}
    const list=[...M.values()].sort((a,b)=>b.val-a.val||b.dv-a.dv||b.jobs-a.jobs);const tv=list.reduce((a,x)=>a+x.val,0);
    const rows=list.map((x,i)=>[N(i+1),x.name,N(x.jobs),N(x.qty),N(Math.round(x.val)),tv?(Math.round(x.val/tv*1000)/10)+"%":"",N(x.jobs?Math.round(x.val/x.jobs):""),N(x.done),N(x.dq),N(Math.round(x.dv)),fmtDY(x.last)]);
    return{title:"Party-wise business",cols:["Rank","Party","Jobs received","Qty (pcs)","Job value ₹","Share of value","Avg job value ₹","Jobs completed","Pcs dispatched","Dispatched value ₹","Last job"],rows,
      tot:{2:list.reduce((a,x)=>a+x.jobs,0),3:list.reduce((a,x)=>a+x.qty,0),4:Math.round(tv),7:list.reduce((a,x)=>a+x.done,0),8:list.reduce((a,x)=>a+x.dq,0),9:Math.round(list.reduce((a,x)=>a+x.dv,0))},
      foot:"Parties ranked by value of jobs received in the period (quantity × rate, before GST)."}}
  if(type==="partymonth"){const ms=monthsIn(from,to);const M=new Map();
    for(const j of allJ){if(!inR(j.created))continue;const k=normName(j.customer)||"-";if(!M.has(k))M.set(k,{name:String(j.customer||"").trim()||"(no party)",m:{},n:0,t:0});const x=M.get(k),mk=j.created.slice(0,7);x.m[mk]=(x.m[mk]||0)+jVal(j);x.t+=jVal(j);x.n++}
    const list=[...M.values()].sort((a,b)=>b.t-a.t);const tot={};ms.forEach((mk,i)=>tot[i+1]=Math.round(list.reduce((a,x)=>a+(x.m[mk]||0),0)));tot[ms.length+1]=list.reduce((a,x)=>a+x.n,0);tot[ms.length+2]=Math.round(list.reduce((a,x)=>a+x.t,0));
    const rows=list.map(x=>[x.name,...ms.map(mk=>x.m[mk]?{n:Math.round(x.m[mk])}:{n:0}),N(x.n),N(Math.round(x.t))]);
    return{title:"Party-wise job value, month by month",cols:["Party",...ms.map(k=>monTxt(k)+" ₹"),"Jobs","Total ₹"],rows,tot,foot:"Value of job sheets created each month (quantity × rate, before GST). Use This year to see the whole year."}}
  if(type==="jobmat"){const rows=[];let tv=0;const sgn=m=>m.qty<0?1:-1;
    for(const m of S.moves.filter(m=>m.jobId&&inR(m.date))){const p=P.get(m.paperId)||{};const j=J.get(m.jobId);const q=Math.abs(+m.qty||0);const k=p.id?kgOf(p,q):null;
      rows.push([fmtDY(m.date),m.jobNo||(j?jno(j):""),j?.customer||"","Paper"+(m.qty>0?" (returned)":""),[p.pin&&"PIN "+p.pin,p.name,p.gsm&&p.gsm+" gsm",sizeTxt(p)].filter(Boolean).join(", "),N(sgn(m)*q),p.unit||"sheets",N(k!=null?Math.round(sgn(m)*k*10)/10:""),"",m.date||""])}
    for(const x of S.siss.filter(x=>x.jobId&&inR(x.date))){const it=S.items.find(i=>i.id===x.itemId)||{};const j=J.get(x.jobId);const v=(+x.qty||0)*lastRate(x.itemId);tv+=v;
      rows.push([fmtDY(x.date),j?jno(j):x.jobNo||"",j?.customer||"",it.cat||"Stores",(it.name?itemLabel(it):x.name||""),N(+x.qty||0),it.unit||"",it.unit==="kg"?N(+x.qty||0):"",N(v?Math.round(v):""),x.date||""])}
    for(const j of allJ){const pd=j.plan?.planned;if(!pd||!inR(pd))continue;for(const pid of j.plan?.plates?.ids||[]){const pl=S.plates.find(x=>x.id===pid);if(!pl)continue;
      rows.push([fmtDY(pd),jno(j),j.customer||"","Plates",[pl.pno,pl.ref,plSetTxt(pl)].filter(Boolean).join(", "),N(+pl.qty||0),"plates","","",pd])}}
    rows.sort((a,b)=>String(a[1]).localeCompare(String(b[1]),undefined,{numeric:true})||String(a[9]).localeCompare(String(b[9])));rows.forEach(r=>r.pop());
    return{title:"Material used per job",cols:["Date","Job","Party","Material","Item","Qty","Unit","≈ Kg","Value ₹ (stores, last rate)"],rows,tot:{8:Math.round(tv)},foot:"Paper issued to jobs (returns shown as minus), stores items issued to jobs, and plates selected in each job's plan."}}
  if(type==="allstock"){const rows=[];let skg=0,sv=0;const G=new Map();
    for(const p of allP){if((p.inDate||"")>to)continue;const mv=S.moves.filter(m=>m.paperId===p.id&&(m.date||"")<=to);const bal=(+p.opening||0)+mv.reduce((a,m)=>a+(+m.qty||0),0);if(Math.abs(bal)<1e-9)continue;
      const key=[owner(p),p.name,p.gsm,sizeTxt(p),p.unit||"sheets"].join("|");if(!G.has(key))G.set(key,{p,bal:0,kg:0,pins:[]});const x=G.get(key);x.bal+=bal;x.kg+=kgOf(p,bal)||0;x.pins.push(p.pin)}
    for(const x of [...G.values()].sort((a,b)=>owner(a.p).localeCompare(owner(b.p))||String(a.p.name).localeCompare(String(b.p.name))||(+a.p.gsm||0)-(+b.p.gsm||0))){skg+=x.kg;
      rows.push([x.p.supply==="party"?"Paper, party: "+(x.p.party||"?"):"Paper, Arihant",x.p.name||"",[x.p.gsm&&x.p.gsm+" gsm",sizeTxt(x.p)].filter(Boolean).join(", ")+" · PIN "+x.pins.filter(Boolean).join(", "),N(Math.round(x.bal*100)/100),x.p.unit||"sheets",N(Math.round(x.kg)),""])}
    for(const it of [...S.items].sort((a,b)=>(a.cat||"").localeCompare(b.cat||"")||a.name.localeCompare(b.name))){const b=(+it.opening||0)+itemIn(it.id,to)-itemOut(it.id,to);if(Math.abs(b)<1e-9)continue;const v=Math.max(0,b)*lastRate(it.id);sv+=v;
      rows.push([it.cat||"Stores",itemLabel(it),it.loc?"Kept at "+it.loc:"",N(Math.round(b*1000)/1000),it.unit||"",it.unit==="kg"?N(Math.round(b)):"",N(v?Math.round(v):"")])}
    for(const pl of S.plates.filter(p=>(p.date||"")<=to&&!plJobs(p.id).length))rows.push(["Plates (not used in a job yet)",pl.pno,[pl.ref,pl.vendor,plSetTxt(pl),pl.loc&&"Kept at "+pl.loc].filter(Boolean).join(" · "),N(+pl.qty||0),"plates","",""]);
    return{title:`Complete stock as on ${fmtDY(to)}`,cols:["Material","Item","Details","Balance","Unit","≈ Kg","Value ₹ (stores, last rate)"],rows,tot:{5:Math.round(skg),6:Math.round(sv)},foot:"Paper is grouped by owner, type, GSM and size. Stores covers ink, lamination film, chemicals, foil, glue, spares and other raw material. The Kg total is paper only. Paper value isn't tracked."}}
  return{title:"",cols:[],rows:[]}}
function repTable(r){const num=r.cols.map((_,i)=>r.rows.some(row=>row[i]&&typeof row[i]==="object"));
  return `<table class="rt t"><tr>${r.cols.map((c,i)=>`<th class="${num[i]?"n":""}">${esc(c)}</th>`).join("")}</tr>
  ${r.rows.map(row=>`<tr>${row.map((c,i)=>`<td class="${num[i]?"n":""}">${esc(c&&typeof c==="object"?fmtN(c.n):c??"")}</td>`).join("")}</tr>`).join("")}
  ${r.tot?`<tr class="tot">${r.cols.map((_,i)=>`<td class="${num[i]?"n":""}">${i===0?"Total":r.tot[i]!=null?fmtN(r.tot[i]):""}</td>`).join("")}</tr>`:""}</table>`}
const repList=()=>isAcc()?REPORTS.filter(([k])=>["monthly","party","partymonth","so","jobs","pending","dispatch"].includes(k)):REPORTS;
function renderReports(){if(!ARC)loadArc();if(!repList().some(([k])=>k===REP.type))REP.type=repList()[0][0];const r=repData();const rl=RANGELESS.includes(REP.type);
  return `<h2 style="margin-top:6px">Reports</h2>
  <label>Report<select id="rtype">${repList().map(([k,t])=>`<option value="${k}"${k===REP.type?" selected":""}>${t}</option>`).join("")}</select></label>
  ${rl?"":`<div class="two">${ASON(REP.type)?`<label>As on<input type="date" id="rto" value="${REP.to}"></label>`:`<label>From<input type="date" id="rfrom" value="${REP.from}"></label><label>To<input type="date" id="rto" value="${REP.to}"></label>`}</div>`}
  <div class="chips">${rl?"":[["This month",monthStart(),today()],["Last 7 days",daysAgo(6),today()],["Last month",(()=>{const d=new Date(monthStart()+"T00:00");d.setMonth(d.getMonth()-1);return isoL(d).slice(0,8)+"01"})(),daysAgo(+today().slice(8,10))],["This year",today().slice(0,4)+"-04-01"<=today()?today().slice(0,4)+"-04-01":(+today().slice(0,4)-1)+"-04-01",today()]].map(([t,a,b])=>`<button class="chip" data-rr="${a}|${b}" aria-pressed="${REP.from===a&&REP.to===b}">${t}</button>`).join("")}</div>
  <p class="meta" style="margin:8px 0 0"><b>${esc(r.title)}</b> · ${fmtN(r.rows.length)} rows${db&&!ARC?" · loading archive…":ARC&&(ARC.jobs.length||ARC.paper.length)?" · includes archived records":""}</p>
  ${r.foot?`<p class="meta" style="margin:2px 0 0">${esc(r.foot)}</p>`:""}
  <div class="btns" style="margin-top:8px"><button class="btn" id="rprint">Print / PDF</button><button class="btn primary" id="rcsv">Download for Excel</button></div>
  <div class="rwrap">${r.rows.length?repTable(r):`<p class="meta" style="padding:10px">Nothing in this period.</p>`}</div>`}
function wireReports(){const t=$("#rtype");t.onchange=()=>{REP.type=t.value;if(ASON(REP.type))REP.to=today();render()};
  const fr=$("#rfrom"),to=$("#rto");fr&&(fr.onchange=()=>{REP.from=fr.value||monthStart();render()});to&&(to.onchange=()=>{REP.to=to.value||today();render()});
  document.querySelectorAll("[data-rr]").forEach(b=>b.onclick=()=>{const[a,c]=b.dataset.rr.split("|");REP.from=a;REP.to=c;render()});
  const per=()=>RANGELESS.includes(REP.type)||ASON(REP.type)?"":` ${fmtDY(REP.from)} to ${fmtDY(REP.to)}`;
  $("#rprint").onclick=()=>{const r=repData();showPrint(`${r.title}${per()}`,`<div class="hd"><div><h1>${OWN}</h1><div>${esc(r.title)}</div></div><div style="text-align:right">${esc(per().trim())}${per()?"<br>":""}Printed ${fmtDY(today())}</div></div>
    <style>.doc .rt{font-size:11px}.doc .rt th,.doc .rt td{white-space:normal;padding:3px 4px}.doc .rt td.n{text-align:right}</style>${repTable(r)}${r.foot?`<p>${esc(r.foot)}</p>`:""}`)};
  $("#rcsv").onclick=async()=>{const r=repData();const q=v=>{const s=String(v??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
    const lines=[[r.title+per()],[],r.cols,...r.rows.map(row=>row.map(c=>c&&typeof c==="object"?c.n:c)),...(r.tot?[r.cols.map((_,i)=>i===0?"Total":r.tot[i]??"")]:[]),...(r.foot?[[],[r.foot]]:[])];
    const csv="\ufeff"+lines.map(l=>l.map(q).join(",")).join("\r\n");
    let dl=null;try{dl=window.claude&&window.claude.use?await window.claude.use("downloads"):null}catch(e){}
    if(!dl){toast("Download isn't available here.");return}
    try{await dl.save({filename:`${REPORTS.find(x=>x[0]===REP.type)[1].replace(/[^A-Za-z0-9]+/g,"-")}-${ASON(REP.type)?REP.to:RANGELESS.includes(REP.type)?today():REP.from+"-to-"+REP.to}.csv`,data:csv})}catch(e){if(e.code!=="declined")toast("Couldn't download the file.")}}}

/* ---------- summary ---------- */
function renderSummary(){
  const act=S.jobs.filter(j=>j.stage<6);
  const late=act.filter(j=>dueClass(j)==="due-late");
  const soon=act.filter(j=>dueClass(j)==="due-soon");
  const low=S.paper.filter(p=>p.min&&balance(p.id)<+p.min);
  const m=today().slice(0,7);const disp=S.jobs.filter(j=>(j.dispatched||"").startsWith(m));
  const pending=act.reduce((a,j)=>a+(+j.qty||0)*(+j.rate||0),0);
  return `<h2>This month</h2>
  <div class="grid"><div class="tile"><div class="n num">${disp.length}</div><div class="l">Jobs dispatched</div></div>
  ${isAdm()?`<div class="tile"><div class="n num">${inr(disp.reduce((a,j)=>a+(+j.qty||0)*(+j.rate||0),0))}</div><div class="l">Dispatched value</div></div>
  <div class="tile"><div class="n num">${inr(pending)}</div><div class="l">Value in progress</div></div>`:""}</div>
  ${(()=>{const d=S.so.filter(o=>(o.status||"draft")==="draft"),p=S.so.filter(soPendingJobs);const row=o=>`<button class="row" data-so="${o.id}"><div class="row-top"><span><span class="jno">${soNo(o)}</span> ${esc(o.customer)}</span><span class="num">${inr(soTot(o).total)}</span></div><div class="meta">${esc(soLines(o).map(l=>[l.ptype,l.item].filter(Boolean).join(": ")).join(", "))}</div></button>`;
    return (d.length?`<h2>Sales orders to approve</h2><div class="list">${d.map(row).join("")}</div>`:"")+(p.length&&isAdm()?`<h2>Approved, send to job sheet</h2><div class="list">${p.map(row).join("")}</div>`:"")})()}
  <h2>Needs planning</h2><div class="list">${act.filter(j=>!j.plan).map(j=>`<button class="row" data-job="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> ${esc(j.customer)}</span><span class="meta">${fmtD(j.due)}</span></div><div class="meta">${esc(jobDesc(j))}</div></button>`).join("")||'<p class="meta">All active jobs are planned.</p>'}</div>
  <h2>Late deliveries</h2><div class="list">${late.map(j=>`<button class="row" data-job="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> ${esc(j.customer)}</span><span class="due-late">${fmtD(j.due)}</span></div><div class="meta">${STAGES[j.stage]}</div></button>`).join("")||'<p class="meta">Nothing late.</p>'}</div>
  ${soon.length?`<h2>Due in 2 days</h2><div class="list">${soon.map(j=>`<button class="row" data-job="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> ${esc(j.customer)}</span><span class="due-soon">${fmtD(j.due)}</span></div><div class="meta">${STAGES[j.stage]}</div></button>`).join("")}</div>`:""}
  ${(()=>{const ex=S.jobs.map(j=>{const p=S.paper.find(x=>x.id===j.paperId);return p?{j,st:paperStatus(j)}:null}).filter(x=>x&&x.st.over);
    return ex.length?`<h2>Excess paper issued</h2><div class="list">${ex.map(({j,st})=>`<button class="row" data-job="${j.id}"><div class="row-top"><span><span class="jno">${jno(j)}</span> ${esc(j.customer)}</span><span class="low">+${fmtN(st.excess)} sheets</span></div><div class="meta">${fmtN(Math.round(st.issSh))} issued, ${fmtN(st.need)} planned</div></button>`).join("")}</div>`:""})()}
  ${(()=>{const pv=S.paper.filter(isPending);return pv.length?`<h2>Paper inward to verify</h2><div class="list">${pv.map(p=>`<button class="row" data-paper="${p.id}"><div class="row-top"><span class="cust">${pinTag(p)}${esc(p.name)}</span><span class="meta">${p.inDate?fmtD(p.inDate):""}</span></div><div class="meta">${esc([supplyTxt(p),fmtN(p.opening)+" "+(p.unit||"sheets")].join(" · "))}</div></button>`).join("")}</div>`:""})()}
  <h2>Low paper stock</h2><div class="list">${low.map(p=>`<button class="row" data-paper="${p.id}"><div class="row-top"><span class="cust">${esc(paperName(p))}</span><span class="bal num low">${fmtN(balance(p.id))}</span></div></button>`).join("")||'<p class="meta">All paper above alert level.</p>'}</div>
  ${S.items.length?`<h2>Low stores stock</h2><div class="list">${S.items.filter(isLowItem).map(it=>`<button class="row" data-item="${it.id}"><div class="row-top"><span class="cust">${esc(it.name)}<span class="tag">${esc(it.cat||"")}</span></span><span class="bal num low">${qtyTxt(itemBal(it.id))} ${esc(it.unit||"")}</span></div></button>`).join("")||'<p class="meta">All stores items above alert level.</p>'}</div>`:""}
  ${canVerify&&db&&usage().used>3500?`<div class="caution" style="margin-top:8px">Storage is ${Math.round(usage().used/50)}% full. Open Data &amp; archive to move old records out.</div>`:""}`}

/* ---------- home ---------- */
function renderHome(){const act=S.jobs.filter(j=>j.stage<6);const late=act.filter(j=>dueClass(j)==="due-late").length;
  const ready=act.filter(j=>j.stage===5&&readyQty(j)>0),readyPcs=ready.reduce((a,j)=>a+readyQty(j),0);
  const draft=S.so.filter(o=>(o.status||"draft")==="draft").length,toSend=S.so.filter(soPendingJobs).length;
  const pv=S.paper.filter(isPending).length,lowP=S.paper.filter(p=>p.min&&balance(p.id)<+p.min).length,lowS=S.items.filter(isLowItem).length;
  const dispM=S.jobs.filter(j=>(j.dispatched||"").startsWith(today().slice(0,7))).length;
  const K=[],k=(n,l,nav,warn)=>K.push(`<button class="kpi${warn?" warn":""}" data-nav="${nav}"><b class="num">${n}</b><span>${l}</span></button>`);
  k(fmtN(act.length),"jobs on the floor","jobs|jobs|active");
  k(fmtN(late),late===1?"delivery late":"deliveries late","jobs|jobs|active",late>0);
  k(fmtN(readyPcs),"pcs ready to dispatch","jobs|jobs|5");
  if(isAdm())k(fmtN(draft),draft===1?"sales order to approve":"sales orders to approve","jobs|so|draft",draft>0);
  if(!isAcc())k(fmtN(pv+lowP+lowS),"paper to verify or low stock","inward|stock",pv+lowP+lowS>0);
  const steps=[];let i=1;const st=(l,v,u,nav,hot)=>steps.push(`<button class="step${hot?" hot":""}" data-nav="${nav}"><span class="n">${String(i++).padStart(2,"0")}</span><span class="l">${l}</span><span class="v num">${v}<small>${u}</small></span></button>`);
  if(isAdm())st("Sales order",fmtN(draft+toSend),"open","jobs|so|open",draft+toSend>0);
  STAGES.slice(0,6).forEach((s,ix)=>{const n=act.filter(j=>j.stage===ix).length;st(s,fmtN(n),n===1?"job":"jobs","jobs|jobs|"+ix,n>0)});
  st("Dispatched",fmtN(dispM),"this month","jobs|jobs|6");
  const Q=[];if(isAdm())Q.push(`<button class="btn primary" data-qa="so">New sales order</button>`);
  if(!isAcc())Q.push(`<button class="btn${isAdm()?"":" primary"}" data-qa="job">New job</button>`,`<button class="btn" data-qa="paper">Paper inward</button>`,`<button class="btn" data-qa="plate">Plate inward</button>`,`<button class="btn" data-qa="grn">Stores GRN</button>`);
  if(ready.length&&!isFac())Q.push(`<button class="btn" data-nav="jobs|jobs|5">Dispatch (${ready.length})</button>`);
  return `<div class="hello"><h2>Today on the floor</h2><span class="meta">${fmtDY(today())}</span></div>
  <div class="kpis">${K.join("")}</div><div class="qa">${Q.join("")}</div>
  <p class="eyebrow">The flow · tap a stage to see its jobs</p><div class="flow">${steps.join("")}</div>
  ${renderSummary()}`}
function renderSetup(){const acct=`<button class="row" id="acctbtn"><div class="row-top"><span class="cust">Logins &amp; passwords</span><span class="meta">${esc((window.__ERP_HOST&&window.__ERP_HOST.userName())||"")}</span></div><div class="meta">${isOwn()?"Add staff logins, reset passwords, sign out":"Change your password or sign out"}</div></button>`;const help=acct+`<button class="row" id="helpbtn"><div class="row-top"><span class="cust">How to use Print Floor</span><span class="meta">${ROLE_TXT[role||"factory"]}</span></div><div class="meta">Step-by-step guide for your role</div></button>`;
  if(isOwn())return `<div class="list">${help}${db?`<button class="row" id="dset"><div class="row-top"><span class="cust">Data &amp; archive</span><span class="meta num">${fmtN(usage().used)} of ${fmtN(CAP)}</span></div><div class="meta">Move old jobs and used-up paper out of the daily lists</div></button>`:""}</div><h2>Masters</h2>${renderMasters()}`;
  if(isAcc())return `<div class="list">${help}</div>`;
  const r=(id,t,m)=>`<button class="row" id="${id}"><div class="row-top"><span class="cust">${t}</span></div><div class="meta">${m}</div></button>`;
  return `<div class="list">${help}${r("mset",`Machines (${S.machines.length})`,"Printing, cutting, lamination and other machines")}${r("wset",`Job workers (${S.workers.length})`,"People you send outsourced work to")}${r("lset","Storage locations","Factory, gala, floor and pillar lists for paper")}</div>`}

/* ---------- shell ---------- */
function render(){
  const main=$("#main");const focused=document.activeElement&&document.activeElement.id==="q";const pos=focused?document.activeElement.selectionStart:0;
  const note=!db&&$("#sync").textContent==="This phone only"?`<div class="note">Saving on this phone only. Open the published link to share live data with your team.</div>`:"";
  applyNav();if(db||role)renderNav();
  main.innerHTML=note+subBar()+(tab==="exp"?KX.html():tab==="jobs"?(jobsMode==="so"&&isAdm()?renderSO():renderJobs()):{masters:renderSetup,entry:renderEntry,stock:renderStock,customers:renderCustomers,summary:renderHome,reports:renderReports,stores:renderStores,plates:renderPlates}[tab]());
  const fab=$("#fab");fab.style.display=tab==="summary"||tab==="reports"?"none":"block";
  tab==="reports"&&wireReports();
  const da=$("#dset");da&&(da.onclick=dataView);
  const ab=$("#acctbtn");ab&&(ab.onclick=()=>window.__ERP_HOST&&window.__ERP_HOST.openAccount());
  fab.textContent={jobs:jobsMode==="so"&&isAdm()?"New sales order":isAcc()?"":"New job",stock:"Paper inward",stores:"New GRN",plates:pmode==="punch"?"Punch inward":"Plate inward",customers:"Add customer"}[tab]||"";
  if(!fab.textContent)fab.style.display="none";
  document.querySelectorAll("[data-ml]").forEach(b=>b.onclick=()=>listEditor(b.dataset.ml));
  document.querySelectorAll("[data-mv]").forEach(b=>b.onclick=()=>({mach:machinesView,wk:workersView,loc:locsView,co:companyForm}[b.dataset.mv])());
  const ai=$("#additem");ai&&(ai.onclick=()=>itemForm(storeCat&&!q?{cat:storeCat}:{}));
  document.querySelectorAll("[data-scat]").forEach(b=>b.onclick=()=>{storeCat=b.dataset.scat;render();window.scrollTo(0,0)});
  const sb=$("#scback");sb&&(sb.onclick=()=>{storeCat="";render()});
  const ms=$("#mset");ms&&(ms.onclick=machinesView);
  const ws=$("#wset");ws&&(ws.onclick=workersView);
  const ls=$("#lset");ls&&(ls.onclick=locsView);
  const cs=$("#coset");cs&&(cs.onclick=companyForm);
  const hb=$("#helpbtn");hb&&(hb.onclick=helpView);
  const qi=$("#q");if(qi){qi.oninput=e=>{q=e.target.value;render()};if(focused){qi.focus();qi.setSelectionRange(pos,pos)}}
  // refresh an open sheet's view when data changes elsewhere
}
document.addEventListener("click",e=>{
  if(e.target.closest("#sheetwrap")&&e.target.closest("[data-mach]")){const m=S.machines.find(x=>x.id===e.target.closest("[data-mach]").dataset.mach);m&&machForm(m);return}
  const t=e.target.closest("[data-pm],[data-punch],[data-js],[data-jsf],[data-job],[data-paper],[data-cust],[data-f],[data-sf],[data-sv],[data-item],[data-grn],[data-plate],[data-so],[data-sof],[data-jm],[data-go],[data-tab]");if(!t)return;
  if(t.dataset.js){jsEntry(t.dataset.js);return}
  if(t.dataset.jsf){jsFilter=t.dataset.jsf;render();return}
  if(t.dataset.sf){stockFilter=t.dataset.sf;render();return}
  if(t.dataset.sv){storeView=t.dataset.sv;storeCat="";q="";render();return}
  if(t.dataset.item){itemView(t.dataset.item);return}
  if(t.dataset.grn){grnView(t.dataset.grn);return}
  if(t.dataset.plate){plateView(t.dataset.plate);return}
  if(t.dataset.punch){punchView(t.dataset.punch);return}
  if(t.dataset.pm){pmode=t.dataset.pm;q="";render();return}
  if(t.dataset.so){soView(t.dataset.so);return}
  if(t.dataset.sof){soFilter=t.dataset.sof;render();return}
  if(t.dataset.jm){jobsMode=t.dataset.jm;q="";render();return}
  if(t.dataset.job)jobView(t.dataset.job);
  else if(t.dataset.paper)paperView(t.dataset.paper);
  else if(t.dataset.cust)custView(t.dataset.cust);
  else if(t.dataset.f){filter=t.dataset.f;render()}
  else if(t.dataset.go){navTop="jobs";sub.jobs="jobs";filter=t.dataset.go;q="";setTab()}});
document.addEventListener("click",e=>{const n=e.target.closest("[data-top],[data-sub],[data-nav],[data-qa]");if(!n)return;
  if(n.dataset.top){navTop=n.dataset.top;q="";setTab();return}
  if(n.dataset.sub){sub[navTop]=n.dataset.sub;q="";storeCat="";setTab();return}
  if(n.dataset.nav){const[t,v,x]=n.dataset.nav.split("|");closeSheet();navTop=t;if(v)sub[t]=v;q="";
    if(x&&t==="jobs"&&v==="jobs")filter=x;if(x&&v==="so")soFilter=x;setTab();return}
  if(n.dataset.qa)({so:()=>soForm(),job:()=>jobForm(),paper:()=>paperForm(),plate:()=>plateForm(),grn:()=>grnForm()}[n.dataset.qa]||(()=>{}))()});
function setTab(){applyNav();renderNav();render();window.scrollTo(0,0)}
$("#fab").onclick=()=>({jobs:()=>jobsMode==="so"&&isAdm()?soForm():isAcc()?0:jobForm(),stock:()=>paperForm(),customers:()=>custForm(),stores:()=>grnForm(),plates:()=>pmode==="punch"?punchForm():plateForm()}[tab]||(()=>{}))();
init();