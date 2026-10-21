import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPionexLoader,contract,STEPS} from './market.mjs';
import {startScheduler} from './scheduler.mjs';

export function marketClient(fetcher=fetch,clock=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))){
 const cache=new Map();let chain=Promise.resolve(),next=0,queued=0,blockedUntil=0;
 return async(path,ttl)=>{
  if(!/^\/api\/v1\/(common\/symbols\?type=PERP|market\/(bookTickers\?type=PERP|tickers\?type=PERP|klines\?symbol=[A-Z0-9]+_USDT_PERP&interval=(60M|4H)&limit=500))$/.test(path))throw Error('不允許的行情路徑');
  const hit=cache.get(path);if(hit&&(hit.pending||clock()<hit.expires))return hit.promise;
  if(clock()<blockedUntil)throw Error('Pionex 限流或拒絕，暫停重試');
  if(queued>=32)throw Error('行情請求忙碌，請稍後重試');
  queued++;
  const entry={pending:true,expires:0,promise:null};
  const task=chain.catch(()=>{}).then(async()=>{
   if(clock()<blockedUntil)throw Error('Pionex 限流或拒絕，暫停重試');
   if(next>clock())await pause(next-clock());next=clock()+650;
   let r;try{r=await fetcher('https://api.pionex.com'+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw Error('Pionex 行情連線失敗或逾時');}
   if(!r.ok){if([403,429].includes(r.status))blockedUntil=clock()+60000;throw Error('Pionex HTTP '+r.status);}
   let body;try{body=await r.json();}catch{throw Error('Pionex 行情格式異常');}
   if(body?.result!==true)throw Error('Pionex 行情未成功');
   // Cache TTL starts before request so a request crossing a candle boundary
   // cannot preserve an old closed-bar snapshot into the new period.
   entry.expires=started+ttl;return body;
  });
  const started=clock();entry.promise=task.finally(()=>{entry.pending=false;queued--;}).catch(e=>{cache.delete(path);throw e;});chain=entry.promise;cache.set(path,entry);return entry.promise;
 };
}
const hash=s=>createHash('sha256').update(s).digest();
export function relayHandler({token,load}){
 if(typeof token!=='string'||token.length<32)throw Error('RELAY_TOKEN must contain at least 32 characters');
 return async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  if(req.method!=='GET')return send(405,{error:'Method not allowed'});
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/healthz')return send(200,{ok:true,service:'pionex-perp-relay',marketVerified:false});
  const auth=String(req.headers.authorization||'');if(!timingSafeEqual(hash(auth),hash('Bearer '+token)))return send(401,{error:'Unauthorized'});
  if(url.pathname!=='/v1/snapshot')return send(404,{error:'Not found'});
  const symbol=url.searchParams.get('symbol'),tf=url.searchParams.get('tf');
  try{contract(symbol);if(!STEPS[tf]||[...url.searchParams.keys()].some(k=>!['symbol','tf'].includes(k)))throw Error();}catch{return send(400,{error:'Invalid symbol or timeframe'});}
  try{return send(200,await load(symbol,tf));}catch{return send(503,{error:'Pionex 永續行情暫不可用；停止報單，不使用其他來源替代。'});}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const handler=relayHandler({token:process.env.RELAY_TOKEN,load:createPionexLoader(marketClient())});
 const server=createServer(handler);server.requestTimeout=30000;server.headersTimeout=10000;
 server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Pionex public-market relay listening'));
 const stopScheduler=startScheduler();
 process.on('SIGTERM',()=>{stopScheduler();server.close(()=>process.exit(0));});
}
