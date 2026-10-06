// Runs the REAL backend/*.gs code in Node with in-memory fakes for Google services.
// API on :8766 (like the Apps Script /exec URL), frontend/ served on :8765 (like GitHub Pages).
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),http=require('http'),path=require('path');
const B=path.join(__dirname,'..','backend')+path.sep;
const FRONT=path.join(__dirname,'..','frontend');
const TOKEN=process.env.TEST_TOKEN||'7000000000:AAFakeTokenForE2ETestingOnly_xyz123', ADMIN='-4000000001';
const toBuf=x=>Array.isArray(x)?Buffer.from(x.map(b=>b&255)):Buffer.from(x,'utf8');
const sent=[]; const props={BOT_TOKEN:TOKEN,ADMIN_CHAT_ID:ADMIN,WEBAPP_URL:'https://example.github.io/kit/',WEBHOOK_SECRET:'S3cretS3cretS3cretS3cretS3cret12',API_URL:'http://127.0.0.1:8766/'};
const chain=()=>new Proxy(function(){},{get:(t,k)=>k==='then'?undefined:chain(),apply:()=>chain()});
class Sheet{constructor(n,rows){this.n=n;this.d=rows||[];}
 getName(){return this.n} getLastRow(){let r=0;this.d.forEach((row,i)=>{if(row&&row.some(v=>v!==''&&v!=null))r=i+1});return r}
 getLastColumn(){return Math.max(0,...this.d.map(r=>r?r.length:0))} getMaxRows(){return 5000}
 appendRow(a){this.d[this.getLastRow()]=[...a];return this}
 getRange(r,c,nr=1,nc=1){const s=this;if(typeof r==='string')return chain();
  const rg={getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>((s.d[r-1+i]||[])[c-1+j])??'')),
   setValues:v=>{v.forEach((row,i)=>{s.d[r-1+i]=s.d[r-1+i]||[];row.forEach((x,j)=>s.d[r-1+i][c-1+j]=x)});return rg},
   createTextFinder:t=>({matchEntireCell(){return this},findAll:()=>rg.getValues().flat().filter(x=>String(x)===String(t))})};
  return new Proxy(rg,{get:(o,k)=>k in o?o[k]:()=>chain()})}
 getBandings(){return[]} getConditionalFormatRules(){return[]}}
const ctx={console,Logger:{log(){}},
 SpreadsheetApp:{getActiveSpreadsheet:()=>ss,newDataValidation:chain,newConditionalFormatRule:chain,BandingTheme:{},BooleanCriteria:{}},
 CacheService:(()=>{const m=new Map();return{getScriptCache:()=>({get:k=>m.get(k)??null,put:(k,v)=>m.set(k,String(v))})}})(),
 LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v)}})},
 UrlFetchApp:{fetch:(url,o)=>{sent.push({method:url.split('/').pop(),body:JSON.parse(o.payload)});return{getResponseCode:()=>200,getContentText:()=>'{"ok":true,"result":{}}'}}},
 ContentService:{MimeType:{JSON:'json',TEXT:'text'},createTextOutput:s=>{const o={c:s,setMimeType(){return o}};return o}},
 Utilities:{computeHmacSha256Signature(v,k){if(!((typeof v==='string'&&typeof k==='string')||(Array.isArray(v)&&Array.isArray(k))))throw new Error('overload');
   return[...crypto.createHmac('sha256',toBuf(k)).update(toBuf(v)).digest()].map(b=>b>127?b-256:b)},
  newBlob:s=>({getBytes:()=>[...Buffer.from(s,'utf8')].map(b=>b>127?b-256:b)}),getUuid:()=>crypto.randomUUID(),
  formatDate:(d,tz,f)=>{const p=new Date(d.getTime()+7*3600e3);const z=n=>String(n).padStart(2,'0');return f.replace('yy',z(p.getUTCFullYear()%100)).replace('MM',z(p.getUTCMonth()+1)).replace('dd',z(p.getUTCDate()))}}};
vm.createContext(ctx);
for(const f of ['Setup.gs','Validation.gs','Code.gs','Tests.gs'])vm.runInContext(fs.readFileSync(B+f,'utf8'),ctx,{filename:f});
const H=vm.runInContext('LEADS_HEADERS',ctx),CFG=vm.runInContext('DEFAULT_CONFIG_ENTRIES',ctx);
const sheets={Leads:new Sheet('Leads',[[...H]]),Config:new Sheet('Config',[['Key','Value','Description'],...CFG.map(e=>[e.key,e.value,e.description])]),Log:new Sheet('Log',[['Timestamp','Level','Source','Message','Details']])};
const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n)),setSpreadsheetTimeZone(){},getSheets:()=>Object.values(sheets)};
const preflights=[];
http.createServer((req,res)=>{
 if(req.method==='OPTIONS'){preflights.push(req.url);res.writeHead(405);return res.end();}
 if(req.url==='/__state'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({leads:sheets.Leads.d,log:sheets.Log.d,sent,preflights,headers:H}));}
 let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const u=new URL(req.url,'http://x');const e={postData:{contents:b,type:req.headers['content-type']},parameter:Object.fromEntries(u.searchParams)};
  const out=req.method==='GET'?ctx.doGet(e):ctx.doPost(e);
  res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(out.c);});
}).listen(8766,'127.0.0.1',()=>console.log('mock GAS on 8766'));

const TYPES={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};
http.createServer((req,res)=>{const f=path.join(FRONT,decodeURIComponent(new URL(req.url,'http://x').pathname));
 if(!f.startsWith(FRONT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
}).listen(8765,'127.0.0.1',()=>console.log('frontend on 8765'));
