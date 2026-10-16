/* ===== Daily expenses module (petty cash, transport, loading/unloading) — shared by both ERPs =====
   Host calls KX.init(adapter) once its db and role are known, KX.html() to draw the tab, KX.wire(el) after,
   and KX.badge() for the nav count. Data lives in collections kxcfg, kxv (vouchers), kxc (cash), kxs (bill
   settlements) and kxi (bill photos). Vouchers and cash entries are kept many-per-document, one document per month. */
(()=>{"use strict";
const KX={};window.KX=KX;
let A=null,db=null,LOCAL=false,started=false,CFG=null;
const LIVE={kxv:{},kxc:{},kxs:{}},OLD={kxv:{},kxc:{},kxs:{}},LOADED={};
let V=[],C=[],ST=[];
const UI={view:"today",vf:"all",vm:"",mm:"",cm:""};
const DEF_HEADS=["Tea & refreshment","Stationery & xerox","Courier & postage","Repairs & maintenance","Electrical","Machine spares (small)","Cleaning & housekeeping","Local conveyance","Drinking water","Miscellaneous"];
const DEF={float:10000,anchor:null,anchorHist:[],start:"",photoAbove:200,backDays:1,lockedUpto:"",custodian:"",routes:[],works:[],
  heads:DEF_HEADS.map((n,i)=>({id:"h"+i,name:n,budget:0})),need:{outTr:true,outLd:true,inTr:false,inLd:true,interTr:false,interLd:false}};
const TL={tr:"Transport",ld:"Loading / unloading",pt:"Petty expense"};
const DL={tr:{out:"Dispatch (outward)",in:"Inward (purchase)",inter:"Between our units",other:"Other trip"},
          ld:{out:"Loading for dispatch",in:"Unloading of inward",inter:"Between our units",other:"Shifting / other"}};
const ML={cash:"Cash from box",bank:"UPI / bank (office)",credit:"Monthly bill (on account)",nil:"No charge"};
const RL={owner:"Owner",accounts:"Accounts",factory:"Factory manager"};
const DEN=[500,200,100,50,20,10];

/* ---------- small helpers ---------- */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const r2=n=>Math.round(num(n)*100)/100;
const inr=n=>(num(n)<0?"−":"")+"₹"+Math.abs(r2(n)).toLocaleString("en-IN",{maximumFractionDigits:2});
const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today=()=>iso(new Date());
const addDays=(s,n)=>{const d=new Date(s+"T00:00");d.setDate(d.getDate()+n);return iso(d)};
const mOf=s=>String(s||"").slice(0,7);
const mAdd=(m,n)=>{const[y,mo]=m.split("-").map(Number);const d=new Date(y,mo-1+n,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
const mEnd=m=>addDays(mAdd(m,1)+"-01",-1);
const mName=m=>new Date(m+"-01T00:00").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
const fD=s=>s?new Date(s+"T00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}):"";
const fDT=t=>t?new Date(t).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}):"";
const nid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const norm=s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const role=()=>(A&&A.role())||"factory";
const me=()=>(A&&A.me&&A.me())||"local";
const isOwn=()=>role()==="owner",isAppr=()=>role()==="owner"||role()==="accounts";
const who=()=>({uid:me(),role:role()});
const live=v=>v.st!=="cancelled"&&v.st!=="rejected";
const vno=v=>A.prefix+String(v.date||"").slice(2,4)+String(v.date||"").slice(5,7)+"-"+String(v.no||0).padStart(3,"0");
const headName=id=>((CFG.heads||[]).find(h=>h.id===id)||{name:id||"Petty"}).name;
const isLocked=d=>!!CFG.lockedUpto&&mOf(d)<=CFG.lockedUpto;
const mine=x=>x&&x.by&&x.by.uid===me();
function toast(t){let e=$("#kxToast");if(!e){e=document.createElement("div");e.id="kxToast";e.className="kx-toast";e.setAttribute("role","status");document.body.appendChild(e)}
  e.textContent=t;e.style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display="none",3200)}
const errMsg=e=>e&&e.code==="busy"?"Another phone is saving right now. Try again in a few seconds.":e&&e.code==="quota_exceeded"?"Storage is full. Ask the owner to delete old bill photos in Expenses → Setup.":e&&e.code==="invalid_argument"?"You don't have permission to save this. Ask the owner to check your access.":e&&e.msg?e.msg:"Couldn't save. Check the internet and try again.";

/* ---------- storage ---------- */
function persistLocal(){try{localStorage.setItem("kx-"+A.key,JSON.stringify({cfg:CFG,...LIVE}))}catch(e){toast("Phone storage is full.")}}
let _ch=0;function changed(){if(_ch)return;_ch=setTimeout(()=>{_ch=0;try{A.rerender()}catch(e){}},30)}
function flat(){const g=c=>Object.values({...OLD[c],...LIVE[c]}).flatMap(d=>d.items||[]);V=g("kxv");C=g("kxc").filter(c=>!c.void);ST=g("kxs");_fl=null}
let subFrom="",UNS=[];
function windowStart(){let m=mAdd(mOf(today()),-1);const a=CFG.anchor&&mOf(CFG.anchor.date);if(a&&a<m)m=a;return m}
function resub(){const f=windowStart();if(f===subFrom)return;subFrom=f;UNS.forEach(u=>{try{u()}catch(e){}});UNS=[];
  ["kxv","kxc","kxs"].forEach(c=>UNS.push(db.collection(c).where("m",">=",f).limit(300).onSnapshot(s=>{const o={};s.docs.forEach(d=>o[d.id]=d.data());LIVE[c]=o;flat();changed()},
    e=>{if(e&&e.code!=="revoked")toast("Expenses: live link lost. Reopen the app.")})))}
async function loadMonth(m){if(!m||LOCAL||!db||LOADED[m]||m>=subFrom)return;LOADED[m]=1;
  try{for(const c of ["kxv","kxc","kxs"]){const s=await db.collection(c).where("m","==",m).get();s.docs.forEach(d=>OLD[c][d.id]=d.data())}flat();changed()}catch(e){LOADED[m]=0}}
KX.init=function(adapter){if(started)return;A=adapter;started=true;
  const t=A.theme||{};const st=document.createElement("style");
  st.textContent=`:root{--kx-bg:${t.bg};--kx-card:${t.card};--kx-line:${t.line};--kx-fg:${t.fg};--kx-mut:${t.muted};--kx-acc:${t.acc};--kx-on:${t.onAcc||"#fff"};--kx-ok:${t.ok};--kx-warn:${t.warn};--kx-bad:${t.bad}}`;
  document.head.appendChild(st);
  db=A.getDb();LOCAL=!db;
  if(LOCAL){try{const o=JSON.parse(localStorage.getItem("kx-"+A.key)||"{}");CFG={...DEF,...(o.cfg||{})};["kxv","kxc","kxs"].forEach(c=>LIVE[c]=o[c]||{})}catch(e){CFG={...DEF}}flat();changed();return}
  db.collection("kxcfg").doc("main").onSnapshot(s=>{CFG={...DEF,...(s.exists?s.data():{})};resub();changed()},e=>{if(!CFG){CFG={...DEF};resub();changed()}})};
async function saveCfg(patch){const next=JSON.parse(JSON.stringify({...CFG,...patch}));
  if(LOCAL){CFG=next;persistLocal();changed();return}
  try{await db.collection("kxcfg").doc("main").set(next);CFG=next;changed()}catch(e){toast(errMsg(e));throw e}}
const nap=t=>new Promise(r=>setTimeout(r,t));
async function lease(ref,fn){if(typeof ref.acquire!=="function")return fn();let got=false;const H=nid();
  for(let i=0;i<12&&!got;i++){try{got=(await ref.acquire({holder:H,ttlMs:8000})).acquired}catch(e){got=true}if(!got)await nap(400+Math.random()*500)}
  if(!got)throw{code:"busy"};try{return await fn()}finally{if(ref.release)ref.release({holder:H}).catch(()=>{})}}
// put items (all from one month) into that month's documents; new vouchers get the next serial number inside the lock
function place(parts,m,items,opt){const touched={};
  for(const item of items){const host=Object.keys(parts).find(k=>(parts[k].items||[]).some(x=>x.id===item.id));
    if(host){parts[host]={m,items:parts[host].items.map(x=>x.id===item.id?item:x)};touched[host]=1;continue}
    if(opt.assignNo)item.no=Object.values(parts).flatMap(d=>d.items||[]).reduce((a,x)=>Math.max(a,x.no||0),0)+1;
    let k=m,i=1;while(parts[k]&&(parts[k].items||[]).length>=300){i++;k=m+"_"+i}
    parts[k]={m,items:[...((parts[k]&&parts[k].items)||[]),item]};touched[k]=1}
  return touched}
async function write(col,items,opt={}){items=Array.isArray(items)?items:[items];if(!items.length)return;const m=mOf(items[0].date);
  if(items.some(x=>mOf(x.date)!==m))throw{msg:"Entries from different months can't be saved together."};
  items.forEach(x=>{for(const k in x)if(x[k]===undefined)delete x[k]});
  if(LOCAL){const parts={};Object.entries(LIVE[col]).forEach(([k,d])=>{if(d.m===m)parts[k]=d});place(parts,m,items,opt);Object.assign(LIVE[col],parts);persistLocal();flat();changed();return}
  const ref=db.collection(col).doc(m);
  await lease(ref,async()=>{const s=await db.collection(col).where("m","==",m).get();const parts={};s.docs.forEach(d=>parts[d.id]=d.data());
    const t=place(parts,m,items,opt);for(const k of Object.keys(t))await db.collection(col).doc(k).set(JSON.parse(JSON.stringify(parts[k])));
    Object.keys(t).forEach(k=>{if(LIVE[col][k]||m>=subFrom)LIVE[col][k]=parts[k];else OLD[col][k]=parts[k]});flat();changed()})}
async function savePhoto(vid,date,data){if(LOCAL){try{localStorage.setItem("kx-img-"+A.key+"-"+vid,data)}catch(e){throw{msg:"Phone storage is full; photo not saved."}}return}
  await db.collection("kxi").doc(vid).set({m:mOf(date),d:data})}
async function getPhoto(vid){if(LOCAL)return localStorage.getItem("kx-img-"+A.key+"-"+vid);
  const s=await db.collection("kxi").doc(vid).get();return s.exists?s.data().d:null}
async function compress(file){const img=await new Promise((res,rej)=>{const u=URL.createObjectURL(file);const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=u});
  const s=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight));const w=Math.round(img.naturalWidth*s),h=Math.round(img.naturalHeight*s);
  const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
  let q=.6,d=c.toDataURL("image/jpeg",q);while(d.length>150000&&q>.2){q-=.1;d=c.toDataURL("image/jpeg",q)}return d}

