import {analyze} from '../protected-assets/engine.mjs';
import {candleHealth} from '../protected-assets/journal.mjs';
export const PIONEX_COINS=['BTC','ETH','BNB','XRP','SOL','ZEC','HYPE','DOGE','LINK','ADA','BCH','LTC','UNI','SUI','TAO','SHIB','ENA','AAVE','ONDO','DOT','XAUT','XAG','SOXLX','SKHX','SMCIX','MUX','SNDKX'];
export const PIONEX_LABELS={SOXLX:'半導體 3 倍 ETF',SKHX:'SK 海力士',SMCIX:'Super Micro',MUX:'Micron 美光',SNDKX:'SanDisk',XAUT:'Tether Gold 黃金',XAG:'白銀'};
export const PIONEX_SOURCE='Pionex USDT 永續合約';
export const STEPS={'1h':3600000,'4h':14400000};
export function contract(symbol){const coin=String(symbol).replace(/USDT$/,'');if(!PIONEX_COINS.includes(coin)||symbol!==coin+'USDT')throw Error('不支援的永續合約');return coin+'_USDT_PERP';}
export function result(raw){if(raw?.result!==true||!raw.data)throw Error('Pionex 行情回應無效');return raw.data;}
function fresh(time,now,ttl=90000){return Number.isFinite(time)&&time>0&&time<=now+5000&&now-time<=ttl;}
export function parsePionexBundle(bundle,symbol,tf,now=Date.now()){
 const pair=contract(symbol),step=STEPS[tf],coin=symbol.slice(0,-4);
 if(!step||bundle?.source!=='Pionex'||bundle.market!=='PERP'||bundle.symbol!==pair||bundle.tf!==tf||!fresh(bundle.collectedAt,now))throw Error('行情來源、產品、週期或快照時間不相符');
 const p=bundle.pair;
 if(!fresh(bundle.metadataAt,now,180000)||p?.symbol!==pair||p.type!=='PERP'||p.baseCurrency!==coin||p.quoteCurrency!=='USDT'||p.status!=='TRADING')throw Error('Pionex 合約不存在、暫停交易或產品狀態過期');
 const raw=result(bundle.klines).klines;
 if(!Array.isArray(raw)||raw.length>500)throw Error('Pionex K 線格式無效');
 const rows=raw.map(b=>({t:Number(b.time),end:Number(b.time)+step-1,o:Number(b.open),h:Number(b.high),l:Number(b.low),c:Number(b.close)})).filter(b=>b.end<now).sort((a,b)=>a.t-b.t);
 const issue=candleHealth(rows,step,now);if(issue)throw Error(issue);
 if(rows.at(-1).end!==Math.floor(now/step)*step-1)throw Error('最新收盤 K 線尚未到齊');
 const book=result(bundle.book).tickers?.find(x=>x.symbol===pair),ticker=result(bundle.ticker).tickers?.find(x=>x.symbol===pair);
 const bid=Number(book?.bidPrice),ask=Number(book?.askPrice),event=Number(book?.timestamp),volume=Number(ticker?.amount),volumeTime=Number(ticker?.time);
 if(![bid,ask,volume].every(Number.isFinite)||bid<=0||ask<bid||volume<0||!fresh(event,now)||!fresh(volumeTime,now))throw Error('Pionex 買賣報價或成交額過期／無效');
 const side=analyze(rows)?.state,price=side==='long'?ask:side==='short'?bid:(ask+bid)/2;
 return{rows,source:PIONEX_SOURCE,pair,market:'PERP',quote:{price,event,kind:side==='long'?'賣一價快照':side==='short'?'買一價快照':'買賣中間價快照'},metrics:{bid,ask,volume,spread:(ask-bid)/((ask+bid)/2),event:Math.min(event,volumeTime),received:bundle.collectedAt}};
}
export function createPionexLoader(getJSON,clock=Date.now){
 const now=clock;
 return async(symbol,tf)=>{
  const pair=contract(symbol);if(!STEPS[tf])throw Error('僅支援 1h／4h');
  const metadata=await getJSON('/api/v1/common/symbols?type=PERP',120000);
  const p=result(metadata).symbols?.find(x=>x.symbol===pair);
  if(!p||p.status!=='TRADING'||p.type!=='PERP')throw Error('Pionex 無可交易的 '+pair);
  const klines=await getJSON('/api/v1/market/klines?symbol='+pair+'&interval='+(tf==='1h'?'60M':'4H')+'&limit=500',Math.min(30000,STEPS[tf]-now()%STEPS[tf]));
  // Plural endpoint is the documented Trade API public endpoint; verified to
  // return PERP products. Do not use the singular endpoint which returned 404.
  const book=await getJSON('/api/v1/market/bookTickers?type=PERP',5000);
  const ticker=await getJSON('/api/v1/market/tickers?type=PERP',20000);
  const bundle={source:'Pionex',market:'PERP',symbol:pair,tf,pair:p,metadataAt:Number(metadata.timestamp),collectedAt:now(),klines,book:{...book,data:{tickers:result(book).tickers?.filter(x=>x.symbol===pair)}},ticker:{...ticker,data:{tickers:result(ticker).tickers?.filter(x=>x.symbol===pair)}}};
  parsePionexBundle(bundle,symbol,tf,now());return bundle;
 };
}
