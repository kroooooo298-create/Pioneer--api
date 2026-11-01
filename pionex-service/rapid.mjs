import {result} from './market.mjs';
export async function rapidQuotes(getJSON,_symbols,now=Date.now()){
 const metadata=await getJSON('/api/v1/common/symbols?type=PERP',120000);
 const books=await getJSON('/api/v1/market/bookTickers?type=PERP',5000);
 const tickers=await getJSON('/api/v1/market/tickers?type=PERP',20000);
 if(!Number.isFinite(Number(metadata.timestamp))||now-Number(metadata.timestamp)>180000||Number(metadata.timestamp)>now+5000)throw Error('stale-contract-metadata');
 const all=result(metadata).symbols,book=result(books).tickers,ticker=result(tickers).tickers;
 if(![all,book,ticker].every(Array.isArray))throw Error('invalid-market-universe');
 const pairs=all.filter(p=>p.type==='PERP'&&p.status==='TRADING'&&p.quoteCurrency==='USDT'&&/^[A-Z0-9]{1,24}$/.test(p.baseCurrency)&&p.symbol===p.baseCurrency+'_USDT_PERP');
 if(!pairs.length||pairs.length>1000||new Set(pairs.map(p=>p.symbol)).size!==pairs.length)throw Error('invalid-or-oversized-universe');
 const bm=new Map(book.map(x=>[x.symbol,x])),tm=new Map(ticker.map(x=>[x.symbol,x]));
 return {universe:pairs.map(p=>p.baseCurrency+'USDT'),quotes:pairs.flatMap(p=>{const b=bm.get(p.symbol),t=tm.get(p.symbol);if(!b||!t)return [];
 return [{symbol:p.baseCurrency+'USDT',bid:Number(b.bidPrice),ask:Number(b.askPrice),volume:Number(t.amount),time:Math.min(Number(b.timestamp),Number(t.time))}];})};
}