/* ---------- business rules ---------- */
function docs(){try{return(A.docs()||[]).filter(d=>d&&d.key&&d.date)}catch(e){return[]}}
const kindOf=d=>d.kind==="out"?"out":d.kind==="in"?"in":"inter";
function linked(){const tr=new Set(),ld=new Set();V.forEach(v=>{if(live(v)&&v.doc&&v.doc.key)(v.type==="tr"?tr:v.type==="ld"?ld:new Set()).add(v.doc.key)});return{tr,ld}}
function missing(from,to){const need=CFG.need||DEF.need,L=linked(),out=[];
  docs().forEach(d=>{if(d.opt||d.date<from||d.date>to)return;const k=kindOf(d);const nt=!!need[k+"Tr"]&&!L.tr.has(d.key),nl=!!need[k+"Ld"]&&!L.ld.has(d.key);if(nt||nl)out.push({d,nt,nl})});
  return out.sort((a,b)=>b.d.date.localeCompare(a.d.date))}
const missFrom=()=>{const s=CFG.start||addDays(today(),-7);return s};
let _fl=null;
function flags(v){if(!_fl)_fl=new Map();if(_fl.has(v.id))return _fl.get(v.id);const f=[];
  if(live(v)){
    const late=Math.round((new Date(iso(new Date(v.at||Date.now()))+"T00:00")-new Date(v.date+"T00:00"))/864e5);if(late>=1&&v.mode!=="nil")f.push(`Entered ${late} day${late>1?"s":""} after the date`);
    if(v.type!=="pt"&&v.mode!=="nil"){if(!num(v.mrate))f.push("Rate not in the rate list"+(v.rateWhy?": "+v.rateWhy:""));else if(num(v.rate)>num(v.mrate))f.push(`Rate ${inr(v.rate)} is above the rate list ${inr(v.mrate)}`+(v.rateWhy?": "+v.rateWhy:""))}
    if(v.type!=="pt"&&!(v.doc&&v.doc.key))f.push("Not linked to a challan / GRN in the app"+(v.doc&&v.doc.ref?" (typed: "+v.doc.ref+")":""));
    if(v.mode!=="nil"&&num(CFG.photoAbove)>0&&num(v.amt)>=num(CFG.photoAbove)&&!v.photo)f.push("No bill / slip photo");
    if(num(v.extra)>0)f.push(`Extra ${inr(v.extra)}: ${v.extraWhy||"no reason given"}`);
    const d=V.find(x=>x.id!==v.id&&live(x)&&x.type===v.type&&x.date===v.date&&v.mode!=="nil"&&x.mode!=="nil"&&(
      (v.type==="tr"&&v.veh&&norm(x.veh)===norm(v.veh)&&x.doc&&v.doc&&x.doc.key&&x.doc.key===v.doc.key)||(norm(x.payee)===norm(v.payee)&&r2(x.amt)===r2(v.amt))));
    if(d)f.push("Looks like a duplicate of "+vno(d));
    if(v.type==="tr"&&v.mode!=="nil"&&v.doc&&v.doc.key){const o=V.find(x=>x.id!==v.id&&x!==d&&live(x)&&x.type==="tr"&&x.mode!=="nil"&&x.doc&&x.doc.key===v.doc.key);if(o)f.push("Same challan / GRN also has trip "+vno(o))}
    if((v.h||[]).some(h=>h.k==="edit"))f.push("Changed after it was entered");
    if(v.ap&&v.by&&v.ap.uid===v.by.uid&&!LOCAL)f.push("Approved by the same person who entered it")}
  _fl.set(v.id,f);return f}
function cashBook(){const a=CFG.anchor;if(!a)return null;const rows=[];
  C.forEach(c=>{if(c.date<a.date)return;
    if(c.t==="topup"&&c.ack)rows.push({date:c.date,at:c.ack.at||c.at,txt:"Cash received from office"+(c.note?" · "+c.note:""),inn:num(c.amt),c});
    else if(c.t==="return"&&c.ack)rows.push({date:c.date,at:c.ack.at||c.at,txt:"Cash returned to office"+(c.note?" · "+c.note:""),out:num(c.amt),c});
    else if(c.t==="count")rows.push({date:c.date,at:c.at,count:c})});
  V.forEach(v=>{if(v.mode==="cash"&&live(v)&&v.date>=a.date)rows.push({date:v.date,at:v.at||0,txt:vno(v)+" · "+(v.type==="pt"?headName(v.head):TL[v.type])+(v.payee?" · "+v.payee:""),out:num(v.amt),v})});
  rows.sort((x,y)=>x.date.localeCompare(y.date)||x.at-y.at);let bal=num(a.amt);rows.forEach(r=>{bal=r2(bal+num(r.inn)-num(r.out));r.bal=bal});return{rows,bal,open:num(a.amt)}}
const canAck=c=>!c.ack&&(LOCAL||!mine(c))&&(c.t==="topup"||isAppr());
function canEdit(v){if(isLocked(v.date)||v.st==="cancelled"||v.st==="rejected"||v.st==="approved")return false;return isOwn()||(mine(v)&&(v.st==="pending"||v.st==="query"))}
const canCancel=v=>!isLocked(v.date)&&v.st!=="cancelled"&&v.st!=="rejected"&&(isAppr()||(mine(v)&&v.st!=="approved"));
const canApprove=v=>isAppr()&&(v.st==="pending"||v.st==="query")&&!isLocked(v.date)&&(isOwn()||!mine(v));
KX.badge=()=>{if(!started||!CFG)return 0;let n=0;
  if(isAppr())n+=V.filter(v=>v.st==="pending"&&(isOwn()||!mine(v))).length;
  n+=V.filter(v=>v.st==="query"&&mine(v)).length;n+=C.filter(c=>(c.t==="topup"||c.t==="return")&&canAck(c)).length;return n};

/* ---------- views ---------- */
const pill=(t,c="")=>`<span class="kx-pill ${c}">${esc(t)}</span>`;
const stPill=v=>({pending:pill("Waiting approval"),approved:pill("Approved","ok"),query:pill("Query","warn"),rejected:pill("Rejected","bad"),cancelled:pill("Cancelled","mut")})[v.st]||"";
function vTitle(v){return v.type==="pt"?headName(v.head)+(v.payee?" · "+v.payee:""):(v.payee||(v.mode==="nil"?"No charge":"—"))+(v.veh?" · "+v.veh:"")}
function vRow(v){const f=flags(v);return `<button class="kx-row${live(v)?"":" kx-dead"}" data-kx="open" data-id="${v.id}"><div class="kx-rt"><span class="kx-tt"><b class="kx-no">${vno(v)}</b> ${esc(vTitle(v))}</span><b class="kx-amt">${v.mode==="nil"?"₹0":inr(v.amt)}</b></div>
  <div class="kx-meta">${fD(v.date)} · ${v.type==="pt"?"Petty":TL[v.type]}${v.doc&&v.doc.ref?" · "+esc(v.doc.ref):""} · ${ML[v.mode]||""}</div>
  <div class="kx-tags">${stPill(v)}${f.length?pill(f.length+" flag"+(f.length>1?"s":""),"warn"):""}${v.photo?pill("Photo"):""}</div></button>`}
const empty=t=>`<div class="kx-empty">${t}</div>`;
const note=(t,btn="")=>`<div class="kx-note">${t}${btn}</div>`;
function monthNav(key,m){return `<div class="kx-mnav"><button class="kx-ib" data-kx="mprev" data-k="${key}" aria-label="Previous month">‹</button><b>${mName(m)}</b><button class="kx-ib" data-kx="mnext" data-k="${key}" aria-label="Next month" ${m>=mOf(today())?"disabled":""}>›</button></div>`}
const ICO={tr:'<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  ld:'<path d="M4 20h16M7 20V9h10v11M7 13h10M12 9V4M9.5 6.5 12 4l2.5 2.5"/>',pt:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>'};
function seg(){const L=[["today","Today"],["list","Vouchers"]];if(isAppr())L.push(["appr","Approve"]);L.push(["cash","Cash"]);if(isAppr())L.push(["month","Month"]);if(isOwn())L.push(["setup","Setup"]);
  if(!L.some(x=>x[0]===UI.view))UI.view="today";
  const n={appr:isAppr()?V.filter(v=>v.st==="pending"&&(isOwn()||!mine(v))).length:0};
  return `<div class="kx-seg" role="group">${L.map(([k,l])=>`<button data-kx="view" data-v="${k}" aria-pressed="${UI.view===k}">${l}${n[k]?` <b class="kx-n">${n[k]}</b>`:""}</button>`).join("")}</div>`}
KX.html=function(){if(!started||!CFG)return `<div class="kx">${empty("Opening expenses…")}</div>`;
  UI.vm=UI.vm||mOf(today());UI.mm=UI.mm||mOf(today());UI.cm=UI.cm||mOf(today());
  const body={today:vToday,list:vList,appr:vAppr,cash:vCash,month:vMonth,setup:vSetup}[seg()&&UI.view]();
  return `<div class="kx">${seg()}${body}</div>`};
KX.wire=function(){};

