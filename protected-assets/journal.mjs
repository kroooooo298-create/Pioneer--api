// Forward-only, local quote-sampled paper ledger. Never fills a past candle close.
export const JOURNAL_KEY='trend-radar-paper-v1';
export const PAPER_RULES={version:'MA-paper-1',fee:.001,slip:.0005,gap:90000,limit:2000};
export const activePaper=r=>['pending','open'].includes(r.state);
export function candleHealth(rows,step,now=Date.now()){
 if(!Array.isArray(rows)||rows.length<245)return '不足 245 根收盤棒';
 for(let i=0;i<rows.length;i++){const r=rows[i];if(![r.t,r.end,r.o,r.h,r.l,r.c].every(Number.isFinite)||Math.min(r.o,r.h,r.l,r.c)<=0||r.h<Math.max(r.o,r.c,r.l)||r.l>Math.min(r.o,r.c)||r.t%step!==0||r.end-r.t!==step-1||r.end>=now)return 'K 線格式或收盤時間異常';if(i&&r.t-rows[i-1].t!==step)return 'K 線缺漏或順序異常';}
 return null;
}
export function emptyJournal(){return{version:1,records:[]};}
export function readJournal(raw){
 if(!raw)return emptyJournal();const x=JSON.parse(raw);if(x.version!==1||!Array.isArray(x.records)||x.records.length>PAPER_RULES.limit)throw Error('模擬履歷格式無效');const ids=new Set();
 for(const r of x.records){if(!r||typeof r.id!=='string'||ids.has(r.id)||!/^[A-Z0-9]{1,24}$/.test(r.symbol)||!['1h','4h','1d'].includes(r.tf)||!['long','short'].includes(r.side)||!['pending','open','closed','invalid','expired','uncertain'].includes(r.state)||![r.created,r.candle,r.expires,r.observedEvent,r.lastSeen,r.levels?.entry,r.levels?.stop,r.levels?.target,r.levels?.low,r.levels?.high,r.rules?.fee,r.rules?.slip,r.rules?.gap].every(Number.isFinite)||r.levels.stop<=0||r.levels.target<=0||r.rules.fee<0||r.rules.slip<0||r.rules.gap<=0||typeof r.reason!=='string'||typeof r.ruleVersion!=='string')throw Error('模擬履歷紀錄損壞');if(['open','closed'].includes(r.state)&&![r.entry,r.entered,r.risk].every(n=>Number.isFinite(n)&&n>0))throw Error('模擬成交紀錄損壞');if(r.state==='closed'&&![r.exit,r.closed,r.netR].every(Number.isFinite))throw Error('模擬出場紀錄損壞');ids.add(r.id);}return x;
}
export function paperStep(journal,observations,now=Date.now(),suspended=false){
 const next=JSON.parse(JSON.stringify(journal));const byId=new Map(observations.map(o=>[o.symbol+':'+o.tf,o]));
 for(const r of next.records){if(!activePaper(r))continue;const o=byId.get(r.symbol+':'+r.tf),q=o?.quote;const finish=(state,reason)=>{r.state=state;r.ended=now;r.resultReason=reason;};
 if(o?.market&&r.market&&o.market!==r.market){finish('uncertain','行情來源已變更；保留原紀錄並排除績效，不以新來源判斷舊單');continue;}
 if(suspended||now-r.lastSeen>r.rules.gap){finish('uncertain','監測中斷，無法確認期間是否觸價；不納入績效');continue;}
 if(!q?.fresh)continue;
 if(q.event-r.observedEvent>r.rules.gap){finish('uncertain','報價間隔超過 90 秒；不納入績效');continue;}
 if(q.event<=r.observedEvent)continue;
 r.observedEvent=q.event;r.lastSeen=now;const sign=r.side==='long'?1:-1;
 if(r.state==='pending'){
 if(now>=r.expires){finish('expired','下一根訊號棒已收盤，原候選到期');continue;}
 if((q.price-r.levels.stop)*sign<=0||(r.levels.target-q.price)*sign<=0||o.invalid){finish('invalid','原候選越過界線或被策略判定失效');continue;}
 if(!o.healthy||q.price<r.levels.low||q.price>r.levels.high)continue;
 const entry=q.price*(1+sign*r.rules.slip),risk=(entry-r.levels.stop)*sign;if(risk<=0||(r.levels.target-entry)*sign/risk<1.5)continue;
 r.entry=entry;r.entryQuote=q.price;r.entered=now;r.risk=risk;r.state='open';continue;
 }
 const stop=(q.price-r.levels.stop)*sign<=0,target=(q.price-r.levels.target)*sign>=0,ma=o.healthy&&Number.isFinite(o.close)&&Number.isFinite(o.ma60)&&(o.close-o.ma60)*sign<0;
 if(!stop&&!target&&!ma)continue;
 // Gap-through stop uses observed adverse price. Target never gains from overshoot.
 const raw=target?r.levels.target:q.price;r.exit=raw*(1-sign*r.rules.slip);r.closed=now;r.state='closed';r.exitReason=stop?'stop':target?'target':'ma60';r.netR=((r.exit-r.entry)*sign-r.rules.fee*(r.entry+r.exit))/r.risk;
 }
 if(!suspended)for(const o of observations){if(!o.candidate||!o.healthy||!o.quote?.fresh||o.invalid||next.records.length>=PAPER_RULES.limit)continue;const id=o.symbol+':'+o.tf+':'+o.candle;if(next.records.some(r=>r.id===id||activePaper(r)&&r.symbol===o.symbol&&r.tf===o.tf))continue;next.records.push({id,symbol:o.symbol,market:o.market||'Binance 現貨',tf:o.tf,side:o.side,candle:o.candle,created:now,expires:o.expires,observedEvent:o.quote.event,lastSeen:now,state:'pending',levels:{...o.levels},reason:o.reason,ruleVersion:PAPER_RULES.version,rules:{fee:PAPER_RULES.fee,slip:PAPER_RULES.slip,gap:PAPER_RULES.gap}});}
 return next;
}
export function paperStats(records){
 const done=records.filter(r=>r.state==='closed').sort((a,b)=>a.closed-b.closed||a.id.localeCompare(b.id));let win=0,profit=0,loss=0,equity=0,peak=0,dd=0,streak=0,maxStreak=0;
 for(const r of done){if(r.netR>0){win++;profit+=r.netR;streak=0;}else if(r.netR<0){loss-=r.netR;maxStreak=Math.max(maxStreak,++streak);}else streak=0;equity+=r.netR;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
 return{n:done.length,winRate:done.length?win/done.length*100:null,pf:loss?profit/loss:profit?Infinity:null,avgWinLoss:win&&done.filter(r=>r.netR<0).length?(profit/win)/(loss/done.filter(r=>r.netR<0).length):null,netR:equity,ddR:dd,maxStreak,open:records.filter(r=>r.state==='open').length,pending:records.filter(r=>r.state==='pending').length,uncertain:records.filter(r=>r.state==='uncertain').length};
}
