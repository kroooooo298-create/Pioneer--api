import test from 'node:test';
import assert from 'node:assert/strict';
import {rapidDelay,startScheduler} from '../pionex-service/scheduler.mjs';
import {marketClient} from '../pionex-service/server.mjs';
test('rapid cadence subtracts successful work but backs off errors and pauses',()=>{
 assert.equal(rapidDelay({state:'checked'},11000),4000);
 assert.equal(rapidDelay({state:'checked'},30000),1000);
 for(const r of [null,{state:'paused'},{state:'configuration-changed'}])assert.equal(rapidDelay(r,11000),60000);
});
test('a strict rapid caller does not reuse a longer turnover cache',async()=>{
 let now=100000,calls=0;
 const client=marketClient(async()=>{calls++;return Response.json({result:true,timestamp:now})},()=>now,async ms=>{now+=ms});
 const path='/api/v1/market/tickers?type=PERP';
 await client(path,20000);now+=6000;
 await client(path,20000);assert.equal(calls,1);
 await client(path,5000);assert.equal(calls,2);
 await client(path,5000);assert.equal(calls,2);
});
test('rapid scheduler never overlaps a slow ingest and waits before a new fresh batch',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1800000000000});
 let starts=0,posts=0,release;const gate=new Promise(r=>release=r);
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(new URL(url).pathname!=='/internal-rapid')return Response.json({state:'idle'});
  if(!options.body){starts++;return Response.json({ready:true,symbols:[],revision:'r'});}
  posts++;if(posts===1)await gate;return Response.json({state:'checked'});
 });
 const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
 const stop=startScheduler({MONITOR_ENABLED:'true',MONITOR_SITE_URL:'https://site.test',MONITOR_TOKEN:'x'.repeat(32)},()=>{},async()=>({quotes:[],universe:[]}));
 t.mock.timers.tick(15000);await flush();assert.equal(starts,1);
 t.mock.timers.tick(60000);await flush();assert.equal(starts,1);
 release();await flush();t.mock.timers.tick(999);await flush();assert.equal(starts,1);
 t.mock.timers.tick(1);await flush();assert.equal(starts,2);assert.equal(posts,2);
 stop();t.mock.timers.tick(120000);await flush();assert.equal(starts,2);
});