function vToday(){const t=today(),cb=cashBook();let h="";
  if(!CFG.anchor)h+=isOwn()?note("Set the cash float and the opening cash once, so the app can tell how much cash should be in the box.",` <button class="kx-link" data-kx="setGen">Set up now</button>`):note("The owner has not set the opening cash yet. You can still enter expenses.");
  if(cb){const lc=C.filter(c=>c.t==="count").sort((a,b)=>b.at-a.at)[0];const due=r2(Math.max(0,num(CFG.float)-cb.bal));
    h+=`<div class="kx-card"><div class="kx-eye">Cash that should be in the box</div><div class="kx-big">${inr(cb.bal)}</div>
    <div class="kx-meta">Float ${inr(CFG.float)}${due>0?` · top-up due <b>${inr(due)}</b>`:""}${CFG.custodian?" · held by "+esc(CFG.custodian):""}</div>
    ${lc?`<div class="kx-meta">Last count ${fD(lc.date)} ${fDT(lc.at).split(", ").pop()}: ${inr(lc.counted)} ${diffTxt(lc.diff)}</div>`:""}
    <div class="kx-btns"><button class="kx-btn" data-kx="count">Count cash</button>${isAppr()?`<button class="kx-btn" data-kx="topup">Give cash</button>`:`<button class="kx-btn" data-kx="ret">Return cash</button>`}</div></div>`;
    if(!isAppr()&&!C.some(c=>c.t==="count"&&c.date===t)&&new Date().getHours()>=16)h+=note("Cash has not been counted today. Count it before you leave.",` <button class="kx-link" data-kx="count">Count now</button>`)}
  C.filter(c=>(c.t==="topup"||c.t==="return")&&!c.ack).forEach(c=>{
    if(canAck(c))h+=`<div class="kx-alert"><b>${c.t==="topup"?"Cash sent to you":"Cash returned by the factory"}: ${inr(c.amt)}</b><span>${fD(c.date)}${c.note?" · "+esc(c.note):""}. Confirm only after you have it in hand.</span><button class="kx-btn p" data-kx="ack" data-id="${c.id}">I received ${inr(c.amt)}</button></div>`;
    else if(mine(c))h+=`<div class="kx-alert mut"><b>${inr(c.amt)} ${c.t==="topup"?"given":"returned"} on ${fD(c.date)}</b><span>Waiting for the other person to confirm receipt. It counts only after they confirm.</span><button class="kx-link" data-kx="void" data-id="${c.id}">Withdraw this entry</button></div>`});
  V.filter(v=>v.st==="query"&&mine(v)).forEach(v=>{h+=`<div class="kx-alert"><b>Query on ${vno(v)}</b><span>${esc(v.stNote||"")}</span><button class="kx-btn" data-kx="open" data-id="${v.id}">Open and reply</button></div>`});
  h+=`<div class="kx-add">${["tr","ld","pt"].map(k=>`<button data-kx="new" data-t="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg><b>${k==="pt"?"Petty expense":TL[k]}</b><span>${{tr:"Tempo, truck or rickshaw trip",ld:"Hamali for loading or unloading",pt:"Tea, xerox, repairs and other cash"}[k]}</span></button>`).join("")}</div>`;
  const ms=missing(missFrom(),t);
  if(ms.length){h+=`<h3 class="kx-h">Challans and inwards with no entry <span class="kx-pill bad">${ms.length}</span></h3><p class="kx-meta kx-sub">Each dispatch and inward needs its transport and loading charge entered, or marked "No charge".</p>`;
    h+=ms.slice(0,4).map(missRow).join("")+(ms.length>4?`<button class="kx-btn wide" data-kx="missAll">See all ${ms.length}</button>`:"")}
  const tv=V.filter(v=>v.date===t||iso(new Date(v.at||0))===t).sort((a,b)=>b.at-a.at);const sum=tv.filter(live).reduce((a,v)=>a+num(v.amt),0);
  h+=`<h3 class="kx-h">Entered today <span class="kx-meta">${tv.length} · ${inr(sum)}</span></h3>`+(tv.length?`<div class="kx-list">${tv.map(vRow).join("")}</div>`:empty("Nothing entered today yet."));
  h+=`<button class="kx-btn wide ghost" data-kx="help">How this system works</button>`;return h}
function missRow(x){const d=x.d;return `<div class="kx-miss"><div><b>${esc(d.ref)}</b> <span class="kx-meta">${fD(d.date)} · ${esc(d.party||"")}</span><div class="kx-meta">${esc(d.info||"")}</div>
  <div class="kx-meta">${[x.nt?"Transport not entered":"",x.nl?"Loading / unloading not entered":""].filter(Boolean).join(" · ")}</div></div>
  <div class="kx-btns">${x.nt?`<button class="kx-btn s" data-kx="new" data-t="tr" data-doc="${esc(d.key)}">+ Transport</button>`:""}${x.nl?`<button class="kx-btn s" data-kx="new" data-t="ld" data-doc="${esc(d.key)}">+ ${d.kind==="out"?"Loading":"Unloading"}</button>`:""}<button class="kx-btn s" data-kx="nil" data-doc="${esc(d.key)}" data-nt="${x.nt?1:""}" data-nl="${x.nl?1:""}">No charge</button></div></div>`}
const diffTxt=d=>d==null?"":r2(d)===0?pill("Matched","ok"):r2(d)<0?pill("Short "+inr(-d),"bad"):pill("Extra "+inr(d),"warn");

const FILT=[["all","All"],["pending","Waiting"],["flag","Flagged"],["query","Query"],["tr","Transport"],["ld","Loading"],["pt","Petty"],["cancelled","Cancelled / rejected"]];
function vList(){const m=UI.vm;loadMonth(m);let vs=V.filter(v=>mOf(v.date)===m);
  const f=UI.vf;vs=vs.filter(v=>f==="all"?true:f==="pending"?v.st==="pending":f==="flag"?flags(v).length>0:f==="query"?v.st==="query":f==="cancelled"?!live(v):v.type===f&&live(v));
  vs.sort((a,b)=>b.date.localeCompare(a.date)||(b.no||0)-(a.no||0));const sum=vs.filter(live).reduce((a,v)=>a+num(v.amt),0);
  return monthNav("vm",m)+`<div class="kx-chips">${FILT.map(([k,l])=>`<button data-kx="vf" data-f="${k}" aria-pressed="${f===k}">${l}</button>`).join("")}</div>
  <p class="kx-meta kx-sub">${vs.length} voucher${vs.length===1?"":"s"} · ${inr(sum)}</p>`+(vs.length?`<div class="kx-list">${vs.map(vRow).join("")}</div>`:empty("No vouchers here."))}
function vAppr(){const q=V.filter(v=>v.st==="pending"&&(isOwn()||!mine(v))).sort((a,b)=>flags(b).length-flags(a).length||a.date.localeCompare(b.date));
  const clean=q.filter(v=>!flags(v).length&&!isLocked(v.date));
  let h=`<p class="kx-meta kx-sub">Check flagged vouchers one by one. Clean ones (correct rate, linked to a challan or GRN, photo attached) can be approved together.</p>`;
  if(clean.length)h+=`<button class="kx-btn p wide" data-kx="apprClean">Approve ${clean.length} clean voucher${clean.length>1?"s":""} (${inr(clean.reduce((a,v)=>a+num(v.amt),0))})</button>`;
  const others=V.filter(v=>v.st==="query").length;
  return h+(q.length?`<div class="kx-list">${q.map(vRow).join("")}</div>`:empty("Nothing waiting for approval."))+(others?`<p class="kx-meta kx-sub">${others} voucher${others>1?"s":""} sent back with a query, waiting for the factory's reply.</p>`:"")}
function vCash(){const cb=cashBook();if(!cb)return note(isOwn()?"Set the opening cash first.":"The owner has not set the opening cash yet.",isOwn()?` <button class="kx-link" data-kx="setGen">Set up now</button>`:"");
  const m=UI.cm;loadMonth(m);const s=m+"-01",e=mEnd(m);const before=cb.rows.filter(r=>r.date<s&&!r.count);const open=before.length?before[before.length-1].bal:cb.open;
  const rows=cb.rows.filter(r=>r.date>=s&&r.date<=e);const tin=rows.reduce((a,r)=>a+num(r.inn),0),tout=rows.reduce((a,r)=>a+num(r.out),0);
  let h=monthNav("cm",m)+`<div class="kx-tiles"><div><span>Opening</span><b>${inr(open)}</b></div><div><span>Received</span><b>${inr(tin)}</b></div><div><span>Spent</span><b>${inr(tout)}</b></div><div><span>Should be</span><b>${inr(open+tin-tout)}</b></div></div>
  <div class="kx-btns"><button class="kx-btn" data-kx="count">Count cash</button>${isAppr()?`<button class="kx-btn" data-kx="topup">Give cash</button>`:""}<button class="kx-btn" data-kx="ret">Return cash</button></div>`;
  if(s<CFG.anchor.date)h+=note(`The cash book starts on ${fD(CFG.anchor.date)} with ${inr(CFG.anchor.amt)}.`);
  h+=rows.length?`<div class="kx-tw"><table class="kx-tbl"><thead><tr><th>Date</th><th>Particulars</th><th class="n">In</th><th class="n">Out</th><th class="n">Balance</th></tr></thead><tbody>${rows.map(r=>r.count?
    `<tr class="kx-cnt"><td>${fD(r.date)}</td><td colspan="3">Counted ${inr(r.count.counted)} (should be ${inr(r.count.expected)}) ${diffTxt(r.count.diff)}${r.count.note?" · "+esc(r.count.note):""}</td><td class="n">—</td></tr>`:
    `<tr${r.v?` data-kx="open" data-id="${r.v.id}" class="kx-click"`:""}><td>${fD(r.date)}</td><td>${esc(r.txt)}</td><td class="n">${r.inn?inr(r.inn):""}</td><td class="n">${r.out?inr(r.out):""}</td><td class="n">${inr(r.bal)}</td></tr>`).join("")}</tbody></table></div>`:empty("No cash movement this month.");return h}
