// One sweep at a time. Unknown HTTP/notification outcomes are never retried here.
export async function sweep({url,token,siteAccess,fetcher=fetch,dry=false}){
 const endpoint=new URL('/internal-monitor',url);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!token||token.length<32)throw Error('Invalid monitor configuration');
 const call=async args=>{
  let r;try{r=await fetcher(endpoint,{method:args?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'TrendRadar-Monitor/1.0',...(siteAccess?{'OAI-Sites-Authorization':'Bearer '+siteAccess}:{})},body:args?JSON.stringify(args):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});}catch{throw Error('Monitor request interrupted; no retry');}
  if(!r.ok)throw Error('Monitor HTTP '+r.status+'; no retry');
  return r.json();
 };
 const status=await call();if(!status.ready)return {state:'paused-or-setup-required'};
 let cursor=0,revision;
 for(let batch=0;batch<100;batch++){
  const r=await call({cursor,dry_run:dry,...(revision?{revision}:{})});
  if(!['checked','dry-run'].includes(r.state))return {state:r.state||'interrupted'};
  if(revision&&r.revision!==revision)throw Error('Configuration changed; stopped');
  revision=r.revision;
  if(r.nextCursor===null){
   if(!r.complete)throw Error('Incomplete monitor sweep');
   return {state:r.state,complete:true,checked:r.checked,total:r.total,healthy:r.healthy,failed:r.failed};
  }
  if(!Number.isInteger(r.nextCursor)||r.nextCursor<=cursor||!revision)throw Error('Invalid monitor cursor; stopped');
  cursor=r.nextCursor;
 }
 throw Error('Monitor batch limit reached');
}
export function startScheduler(env=process.env,log=console.log){
 if(env.MONITOR_ENABLED!=='true')return ()=>{};
 let stopped=false,timer;
 const tick=async()=>{
  try{log('monitor '+JSON.stringify(await sweep({url:env.MONITOR_SITE_URL,token:env.MONITOR_TOKEN,siteAccess:env.MONITOR_SITE_ACCESS})));}
  catch{log('monitor interrupted; check website status; no batch retry');}
  if(!stopped)timer=setTimeout(tick,60000);
 };
 timer=setTimeout(tick,15000);
 return ()=>{stopped=true;clearTimeout(timer);};
}
