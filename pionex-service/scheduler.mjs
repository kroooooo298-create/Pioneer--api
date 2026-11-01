// Independent loops; uncertain sends are terminal in the Site outbox.
export async function invoke({url,token,siteAccess,fetcher=fetch,log=()=>{}},path,args){
 const endpoint=new URL(path,url);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!token||token.length<32)throw Error('invalid-configuration');
 const started=Date.now(),id=crypto.randomUUID();let r,stage='response-headers',code;
 try{
  try{r=await fetcher(endpoint,{method:args?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'TrendRadar-Monitor/2.1',...(siteAccess?{'OAI-Sites-Authorization':'Bearer '+siteAccess}:{})},body:args?JSON.stringify(args):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});}catch{throw Error('request-timeout-or-network; no batch retry');}
  if(!r.ok)throw Error('http-'+r.status+'; no batch retry');
  stage='response-body';try{return await r.json()}catch{throw Error('invalid-response; no batch retry')}
 }catch(e){code=e.message;throw e;}
 finally{try{log(JSON.stringify({event:'site-request',id,path,method:args?'POST':'GET',cursor:Number.isInteger(args?.cursor)?args.cursor:undefined,kind:['delivery','positions','subscriptions','rapid-delivery','market-entry'].includes(args?.kind)?args.kind:undefined,stage,status:r?.status,code,ray:r?.headers?.get('cf-ray')?.replace(/[^a-zA-Z0-9-]/g,'').slice(0,80),elapsedMs:Date.now()-started}));}catch{}}
}
export async function sweep(options){
 const call=args=>invoke(options,'/internal-monitor',args),s=await call();if(!s.ready)return {state:'paused-or-setup-required'};
 const recovery=s.recovery;
 if(recovery?.action==='wait')return {state:recovery.reason||'scan-busy'};
 if(recovery&&!['start','resume'].includes(recovery.action))throw Error('invalid-recovery');
 const resume=recovery?.action==='resume'&&options.dry!==true;
 if(resume&&(!Number.isInteger(recovery.cursor)||recovery.cursor<=0||typeof recovery.revision!=='string'||!recovery.revision))throw Error('invalid-recovery');
 let cursor=resume?recovery.cursor:0,revision=resume?recovery.revision:undefined;
 const resumedFrom=cursor;
 for(let batch=0;batch<100;batch++){
  const r=await call({cursor,dry_run:options.dry===true,...(revision?{revision}:{})});
  if(!['checked','dry-run'].includes(r.state))return {state:r.state||'interrupted',cursor,...(r.code?{code:r.code}:{}),...(r.stage?{stage:r.stage}:{})};
  if(revision&&r.revision!==revision)throw Error('configuration-changed');revision=r.revision;
  if(r.nextCursor===null){if(!r.complete)throw Error('incomplete-sweep');return {state:r.state,complete:true,resumedFrom,checked:r.checked,total:r.total,healthy:r.healthy,failed:r.failed};}
  if(!Number.isInteger(r.nextCursor)||r.nextCursor<=cursor||!revision)throw Error('invalid-cursor');cursor=r.nextCursor;
 }
 throw Error('batch-limit');
}
export function scanDelay(result){return result?.complete&&['checked','dry-run'].includes(result.state)&&result.failed===0?15000:60000;}
export async function rapidSweep(options,getQuotes){
 const s=await invoke(options,'/internal-rapid');if(!s.ready)return {state:'paused'};
 if(!Array.isArray(s.symbols)||s.symbols.length>100||typeof s.revision!=='string')throw Error('invalid-rapid-configuration');
 const batch=await getQuotes();return invoke(options,'/internal-rapid',{source:'Pionex',market:'PERP',revision:s.revision,...batch});
}
// Rapid ingestion targets a start-to-start cadence, never overlapping or replaying a batch.
export function rapidDelay(result,elapsedMs){
 return result?.state==='checked'?Math.max(1000,15000-Math.max(0,elapsedMs)):60000;
}
export function startScheduler(env=process.env,log=console.log,getQuotes){
 if(env.MONITOR_ENABLED!=='true')return ()=>{};
 const options={url:env.MONITOR_SITE_URL,token:env.MONITOR_TOKEN,siteAccess:env.MONITOR_SITE_ACCESS,log};let stopped=false;const timers=new Set();
 function loop(kind,delay,work){const schedule=ms=>{const t=setTimeout(async()=>{timers.delete(t);const start=Date.now();let next=typeof delay==='function'?delay(null):delay;try{const r=await work();if(typeof delay==='function')next=delay(r,Date.now()-start);if(kind==='scan'||!['idle','checked','sent','cancelled'].includes(r.state))log(JSON.stringify({job:kind,...r,elapsedMs:Date.now()-start}));}catch(e){log(JSON.stringify({job:kind,state:'interrupted',code:e.message,elapsedMs:Date.now()-start}));}if(!stopped)schedule(next);},ms);timers.add(t);};schedule(15000);}
 if(getQuotes){loop('rapid',rapidDelay,()=>rapidSweep(options,getQuotes));loop('rapid-delivery',5000,()=>invoke(options,'/internal-maintenance',{kind:'rapid-delivery'}));loop('market-entry',15000,()=>invoke(options,'/internal-maintenance',{kind:'market-entry'}));}
 loop('scan',scanDelay,()=>sweep(options));
 loop('subscriptions',15000,()=>invoke(options,'/internal-maintenance',{kind:'subscriptions'}));
 loop('delivery',1500,()=>invoke(options,'/internal-maintenance',{kind:'delivery'}));
 loop('positions',15000,()=>invoke(options,'/internal-maintenance',{kind:'positions'}));
 return ()=>{stopped=true;for(const t of timers)clearTimeout(t);};
}