function vMonth(){const m=UI.mm;loadMonth(m);const vs=V.filter(v=>mOf(v.date)===m),lv=vs.filter(live);const tot=lv.reduce((a,v)=>a+num(v.amt),0);
  const by=(f)=>{const o={};lv.forEach(v=>{const k=f(v);o[k]=(o[k]||0)+num(v.amt)});return o};
  const mode=by(v=>v.mode),typ=by(v=>v.type==="tr"?"tr-"+(v.dir||"other"):v.type==="ld"?"ld":"pt:"+v.head);
  const pend=vs.filter(v=>v.st==="pending"||v.st==="query").length,fl=lv.filter(v=>flags(v).length).length;
  const ms=missing(m+"-01"<missFrom()?missFrom():m+"-01",mEnd(m));
  const counts=C.filter(c=>c.t==="count"&&mOf(c.date)===m),short=counts.filter(c=>r2(c.diff)<0).reduce((a,c)=>a+num(c.diff),0);
  let h=monthNav("mm",m)+`<div class="kx-tiles"><div><span>Total spent</span><b>${inr(tot)}</b></div><div><span>Cash</span><b>${inr(mode.cash||0)}</b></div><div><span>UPI / bank</span><b>${inr(mode.bank||0)}</b></div><div><span>On monthly bill</span><b>${inr(mode.credit||0)}</b></div></div>`;
  const chk=[[pend,"vouchers not yet approved","list","pending"],[fl,"vouchers with flags","list","flag"],[ms.length,"challans / inwards with no entry","missAll"],[counts.filter(c=>r2(c.diff)!==0).length,"cash counts that did not match"+(short?" (short "+inr(-short)+")":""),"cashm"]];
  h+=`<h3 class="kx-h">Before you close the month</h3><div class="kx-list">${chk.map(([n,t,a,f])=>`<button class="kx-chk ${n?"bad":"ok"}" data-kx="${a}" data-m="${m}" ${f?`data-f="${f}"`:""}><b>${n||"✓"}</b><span>${n?t:"No "+t}</span></button>`).join("")}</div>`;
  const trT=["out","in","inter","other"].map(d=>[DL.tr[d],typ["tr-"+d]||0]).filter(x=>x[1]),hd=(CFG.heads||[]).map(x=>[x,typ["pt:"+x.id]||0]).filter(([x,a])=>a||num(x.budget));
  h+=`<h3 class="kx-h">Where the money went</h3><div class="kx-tw"><table class="kx-tbl"><tbody>${trT.map(([l,a])=>`<tr><td>Transport — ${esc(l)}</td><td class="n">${inr(a)}</td></tr>`).join("")}
    ${typ.ld?`<tr><td>Loading / unloading</td><td class="n">${inr(typ.ld)}</td></tr>`:""}
    ${hd.map(([x,a])=>{const b=num(x.budget),over=b&&a>b;return `<tr><td>${esc(x.name)}${b?`<div class="kx-bar"><span style="width:${Math.min(100,a/b*100)}%" class="${over?"over":""}"></span></div><span class="kx-meta">${over?"Over budget by "+inr(a-b):"Budget "+inr(b)}</span>`:""}</td><td class="n">${inr(a)}</td></tr>`}).join("")}
    <tr class="kx-tot"><td>Total</td><td class="n">${inr(tot)}</td></tr></tbody></table></div>`;
  const pay={};lv.filter(v=>v.payee&&v.type!=="pt").forEach(v=>{const k=norm(v.payee);const p=pay[k]=pay[k]||{name:v.payee,n:0,amt:0,credit:0};p.n++;p.amt+=num(v.amt);if(v.mode==="credit")p.credit+=num(v.amt)});
  const pl=Object.values(pay).sort((a,b)=>b.amt-a.amt);
  h+=`<h3 class="kx-h">Transporters and hamals</h3><p class="kx-meta kx-sub">Open a name to match their month-end bill against the trips entered here.</p>`+(pl.length?`<div class="kx-list">${pl.map(p=>{const s=ST.find(x=>x.m===m&&norm(x.payee)===norm(p.name));
    return `<button class="kx-row" data-kx="stmt" data-p="${esc(p.name)}" data-m="${m}"><div class="kx-rt"><span class="kx-tt"><b>${esc(p.name)}</b></span><b class="kx-amt">${inr(p.amt)}</b></div><div class="kx-meta">${p.n} entr${p.n>1?"ies":"y"}${p.credit?" · on bill "+inr(p.credit):""}</div><div class="kx-tags">${s?(s.paid?pill("Paid","ok"):r2(s.diff)?pill("Bill differs by "+inr(s.diff),"bad"):pill("Bill matched","ok")):p.credit?pill("Bill not checked","warn"):""}</div></button>`}).join("")}</div>`:empty("No transport or hamali this month."));
  h+=`<div class="kx-btns kx-gap"><button class="kx-btn" data-kx="csv" data-m="${m}">Export for Tally (CSV)</button>${isOwn()?(isLocked(m+"-01")?(CFG.lockedUpto===m?`<button class="kx-btn" data-kx="unlock">Unlock ${mName(m)}</button>`:""):m<mOf(today())?`<button class="kx-btn p" data-kx="lock" data-m="${m}">Close ${mName(m)}</button>`:""):""}</div>`;
  if(isLocked(m+"-01"))h+=note(`${mName(m)} is closed. Vouchers in it can't be added or changed.`);return h}
