import {contract} from './market.mjs';
const numeric=x=>(typeof x==='number'||typeof x==='string'&&x.trim()!=='')&&Number.isFinite(Number(x));
export function parseFunding(bundle,symbol,now=Date.now()){
 const pair=contract(symbol),raw=bundle?.indexes,index=raw?.data?.indexes?.find(x=>x.symbol===pair);
 const stamp=index?.updateTime;
 if(raw?.result!==true||!index||!numeric(index.markPrice)||Number(index.markPrice)<=0||!numeric(index.indexPrice)||Number(index.indexPrice)<=0||!numeric(index.nextFundingRate)||!Number.isFinite(stamp)||now-stamp>90000||stamp>now+5000||!Number.isFinite(index.nextFundingTime)||index.nextFundingTime<=now)throw Error('資金費率／標記價格過期或資料不完整');
 const history=bundle.history;
 let settled=null;
 if(history?.result===true&&history.data?.symbol===pair&&Array.isArray(history.data.rates)){
  const rates=history.data.rates.filter(x=>numeric(x.fundingRate)&&Number.isFinite(x.fundingTime)&&x.fundingTime<=now).sort((a,b)=>b.fundingTime-a.fundingTime);
  if(rates.length)settled={rate:Number(rates[0].fundingRate),time:rates[0].fundingTime};
 }
 return{symbol,pair,source:'Pionex USDT 永續合約',market:'PERP',markPrice:Number(index.markPrice),indexPrice:Number(index.indexPrice),nextRate:Number(index.nextFundingRate),nextTime:index.nextFundingTime,updatedAt:stamp,receivedAt:now,settled};
}
export async function fundingBundle(getJSON,symbol){
 const pair=contract(symbol);
 const indexes=await getJSON('/api/v1/market/indexes',10000);
 let history=null;try{history=await getJSON('/api/v1/market/fundingRates?symbol='+pair+'&limit=1',60000);}catch{}
 return{indexes,history};
}