function vSetup(){const c=CFG;const card=(t,body,act)=>`<div class="kx-card"><div class="kx-rt"><b>${t}</b><button class="kx-link" data-kx="${act}">Edit</button></div>${body}</div>`;
  return card("Cash box",`<div class="kx-meta">Float ${inr(c.float)} · held by ${esc(c.custodian||"not set")}<br>${c.anchor?`Cash book started ${fD(c.anchor.date)} with ${inr(c.anchor.amt)}`:"Opening cash not set"}<br>Bill photo needed from ${inr(c.photoAbove)} · staff can enter up to ${c.backDays} day${c.backDays==1?"":"s"} back<br>Checking challans and inwards from ${c.start?fD(c.start):"—"}</div>`,"setGen")
  +card("Transport rate list",(c.routes||[]).length?`<div class="kx-tw"><table class="kx-tbl"><tbody>${c.routes.map(r=>`<tr><td>${esc(r.name)}<div class="kx-meta">${esc(r.veh||"")}</div></td><td class="n">${inr(r.rate)} / trip</td></tr>`).join("")}</tbody></table></div>`:`<div class="kx-meta">No routes yet. Add each regular route and vehicle with its fixed rate, so a higher rate gets flagged.</div>`,"setRoutes")
  +card("Loading / unloading rate list",(c.works||[]).length?`<div class="kx-tw"><table class="kx-tbl"><tbody>${c.works.map(r=>`<tr><td>${esc(r.name)}</td><td class="n">${inr(r.rate)} / ${esc(r.unit)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="kx-meta">No rates yet. Add rates per reel, bundle, ton or trip.</div>`,"setWorks")
  +card("Petty expense heads and monthly budget",`<div class="kx-meta">${(c.heads||[]).map(h=>esc(h.name)+(num(h.budget)?" ("+inr(h.budget)+")":"")).join(" · ")}</div>`,"setHeads")
  +card("Which entries every challan / inward needs",`<div class="kx-meta">${[["out","Dispatch"],["in","Inward"],["inter","Between units"]].map(([k,l])=>l+": "+[c.need[k+"Tr"]?"transport":"",c.need[k+"Ld"]?"loading":""].filter(Boolean).join(" + ")||l+": nothing").join("<br>")}</div>`,"setGen")
  +card("Bill photos",`<div class="kx-meta">Photos take space in the app's storage. Delete photos of closed months once the bills are filed.</div>`,"purge")}

/* ---------- sheets ---------- */
function sheet(title,html){close();const w=document.createElement("div");w.id="kxw";w.className="kx-scrim";
  w.innerHTML=`<div class="kx-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="kx-sh"><h3>${esc(title)}</h3><button class="kx-x" data-kx="close" aria-label="Close">×</button></div><div class="kx-sb">${html}</div></div>`;
  document.body.appendChild(w);w.addEventListener("click",e=>{if(e.target===w)close()});return w.querySelector(".kx-sb")}
function close(){const w=$("#kxw");if(w)w.remove()}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#kxw"))close()});
const fld=(l,n,v,t="text",a="")=>`<label class="kx-f"><span>${l}</span><input name="${n}" type="${t}" value="${esc(v??"")}" ${t==="number"?'inputmode="decimal" step="any" min="0"':""} ${a}></label>`;
const sel=(l,n,opts,v,a="")=>`<label class="kx-f"><span>${l}</span><select name="${n}" ${a}>${opts.map(([k,t])=>`<option value="${esc(k)}" ${String(k)===String(v??"")?"selected":""}>${esc(t)}</option>`).join("")}</select></label>`;
const read=f=>Object.fromEntries(new FormData(f));
function askText(title,label,btn,cb,req=true){const b=sheet(title,`<form class="kx-form">${`<label class="kx-f"><span>${label}</span><textarea name="t" rows="3"></textarea></label>`}<div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Back</button><button class="kx-btn p">${btn}</button></div></form>`);
  const f=$("form",b);f.onsubmit=async e=>{e.preventDefault();const t=f.t.value.trim();if(req&&!t){toast("Please write the reason.");return}const s=$("button.p",f);s.disabled=true;try{await cb(t);close()}catch(x){toast(errMsg(x));s.disabled=false}}}

function docOpts(type,dir,cur){const L=linked(),set=type==="tr"?L.tr:L.ld,lo=addDays(today(),-60);
  return docs().filter(d=>(dir==="other"||kindOf(d)===dir)&&(d.date>=lo||d.key===cur)).sort((a,b)=>(set.has(a.key)-set.has(b.key))||b.date.localeCompare(a.date))
    .map(d=>[d.key,`${d.ref} · ${fD(d.date)} · ${d.party||""}${set.has(d.key)&&d.key!==cur?" (already entered)":""}`])}
function voucherForm(type,v,pre={}){const ed=!!(v&&v.id);v=v?JSON.parse(JSON.stringify(v)):{type,date:today(),mode:type==="pt"?"cash":"cash",trips:1,qty:"",...pre};
  if(pre.docKey&&!v.dir){const d=docs().find(x=>x.key===pre.docKey);v.dir=d?kindOf(d):"other";v.doc=d?{key:d.key,ref:d.ref}:null}
  v.dir=v.dir||"out";const minD=isOwn()?"":addDays(today(),-num(CFG.backDays));
  const dateF=fld("Date","date",v.date,"date",`max="${today()}" ${minD?`min="${minD}"`:""}`);
  const modes=type==="pt"?[["cash",ML.cash],["bank",ML.bank]]:[["cash",ML.cash],["bank",ML.bank],["credit",ML.credit],["nil",ML.nil+" (party's vehicle / own staff)"]];
  const pays=[...new Set(V.filter(x=>x.type===type&&x.payee).map(x=>x.payee.trim()))].sort();
  let h=`<form class="kx-form" autocomplete="off"><datalist id="kxPay">${pays.map(p=>`<option value="${esc(p)}">`).join("")}</datalist>`;
  if(type!=="pt"){const rl=type==="tr"?CFG.routes||[]:CFG.works||[];
    h+=`<div class="kx-2">${dateF}${sel(type==="tr"?"Trip type":"Work for","dir",Object.entries(DL[type]),v.dir)}</div>
    <label class="kx-f"><span>Challan / GRN</span><select name="docKey"><option value="">Not in the list — type the number below</option>${docOpts(type,v.dir,v.doc&&v.doc.key).map(([k,t])=>`<option value="${esc(k)}" ${v.doc&&v.doc.key===k?"selected":""}>${esc(t)}</option>`).join("")}</select></label>
    <div data-show="docTxt">${fld("Challan / bill number","docTxt",v.doc&&!v.doc.key?v.doc.ref:"","text",'placeholder="e.g. supplier bill 4512"')}</div>
    ${sel("Paid by","mode",modes,v.mode)}
    <div data-hide="nil">${fld(type==="tr"?"Transporter / driver":"Hamal / gang name","payee",v.payee,"text",'list="kxPay"')}
    ${type==="tr"?fld("Vehicle number","veh",v.veh,"text",'placeholder="MH04 AB 1234" style="text-transform:uppercase"'):""}
    <label class="kx-f"><span>${type==="tr"?"Route and vehicle (rate list)":"Work (rate list)"}</span><select name="rid"><option value="">Not in the rate list</option>${rl.map(r=>`<option value="${esc(r.id)}" ${v.rid===r.id?"selected":""}>${esc(r.name)}${r.veh?" · "+esc(r.veh):""} · ${inr(r.rate)}/${esc(r.unit||"trip")}</option>`).join("")}</select></label>
    <div class="kx-2">${fld(type==="tr"?"Trips":"Quantity <i data-unit></i>",type==="tr"?"trips":"qty",type==="tr"?v.trips:v.qty,"number")}${fld("Rate (₹)","rate",v.rate,"number")}</div>
    <div data-show="rateWhy">${fld("Why this rate?","rateWhy",v.rateWhy,"text",'placeholder="Required when rate is not in the list or higher"')}</div>
    ${type==="tr"?`<div class="kx-2">${fld("Toll / parking / waiting (₹)","extra",v.extra,"number")}${fld("Reason for extra","extraWhy",v.extraWhy)}</div>`:""}
    <div data-show="mref">${fld("UPI / bank reference","mref",v.mref)}</div>
    ${fld("Slip / bill number","bill",v.bill)}</div>`}
  else h+=`<div class="kx-2">${dateF}${fld("Amount (₹)","amt",v.amt,"number")}</div>${sel("Expense head","head",(CFG.heads||[]).map(x=>[x.id,x.name]),v.head)}
    ${fld("Paid to (shop / person)","payee",v.payee,"text",'list="kxPay"')}${fld("What for","note",v.note,"text",'placeholder="e.g. 20 cups tea for night shift"')}
    ${sel("Paid by","mode",modes,v.mode)}<div data-show="mref">${fld("UPI / bank reference","mref",v.mref)}</div>${fld("Bill number","bill",v.bill)}`;
  h+=`<div data-hide="nil"><label class="kx-f"><span>Bill / slip photo${num(CFG.photoAbove)>0?` (needed from ${inr(CFG.photoAbove)})`:""}</span><input name="ph" type="file" accept="image/*" capture="environment"></label>
    <p class="kx-meta" data-ph>${v.photo?"A photo is attached. Choose a new one to replace it.":""}</p></div>
    ${type!=="pt"?fld("Note","note",v.note):""}<div class="kx-calc" data-calc></div>
    <div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Cancel</button><button class="kx-btn p">${ed?"Save changes":"Save voucher"}</button></div></form>`;
  const b=sheet((ed?"Edit "+vno(v):"New "+(type==="pt"?"petty expense":TL[type].toLowerCase()))+(ed?"":""),h);const f=$("form",b);
  const show=(k,on)=>{const e=$(`[data-show="${k}"]`,f);if(e)e.hidden=!on};
  const rlist=()=>type==="tr"?CFG.routes||[]:CFG.works||[];
  let lastRid=v.rid||"";
  function calc(){const x=read(f);const nil=x.mode==="nil";$$('[data-hide="nil"]',f).forEach(e=>e.hidden=nil);show("mref",x.mode==="bank");
    let amt=0,msg="";
    if(type!=="pt"){show("docTxt",!x.docKey);const r=rlist().find(z=>z.id===x.rid);
      if(x.rid!==lastRid){lastRid=x.rid;if(r)f.rate.value=r.rate}
      const u=$("[data-unit]",f);if(u)u.textContent=r?"("+r.unit+")":"";
      const q=num(type==="tr"?x.trips:x.qty),rt=num(x.rate);amt=nil?0:r2(q*rt+num(x.extra));
      show("rateWhy",!nil&&(!r||rt>num(r.rate)));
      msg=nil?"Amount: ₹0 (no charge). This still records who handled the challan.":`${type==="tr"?"Trips":"Qty"} ${q} × ${inr(rt)}${num(x.extra)?" + extra "+inr(x.extra):""} = <b>${inr(amt)}</b>${r&&rt>num(r.rate)?`<br><span class="kx-warn">Above the rate list (${inr(r.rate)}). This will be flagged.</span>`:!r&&!nil?`<br><span class="kx-warn">Not in the rate list. This will be flagged.</span>`:""}`}
    else{amt=r2(x.amt);msg=`Amount <b>${inr(amt)}</b>`}
    $("[data-calc]",f).innerHTML=msg;return amt}
  f.addEventListener("input",calc);f.addEventListener("change",e=>{if(e.target.name==="dir"){const s=f.docKey;s.innerHTML=`<option value="">Not in the list — type the number below</option>`+docOpts(type,f.dir.value,"").map(([k,t])=>`<option value="${esc(k)}">${esc(t)}</option>`).join("")}
    if(e.target.name==="ph"&&e.target.files[0])$("[data-ph]",f).textContent="Photo will be attached when you save.";calc()});calc();
  f.onsubmit=async e=>{e.preventDefault();const x=read(f),btn=$("button.p",f);const nil=x.mode==="nil";const amt=calc();
    const fail=t=>{toast(t);return false};
    if(!x.date)return fail("Choose the date.");if(x.date>today())return fail("The date can't be in the future.");
    if(isLocked(x.date))return fail(mName(mOf(x.date))+" is closed. Ask the owner.");
    if(minD&&x.date<minD&&!(ed&&x.date===v.date))return fail(`You can enter only up to ${CFG.backDays} day(s) back. Ask the owner for older bills.`);
    if(ed&&mOf(x.date)!==mOf(v.date))return fail("The date can't move to another month. Cancel this voucher and enter a new one.");
    const it={...v,date:x.date,mode:x.mode,payee:(x.payee||"").trim(),bill:(x.bill||"").trim(),note:(x.note||"").trim(),mref:x.mode==="bank"?(x.mref||"").trim():"",amt};
    if(type!=="pt"){const r=rlist().find(z=>z.id===x.rid);const d=docs().find(z=>z.key===x.docKey);
      Object.assign(it,{dir:x.dir,doc:d?{key:d.key,ref:d.ref}:(x.docTxt||"").trim()?{key:"",ref:x.docTxt.trim()}:null});
      if(!it.doc&&x.dir!=="other")return fail("Pick the challan / GRN, or type its number.");
      if(nil){Object.assign(it,{rid:"",rname:"",rate:0,mrate:0,trips:0,qty:0,extra:0,amt:0,veh:"",payee:it.payee});if(!it.doc)return fail("No charge needs a challan / GRN.")}
      else{const q=num(type==="tr"?x.trips:x.qty),rt=num(x.rate);
        if(!it.payee)return fail(type==="tr"?"Enter the transporter or driver name.":"Enter the hamal / gang name.");
        if(!(q>0))return fail(type==="tr"?"Enter the number of trips.":"Enter the quantity.");if(!(rt>0))return fail("Enter the rate.");
        if((!r||rt>num(r.rate))&&!(x.rateWhy||"").trim())return fail("Write why this rate is used.");
        if(type==="tr"&&num(x.extra)>0&&!(x.extraWhy||"").trim())return fail("Write the reason for the extra amount.");
        Object.assign(it,{rid:r?r.id:"",rname:r?r.name+(r.veh?" · "+r.veh:""):"",unit:r?r.unit||"trip":type==="tr"?"trip":"",mrate:r?num(r.rate):0,rate:rt,rateWhy:(!r||rt>num(r.rate))?x.rateWhy.trim():"",
          trips:type==="tr"?q:0,qty:type==="ld"?q:0,extra:type==="tr"?num(x.extra):0,extraWhy:type==="tr"&&num(x.extra)>0?x.extraWhy.trim():"",veh:type==="tr"?(x.veh||"").toUpperCase().replace(/\s+/g," ").trim():""})}}
    else{if(!(amt>0))return fail("Enter the amount.");if(!it.note)return fail("Write what the money was for.");Object.assign(it,{head:x.head})}
    if(it.mode==="bank"&&!it.mref)return fail("Enter the UPI / bank reference.");
    btn.disabled=true;btn.textContent="Saving…";
    try{const file=f.ph&&f.ph.files[0];if(!ed){it.id=nid();it.at=Date.now();it.by=who();it.st="pending";it.h=[]}
      if(file&&!nil){const d=await compress(file);await savePhoto(it.id,it.date,d);it.photo=true}
      if(ed){const ch=diffFields(v,it);if(ch||file){it.h=[...(v.h||[]),{k:v.st==="query"&&mine(v)?"reply":"edit",at:Date.now(),...who(),what:ch+(file?" photo replaced":"")}]}
        if(v.st==="query"&&mine(v))it.st="pending";if(!ch&&!file&&v.st!=="query"){close();return}}
      await write("kxv",it,{assignNo:!ed});close();toast(vno(it)+(ed?" updated":" saved")+(flags(it).length?" — flagged for the owner":""))}
    catch(er){toast(errMsg(er));btn.disabled=false;btn.textContent=ed?"Save changes":"Save voucher"}}}
function diffFields(a,b){const L={date:"date",amt:"amount",rate:"rate",trips:"trips",qty:"qty",payee:"paid to",veh:"vehicle",mode:"paid by",extra:"extra",head:"head",bill:"bill no"};
  const out=[];for(const k in L){const x=a[k]??"",y=b[k]??"";if(String(x)!==String(y))out.push(`${L[k]} ${k==="amt"||k==="rate"||k==="extra"?inr(x):x||"—"} → ${k==="amt"||k==="rate"||k==="extra"?inr(y):y||"—"}`)}
  if((a.doc&&a.doc.ref)!==(b.doc&&b.doc.ref))out.push(`document ${a.doc?a.doc.ref:"—"} → ${b.doc?b.doc.ref:"—"}`);return out.join("; ")}
function openV(id){const v=V.find(x=>x.id===id);if(!v){toast("Voucher not found.");return}const f=flags(v);
  const row=(k,val)=>val||val===0?`<dt>${k}</dt><dd>${val}</dd>`:"";
  let h=`<div class="kx-rt"><span>${stPill(v)}</span><b class="kx-big">${v.mode==="nil"?"₹0":inr(v.amt)}</b></div><dl class="kx-dl">
    ${row("Date",fD(v.date))}${row("Type",v.type==="pt"?"Petty — "+esc(headName(v.head)):esc(TL[v.type]+" — "+(DL[v.type][v.dir]||"")))}
    ${row("Challan / GRN",v.doc?esc(v.doc.ref)+(v.doc.key?"":" (typed, not in app)"):"")}${row("Paid to",esc(v.payee))}${row("Vehicle",esc(v.veh))}
    ${row("Rate list",v.type!=="pt"&&v.mode!=="nil"?(v.rname?esc(v.rname)+" · "+inr(v.mrate):"Not in list"):"")}
    ${row("Worked out",v.type!=="pt"&&v.mode!=="nil"?`${v.type==="tr"?v.trips+" trip(s)":v.qty+" "+esc(v.unit||"")} × ${inr(v.rate)}${num(v.extra)?" + "+inr(v.extra)+" ("+esc(v.extraWhy)+")":""}`:"")}
    ${row("Reason for rate",esc(v.rateWhy))}${row("Paid by",esc(ML[v.mode])+(v.mref?" · ref "+esc(v.mref):""))}${row("Bill / slip no.",esc(v.bill))}${row("Note",esc(v.note))}
    ${row("Entered",fDT(v.at)+" by "+(RL[v.by&&v.by.role]||""))}${v.ap?row(v.st==="approved"?"Approved":"Decided",fDT(v.ap.at)+" by "+(RL[v.ap.role]||"")):""}${row(v.st==="query"?"Query":v.st==="rejected"?"Rejected because":v.st==="cancelled"?"Cancelled because":"",esc(v.stNote))}</dl>`;
  if(f.length)h+=`<div class="kx-flags"><b>Check before approving</b><ul>${f.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
  if(v.photo)h+=`<button class="kx-btn wide" data-kx="photo" data-id="${v.id}">Show bill photo</button><div data-img></div>`;
  if((v.h||[]).length)h+=`<details class="kx-hist"><summary>History (${v.h.length})</summary><ul>${v.h.map(x=>`<li>${fDT(x.at)} · ${RL[x.role]||""}: ${esc({edit:"changed",reply:"replied and resubmitted",approve:"approved",query:"sent a query",reject:"rejected",cancel:"cancelled",reopen:"reopened"}[x.k]||x.k)}${x.what?" — "+esc(x.what):""}</li>`).join("")}</ul></details>`;
  const acts=[];
  if(canApprove(v))acts.push(`<button class="kx-btn p" data-kx="appr" data-id="${v.id}">Approve</button>`,`<button class="kx-btn" data-kx="query" data-id="${v.id}">Ask a question</button>`,`<button class="kx-btn danger" data-kx="reject" data-id="${v.id}">Reject</button>`);
  if(canEdit(v))acts.push(`<button class="kx-btn" data-kx="edit" data-id="${v.id}">${v.st==="query"&&mine(v)?"Edit and resubmit":"Edit"}</button>`);
  if(canCancel(v))acts.push(`<button class="kx-btn danger" data-kx="cancel" data-id="${v.id}">Cancel voucher</button>`);
  if(isOwn()&&v.st==="approved"&&!isLocked(v.date))acts.push(`<button class="kx-btn" data-kx="reopen" data-id="${v.id}">Reopen</button>`);
  if(isLocked(v.date))h+=note(mName(mOf(v.date))+" is closed. This voucher can't be changed.");
  sheet(vno(v)+" · "+(v.type==="pt"?"Petty expense":TL[v.type]),h+(acts.length?`<div class="kx-btns kx-gap">${acts.join("")}</div>`:""))}
async function setSt(v,st,txt,k){const it={...v,st,stNote:txt||"",h:[...(v.h||[]),{k,at:Date.now(),...who(),what:txt||""}]};
  if(st==="approved"||st==="rejected"||st==="query")it.ap={...who(),at:Date.now()};if(st==="pending")delete it.ap;await write("kxv",it);return it}
function countForm(){const cb=cashBook();const exp=cb?cb.bal:null;
  const b=sheet("Count the cash box",`<form class="kx-form"><p class="kx-meta">Count every note and coin in the box. Do this every evening.</p><div class="kx-den">${DEN.map(d=>`<label class="kx-f"><span>₹${d} ×</span><input name="d${d}" type="number" inputmode="numeric" min="0" step="1"></label>`).join("")}<label class="kx-f"><span>Coins total ₹</span><input name="coins" type="number" inputmode="decimal" min="0" step="any"></label></div>
    <div class="kx-calc" data-calc></div><label class="kx-f" data-show="why"><span>Why is it different?</span><input name="note"></label>
    <div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Cancel</button><button class="kx-btn p">Save count</button></div></form>`);
  const f=$("form",b);const tot=()=>{const x=read(f);return r2(DEN.reduce((a,d)=>a+num(x["d"+d])*d,0)+num(x.coins))};
  const calc=()=>{const t=tot(),d=exp==null?null:r2(t-exp);$("[data-calc]",f).innerHTML=`Counted <b>${inr(t)}</b>${exp!=null?` · should be ${inr(exp)} · ${diffTxt(d)}`:""}`;$('[data-show="why"]',f).hidden=!(d&&d!==0)};
  f.addEventListener("input",calc);calc();
  f.onsubmit=async e=>{e.preventDefault();const x=read(f),t=tot(),d=exp==null?null:r2(t-exp);if(d&&!x.note.trim()){toast("Write why the cash is different.");return}
    if(!(t>0)&&!confirm("Save a count of ₹0?"))return;const den={};DEN.forEach(n=>{if(num(x["d"+n]))den[n]=num(x["d"+n])});
    try{await write("kxc",{id:nid(),t:"count",date:today(),counted:t,expected:exp,diff:d,den,coins:num(x.coins),note:x.note.trim(),by:who(),at:Date.now()});close();toast(d?"Count saved — the owner will see the difference":"Count saved")}catch(er){toast(errMsg(er))}}}
function moneyForm(t){const cb=cashBook();const due=cb?r2(Math.max(0,num(CFG.float)-cb.bal)):"";
  const b=sheet(t==="topup"?"Give cash to the factory":"Return cash to the office",`<form class="kx-form">${fld("Amount (₹)","amt",t==="topup"?due||"":"","number")}${fld("Date","date",today(),"date",`max="${today()}"`)}${fld("Note","note","","text",t==="topup"?'placeholder="e.g. top-up for vouchers up to 14 Oct"':"")}
    <p class="kx-meta">${t==="topup"?"It is added to the cash box only after the person who takes it taps \"I received\" in their app.":"The office has to confirm they received it."}</p>
    <div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Cancel</button><button class="kx-btn p">Save</button></div></form>`);
  const f=$("form",b);f.onsubmit=async e=>{e.preventDefault();const x=read(f);if(!(num(x.amt)>0)){toast("Enter the amount.");return}if(isLocked(x.date)){toast("That month is closed.");return}
    try{await write("kxc",{id:nid(),t,date:x.date,amt:r2(x.amt),note:x.note.trim(),by:who(),at:Date.now(),ack:null});close();toast("Saved. Waiting for confirmation.")}catch(er){toast(errMsg(er))}}}
function stmt(p,m){const vs=V.filter(v=>mOf(v.date)===m&&live(v)&&norm(v.payee)===norm(p)).sort((a,b)=>a.date.localeCompare(b.date));
  const cr=vs.filter(v=>v.mode==="credit"),crT=r2(cr.reduce((a,v)=>a+num(v.amt),0)),s=ST.find(x=>x.m===m&&norm(x.payee)===norm(p));
  let h=`<p class="kx-meta">${mName(m)} · ${vs.length} entr${vs.length===1?"y":"ies"} · ${inr(vs.reduce((a,v)=>a+num(v.amt),0))} in all · on monthly bill ${inr(crT)}</p>
  <div class="kx-tw"><table class="kx-tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Challan / vehicle</th><th class="n">Amount</th><th>Paid</th></tr></thead><tbody>${vs.map(v=>`<tr class="kx-click" data-kx="open" data-id="${v.id}"><td>${fD(v.date)}</td><td>${vno(v)}</td><td>${esc((v.doc?v.doc.ref:"")+(v.veh?" · "+v.veh:""))}</td><td class="n">${inr(v.amt)}</td><td>${v.mode==="credit"?"On bill":esc(ML[v.mode].split(" ")[0])}</td></tr>`).join("")}<tr class="kx-tot"><td colspan="3">On monthly bill</td><td class="n">${inr(crT)}</td><td></td></tr></tbody></table></div>`;
  if(s)h+=`<div class="kx-card"><b>Their bill ${esc(s.bill)}: ${inr(s.billAmt)}</b><div class="kx-meta">App total ${inr(s.appAmt)} · ${diffTxt(r2(s.appAmt-s.billAmt))}${s.note?" · "+esc(s.note):""}</div>${s.paid?`<div class="kx-meta">Paid ${fD(s.paid.date)} · ${esc(s.paid.ref)}</div>`:""}</div>`;
  if(isAppr()&&cr.length&&!(s&&s.paid))h+=`<form class="kx-form" data-st><h4>${s?"Update":"Match"} their bill</h4><div class="kx-2">${fld("Their bill no.","bill",s&&s.bill)}${fld("Bill amount (₹)","billAmt",s&&s.billAmt,"number")}</div><div class="kx-calc" data-calc></div>${fld("Note","note",s&&s.note)}
    ${s?`<div class="kx-2">${fld("Paid on","pdate",today(),"date")}${fld("Cheque / UPI ref","pref","")}</div>`:""}<div class="kx-btns"><button class="kx-btn p" name="act" value="save">Save bill check</button>${s?`<button class="kx-btn" name="act" value="paid">Mark paid</button>`:""}</div></form>`;
  const b=sheet(p,h);const f=$("form[data-st]",b);if(!f)return;
  const c=()=>{const d=r2(crT-num(f.billAmt.value));$("[data-calc]",f).innerHTML=num(f.billAmt.value)?(d===0?"Matches the trips entered.":`<span class="kx-warn">Bill is ${d<0?"higher":"lower"} than the trips entered by ${inr(Math.abs(d))}. Don't pay the difference until it is explained.</span>`):""};f.addEventListener("input",c);c();
  f.onsubmit=async e=>{e.preventDefault();const act=e.submitter&&e.submitter.value;const x=read(f);if(!x.bill.trim()||!(num(x.billAmt)>0)){toast("Enter their bill number and amount.");return}
    const it={...(s||{id:nid(),payee:p,m,date:m+"-01",by:who(),at:Date.now()}),bill:x.bill.trim(),billAmt:r2(x.billAmt),appAmt:crT,diff:r2(crT-num(x.billAmt)),vids:cr.map(v=>v.id),note:x.note.trim()};
    if(act==="paid"){if(!x.pref.trim()){toast("Enter the cheque or UPI reference.");return}if(it.diff&&!it.note){toast("The bill differs. Write a note explaining it before paying.");return}it.paid={date:x.pdate,ref:x.pref.trim(),...who(),at:Date.now()}}
    try{await write("kxs",it);toast(act==="paid"?"Marked paid":"Bill check saved");stmt(p,m)}catch(er){toast(errMsg(er))}}}
async function exportCsv(m){await loadMonth(m);const vs=V.filter(v=>mOf(v.date)===m&&live(v)).sort((a,b)=>a.date.localeCompare(b.date)||a.no-b.no);
  const led=v=>v.type==="tr"?"Freight "+({out:"outward",in:"inward",inter:"inter-unit",other:"other"}[v.dir]||""):v.type==="ld"?"Loading & unloading (hamali)":headName(v.head);
  const rows=[["Date","Voucher no","Ledger","Paid to","Narration","Challan / GRN","Vehicle","Qty","Rate","Amount","Paid by","Ref / bill no","Status","Flags"]];
  vs.forEach(v=>rows.push([v.date.split("-").reverse().join("-"),vno(v),led(v),v.payee||"",v.type==="pt"?v.note:[v.rname,v.note].filter(Boolean).join(" · "),v.doc?v.doc.ref:"",v.veh||"",v.type==="tr"?v.trips:v.type==="ld"?v.qty:"",v.rate||"",r2(v.amt),ML[v.mode],[v.mref,v.bill].filter(Boolean).join(" / "),v.st,flags(v).join("; ")]));
  const txt=rows.map(r=>r.map(c=>{const s=String(c??"");return/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(",")).join("\n");const name=`${A.key}-expenses-${m}.csv`;
  let dl=null;try{dl=window.claude&&window.claude.use?await window.claude.use("downloads"):null}catch(e){}
  if(dl){try{await dl.save({filename:name,data:txt});return}catch(e){if(e&&e.code==="declined")return}}
  try{await navigator.clipboard.writeText(txt);toast("Copied. Paste it into Excel or Google Sheets.");return}catch(e){}
  sheet("Export "+mName(m),`<p class="kx-meta">Select all and copy, then paste into Excel.</p><textarea class="kx-ta" rows="12" readonly>${esc(txt)}</textarea>`)}
function listEditor(key){const cfgK={setRoutes:"routes",setWorks:"works",setHeads:"heads"}[key],L=JSON.parse(JSON.stringify(CFG[cfgK]||[]));
  const cols={routes:[["name","Route (from → to)","text"],["veh","Vehicle type","text"],["rate","Rate per trip ₹","number"]],works:[["name","Work","text"],["unit","Per (reel / bundle / ton / trip)","text"],["rate","Rate ₹","number"]],heads:[["name","Head","text"],["budget","Monthly budget ₹ (0 = none)","number"]]}[cfgK];
  const title={routes:"Transport rate list",works:"Loading / unloading rates",heads:"Petty expense heads"}[cfgK];
  const rowH=(r,i)=>`<div class="kx-er" data-i="${i}">${cols.map(([k,l,t])=>fld(l,k+"_"+i,r[k],t)).join("")}<button type="button" class="kx-x" data-rm="${i}" aria-label="Remove">×</button></div>`;
  const b=sheet(title,`<form class="kx-form"><p class="kx-meta">${cfgK==="heads"?"Removing a head keeps old vouchers as they are.":"A new rate applies to new vouchers. Old vouchers keep the rate they were made with."}</p><div data-rows>${L.map(rowH).join("")}</div>
    <button type="button" class="kx-btn wide ghost" data-add>+ Add row</button><div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Cancel</button><button class="kx-btn p">Save</button></div></form>`);
  const f=$("form",b);let n=L.length;
  if(!n){$("[data-rows]",f).insertAdjacentHTML("beforeend",rowH({},n++))}
  $("[data-add]",f).onclick=()=>{$("[data-rows]",f).insertAdjacentHTML("beforeend",rowH(cfgK==="works"?{unit:"reel"}:{},n++))};
  f.addEventListener("click",e=>{const r=e.target.closest("[data-rm]");if(r)r.parentElement.remove()});
  f.onsubmit=async e=>{e.preventDefault();const x=read(f),out=[];$$(".kx-er",f).forEach(el=>{const i=el.dataset.i,o={id:(L[i]&&L[i].id)||(cfgK[0]+nid())};cols.forEach(([k,,t])=>o[k]=t==="number"?num(x[k+"_"+i]):(x[k+"_"+i]||"").trim());if(o.name)out.push(o)});
    if(cfgK!=="heads"&&out.some(o=>!(o.rate>0))){toast("Every row needs a rate.");return}
    try{await saveCfg({[cfgK]:out});close();toast("Saved")}catch(er){}}}
function genForm(){const c=CFG;const nd=c.need||DEF.need;
  const b=sheet("Cash box and rules",`<form class="kx-form"><div class="kx-2">${fld("Cash float (₹)","float",c.float,"number")}${fld("Cash held by","custodian",c.custodian,"text",'placeholder="Factory manager\'s name"')}</div>
   ${c.anchor?`<p class="kx-meta">Cash book started ${fD(c.anchor.date)} with ${inr(c.anchor.amt)}. <button type="button" class="kx-link" data-reset>Restart the cash book</button></p><div data-anc hidden>`:"<div data-anc>"}<div class="kx-2">${fld("Cash in the box now (₹)","aamt",c.anchor?"":"","number")}${fld("As on date","adate",today(),"date")}</div></div>
   <div class="kx-2">${fld("Bill photo needed from (₹)","photoAbove",c.photoAbove,"number")}${fld("Staff can enter how many days back","backDays",c.backDays,"number")}</div>
   ${fld("Check challans and inwards from","start",c.start||today(),"date")}
   <p class="kx-meta"><b>Every dispatch / inward must have:</b></p><div class="kx-checks">${[["out","Dispatch"],["in","Inward"],["inter","Between units"]].map(([k,l])=>`<div><b>${l}</b><label><input type="checkbox" name="${k}Tr" ${nd[k+"Tr"]?"checked":""}> transport</label><label><input type="checkbox" name="${k}Ld" ${nd[k+"Ld"]?"checked":""}> loading / unloading</label></div>`).join("")}</div>
   <div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Cancel</button><button class="kx-btn p">Save</button></div></form>`);
  const f=$("form",b);const rs=$("[data-reset]",f);if(rs)rs.onclick=()=>{$("[data-anc]",f).hidden=false;rs.parentElement.hidden=true};
  f.onsubmit=async e=>{e.preventDefault();const x=read(f);const patch={float:num(x.float),custodian:x.custodian.trim(),photoAbove:num(x.photoAbove),backDays:Math.max(0,Math.round(num(x.backDays))),start:x.start||today(),
    need:{outTr:!!x.outTr,outLd:!!x.outLd,inTr:!!x.inTr,inLd:!!x.inLd,interTr:!!x.interTr,interLd:!!x.interLd}};
    if(!$("[data-anc]",f).hidden&&x.aamt!==""){if(isLocked(x.adate)){toast("That month is closed.");return}patch.anchor={date:x.adate,amt:r2(x.aamt)}}
    else if(!c.anchor&&x.aamt===""){toast("Enter the cash in the box now (₹0 if empty).");return}
    try{await saveCfg(patch);close();toast("Saved")}catch(er){}}}
async function lockMonth(m){const vs=V.filter(v=>mOf(v.date)===m);const p=vs.filter(v=>v.st==="pending"||v.st==="query").length;
  if(p){toast(`${p} voucher${p>1?"s are":" is"} not approved yet. Approve, reject or cancel them first.`);return}
  const cb=cashBook();const patch={lockedUpto:m,anchorHist:[...(CFG.anchorHist||[]),{m,prevLock:CFG.lockedUpto||"",prevAnchor:CFG.anchor||null}]};
  let msg=`Close ${mName(m)}? No one can add or change its vouchers after this.`;
  if(cb&&CFG.anchor.date<=mEnd(m)){const rs=cb.rows.filter(r=>r.date<=mEnd(m)&&!r.count);const bal=rs.length?rs[rs.length-1].bal:cb.open;patch.anchor={date:mAdd(m,1)+"-01",amt:bal};msg+=` Closing cash ${inr(bal)} is carried to ${mName(mAdd(m,1))}.`}
  if(!confirm(msg))return;try{await saveCfg(patch);toast(mName(m)+" closed")}catch(e){}}
async function unlockMonth(){const h=[...(CFG.anchorHist||[])];const last=h.pop();if(!last||last.m!==CFG.lockedUpto){toast("Can't unlock this month.");return}
  if(!confirm(`Reopen ${mName(last.m)}? Its vouchers can be changed again.`))return;try{await saveCfg({lockedUpto:last.prevLock,anchor:last.prevAnchor,anchorHist:h});toast(mName(last.m)+" reopened")}catch(e){}}
function purgeForm(){if(LOCAL){toast("Photos are on this phone only.");return}const def=CFG.lockedUpto||mAdd(mOf(today()),-3);
  const b=sheet("Delete old bill photos",`<form class="kx-form"><p class="kx-meta">Deletes the photos only. Vouchers, amounts and history stay. Keep the paper bills filed by voucher number.</p>${fld("Delete photos of months up to","m",def,"month",`max="${CFG.lockedUpto||mAdd(mOf(today()),-1)}"`)}<div class="kx-btns"><button type="button" class="kx-btn" data-kx="close">Cancel</button><button class="kx-btn danger">Delete photos</button></div></form>`);
  const f=$("form",b);f.onsubmit=async e=>{e.preventDefault();const m=f.m.value;if(!m)return;if(!isLocked(m+"-01")){toast("Close that month first.");return}if(!confirm(`Delete all bill photos up to ${mName(m)}? This can't be undone.`))return;
    try{const s=await db.collection("kxi").where("m","<=",m).limit(500).get();for(const d of s.docs)await db.collection("kxi").doc(d.id).delete();close();toast(s.docs.length+" photos deleted")}catch(er){toast(errMsg(er))}}}
function helpSheet(){const r=role();
  const fac=`<h4>Every day</h4><ol><li>Pay from the cash box only. Every rupee paid gets a voucher in the app <b>the same day</b>.</li><li>Transport: pick the challan or GRN, the route from the rate list, and the vehicle number. The app works out the amount.</li><li>Loading / unloading: pick the challan or GRN and the work. Quantity × list rate.</li><li>Photo of the bill or slip. Write the voucher number on the paper slip and file it.</li><li>If the party sends its own vehicle or your staff loads, tap <b>No charge</b> on that challan.</li><li>Before leaving, <b>Count cash</b>. The app shows if it is short.</li></ol><h4>When you get cash</h4><p>Tap <b>I received</b> only after the money is in your hand.</p><h4>Queries</h4><p>If the owner asks a question, open the voucher, fix or explain, and resubmit.</p>`;
  const appr=`<h4>Why money can't leak</h4><ul><li><b>Fixed float.</b> The box always holds a known amount. Cash given + vouchers = float. Whatever is not in vouchers must be in the box.</li><li><b>Serial voucher numbers.</b> Nothing is ever deleted. Cancelled vouchers stay visible with the reason.</li><li><b>Rate lists.</b> The amount is worked out from your fixed rates. A higher rate needs a reason and is flagged.</li><li><b>Linked to challans and GRNs.</b> Every dispatch and inward must have its transport and loading entered, or marked no charge. Missing ones are listed.</li><li><b>Duplicates and late entries</b> are flagged automatically.</li><li><b>Two people for every cash handover.</b> Cash given counts only after the other person confirms.</li><li><b>Daily count.</b> Short cash shows up the same day, not at month end.</li><li><b>Transporter bills</b> are matched against the trips entered before you pay.</li><li><b>Month close</b> locks the month after everything is approved.</li></ul>
  <h4>Your routine</h4><ol><li>Daily: open <b>Approve</b>, approve clean vouchers together, check flagged ones.</li><li>When the box runs low: <b>Give cash</b> for the top-up shown.</li><li>Month end: open <b>Month</b>, clear the checklist, match transporter bills, export for Tally, then close the month.</li></ol>`;
  sheet("How expenses work",`<div class="kx-help">${r==="factory"?fac:appr+fac.replace("<h4>Every day</h4>","<h4>What the factory does every day</h4>")}</div>`)}

/* ---------- actions ---------- */
const ACT={close,view:d=>{UI.view=d.v;changed();window.scrollTo(0,0)},vf:d=>{UI.vf=d.f;changed()},
  mprev:d=>{UI[d.k]=mAdd(UI[d.k],-1);changed()},mnext:d=>{if(UI[d.k]<mOf(today()))UI[d.k]=mAdd(UI[d.k],1);changed()},
  new:d=>voucherForm(d.t,null,d.doc?{docKey:d.doc}:{}),open:d=>openV(d.id),edit:d=>{const v=V.find(x=>x.id===d.id);v&&voucherForm(v.type,v)},
  photo:async(d,el)=>{el.disabled=true;el.textContent="Loading photo…";try{const p=await getPhoto(d.id);const box=$("[data-img]",el.parentElement);el.remove();box.innerHTML=p?`<img class="kx-img" src="${p}" alt="Bill photo">`:`<p class="kx-meta">The photo was deleted to free space.</p>`}catch(e){el.textContent="Couldn't load the photo";el.disabled=false}},
  appr:async d=>{const v=V.find(x=>x.id===d.id);try{await setSt(v,"approved","","approve");close();toast(vno(v)+" approved")}catch(e){toast(errMsg(e))}},
  query:d=>{const v=V.find(x=>x.id===d.id);askText("Ask about "+vno(v),"Your question","Send query",t=>setSt(v,"query",t,"query"))},
  reject:d=>{const v=V.find(x=>x.id===d.id);askText("Reject "+vno(v),"Why is it rejected? The cash is then counted as short in the box.","Reject",t=>setSt(v,"rejected",t,"reject"))},
  cancel:d=>{const v=V.find(x=>x.id===d.id);askText("Cancel "+vno(v),"Why cancel? The voucher number stays, marked cancelled.","Cancel voucher",t=>setSt(v,"cancelled",t,"cancel"))},
  reopen:d=>{const v=V.find(x=>x.id===d.id);askText("Reopen "+vno(v),"Why reopen?","Reopen",t=>setSt(v,"pending",t,"reopen"))},
  apprClean:async(d,el)=>{const q=V.filter(v=>v.st==="pending"&&(isOwn()||!mine(v))&&!flags(v).length&&!isLocked(v.date));if(!q.length)return;el.disabled=true;
    const by={};q.forEach(v=>{(by[mOf(v.date)]=by[mOf(v.date)]||[]).push({...v,st:"approved",stNote:"",ap:{...who(),at:Date.now()},h:[...(v.h||[]),{k:"approve",at:Date.now(),...who(),what:""}]})});
    try{for(const m in by)await write("kxv",by[m]);toast(q.length+" approved")}catch(e){toast(errMsg(e));el.disabled=false}},
  count:countForm,topup:()=>moneyForm("topup"),ret:()=>moneyForm("return"),
  ack:d=>{const c=C.find(x=>x.id===d.id);if(!c)return;if(!confirm(`Confirm you have ${inr(c.amt)} in hand?`))return;write("kxc",{...c,ack:{...who(),at:Date.now()}}).then(()=>toast("Confirmed")).catch(e=>toast(errMsg(e)))},
  void:d=>{const c=C.find(x=>x.id===d.id);if(!c||c.ack)return;if(!confirm("Withdraw this entry?"))return;write("kxc",{...c,void:{...who(),at:Date.now()}}).then(()=>toast("Withdrawn")).catch(e=>toast(errMsg(e)))},
  nil:async(d,el)=>{const doc=docs().find(x=>x.key===d.doc);if(!doc)return;if(!confirm(`Mark ${doc.ref} as no charge${d.nt&&d.nl?" for transport and loading":d.nt?" for transport":" for loading / unloading"}? (Party's vehicle or our own staff.)`))return;
    el.disabled=true;const base={date:doc.date>=addDays(today(),-num(CFG.backDays))||isOwn()?doc.date:today(),dir:kindOf(doc),doc:{key:doc.key,ref:doc.ref},mode:"nil",amt:0,rate:0,mrate:0,st:"pending",by:who(),h:[]};
    if(isLocked(base.date))base.date=today();
    try{const its=[];if(d.nt)its.push({...base,id:nid(),at:Date.now(),type:"tr"});if(d.nl)its.push({...base,id:nid(),at:Date.now(),type:"ld"});await write("kxv",its,{assignNo:true});toast(doc.ref+" marked no charge")}catch(e){toast(errMsg(e));el.disabled=false}},
  missAll:d=>{const m=d.m;const ms=m?missing(m+"-01"<missFrom()?missFrom():m+"-01",mEnd(m)):missing(missFrom(),today());sheet("Challans and inwards with no entry",ms.length?ms.map(missRow).join(""):empty("All entered."))},
  list:d=>{UI.view="list";UI.vf=d.f||"all";if(d.m)UI.vm=d.m;changed();window.scrollTo(0,0)},cashm:d=>{UI.view="cash";UI.cm=d.m||UI.cm;changed()},
  stmt:d=>stmt(d.p,d.m),csv:d=>exportCsv(d.m),lock:d=>lockMonth(d.m),unlock:unlockMonth,
  setGen:()=>{if(isOwn())genForm()},setRoutes:()=>listEditor("setRoutes"),setWorks:()=>listEditor("setWorks"),setHeads:()=>listEditor("setHeads"),purge:purgeForm,help:helpSheet};
document.addEventListener("click",e=>{const b=e.target.closest("[data-kx]");if(!b||!A)return;const fn=ACT[b.dataset.kx];if(!fn)return;e.preventDefault();e.stopPropagation();fn({...b.dataset},b)},true);
// nil and missAll from the sheet also need closing the sheet after action — handled by re-render; missAll rows stay usable
})();
