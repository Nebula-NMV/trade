const $ = (id) => document.getElementById(id);
const state = { symbol: 'AAPL', history: null, liveBars: null, liveBarsFeed: '', liveTimer: null, marketTimer: null, marketPending: false, intradayForecastTimer: null, intradayForecastRequestId: 0, intradayForecastCache: {}, liveRange: '1d', taRows: null, taPending: null, taRequestId: 0, taReliabilityCache: {}, taScreenerRequestId: 0, pivotTimeframe: '1d', pivotRows: null, pivotRequestId: 0, pivotPendingKey: null, watchHistories: {}, alpacaDailyHistories: {}, backtestExtraSymbols: [], planCandidates: [], planUniverse: 'watchlist', planScanId: 0, planScanMessage: '', planVisibleLimit: 50, sp500Plans: [], sp500Stocks: [], sp500LoadPromise: null, allUsPlans: [], allUsStocks: [], allUsLoadPromise: null, capitalByCurrency: {}, positions: {}, chartViews: {}, signalSnapshots: {}, planTracking: {}, view: 'analysis', levels: null, interval: '1d', range: '6m', taTimeframe: '1d', zoom: 1, pan: 0, chartView: null, drag: null, forecastDays: 5, loading: false, source: 'yahoo' };
const metaBySymbol = {
  'AAPL': { name: 'Apple', sub: 'Apple Inc. · NASDAQ', market: 'NASDAQ' },
  'MSFT': { name: 'Microsoft', sub: 'Microsoft Corporation · NASDAQ', market: 'NASDAQ' }
};
const WATCHLIST_KEY = 'signal_watchlist_v1';
const POSITIONS_KEY = 'signal_positions_v1';
const CHART_VIEWS_KEY = 'signal_chart_views_v1';
const SIGNAL_SNAPSHOTS_KEY = 'signal_snapshots_v1';
const PLAN_TRACKING_KEY = 'signal_plan_tracking_v1';
const BOT_SYMBOLS_KEY = 'signal_bot_symbols_v1';
const BOT_STRATEGIES_KEY = 'signal_bot_symbol_strategies_v1';
const BOT_SYMBOL_CATALOG = [
  ['AAPL','Apple'],['MSFT','Microsoft'],['NVDA','NVIDIA'],['AMZN','Amazon'],['GOOGL','Alphabet'],['META','Meta Platforms'],
  ['TSLA','Tesla'],['AMD','Advanced Micro Devices'],['AVGO','Broadcom'],['NFLX','Netflix'],['COST','Costco'],['WMT','Walmart'],
  ['PLTR','Palantir'],['INTC','Intel'],['DIS','Disney'],['JPM','JPMorgan Chase'],['SPY','S&P 500 ETF'],['QQQ','Nasdaq 100 ETF'],
  ['ORCL','Oracle'],['CRM','Salesforce'],['UBER','Uber'],['BA','Boeing'],['KO','Coca-Cola'],['PEP','PepsiCo'],['T','AT&T'],
  ['BAC','Bank of America'],['XOM','Exxon Mobil'],['CVX','Chevron'],['V','Visa'],['MA','Mastercard'],['SHOP','Shopify'],['SOFI','SoFi']
];
let botSelectedSymbols = ['AAPL'];
let botSelectedStrategies = {};
let botSymbolsInitialized = false;
let botWasActive = false;
let alpacaTradingMode = 'paper';
let alpacaLiveMaxOrder = 500;
let botUniversePromise = null;
const watchDetails = {
  'AAPL': {name:'AAPL',sub:'Apple',color:'green'},
  'MSFT': {name:'MSFT',sub:'Microsoft',color:'blue'},
  'NVDA': {name:'NVDA',sub:'NVIDIA',color:'violet'}
};
const fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avg = (a) => a.length ? a.reduce((x,y) => x+y,0)/a.length : 0;
const {ema,rsi,macd,macdSeries,rsiSeries,atrSeries}=window.SignalIndicators;
const REGIME_STRATEGIES=[];
const NO_TARGET_STRATEGIES=[];

function makeWatchItem(symbol){
  const info=watchDetails[symbol]||{name:symbol.replace(/\.BK$/,''),sub:'กำหนดเอง',color:'green'};
  const wrapper=document.createElement('div');wrapper.className='watch-item';wrapper.draggable=true;wrapper.title='ลากเพื่อเปลี่ยนลำดับ';
  const row=document.createElement('button');row.type='button';row.className='watch-row';row.dataset.symbol=symbol;
  if(symbol===state.symbol)row.classList.add('selected');
  const dot=document.createElement('span');dot.className=`ticker-dot ${info.color}`;
  const name=document.createElement('span');name.className='watch-name';name.append(document.createTextNode(info.name));
  const small=document.createElement('small');small.textContent=info.sub;name.append(small);
  const quote=document.createElement('span');quote.className='watch-price';quote.textContent='—';
  row.append(dot,name,quote);
  const remove=document.createElement('button');remove.type='button';remove.className='watch-remove';remove.title=`ลบ ${info.name} ออกจาก Watchlist`;remove.setAttribute('aria-label',`ลบ ${info.name} ออกจาก Watchlist`);remove.textContent='×';
  wrapper.append(row,remove);return wrapper;
}
function persistWatchlist(){
  const symbols=[...document.querySelectorAll('.watch-block .watch-row')].map(row=>row.dataset.symbol);
  try{localStorage.setItem(WATCHLIST_KEY,JSON.stringify(symbols))}catch(_){toast('บันทึกรายการ Watchlist ไม่ได้ในเบราว์เซอร์นี้')}
}
function filterWatchlist(){
  const query=$('watchSearch').value.trim().toUpperCase();let visible=0;
  document.querySelectorAll('.watch-block .watch-item').forEach(item=>{const row=item.querySelector('.watch-row'),text=`${row.dataset.symbol} ${item.querySelector('.watch-name').textContent}`.toUpperCase(),match=!query||text.includes(query);item.hidden=!match;if(match)visible++});
  $('watchNoResults').hidden=visible>0;
}
function restoreWatchlist(){
  const root=document.querySelector('.watch-block');let symbols;
  try{
    const saved=localStorage.getItem(WATCHLIST_KEY);
    symbols=saved===null?[...root.querySelectorAll('.watch-row')].map(row=>row.dataset.symbol):JSON.parse(saved);
  }catch(_){symbols=[...root.querySelectorAll('.watch-row')].map(row=>row.dataset.symbol)}
  if(!Array.isArray(symbols))symbols=[];
  const hadThaiSymbols=symbols.some(x=>typeof x==='string'&&x.endsWith('.BK'));
  symbols=[...new Set(symbols.filter(x=>typeof x==='string'&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(x)))];
  if(!symbols.length&&hadThaiSymbols)symbols=['AAPL'];
  root.querySelectorAll('.watch-item').forEach(item=>item.remove());
  symbols.forEach(symbol=>root.append(makeWatchItem(symbol)));
  persistWatchlist();
}
function restorePositions(){try{const saved=JSON.parse(localStorage.getItem(POSITIONS_KEY)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))state.positions=Object.fromEntries(Object.entries(saved).filter(([symbol])=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)).map(([symbol,p])=>{const lots=Array.isArray(p)?p:(p&&Number(p.amount)>0&&Number(p.entryPrice)>0?[{amount:Number(p.amount),price:Number(p.entryPrice)}]:[]);return [symbol,lots.filter(x=>Number(x.amount)>0&&Number(x.price)>0).map(x=>({amount:Number(x.amount),price:Number(x.price)}))]}).filter(([,lots])=>lots.length))}catch(_){state.positions={}}}
function persistPositions(){try{localStorage.setItem(POSITIONS_KEY,JSON.stringify(state.positions))}catch(_){toast('บันทึกข้อมูลซื้อไม่ได้ในเบราว์เซอร์นี้')}}
function persistChartView(){state.chartViews[state.symbol]={zoom:state.zoom,pan:state.pan,range:state.range,interval:state.interval};try{localStorage.setItem(CHART_VIEWS_KEY,JSON.stringify(state.chartViews))}catch(_){}}
function restoreChartViews(){try{const saved=JSON.parse(localStorage.getItem(CHART_VIEWS_KEY)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))state.chartViews=Object.fromEntries(Object.entries(saved).filter(([symbol,v])=>/^[A-Z0-9^=._-]{1,24}$/.test(symbol)&&v&&typeof v==='object').map(([symbol,v])=>[symbol,{zoom:Math.max(1,Math.min(30,Number(v.zoom)||1)),pan:Math.max(0,Number(v.pan)||0),range:['1m','3m','6m','1y','2y'].includes(v.range)?v.range:'6m',interval:['1d','1w','1mo','1min','5min','15min','1h'].includes(v.interval)?v.interval:'1d'}]))}catch(_){state.chartViews={}}}
function applyChartView(symbol){const saved=state.chartViews[symbol];state.zoom=saved?.zoom||1;state.pan=saved?.pan||0;state.range=saved?.range||'6m';state.interval=saved?.interval||'1d';document.querySelectorAll('[data-range]').forEach(x=>x.classList.toggle('active',x.dataset.range===state.range));document.querySelectorAll('[data-interval]').forEach(x=>x.classList.toggle('active',x.dataset.interval===state.interval))}
function restoreSignalSnapshots(){try{const saved=JSON.parse(localStorage.getItem(SIGNAL_SNAPSHOTS_KEY)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))state.signalSnapshots=saved}catch(_){state.signalSnapshots={}}}
function persistSignalSnapshots(){try{localStorage.setItem(SIGNAL_SNAPSHOTS_KEY,JSON.stringify(state.signalSnapshots))}catch(_){}}
function restorePlanTracking(){try{const saved=JSON.parse(localStorage.getItem(PLAN_TRACKING_KEY)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))state.planTracking={active:saved.active&&typeof saved.active==='object'?saved.active:{},events:Array.isArray(saved.events)?saved.events.slice(0,100):[]}}catch(_){state.planTracking={active:{},events:[]}}}
function persistPlanTracking(){try{localStorage.setItem(PLAN_TRACKING_KEY,JSON.stringify(state.planTracking))}catch(_){}}
function renderPlanAlerts(){
  const root=$('planAlertHistory');if(!root)return;const events=state.planTracking.events||[],active=Object.entries(state.planTracking.active||{}).filter(([,x])=>!x.outcome);
  $('planAlertSummary').textContent=`ติดตาม ${active.length} แผน · ประวัติ ${events.length} เหตุการณ์ · สแกน Watchlist ทุก 15 นาทีขณะเปิดแอพ`;
  $('enablePlanNotifications').textContent=typeof Notification==='undefined'?'การแจ้งเตือนไม่รองรับ':Notification.permission==='granted'?'เปิดการแจ้งเตือนแล้ว':'เปิดการแจ้งเตือน';
  const activeHtml=active.map(([symbol,x])=>`<article class="plan-alert-item"><div><b>${escapeHtml(symbol)} · กำลังติดตามแผน</b><p>Buy ${fmt(x.entryLow)}–${fmt(x.entryHigh)} · Stop ${fmt(x.stop)} · Target ${fmt(x.target)}</p></div><span>${x.inZone?'อยู่ใน Buy Zone':'รอราคา'}</span></article>`).join(''),eventHtml=events.slice(0,15).map(event=>`<article class="plan-alert-item ${event.kind==='target'?'target':event.kind==='stop'?'stop':''}"><div><b>${escapeHtml(event.symbol)} · ${escapeHtml(event.title)}</b><small>${escapeHtml(event.date||'')} · ${escapeHtml(event.time||'')}</small><p>${escapeHtml(event.detail||'')}${Number.isFinite(event.entryLow)?` · Buy ${fmt(event.entryLow)}–${fmt(event.entryHigh)} · Stop ${fmt(event.stop)} · Target ${fmt(event.target)}`:''}</p></div><span>${event.kind==='target'?'ถึงเป้า':event.kind==='stop'?'แตะ Stop':event.kind==='ambiguous'?'ลำดับไม่ชัด':'แจ้งเตือน'}</span></article>`).join('');
  root.innerHTML=`${activeHtml}${eventHtml||(!active.length?'<div class="portfolio-empty">ยังไม่มีเหตุการณ์ · วิเคราะห์ Watchlist เพื่อเริ่มติดตามแผน</div>':'')}`;
}
function addPlanAlert(event){
  const record={id:`${event.symbol}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,time:new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}),...event};
  state.planTracking.events.unshift(record);state.planTracking.events=state.planTracking.events.slice(0,100);persistPlanTracking();renderPlanAlerts();
  if(typeof Notification!=='undefined'&&Notification.permission==='granted')try{new Notification(`${record.symbol} · ${record.title}`,{body:record.detail||''})}catch(_){}
}
function trackPlanAlerts(plan){
  const rows=plan.history?.rows||[],bar=rows.at(-1);if(!bar||![plan.entryLow,plan.entryHigh,plan.stop,plan.target].every(x=>Number.isFinite(x)&&x>0))return;
  const levels={entryLow:plan.entryLow,entryHigh:plan.entryHigh,stop:plan.stop,target:plan.target},signature=`${plan.qualified?'qualified':'watch'}:${plan.daily.key}:${plan.weekly.key}`,inZone=Boolean(plan.atZone);let tracked=state.planTracking.active[plan.symbol];
  for(const signal of plan.freshSignals||[])addPlanAlert({symbol:plan.symbol,title:signal,detail:`สัญญาณใหม่จากแท่ง ${usTradingDate(bar.t)}`,kind:'signal',date:usTradingDate(bar.t),...levels});
  if(tracked&&!tracked.outcome&&bar.t>=tracked.createdBar){
    const later=rows.filter(x=>x.t>tracked.createdBar&&x.t<=bar.t),seenLow=tracked.observedLow??tracked.createdLow??bar.l,seenHigh=tracked.observedHigh??tracked.createdHigh??bar.h;
    if(bar.t===tracked.createdBar&&(bar.l<seenLow||bar.h>seenHigh))later.push({...bar,partial:true,seenLow,seenHigh});
    for(const candle of later){const hitStop=candle.l<=tracked.stop&&(!candle.partial||candle.seenLow>tracked.stop),hitTarget=candle.h>=tracked.target&&(!candle.partial||candle.seenHigh<tracked.target);if(!hitStop&&!hitTarget)continue;
      if(hitStop&&hitTarget){tracked.outcome='ambiguous';addPlanAlert({symbol:plan.symbol,title:'Stop และ Target แตะในแท่งเดียว',detail:`${usTradingDate(candle.t)} · ข้อมูลรายวันไม่บอกลำดับการแตะ`,kind:'ambiguous',date:usTradingDate(candle.t),...tracked})}
      else if(hitStop){tracked.outcome='stop';addPlanAlert({symbol:plan.symbol,title:'ราคาแตะ Stop ของแผน',detail:`${usTradingDate(candle.t)} · Low ${fmt(candle.l)} ≤ Stop ${fmt(tracked.stop)}`,kind:'stop',date:usTradingDate(candle.t),...tracked})}
      else{tracked.outcome='target';addPlanAlert({symbol:plan.symbol,title:'ราคาแตะ Target ของแผน',detail:`${usTradingDate(candle.t)} · High ${fmt(candle.h)} ≥ Target ${fmt(tracked.target)}`,kind:'target',date:usTradingDate(candle.t),...tracked})}
      tracked.outcomeDate=usTradingDate(candle.t);break;
    }
    if(!tracked.outcome&&bar.t===tracked.createdBar){tracked.observedLow=bar.l;tracked.observedHigh=bar.h}
  }
  const changed=tracked&&['entryLow','entryHigh','stop','target'].some(key=>Math.abs(levels[key]-tracked[key])/Math.max(Math.abs(tracked[key]),.01)>.02);
  if(tracked&&changed){if(!tracked.outcome)addPlanAlert({symbol:plan.symbol,title:'แผนเดิมถูกปรับระดับ',detail:`ปรับแผนก่อนแตะ Stop/Target · เดิม Buy ${fmt(tracked.entryLow)}–${fmt(tracked.entryHigh)}`,kind:'updated',date:usTradingDate(bar.t),...tracked});tracked=null}
  if(tracked){
    const inOriginalZone=plan.current>=tracked.entryLow&&plan.current<=tracked.entryHigh;
    if(!tracked.outcome&&inOriginalZone&&!tracked.inZone)addPlanAlert({symbol:plan.symbol,title:'ราคาเข้า Buy Zone',detail:`ราคาล่าสุด ${fmt(plan.current)} · ช่วงซื้อ ${fmt(tracked.entryLow)}–${fmt(tracked.entryHigh)}`,kind:'zone',date:usTradingDate(bar.t),...tracked});
    if(tracked.signature!==signature)addPlanAlert({symbol:plan.symbol,title:'สัญญาณแผนเปลี่ยน',detail:`${tracked.signature.replaceAll(':',' / ')} → ${signature.replaceAll(':',' / ')}`,kind:'signal',date:usTradingDate(bar.t),...levels});
    Object.assign(tracked,{signature,inZone:inOriginalZone,lastBar:bar.t});
  }else{
    tracked={...levels,createdBar:bar.t,lastBar:bar.t,createdLow:bar.l,createdHigh:bar.h,observedLow:bar.l,observedHigh:bar.h,signature,inZone,outcome:null};
    if(inZone)addPlanAlert({symbol:plan.symbol,title:'เริ่มติดตาม · ราคาอยู่ใน Buy Zone',detail:`ปิด ${fmt(bar.c)} · ช่วงซื้อ ${fmt(levels.entryLow)}–${fmt(levels.entryHigh)}`,kind:'zone',date:usTradingDate(bar.t),...levels});
  }
  state.planTracking.active[plan.symbol]=tracked;
}
async function alpacaApi(path,options={}){const response=await fetch(`/api/alpaca/${path}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||`เชื่อมต่อ Alpaca ไม่สำเร็จ (${response.status})`);error.status=response.status;throw error}return data}
const alpacaMoney=value=>`$${fmt(Number(value),2)}`;
async function refreshAlpaca(){
  const title=$('alpacaConnectionTitle'),detail=$('alpacaConnectionDetail');title.textContent='กำลังตรวจสอบบัญชี Alpaca…';
  try{
    const config=await alpacaApi('config');
    alpacaTradingMode=config.mode==='live-disabled'?'disabled':(config.mode||'paper');const live=alpacaTradingMode==='live',disabledLive=alpacaTradingMode==='disabled';alpacaLiveMaxOrder=Number(config.max_order_usd)||500;document.querySelector('.alpaca-mode-tag').textContent=live?'LIVE · USD':disabledLive?'LIVE · LOCKED':'PAPER · USD';document.querySelector('.alpaca-mode-tag').classList.toggle('live',live||disabledLive);$('alpacaPageMode').textContent=live?'ALPACA · LIVE TRADING':disabledLive?'ALPACA · LIVE LOCKED':'ALPACA · PAPER TRADING';
    document.querySelectorAll('#alpacaAccount .alpaca-stat span')[2].textContent=live?'Equity':'มูลค่าพอร์ตจำลอง';$('alpacaDisclaimer').innerHTML=live?'<span>⚠</span> LIVE ส่งคำสั่งเงินจริง · คำสั่งซื้อสูงสุดตามวงเงินที่แสดง · ตรวจสอบทุกคำสั่งก่อนส่ง · ห้ามเปิดหน้าเว็บให้ผู้อื่น':'<span>ⓘ</span> Paper Trading เป็นการจำลอง · Live ต้องเปิดใช้แยกบนเซิร์ฟเวอร์ · อย่าใส่ API Secret ในหน้าเว็บ';
    if(!config.configured){title.textContent=live||disabledLive?'Live Trading ยังไม่พร้อม':'ยังไม่ได้ตั้งค่า API Key';detail.textContent=config.error||'ตรวจสอบ Environment Variables บนเซิร์ฟเวอร์';$('alpacaAccount').innerHTML='<article class="panel alpaca-stat"><span>สถานะ</span><b>รอตั้งค่า</b></article>';$('alpacaSubmit').disabled=true;$('botStart').disabled=true;return}
    const [account,positions,orders]=await Promise.all([alpacaApi('account'),alpacaApi('positions'),alpacaApi('orders')]);
    $('alpacaSubmit').disabled=false;
    title.textContent=`เชื่อมต่อ ${live?'บัญชีเงินจริง':'บัญชี Paper'} แล้ว · ${account.status||''}`;detail.textContent=`บัญชี ${String(account.account_number||'').slice(-4).padStart(4,'•')} · ${live?`วงเงินซื้อสูงสุด $${fmt(config.max_order_usd,2)} ต่อคำสั่ง`:'โหมดจำลอง'}`;
    const equity=Number(account.equity),lastEquity=Number(account.last_equity),dayPnl=equity-lastEquity;
    $('alpacaAccount').innerHTML=[['เงินสด',alpacaMoney(Number(account.cash))],['Buying power',alpacaMoney(Number(account.buying_power))],['มูลค่าพอร์ตจำลอง',alpacaMoney(equity)],['กำไร/ขาดทุนวันนี้',`${dayPnl>=0?'+':''}${alpacaMoney(dayPnl)}`]].map(([label,value],i)=>`<article class="panel alpaca-stat"><span>${label}</span><b class="${i===3?(dayPnl>=0?'pnl-positive':'pnl-negative'):''}">${value}</b></article>`).join('');
    $('alpacaPositions').innerHTML=positions.length?positions.map(p=>{const pnl=Number(p.unrealized_pl);return `<tr><td><b>${escapeHtml(p.symbol)}</b></td><td>${fmt(Number(p.qty),4)}</td><td>${alpacaMoney(Number(p.avg_entry_price))}</td><td>${alpacaMoney(Number(p.current_price))}</td><td>${alpacaMoney(Number(p.market_value))}</td><td class="${pnl>=0?'pnl-positive':'pnl-negative'}">${pnl>=0?'+':''}${alpacaMoney(pnl)}</td></tr>`}).join(''):'<tr><td colspan="6">ยังไม่มีหุ้นในบัญชี</td></tr>';
    $('alpacaOrders').innerHTML=orders.length?orders.slice(0,25).map(o=>`<tr><td>${new Date(o.submitted_at||o.created_at).toLocaleString('th-TH')}</td><td><b>${escapeHtml(o.symbol)}</b></td><td>${o.side==='buy'?'ซื้อ':'ขาย'}</td><td>${escapeHtml(o.type||'')}</td><td>${escapeHtml(o.qty||o.notional||'—')}</td><td>${escapeHtml(o.status||'')}</td></tr>`).join(''):'<tr><td colspan="6">ยังไม่มีคำสั่ง</td></tr>';
  }catch(err){title.textContent='เชื่อมต่อ Alpaca ไม่สำเร็จ';detail.textContent=err.message;$('alpacaAccount').innerHTML='<article class="panel alpaca-stat"><span>สถานะ</span><b>ตรวจสอบการตั้งค่า</b></article>';}
}
function renderBotSymbols(symbols,persist=true,strategyMap=botSelectedStrategies,reasons={}){
  botSelectedSymbols=[...new Set((Array.isArray(symbols)?symbols:[]).map(symbol=>String(symbol).trim().toUpperCase()).filter(symbol=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)))].slice(0,10);
  botSelectedStrategies=Object.fromEntries(botSelectedSymbols.map(symbol=>{const choice=strategyMap?.[symbol]||'auto';return [symbol,choice==='auto'||!botStrategyCatalog.length||botStrategyCatalog.some(item=>item.id===choice)?choice:'auto']}));
  $('botSymbols').value=botSelectedSymbols.join(', ');
  const strategyOptions=botStrategyCatalog.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
  $('botSymbolList').innerHTML=botSelectedSymbols.length?botSelectedSymbols.map(symbol=>{const selected=botSelectedStrategies[symbol],reason=reasons?.[symbol]||'';return `<div class="bot-symbol-chip"><b>${escapeHtml(symbol)}</b><select data-bot-strategy-symbol="${escapeHtml(symbol)}" aria-label="กลยุทธ์ ${escapeHtml(symbol)}"><option value="auto">อัตโนมัติ · ให้ระบบเลือก</option>${strategyOptions}</select>${reason?`<small>${escapeHtml(reason)}</small>`:''}<button type="button" data-remove-bot-symbol="${escapeHtml(symbol)}" aria-label="นำ ${escapeHtml(symbol)} ออกจากรายการ" title="นำออก">−</button></div>`}).join(''):'<span class="bot-symbol-empty">ยังไม่ได้เลือกหุ้น</span>';
  botSelectedSymbols.forEach(symbol=>{const select=$(`botSymbolList`).querySelector(`[data-bot-strategy-symbol="${CSS.escape(symbol)}"]`);if(select&&[...select.options].some(option=>option.value===botSelectedStrategies[symbol]))select.value=botSelectedStrategies[symbol]});
  if(persist){try{localStorage.setItem(BOT_SYMBOLS_KEY,JSON.stringify(botSelectedSymbols));localStorage.setItem(BOT_STRATEGIES_KEY,JSON.stringify(botSelectedStrategies))}catch(_){}}
}
async function getBotSymbolCatalog(){
  const catalog=new Map(BOT_SYMBOL_CATALOG.map(([symbol,name])=>[symbol,{symbol,name}]));
  try{const watchlist=JSON.parse(localStorage.getItem(WATCHLIST_KEY)||'[]');if(Array.isArray(watchlist))watchlist.forEach(value=>{const symbol=String(value).trim().toUpperCase();if(/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)&&!symbol.endsWith('.BK')&&!catalog.has(symbol))catalog.set(symbol,{symbol,name:'จาก Watchlist'})})}catch(_){}
  if(!botUniversePromise)botUniversePromise=fetch('/api/universe/us-stocks').then(async response=>{if(!response.ok)throw new Error(`โหลดรายชื่อหุ้นไม่สำเร็จ (${response.status})`);const data=await response.json();if(!Array.isArray(data.stocks))throw new Error('รูปแบบรายชื่อหุ้นไม่ถูกต้อง');return data.stocks});
  try{const stocks=await botUniversePromise;stocks.forEach(item=>{const symbol=String(item.symbol||'').trim().toUpperCase();if(/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)&&!catalog.has(symbol))catalog.set(symbol,{symbol,name:item.name||symbol})})}catch(error){botUniversePromise=null;throw error}
  return [...catalog.values()];
}
async function renderBotSymbolSuggestions(query){
  const root=$('botSymbolSuggestions'),normalized=query.trim().toLowerCase();
  if(!normalized){root.hidden=true;root.innerHTML='';return}
  root.hidden=false;root.innerHTML='<span class="bot-symbol-no-match">กำลังค้นหารายชื่อหุ้นสหรัฐฯ…</span>';
  let catalog;try{catalog=await getBotSymbolCatalog()}catch(_){if($('botSymbolSearch').value.trim().toLowerCase()===normalized)root.innerHTML='<span class="bot-symbol-no-match">โหลดรายชื่อหุ้นไม่สำเร็จ · ลองพิมพ์ใหม่อีกครั้ง</span>';return}
  if($('botSymbolSearch').value.trim().toLowerCase()!==normalized)return;
  const matches=catalog.filter(item=>item.symbol.toLowerCase().includes(normalized)||item.name.toLowerCase().includes(normalized)).slice(0,12);
  root.innerHTML=matches.length?matches.map(item=>`<button type="button" role="option" data-bot-suggest="${escapeHtml(item.symbol)}"><b>${escapeHtml(item.symbol)}</b><span>${escapeHtml(item.name)}</span></button>`).join(''):'<span class="bot-symbol-no-match">ไม่พบหุ้นนี้ · ลองค้นจาก Watchlist</span>';
  root.hidden=false;
}
async function addBotSymbol(){
  const query=$('botSymbolSearch').value.trim().toUpperCase();let catalog;try{catalog=await getBotSymbolCatalog()}catch(_){toast('โหลดรายชื่อหุ้นไม่สำเร็จ · ลองอีกครั้ง');return}const item=catalog.find(candidate=>candidate.symbol===query);
  if(!item){toast('เลือกหุ้นจากรายการผลค้นหาก่อนกด +');renderBotSymbolSuggestions($('botSymbolSearch').value);return}
  if(botSelectedSymbols.includes(item.symbol)){toast(`${item.symbol} อยู่ในรายการแล้ว`);return}
  if(botSelectedSymbols.length>=10){toast('เลือกหุ้นได้สูงสุด 10 ตัว');return}
  renderBotSymbols([...botSelectedSymbols,item.symbol]);$('botSymbolSearch').value='';renderBotSymbolSuggestions('');
}
function renderBotJournal(orders){const body=$('botJournalRows');if(!body)return;body.innerHTML=orders?.length?orders.map(order=>`<tr><td>${new Date(order.submitted_at).toLocaleString('th-TH')}</td><td><b>${escapeHtml(order.symbol||'?')} · ${escapeHtml(order.side||'?')}</b><small>${escapeHtml(order.type||'')} · ${escapeHtml(order.strategy||'')}</small></td><td>${fmt(order.filled_qty??order.qty,4)}</td><td>${escapeHtml(order.status||'?')}${order.fill_price?`<small>Fill ${fmt(order.fill_price)}</small>`:''}</td><td>${order.slippage_pct==null?'—':`${order.slippage_pct>0?'+':''}${fmt(order.slippage_pct,3)}%`}</td><td title="${escapeHtml(order.reason||'')}">${escapeHtml(order.reason||'?')}</td></tr>`).join(''):'<tr><td colspan="6">ยังไม่มีรายการ</td></tr>'}
async function refreshAutoBot(){try{const bot=await alpacaApi('bot'),journal=await alpacaApi('bot/journal?limit=50').catch(()=>({orders:[]}));const threadFailed=bot.active&&!bot.thread_alive,heartbeatStale=bot.active&&bot.heartbeat_age_seconds!=null&&bot.heartbeat_age_seconds>1200;$('botState').textContent=threadFailed?'THREAD STOPPED':heartbeatStale?'NO HEARTBEAT':bot.active?`RUNNING - ${bot.trading_mode==='live'?'LIVE':'PAPER'}`:'Stopped';$('botState').classList.toggle('active',bot.active&&!threadFailed&&!heartbeatStale);$('botState').classList.toggle('warning',threadFailed||heartbeatStale);$('botLastMessage').textContent=bot.last_message||'บอทยังไม่ทำงาน';$('botStart').disabled=bot.active;$('botStop').disabled=!bot.active;['botSymbolSearch','botSymbolAdd','botStrategy','botPerTrade','botMaxTotal','botRiskPct','botMaxDailyLoss','botMaxDailyTrades'].forEach(id=>$(id).disabled=bot.active);if(bot.active){renderBotSymbols(bot.symbols||[],false,bot.symbol_strategies||{},bot.strategy_reasons||{});botSymbolsInitialized=true}else if(!botSymbolsInitialized){let saved=null;try{saved=JSON.parse(localStorage.getItem(BOT_SYMBOLS_KEY)||'null')}catch(_){}renderBotSymbols(saved??(bot.strategy?bot.symbols:['AAPL']),!saved,saved?botSelectedStrategies:(bot.symbol_strategies||{}),bot.strategy_reasons||{});botSymbolsInitialized=true}if(bot.active)botWasActive=true;else if(botWasActive){let savedStrategies={};try{savedStrategies=JSON.parse(localStorage.getItem(BOT_STRATEGIES_KEY)||'{}')||{}}catch(_){}renderBotSymbols(botSelectedSymbols,true,savedStrategies);botWasActive=false}document.querySelectorAll('[data-remove-bot-symbol]').forEach(button=>button.disabled=bot.active);document.querySelectorAll('[data-bot-strategy-symbol]').forEach(select=>select.disabled=bot.active);if(bot.strategy){$('botStrategy').value=bot.strategy;$('botPerTrade').value=bot.per_trade_usd;$('botMaxTotal').value=bot.max_total_usd;$('botRiskPct').value=bot.risk_pct??0.5;$('botMaxDailyLoss').value=bot.max_daily_loss_pct??1;$('botMaxDailyTrades').value=bot.max_daily_trades??3}syncBotStrategyHelp();$('botEvents').innerHTML=bot.events?.length?bot.events.map(event=>`<div><time>${new Date(event.time).toLocaleString('th-TH')}</time>${escapeHtml(event.message)}</div>`).join(''):'<div>ยังไม่มีเหตุการณ์</div>';renderBotJournal(journal.orders)}catch(err){$('botLastMessage').textContent=err.message}}
async function startAutoBot(){
  const symbols=[...botSelectedSymbols],strategy=$('botStrategy').value,perTrade=Number($('botPerTrade').value),maxTotal=Number($('botMaxTotal').value),riskPct=Number($('botRiskPct').value),dailyLoss=Number($('botMaxDailyLoss').value),dailyTrades=Number($('botMaxDailyTrades').value),symbolStrategies=Object.fromEntries(symbols.map(symbol=>[symbol,botSelectedStrategies[symbol]||'auto'])),strategyLabels=new Map(botStrategyCatalog.map(item=>[item.id,item.label]));
  if(!symbols.length||symbols.length>10||!(perTrade>=1&&perTrade<=10000&&maxTotal>=perTrade&&maxTotal<=100000&&riskPct>=0.1&&riskPct<=5&&dailyLoss>=0.25&&dailyLoss<=5&&dailyTrades>=1&&dailyTrades<=20&&Number.isInteger(dailyTrades))){toast('ตรวจหุ้น 1–10 ตัว วงเงิน และความเสี่ยงต่อรายการ');return}
  if(alpacaTradingMode==='live'&&(perTrade>alpacaLiveMaxOrder||riskPct>.5||dailyLoss>1||dailyTrades>3)){toast(`โหมด Live จำกัดวงเงินต่อหุ้น $${fmt(alpacaLiveMaxOrder)} · เสี่ยงไม่เกิน 0.5% · ขาดทุนรายวันไม่เกิน 1% · ไม่เกิน 3 รายการ`);return}
  const perStock=symbols.map(symbol=>`${symbol}: ${symbolStrategies[symbol]==='auto'?'เลือกอัตโนมัติ':strategyLabels.get(symbolStrategies[symbol])||symbolStrategies[symbol]}`).join('\n');
  const summary=`กลยุทธ์ต่อหุ้น:\n${perStock}\n\nวงเงินต่อหุ้น: $${fmt(perTrade)}\nวงเงินรวมสูงสุด: $${fmt(maxTotal)}\nความเสี่ยงต่อรายการ: ${fmt(riskPct,1)}% ของ Equity\nขาดทุนรายวันสูงสุด: ${fmt(dailyLoss,2)}% · ไม่เกิน ${dailyTrades} รายการ\n\n${alpacaTradingMode==='live'?'เงินจริง · วงเงินซื้อสูงสุด $'+fmt(alpacaLiveMaxOrder)+' ต่อคำสั่ง':'บัญชี Paper'} · ทำงานตราบใดที่เซิร์ฟเวอร์เปิดอยู่`;
  if(!window.confirm(`เริ่มบอทซื้อขายอัตโนมัติ?\n${summary}`))return;
  if(alpacaTradingMode==='live'&&window.prompt('พิมพ์ I UNDERSTAND LIVE TRADING เพื่อยืนยันการใช้เงินจริง')!=='I UNDERSTAND LIVE TRADING')return;
  $('botStart').disabled=true;
  try{await alpacaApi('bot/start',{method:'POST',body:JSON.stringify({symbols,strategy,symbol_strategies:symbolStrategies,per_trade_usd:perTrade,max_total_usd:maxTotal,risk_pct:riskPct,max_daily_loss_pct:dailyLoss,max_daily_trades:dailyTrades,...(alpacaTradingMode==='live'?{live_confirmation:'I UNDERSTAND LIVE TRADING'}:{})})});toast(`เริ่มบอท Alpaca ${alpacaTradingMode==='live'?'Live':'Paper'} แล้ว`);await refreshAutoBot()}catch(err){toast(err.message);$('botStart').disabled=false}
}
async function stopAutoBot(){try{await alpacaApi('bot/stop',{method:'POST',body:'{}'});toast('ส่งคำขอหยุดบอทแล้ว');await refreshAutoBot()}catch(err){toast(err.message)}}
function updateAlpacaOrderFields(){const side=$('alpacaSide').value,type=$('alpacaType').value,notional=side==='buy'&&type==='market';$('alpacaAmountLabel').querySelector('span').textContent=notional?'จำนวนเงิน USD':'จำนวนหุ้น';$('alpacaAmount').min=notional?'1':'0.000001';$('alpacaAmount').step=notional?'0.01':'0.000001';if(notional&&Number($('alpacaAmount').value)<1)$('alpacaAmount').value='100';$('alpacaLimitLabel').hidden=type!=='limit';$('alpacaLimit').required=type==='limit';$('alpacaTif').value=type==='limit'?'day':$('alpacaTif').value;$('alpacaTif').disabled=type==='limit';}
async function submitAlpacaOrder(event){
  event.preventDefault();
  const symbol=$('alpacaSymbol').value.trim().toUpperCase(),side=$('alpacaSide').value,type=$('alpacaType').value,amount=Number($('alpacaAmount').value),payload={symbol,side,type,time_in_force:type==='limit'?'day':$('alpacaTif').value};
  if(side==='buy'&&type==='market')payload.notional=amount;else payload.qty=amount;
  if(type==='limit')payload.limit_price=Number($('alpacaLimit').value);
  if(!(amount>0)||type==='limit'&&!(payload.limit_price>0)){toast('ตรวจสอบจำนวนหุ้นหรือราคา Limit');return}
  const description=side==='buy'&&type==='market'?`Buy ${symbol} for $${fmt(amount)}`:`${side==='buy'?'Buy':'Sell'} ${fmt(amount,4)} shares of ${symbol}${type==='limit'?` at $${fmt(payload.limit_price)}`:' at market'}`;
  if(alpacaTradingMode==='live'&&side==='buy'&&type==='market'&&amount>alpacaLiveMaxOrder){toast(`วงเงินซื้อ Live สูงสุด $${fmt(alpacaLiveMaxOrder)} ต่อคำสั่ง`);return}
  if(!window.confirm(`ยืนยันส่งคำสั่ง ${alpacaTradingMode==='live'?'เงินจริง':'Paper'}?\n${description}\n${alpacaTradingMode==='live'?'บัญชีเงินจริง':'บัญชี Paper'}`))return;
  if(alpacaTradingMode==='live'&&window.prompt('พิมพ์ I UNDERSTAND LIVE TRADING เพื่อยืนยันการใช้เงินจริง')!=='I UNDERSTAND LIVE TRADING')return;
  if(alpacaTradingMode==='live')payload.live_confirmation='I UNDERSTAND LIVE TRADING';
  const button=$('alpacaSubmit');button.disabled=true;button.textContent='Sending...';
  try{const result=await alpacaApi('orders',{method:'POST',body:JSON.stringify(payload)});toast(`ส่งคำสั่ง ${alpacaTradingMode==='live'?'Live':'Paper'} แล้ว · ${result.symbol} · ${result.status}`);await refreshAlpaca()}catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='ส่งคำสั่ง'}
}
function positionTargets(plan,lots){
  const amount=lots.reduce((sum,x)=>sum+x.amount,0),shares=lots.reduce((sum,x)=>sum+x.amount/x.price,0),entry=amount/shares;
  const supports=(plan.levels?.supports||[]).map(x=>Number(x.p)).filter(x=>Number.isFinite(x)&&x<entry).sort((a,b)=>b-a);
  const resistances=(plan.levels?.resistances||[]).map(x=>Number(x.p)).filter(x=>Number.isFinite(x)&&x>entry).sort((a,b)=>a-b);
  const stop=supports.length?supports[0]*.985:entry*.97;
  const target=resistances.length?resistances[0]:entry+2*(entry-stop);
  const currentValue=shares*plan.current;
  return {amount,entry,shares,currentValue,pnl:currentValue-amount,pnlPct:(currentValue-amount)/amount*100,stop,target,saleValue:shares*target,saleProfit:shares*target-amount};
}

function calibratedReturnDrift(returns,horizon){
  const lookback=20,validationSize=Math.min(240,Math.max(0,returns.length-lookback-horizon+1)),split=Math.floor(validationSize*.7),start=returns.length-horizon+1-validationSize;
  if(split<30||validationSize-split<15)return {drift:0,weight:0,skill:null,observations:Math.max(0,validationSize-split)};
  const points=[];
  for(let i=start;i<=returns.length-horizon;i++){
    const past=returns.slice(i-lookback,i),recent=avg(past.slice(-5)),mean=avg(past),candidate=.65*recent+.35*mean,target=returns.slice(i,i+horizon).reduce((sum,value)=>sum+value,0);
    if(Number.isFinite(candidate)&&Number.isFinite(target))points.push({candidate:candidate*horizon,target});
  }
  // Purge overlapping forward-return labels between training and validation.
  const training=points.slice(0,Math.max(0,split-horizon+1)),validation=points.slice(split);if(training.length<30||validation.length<15)return {drift:0,weight:0,skill:null,observations:validation.length};
  const xMean=avg(training.map(point=>point.candidate)),yMean=avg(training.map(point=>point.target)),variance=avg(training.map(point=>(point.candidate-xMean)**2));
  if(!(variance>0))return {drift:0,weight:0,skill:null,observations:validation.length};
  const covariance=avg(training.map(point=>(point.candidate-xMean)*(point.target-yMean))),weight=Math.max(0,Math.min(.5,covariance/variance)),intercept=yMean-weight*xMean;
  const naiveLoss=avg(validation.map(point=>point.target**2)),modelLoss=avg(validation.map(point=>(point.target-intercept-weight*point.candidate)**2)),skill=naiveLoss>0?1-modelLoss/naiveLoss:0;
  if(!(skill>.02))return {drift:0,weight:0,skill,observations:validation.length};
  const recent=returns.slice(-lookback),candidate=.65*avg(recent.slice(-5))+.35*avg(recent);
  return {drift:intercept+weight*candidate*horizon,weight,skill,observations:validation.length};
}
function estimateForward(rows, days=1, volatilityFloor=.0025){
  const closes=rows.map(x=>x.c),rets=[];for(let i=1;i<closes.length;i++)rets.push(Math.log(closes[i]/closes[i-1]));
  const sample=rets.slice(-20);if(sample.length<10)return null;
  const mean20=avg(sample),vol=Math.sqrt(avg(sample.map(x=>(x-mean20)**2)));
  const horizon=Math.max(1,Math.min(60,Math.round(days)||1)),barVol=Math.max(vol,volatilityFloor),base=closes.at(-1),ema20=ema(closes,20).at(-1),ema50=ema(closes,50).at(-1),ema200=ema(closes,200).at(-1),momentum=macd(closes),rsiValue=rsi(closes);
  const levels=levelCandidates(rows,base,ema20,ema50,ema200);
  const sup=levels.supports.filter(x=>x.p<base).sort((a,b)=>b.p-a.p)[0];
  const res=levels.resistances.filter(x=>x.p>base).sort((a,b)=>a.p-b.p)[0];
  const supportDistance=sup?(base-sup.p)/base:null,resistanceDistance=res?(res.p-base)/base:null;
  const srBias=supportDistance!=null&&resistanceDistance!=null?(resistanceDistance-supportDistance)/.04:0;
  const calibrated=calibratedReturnDrift(rets,horizon),band=barVol*Math.sqrt(horizon),totalDrift=Math.max(-band*.5,Math.min(band*.5,calibrated.drift));
  const close=base*Math.exp(totalDrift),factors=[];
  if(srBias>.3)factors.push('แนวรับใกล้');else if(srBias<-.3)factors.push('แนวต้านใกล้');
  if(rsiValue<=30)factors.push('RSI oversold');else if(rsiValue>=70)factors.push('RSI overbought');
  if(Number.isFinite(ema20)&&Number.isFinite(ema50))factors.push(ema20>=ema50?'EMA 20 > 50':'EMA 20 < 50');
  factors.push(momentum.hist>=0?'MACD บวก':'MACD ลบ');
  return {base,close,low:close*Math.exp(-band),high:close*Math.exp(band),change:(Math.exp(totalDrift)-1)*100,volatility:band*100,days:horizon,factors,calibration:{weight:calibrated.weight,skill:calibrated.skill,observations:calibrated.observations}};
}
function toCandle(t, o, h, l, c, v) { return {t,o,h,l,c,v}; }
function aggregate(rows, kind) {
  const buckets=[];
  for(const r of rows){const d=new Date(r.t*1000);let key;
    if(kind==='week'){const day=(d.getUTCDay()+6)%7;const monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));key=monday.toISOString().slice(0,10)}
    else key=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    let b=buckets[buckets.length-1]; if(!b||b.key!==key){b={key,...toCandle(r.t,r.o,r.h,r.l,r.c,r.v)};buckets.push(b)}else{b.h=Math.max(b.h,r.h);b.l=Math.min(b.l,r.l);b.c=r.c;b.v+=r.v;b.t=r.t}
  }
  return buckets;
}
function simpleAverage(values,period){return values.length<period?null:avg(values.slice(-period))}
function adxValues(rows,period=14){
  if(rows.length<period*2+1)return null;
  const tr=Array(rows.length).fill(0),plus=Array(rows.length).fill(0),minus=Array(rows.length).fill(0);
  for(let i=1;i<rows.length;i++){
    const up=rows[i].h-rows[i-1].h,down=rows[i-1].l-rows[i].l;
    plus[i]=up>down&&up>0?up:0;minus[i]=down>up&&down>0?down:0;
    tr[i]=Math.max(rows[i].h-rows[i].l,Math.abs(rows[i].h-rows[i-1].c),Math.abs(rows[i].l-rows[i-1].c));
  }
  let smoothTr=0,smoothPlus=0,smoothMinus=0;for(let i=1;i<=period;i++){smoothTr+=tr[i];smoothPlus+=plus[i];smoothMinus+=minus[i]}
  const dx=Array(rows.length).fill(null);const setDx=i=>{const p=smoothTr?100*smoothPlus/smoothTr:0,m=smoothTr?100*smoothMinus/smoothTr:0;dx[i]={value:p+m?100*Math.abs(p-m)/(p+m):0,plus:p,minus:m}};setDx(period);
  for(let i=period+1;i<rows.length;i++){smoothTr=smoothTr-smoothTr/period+tr[i];smoothPlus=smoothPlus-smoothPlus/period+plus[i];smoothMinus=smoothMinus-smoothMinus/period+minus[i];setDx(i)}
  let adx=null,seed=[];for(let i=period;i<dx.length;i++)if(dx[i]){if(adx===null){seed.push(dx[i].value);if(seed.length===period)adx=avg(seed)}else adx=(adx*(period-1)+dx[i].value)/period}
  const last=dx.at(-1);return adx===null||!last?null:{adx,plus:last.plus,minus:last.minus};
}
function technicalSignals(rows){
  const closes=rows.map(x=>x.c),last=closes.at(-1),result=[],add=(name,value,signal)=>result.push({name,value,signal}),rsiValues=rsiSeries(closes),lastRsi=rsiValues.at(-1);
  add('RSI(14)',lastRsi==null?null:fmt(lastRsi,3),lastRsi==null?'none':lastRsi>=70?'overbought':lastRsi<=30?'oversold':'hold');
  let stochKs=Array(rows.length).fill(null);for(let i=8;i<rows.length;i++){const tail=rows.slice(i-8,i+1),hi=Math.max(...tail.map(x=>x.h)),lo=Math.min(...tail.map(x=>x.l));stochKs[i]=hi===lo?50:100*(rows[i].c-lo)/(hi-lo)}
  const stochK=stochKs.at(-1),stochD=stochKs.slice(-6).filter(Number.isFinite).length===6?avg(stochKs.slice(-6)):null;
  add('STOCH(9,6)',stochK==null?null:fmt(stochK,3),stochK==null||stochD==null?'none':stochK>=80?'overbought':stochK<=20?'oversold':stochK>stochD?'buy':stochK<stochD?'sell':'hold');
  const stochRsiValues=Array(rows.length).fill(null);for(let i=0;i<rows.length;i++){const window=rsiValues.slice(i-13,i+1);if(window.length===14&&window.every(Number.isFinite)){const low=Math.min(...window),high=Math.max(...window);stochRsiValues[i]=high===low?50:100*(window.at(-1)-low)/(high-low)}}
  const stochRsi=stochRsiValues.at(-1),stochRsiD=stochRsiValues.slice(-3).length===3&&stochRsiValues.slice(-3).every(Number.isFinite)?avg(stochRsiValues.slice(-3)):null;
  add('STOCHRSI(14)',stochRsi==null?null:fmt(stochRsi,3),stochRsi==null||stochRsiD==null?'none':stochRsi>=80?'overbought':stochRsi<=20?'oversold':stochRsi>stochRsiD?'buy':stochRsi<stochRsiD?'sell':'hold');
  const m=closes.length>=35?macd(closes):null;add('MACD(12,26)',m?fmt(m.line,3):null,!m?'none':m.line>m.signal?'buy':m.line<m.signal?'sell':'hold');
  const adx=adxValues(rows);add('ADX(14)',adx?fmt(adx.adx,3):null,!adx?'none':adx.adx<20?'hold':adx.plus>adx.minus?'buy':adx.plus<adx.minus?'sell':'hold');
  let wrValues=Array(rows.length).fill(null);for(let i=13;i<rows.length;i++){const tail=rows.slice(i-13,i+1),hi=Math.max(...tail.map(x=>x.h)),lo=Math.min(...tail.map(x=>x.l));wrValues[i]=hi===lo?-50:-100*(hi-rows[i].c)/(hi-lo)}
  const wr=wrValues.at(-1),wrAverage=wrValues.slice(-3).filter(Number.isFinite).length===3?avg(wrValues.slice(-3)):null;
  add('Williams %R',wr==null?null:fmt(wr,3),wr==null||wrAverage==null?'none':wr>=-20?'overbought':wr<=-80?'oversold':wr>wrAverage?'buy':wr<wrAverage?'sell':'hold');
  if(rows.length>=14){const tail=rows.slice(-14),typical=tail.map(x=>(x.h+x.l+x.c)/3),mean=avg(typical),dev=avg(typical.map(x=>Math.abs(x-mean))),cci=dev?(typical.at(-1)-mean)/(.015*dev):0;add('CCI(14)',fmt(cci,4),cci>0?'buy':cci<0?'sell':'hold')}else add('CCI(14)',null,'none');
  const atrs=atrSeries(rows),atr=atrs.at(-1),prevAtr=atrs.slice(-4,-1).filter(Number.isFinite),priorAtr=prevAtr.length?avg(prevAtr):null;
  add('ATR(14)',atr==null?null:fmt(atr,4),atr==null||priorAtr==null?'none':atr<priorAtr?'volLow':atr>priorAtr?'volHigh':'hold');
  if(rows.length>=14){const tail=rows.slice(-14),high=Math.max(...tail.map(x=>x.h)),low=Math.min(...tail.map(x=>x.l)),mid=(high+low)/2,difference=last-mid;add('Highs/Lows(14)',fmt(difference,3),difference>0?'buy':difference<0?'sell':'hold')}else add('Highs/Lows(14)',null,'none');
  if(rows.length>=28){let weighted=0;for(const [period,weight] of [[7,4],[14,2],[28,1]]){let bp=0,tr=0;for(let i=rows.length-period;i<rows.length;i++){const previous=i?rows[i-1].c:rows[i].c;bp+=rows[i].c-Math.min(rows[i].l,previous);tr+=Math.max(rows[i].h,previous)-Math.min(rows[i].l,previous)}weighted+=weight*(tr?bp/tr*100:50)}const uo=weighted/7;add('Ultimate Oscillator',fmt(uo,3),uo>=70?'overbought':uo<=30?'oversold':'hold')}else add('Ultimate Oscillator',null,'none');
  const roc=closes.length>=13?100*(last/closes.at(-13)-1):null;add('ROC',roc==null?null:fmt(roc,3),roc==null?'none':roc>0?'buy':roc<0?'sell':'hold');
  const ema13=ema(closes,13).at(-1),bullBear=ema13==null?null:(rows.at(-1).h-ema13)+(rows.at(-1).l-ema13);add('Bull/Bear Power(13)',bullBear==null?null:fmt(bullBear,3),bullBear==null?'none':bullBear>0?'buy':bullBear<0?'sell':'hold');
  return result;
}
function signalCounts(rows){return rows.reduce((out,x)=>{if(x.signal==='buy'||x.signal==='oversold')out.buy++;else if(x.signal==='sell'||x.signal==='overbought')out.sell++;else if(x.signal==='hold'||x.signal==='neutral'||x.signal==='volLow'||x.signal==='volHigh')out.neutral++;return out},{buy:0,neutral:0,sell:0})}
function scoreSignal(signal){if(signal==='buy'||signal==='oversold')return 1;if(signal==='sell'||signal==='overbought')return -1;if(signal==='hold'||signal==='neutral'||signal==='volLow'||signal==='volHigh')return 0;return null}
function renderMonthlySeasonality(history){
  const monthNames=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],monthly=aggregate(history.rows,'month'),now=new Date(),currentKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,stats=Array.from({length:12},(_,i)=>({month:i+1,returns:[]}));
  for(let i=1;i<monthly.length;i++){const bar=monthly[i],prior=monthly[i-1],serial=x=>Number(x.key.slice(0,4))*12+Number(x.key.slice(5,7));if(serial(bar)-serial(prior)!==1||bar.key===currentKey)continue;const change=(bar.c/prior.c-1)*100;if(Number.isFinite(change))stats[Number(bar.key.slice(5,7))-1].returns.push(change)}
  stats.forEach(item=>{item.returns=item.returns.slice(-5)});
  const describe=item=>{const n=item.returns.length,mean=n?avg(item.returns):null,up=n?item.returns.filter(x=>x>0).length:0,win=n?up/n:null,direction=n<3?'ข้อมูลยังน้อย':win>=.6&&mean>0?'มักขึ้น':win<=.4&&mean<0?'มักลง':'ไม่ชัดเจน';return {...item,n,mean,up,win,direction}};
  const values=stats.map(describe),current=values[now.getMonth()];$('seasonalityCurrentMonth').textContent=`เดือนนี้: ${monthNames[now.getMonth()]}`;
  $('seasonalitySummary').innerHTML=current.n?`<b>${monthNames[now.getMonth()]} ${current.direction}</b><span>ย้อนหลัง ${current.n} ปี · ผลตอบแทนเฉลี่ย ${current.mean>=0?'+':''}${fmt(current.mean,2)}% · ปิดบวก ${current.up}/${current.n} ปี (${fmt(current.win*100,0)}%)</span>`:`<b>${monthNames[now.getMonth()]}: ยังไม่มีข้อมูลพอ</b><span>ต้องมีข้อมูลเดือนที่ปิดแล้วต่อเนื่องเพื่อคำนวณรูปแบบย้อนหลัง</span>`;
  $('seasonalityRows').innerHTML=values.map(item=>`<tr class="${item.month===now.getMonth()+1?'current-season-month':''}"><td>${monthNames[item.month-1]}${item.month===now.getMonth()+1?' · เดือนนี้':''}</td><td><span class="seasonality-badge ${item.direction==='มักขึ้น'?'up':item.direction==='มักลง'?'down':'mixed'}">${item.direction}</span></td><td>${item.mean==null?'—':`${item.mean>=0?'+':''}${fmt(item.mean,2)}%`}</td><td>${item.n?`${item.up}/${item.n} (${fmt(item.win*100,0)}%)`:'—'}</td><td>${item.n||'—'}</td></tr>`).join('');
  $('seasonalityNote').textContent=`ใช้ข้อมูลฤดูกาลไม่เกิน 5 ปีล่าสุด (สูงสุดเดือนละ 5 ตัวอย่าง) จากประวัติ ${history.rows.length.toLocaleString()} แท่ง ตั้งแต่ ${new Date(history.rows[0].t*1000).toLocaleDateString('th-TH')} ถึง ${new Date(history.rows.at(-1).t*1000).toLocaleDateString('th-TH')} · ผลตอบแทนรายเดือนคำนวณจากราคาปิดเดือนก่อนหน้าเทียบราคาปิดเดือนนั้น โดยไม่รวมเดือนปัจจุบันที่ยังไม่ปิด · “มักขึ้น/ลง” ต้องมีข้อมูลอย่างน้อย 3 ปีและปิดบวก/ลบอย่างน้อย 60% ของตัวอย่าง`;
}
function renderWeekdaySeasonality(history){
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],days=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'],now=new Date(),grid=Array.from({length:12},()=>Array.from({length:7},()=>[])),rows=history.rows,quoteTime=Number(history.meta?.regularMarketTime),lastDay=new Date(rows.at(-1).t*1000).toISOString().slice(0,10),quoteDay=quoteTime?new Date(quoteTime*1000).toISOString().slice(0,10):'',isPartial=history.meta?.marketState==='REGULAR'&&lastDay===quoteDay;
  for(let i=1;i<rows.length;i++){if(isPartial&&i===rows.length-1)continue;const row=rows[i],prior=rows[i-1],date=new Date(row.t*1000),change=(row.c/prior.c-1)*100;if(Number.isFinite(change))grid[date.getUTCMonth()][date.getUTCDay()].push(change)}
  const cell=(month,weekday)=>{if(weekday===0||weekday===6)return `<td><span class="weekday-closed">ตลาดปิด</span></td>`;const values=grid[month][weekday],n=values.length,mean=n?avg(values):null,up=n?values.filter(x=>x>0).length:0,win=n?up/n:0,direction=n<8?'ข้อมูลน้อย':win>=.6&&mean>0?'มักขึ้น':win<=.4&&mean<0?'มักลง':'ไม่ชัดเจน',cls=direction==='มักขึ้น'?'up':direction==='มักลง'?'down':'mixed',icon=direction==='มักขึ้น'?'↑':direction==='มักลง'?'↓':'·',title=n?`${days[weekday]} ${months[month]}: เฉลี่ย ${mean>=0?'+':''}${fmt(mean,2)}% · ปิดบวก ${up}/${n} วัน (${fmt(win*100,0)}%)`:`${days[weekday]} ${months[month]}: ไม่มีข้อมูล`;return `<td title="${escapeHtml(title)}"><span class="weekday-cell ${cls}">${n?`${icon} ${mean>=0?'+':''}${fmt(mean,2)}%`:direction}</span><small>${n?`${fmt(win*100,0)}% บวก · ${n} วัน`:''}</small></td>`};
  $('weekdayCurrentMonth').textContent=`เดือนนี้: ${months[now.getMonth()]}`;$('weekdaySeasonalityRows').innerHTML=months.map((month,i)=>`<tr class="${i===now.getMonth()?'current-season-month':''}"><td>${month}${i===now.getMonth()?' · เดือนนี้':''}</td>${[1,2,3,4,5,6,0].map(day=>cell(i,day)).join('')}</tr>`).join('');
  const current=grid[now.getMonth()],brief=[1,2,3,4,5].map(day=>{const values=current[day],n=values.length,mean=n?avg(values):0,win=n?values.filter(x=>x>0).length/n:0;if(n<8)return null;const label=win>=.6&&mean>0?'มักขึ้น':win<=.4&&mean<0?'มักลง':'ไม่ชัด';return `${days[day]} ${label}`}).filter(Boolean);$('weekdaySeasonalitySummary').innerHTML=`<b>รูปแบบวันซื้อขายของเดือน${months[now.getMonth()]}</b><span>${brief.length?brief.join(' · '):'ข้อมูลรายวันยังไม่พอ · ต้องมีอย่างน้อย 8 ตัวอย่างต่อวันในสัปดาห์'}</span>`;
}
function renderCalendarTiming(history){
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],now=new Date(),currentKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,rows=history.rows,segments=new Map(),daily=Array.from({length:12},()=>Array.from({length:32},()=>[])),quoteTime=Number(history.meta?.regularMarketTime),lastDay=new Date(rows.at(-1).t*1000).toISOString().slice(0,10),quoteDay=quoteTime?new Date(quoteTime*1000).toISOString().slice(0,10):'',isPartial=history.meta?.marketState==='REGULAR'&&lastDay===quoteDay;
  for(let i=1;i<rows.length;i++){
    if(isPartial&&i===rows.length-1)continue;
    const row=rows[i],prior=rows[i-1],date=new Date(row.t*1000),monthKey=date.toISOString().slice(0,7);
    if(monthKey===currentKey)continue;
    const month=date.getUTCMonth(),day=date.getUTCDate(),period=day<=10?0:day<=20?1:2,change=(row.c/prior.c-1)*100;
    if(!Number.isFinite(change))continue;
    daily[month][day].push(change);
    const key=`${monthKey}-${period}`;
    if(!segments.has(key))segments.set(key,{month,period,firstPrevious:prior.c,last:row.c});
    else segments.get(key).last=row.c;
  }
  const buckets=Array.from({length:12},()=>Array.from({length:3},()=>[]));
  for(const segment of segments.values()){const value=(segment.last/segment.firstPrevious-1)*100;if(Number.isFinite(value))buckets[segment.month][segment.period].push(value)}
  const stats=values=>{const n=values.length,mean=n?avg(values):null,up=n?values.filter(x=>x>0).length:0,down=n?values.filter(x=>x<0).length:0,win=n?up/n:0;return {n,mean,up,down,win}};
  const candidates=[];
  buckets.forEach((periods,month)=>periods.forEach((values,period)=>{const s=stats(values);if(s.n>=3)candidates.push({month,period,...s})}));
  const entry=candidates.filter(x=>x.mean<0&&x.win<=.4).sort((a,b)=>a.mean-b.mean)[0]||null,exit=candidates.filter(x=>x.mean>0&&x.win>=.6).sort((a,b)=>b.mean-a.mean)[0]||null,periodNames=['ต้นเดือน (1–10)','กลางเดือน (11–20)','ท้ายเดือน (21–สิ้นเดือน)'];
  $('timingCurrentMonth').textContent=`เดือนนี้: ${months[now.getMonth()]}`;
  const highlight=(item,type)=>item?`<div class="timing-highlight ${type}"><b>${type==='entry'?'ช่วงที่มักอ่อนตัว':'ช่วงที่มักแข็งตัว'}</b><strong>${months[item.month]} · ${periodNames[item.period]}</strong><span>เฉลี่ย ${item.mean>=0?'+':''}${fmt(item.mean,2)}% · ${type==='entry'?'ปิดลบ':'ปิดบวก'} ${type==='entry'?item.down:item.up}/${item.n} ช่วง (${fmt((type==='entry'?item.down:item.up)/item.n*100,0)}%)</span></div>`:`<div class="timing-highlight muted"><b>${type==='entry'?'ช่วงสะสมย้อนหลัง':'ช่วงขายย้อนหลัง'}</b><strong>ยังไม่พบรูปแบบชัดเจน</strong><span>ต้องมีอย่างน้อย 3 ปีและผลไปทิศเดียวกันอย่างน้อย 60%</span></div>`;
  $('timingHighlights').innerHTML=highlight(entry,'entry')+highlight(exit,'exit');
  $('timingWindowRows').innerHTML=months.map((month,m)=>`<tr class="${m===now.getMonth()?'current-season-month':''}"><td>${month}${m===now.getMonth()?' · เดือนนี้':''}</td>${[0,1,2].map(p=>{const s=stats(buckets[m][p]),isEntry=entry?.month===m&&entry?.period===p,isExit=exit?.month===m&&exit?.period===p,cls=isEntry?'timing-entry':isExit?'timing-exit':s.n<3?'mixed':s.mean>0&&s.win>=.6?'up':s.mean<0&&s.win<=.4?'down':'mixed',label=s.n<3?'ข้อมูลน้อย':`${s.mean>=0?'+':''}${fmt(s.mean,2)}%`;return `<td><span class="timing-window-cell ${cls}">${label}${isEntry?' · สะสม':isExit?' · ขาย':''}</span><small>${s.n?`${fmt(s.win*100,0)}% ปิดบวก · ${s.n} ปี`:'—'}</small></td>`}).join('')}</tr>`).join('');
  const exact=months.map((month,m)=>{const dates=Array.from({length:31},(_,i)=>{const values=daily[m][i+1],s=stats(values);return {day:i+1,...s}}).filter(x=>x.n>=5);const weak=dates.filter(x=>x.mean<0&&x.win<=.5).sort((a,b)=>a.mean-b.mean)[0],strong=dates.filter(x=>x.mean>0&&x.win>=.5).sort((a,b)=>b.mean-a.mean)[0],format=(x,label)=>x?`วันที่ ${x.day} · ${x.mean>=0?'+':''}${fmt(x.mean,2)}% · ${label} ${label==='ลบ'?x.down:x.up}/${x.n} (${fmt((label==='ลบ'?x.down:x.up)/x.n*100,0)}%)`:'ไม่พบวันที่เด่น';return `<tr class="${m===now.getMonth()?'current-season-month':''}"><td>${month}${m===now.getMonth()?' · เดือนนี้':''}</td><td>${format(weak,'ลบ')}</td><td>${format(strong,'บวก')}</td></tr>`});
  $('timingDayRows').innerHTML=exact.join('');
}
function classicPivots(previous){
  if(!previous||![previous.h,previous.l,previous.c].every(Number.isFinite))return null;
  const {h:high,l:low,c:close}=previous,p=(high+low+close)/3,range=high-low;
  return {s3:low-2*(high-p),s2:p-range,s1:2*p-high,p,r1:2*p-low,r2:p+range,r3:high+2*(p-low)};
}
function pivotBucketKey(epoch,timeframe){
  const date=usTradingDate(epoch);if(timeframe==='1d')return date;if(timeframe==='1mo')return date.slice(0,7);
  const [year,month,day]=date.split('-').map(Number),monday=new Date(Date.UTC(year,month-1,day));monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);return monday.toISOString().slice(0,10);
}
function selectCompletedPivotBar(rows,timeframe,referenceEpoch,asof){
  if(!rows.length)return null;const bars=timeframe==='1w'?aggregate(rows,'week'):timeframe==='1mo'?aggregate(rows,'month'):rows;
  if(!bars.length)return null;
  const latest=bars.at(-1),referenceDate=usTradingDate(referenceEpoch),currentKey=pivotBucketKey(referenceEpoch,timeframe),latestKey=timeframe==='1d'?usTradingDate(latest.t):latest.key;let periodClosed=false;
  if(timeframe!=='1mo'&&latestKey===currentKey){
    const time=usTimeFormatter.formatToParts(new Date(referenceEpoch*1000)),minutes=Number(time.find(x=>x.type==='hour').value)*60+Number(time.find(x=>x.type==='minute').value);
    if(timeframe==='1d')periodClosed=minutes>=960;
    else{const weekday=new Date(`${referenceDate}T00:00:00Z`).getUTCDay();periodClosed=weekday===6||weekday===0||weekday===5&&minutes>=960}
  }
  const index=latestKey===currentKey&&!periodClosed?bars.length-2:bars.length-1;return index>=0?bars[index]:null;
}
function setPivotDisplay(candle,label,feed=''){
  const pivots=classicPivots(candle),row=$('taPivotRow');if(!pivots){$('taPivotPeriod').textContent=`${label} · ไม่มีแท่งก่อนหน้าที่ปิดแล้ว`;row.innerHTML='<td colspan="7">ข้อมูลแท่งก่อนหน้าไม่เพียงพอ</td>';return}
  row.innerHTML=['s3','s2','s1','p','r1','r2','r3'].map(key=>`<td class="pivot-${key}">${fmt(pivots[key])}</td>`).join('');
  const stamp=Number.isFinite(candle.t)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(candle.t*1000))+' ET':usTradingDate(candle.t);
  $('taPivotPeriod').textContent=`${label} · ใช้แท่ง ${stamp}${feed?` · ${feed}`:''}`;
}
async function renderPivotTable(history){
  const timeframe=state.pivotTimeframe,asof=$('pivotAsOf').value,referenceEpoch=asof?taAsOfEpoch(asof):Date.now()/1000,labels={'1d':'รายวัน','1w':'รายสัปดาห์','1mo':'รายเดือน',...Object.fromEntries(Object.entries(taTimeframeInfo).map(([key,value])=>[key,value.name]))};if(!Number.isFinite(referenceEpoch))return;
  if(['1d','1w','1mo'].includes(timeframe)){
    const daily=taFilteredRows(history.rows,'1d',asof).rows,candle=selectCompletedPivotBar(daily,timeframe,referenceEpoch,asof);setPivotDisplay(candle,labels[timeframe],'Yahoo · แท่งปิดแล้ว');return;
  }
  const key=`${state.symbol}:${timeframe}:${asof||'latest'}`,cached=state.pivotRows,duration=({'1min':60,'5min':300,'15min':900,'30min':1800,'1h':3600,'5h':18000})[timeframe];
  if(cached?.key===key&&(asof||Date.now()-cached.fetchedAt<60000)){
    const closed=cached.rows.filter(bar=>bar.t+duration<=referenceEpoch&&isRegularSessionBar(bar));setPivotDisplay(closed.at(-1),labels[timeframe],cached.feed);return;
  }
  if(state.pivotPendingKey===key)return;
  const requestId=++state.pivotRequestId,symbol=state.symbol;state.pivotPendingKey=key;$('taPivotPeriod').textContent=`${labels[timeframe]} · กำลังโหลดแท่งราคา…`;$('taPivotRow').innerHTML='<td colspan="7">กำลังโหลดข้อมูล Alpaca…</td>';
  try{
    const info=taTimeframeInfo[timeframe],asofParam=asof?`&asof=${encodeURIComponent(asof)}`:'',range=asof?'ta':'5d';
    const result=await alpacaApi(`bars?symbol=${encodeURIComponent(symbol)}&timeframe=${info.api}&range=${range}${asofParam}&_=${Date.now()}`,{cache:'no-store'});
    if(requestId!==state.pivotRequestId||symbol!==state.symbol||timeframe!==state.pivotTimeframe||asof!==$('pivotAsOf').value)return;
    state.pivotRows={key,rows:result.bars||[],feed:result.feed||'Alpaca',fetchedAt:Date.now()};
    const closed=state.pivotRows.rows.filter(bar=>bar.t+duration<=referenceEpoch&&isRegularSessionBar(bar));setPivotDisplay(closed.at(-1),labels[timeframe],state.pivotRows.feed);
  }catch(error){if(requestId===state.pivotRequestId){$('taPivotPeriod').textContent=`${labels[timeframe]} · โหลดไม่สำเร็จ`;$('taPivotRow').innerHTML=`<td colspan="7">${escapeHtml(error.message)}</td>`}}
  finally{if(requestId===state.pivotRequestId&&state.pivotPendingKey===key)state.pivotPendingKey=null}
}
function ratingFor(counts,balanceOverride=null){
  const total=counts.buy+counts.neutral+counts.sell;if(!total&&balanceOverride==null)return {label:'ข้อมูลไม่พอ',score:50,className:'neutral',balance:null};
  const balance=balanceOverride==null?(counts.buy-counts.sell)/total:balanceOverride;
  const score=50+balance*50;
  if(score>=80)return {label:'ซื้อทันที',score,className:'buy-immediate',balance};
  if(score>=60)return {label:'ซื้อ',score,className:'buy',balance};
  if(score<=20)return {label:'ขายทันที',score,className:'sell-immediate',balance};
  if(score<=40)return {label:'ขาย',score,className:'sell',balance};
  return {label:'เป็นกลาง',score,className:'neutral',balance};
}
function renderGauge(id,counts,balanceOverride=null){
  const rating=ratingFor(counts,balanceOverride),cx=90,cy=91,r=69,point=angle=>[cx+r*Math.cos(angle*Math.PI/180),cy+r*Math.sin(angle*Math.PI/180)],arc=(a,b)=>{const p=point(a),q=point(b);return `M${p[0].toFixed(2)} ${p[1].toFixed(2)} A${r} ${r} 0 0 1 ${q[0].toFixed(2)} ${q[1].toFixed(2)}`},needle=point(180+rating.score*1.8),total=counts.buy+counts.neutral+counts.sell;
  $(id).innerHTML=`<svg viewBox="0 0 180 108" aria-hidden="true"><path d="${arc(180,216)}" fill="none" stroke="#c95f62" stroke-width="8" stroke-linecap="round"/><path d="${arc(216,252)}" fill="none" stroke="#e48b88" stroke-width="8" stroke-linecap="round"/><path d="${arc(252,288)}" fill="none" stroke="#77818a" stroke-width="8" stroke-linecap="round"/><path d="${arc(288,324)}" fill="none" stroke="#74bd8e" stroke-width="8" stroke-linecap="round"/><path d="${arc(324,360)}" fill="none" stroke="#16883f" stroke-width="8" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${needle[0].toFixed(2)}" y2="${needle[1].toFixed(2)}" stroke="#bbc5ce" stroke-width="1.4"/><circle cx="${cx}" cy="${cy}" r="4" fill="#8f9ba6"/></svg><div class="ta-gauge-captions"><span class="sell-immediate">ขายทันที</span><span class="sell">ขาย</span><span class="neutral">เป็นกลาง</span><span class="buy">ซื้อ</span><span class="buy-immediate">ซื้อทันที</span></div>`;
  return {...rating,total};
}
const taTimeframeInfo={'1min':{api:'1Min',name:'ราย 1 นาที'},'5min':{api:'5Min',name:'ราย 5 นาที'},'15min':{api:'15Min',name:'ราย 15 นาที'},'30min':{api:'30Min',name:'ราย 30 นาที'},'1h':{api:'1Hour',name:'รายชั่วโมง'},'5h':{api:'5Hour',name:'ราย 5 ชั่วโมง'}};
function taAsOfEpoch(value){return value?Date.parse(`${value}:00+07:00`)/1000:null}
function taFilteredRows(allRows,timeframe,asof){if(!asof)return {rows:allRows,futureRows:[]};const cutoff=taAsOfEpoch(asof);if(!Number.isFinite(cutoff))return {rows:[],futureRows:[]};const duration={ '1min':60,'5min':300,'15min':900,'30min':1800,'1h':3600,'5h':18000 }[timeframe];if(duration){return {rows:allRows.filter(c=>c.t+duration<=cutoff),futureRows:allRows.filter(c=>c.t>=cutoff)}}const eastern=new Date(cutoff*1000).toLocaleString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),[hour,minute]=eastern.split(':').map(Number),cutoffDate=usTradingDate(cutoff),daily=allRows.filter(c=>{const date=usTradingDate(c.t);return date<cutoffDate||(date===cutoffDate&&hour*60+minute>=16*60)}),lastDate=daily.length?usTradingDate(daily.at(-1).t):'';return {rows:daily,futureRows:allRows.filter(c=>lastDate?usTradingDate(c.t)>lastDate:usTradingDate(c.t)>=cutoffDate)}}
function taAsOfLabel(value){return value?new Date(`${value}:00+07:00`).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}):''}
async function fetchTechnicalBars(symbol,timeframe){const info=taTimeframeInfo[timeframe],asof=$('taAsOfDate').value,key=`${symbol}:${timeframe}:${asof}`;if(!info||state.taPending===key)return;state.taPending=key;const requestId=++state.taRequestId;$('taIndicatorPeriod').textContent=`${info.name} · กำลังโหลดข้อมูล`;try{const asofParam=asof?`&asof=${encodeURIComponent(asof)}`:'';const data=await alpacaApi(`bars?symbol=${encodeURIComponent(symbol)}&timeframe=${info.api}&range=ta${asofParam}`);if(requestId!==state.taRequestId||symbol!==state.symbol||timeframe!==state.taTimeframe||asof!==$('taAsOfDate').value)return;state.taRows={symbol,timeframe,asof,rows:data.bars||[]};renderTechnicalAnalysis(state.history)}catch(err){if(requestId===state.taRequestId&&symbol===state.symbol&&timeframe===state.taTimeframe&&asof===$('taAsOfDate').value){$('taIndicatorPeriod').textContent=`${info.name} · โหลดไม่สำเร็จ`;$('taIndicatorRows').innerHTML=`<tr><td colspan="3">${escapeHtml(err.message)}</td></tr>`;$('taMovingAverageRows').innerHTML='<tr><td colspan="3">ข้อมูลค่าเฉลี่ยไม่พร้อม</td></tr>';toast(`โหลดข้อมูล ${info.name} ไม่สำเร็จ: ${err.message}`)}}finally{if(state.taPending===key)state.taPending=null}}
function historicalSignalReliability(rows){
  const count=rows.length,start=Math.max(30,count-520),end=count-21,balances=Array(count).fill(null),samples={1:[],5:[],20:[]};
  for(let i=start;i<=end;i++){
    const prefix=rows.slice(0,i+1),technical=signalCounts(technicalSignals(prefix)),technicalTotal=technical.buy+technical.neutral+technical.sell;
    if(!technicalTotal)continue;
    const technicalBalance=(technical.buy-technical.sell)/technicalTotal,closes=prefix.map(x=>x.c),last=closes.at(-1),periodScores=[];
    for(const period of [5,10,20,50,100,200]){
      const scores=[];
      for(const kind of ['SMA','EMA']){const value=kind==='SMA'?simpleAverage(closes,period):ema(closes,period).at(-1);if(Number.isFinite(value))scores.push(last>value?1:last<value?-1:0)}
      if(scores.length)periodScores.push(avg(scores));
    }
    const averageBalance=periodScores.length?avg(periodScores):null;
    balances[i]=averageBalance==null?technicalBalance:(technicalBalance+averageBalance)/2;
  }
  for(const horizon of [1,5,20])for(let i=start;i+horizon<count;i++){
    const balance=balances[i];if(!Number.isFinite(balance)||Math.abs(balance)<.12)continue;
    const change=(rows[i+horizon].c/rows[i].c-1)*100,signal=balance>0?1:-1,direction=change>0?1:change<0?-1:0;
    samples[horizon].push({hit:direction===signal,change,signal});
  }
  return [1,5,20].map(horizon=>{const values=samples[horizon],hits=values.filter(x=>x.hit).length;return {horizon,n:values.length,hits,rate:values.length?hits/values.length*100:null,mean:values.length?avg(values.map(x=>x.change)):null,buy:values.filter(x=>x.signal>0).length,sell:values.filter(x=>x.signal<0).length}});
}
function technicalReliabilityAcrossFrames(rows){
  const key=`${state.symbol}:${rows.length}:${rows.at(-1)?.t}:${rows.at(-1)?.c}`,cached=state.taReliabilityCache[key];if(cached)return cached;
  const frames=[['รายวัน',rows],['รายสัปดาห์',aggregate(rows,'week')],['รายเดือน',aggregate(rows,'month')]],result=frames.flatMap(([timeframe,bars])=>historicalSignalReliability(bars).map(item=>({...item,timeframe,bars:bars.length})));
  state.taReliabilityCache={[key]:result};return result;
}
function summarizeTechnicalBars(rows){
  const closes=rows.map(x=>x.c),technical=technicalSignals(rows),moving=[];
  for(const period of [5,10,20,50,100,200])for(const kind of ['SMA','EMA']){
    const value=kind==='SMA'?simpleAverage(closes,period):ema(closes,period).at(-1),last=closes.at(-1),signal=value==null?'none':last>value?'buy':last<value?'sell':'neutral';moving.push({name:`${kind} (${period})`,value,signal});
  }
  const technicalCounts=signalCounts(technical),movingCounts=signalCounts(moving),all=signalCounts([...technical,...moving]),technicalTotal=technicalCounts.buy+technicalCounts.neutral+technicalCounts.sell,technicalBalance=technicalTotal?(technicalCounts.buy-technicalCounts.sell)/technicalTotal:null,periodBalances=[5,10,20,50,100,200].map(period=>{const scores=moving.filter(x=>x.name.endsWith(`(${period})`)).map(x=>scoreSignal(x.signal)).filter(Number.isFinite);return scores.length?avg(scores):null}).filter(Number.isFinite),movingBalance=periodBalances.length?avg(periodBalances):null,overallBalance=technicalBalance==null?movingBalance:movingBalance==null?technicalBalance:(technicalBalance+movingBalance)/2;
  return {rating:ratingFor(all,overallBalance),technicalRating:ratingFor(technicalCounts),movingRating:ratingFor(movingCounts),technicalCounts,movingCounts,current:closes.at(-1),time:rows.at(-1)?.t};
}
function renderHistoricalOutcomes(baseRows,futureRows,asof,signalBalance,periodName,reliabilityRows){
  const box=$('taHistoricalResult'),reliability=reliabilityRows||[],multiRows=reliability.map(x=>`<tr><td>${x.timeframe} · หลัง ${x.horizon} แท่ง <small>(${x.bars} แท่งข้อมูล)</small></td><td>${x.rate==null?'ข้อมูลไม่พอ':`${fmt(x.rate,1)}%${x.n<30?' · ตัวอย่างน้อย':''}`}</td><td>${x.n?`${x.hits}/${x.n} ครั้ง`:'0 ครั้ง'} <small>· ซื้อ ${x.buy} / ขาย ${x.sell}</small></td><td>${x.mean==null?'—':`${x.mean>0?'+':''}${fmt(x.mean)}%`}</td></tr>`).join('');
  const multi=`<b>ความน่าเชื่อถือจากหลายจุดเวลา · รายวัน / รายสัปดาห์ / รายเดือน</b><div>ใช้สูงสุด 500 จุดล่าสุดต่อกรอบเวลา · นับเฉพาะสัญญาณเอนเอียงชัดที่มีข้อมูลอนาคตครบ · “ไปทางเดียวกัน” เทียบกับผลตอบแทนจริง</div><table><thead><tr><th>กรอบ/ช่วงวัดผล</th><th>ไปทางเดียวกัน</th><th>ตัวอย่างสัญญาณ</th><th>ผลตอบแทนเฉลี่ย</th></tr></thead><tbody>${multiRows}</tbody></table><small>จุดเวลาอาจทับซ้อนกัน จึงไม่ใช่ตัวอย่างอิสระหรือการรับประกันผล · ตัดสัญญาณเป็นกลางออกจากตัวหาร</small>`;
  if(!asof){box.hidden=false;box.innerHTML=multi;return}
  const base=baseRows.at(-1),actualDate=base?usTradingDate(base.t):'?',direction=signalBalance==null?'ข้อมูลไม่พอ':signalBalance>=.12?'เอนเอียงขึ้น':signalBalance<=-.12?'เอนเอียงลง':'เป็นกลาง',bias=signalBalance==null?0:signalBalance>=.12?1:signalBalance<=-.12?-1:0;let rowsHtml='';
  for(const horizon of [1,5,20]){const future=futureRows[horizon-1];if(!base||!future){rowsHtml+=`<tr><td>หลัง ${horizon} แท่ง</td><td colspan="2">ข้อมูลอนาคตยังไม่ครบ</td></tr>`;continue}const change=(future.c/base.c-1)*100,sign=change>0?1:change<0?-1:0,match=bias===0?'ใช้เป็นกลาง':sign===bias?'ไปทางเดียวกับสัญญาณ':'สวนทางกับสัญญาณ',klass=change>0?'ta-forward-up':change<0?'ta-forward-down':'ta-forward-flat';rowsHtml+=`<tr><td>หลัง ${horizon} แท่ง · ${escapeHtml(usTradingDate(future.t))}</td><td class="${klass}">${change>0?'+':''}${fmt(change)}%</td><td>${match}</td></tr>`}
  box.hidden=false;box.innerHTML=`${multi}<div class="ta-asof-outcome"><b>ผลตรวจ ณ เวลาที่เลือก · ${escapeHtml(taAsOfLabel(asof))} · แท่งข้อมูลถึง ${escapeHtml(actualDate)}</b><div>ภาพรวมสัญญาณ ณ จุดนี้: <b>${escapeHtml(direction)}</b> · ราคาอ้างอิงปิด ${fmt(base?.c)} · ผลตอบแทนหลังจากนั้น</div><table><thead><tr><th>ช่วงวัดผล</th><th>ผลตอบแทน</th><th>เทียบสัญญาณ</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}
function renderTechnicalAnalysis(history){
  if(!history?.rows?.length)return;
  renderPivotTable(history);
  const timeframe=state.taTimeframe,info=taTimeframeInfo[timeframe],asof=$('taAsOfDate').value;let rows,periodName,allRows,futureRows=[];
  if(info){periodName=info.name;const cached=state.taRows;if(cached?.symbol===state.symbol&&cached.timeframe===timeframe&&cached.asof===asof){allRows=cached.rows;({rows,futureRows}=taFilteredRows(allRows,timeframe,asof))}else{$('taIndicatorPeriod').textContent=`${periodName} · กำลังโหลดข้อมูล`;$('taIndicatorRows').innerHTML='<tr><td colspan="3">กำลังโหลดแท่งราคา…</td></tr>';$('taMovingAverageRows').innerHTML='<tr><td colspan="3">กำลังคำนวณค่าเฉลี่ย…</td></tr>';fetchTechnicalBars(state.symbol,timeframe);return}}
  else{const {rows:before,futureRows:future}=taFilteredRows(history.rows,timeframe,asof);rows=timeframe==='1w'?aggregate(before,'week'):timeframe==='1m'?aggregate(before,'month'):before;futureRows=timeframe==='1w'?aggregate(future,'week'):timeframe==='1m'?aggregate(future,'month'):future;periodName=timeframe==='1w'?'รายสัปดาห์':timeframe==='1m'?'รายเดือน':'รายวัน'}
  if(asof&&!rows.length){$('taIndicatorPeriod').textContent=`\u0e44\u0e21\u0e48\u0e21\u0e35\u0e41\u0e17\u0e48\u0e07\u0e23\u0e32\u0e04\u0e32\u0e16\u0e36\u0e07 ${taAsOfLabel(asof)}`;$('taHistoricalResult').hidden=true;return}
  if(!rows?.length){$('taIndicatorPeriod').textContent=`${periodName} · ไม่มีข้อมูล`;if(asof)$('taHistoricalResult').hidden=true;return}
  const closes=rows.map(x=>x.c),last=closes.at(-1),technical=technicalSignals(rows),moving=[];
  for(const period of [5,10,20,50,100,200])for(const kind of ['SMA','EMA']){
    const values=kind==='SMA'?simpleAverage(closes,period):ema(closes,period).at(-1),signal=values==null?'none':last>values?'buy':last<values?'sell':'neutral';moving.push({name:`${kind} (${period})`,value:values==null?null:fmt(values),signal});
  }
  const tc=signalCounts(technical),mc=signalCounts(moving),all=signalCounts([...technical,...moving]),periodBalances=[5,10,20,50,100,200].map(period=>{const scores=moving.filter(x=>x.name.endsWith(`(${period})`)).map(x=>scoreSignal(x.signal)).filter(Number.isFinite);return scores.length?avg(scores):null}).filter(Number.isFinite),technicalBalance=tc.buy+tc.neutral+tc.sell?(tc.buy-tc.sell)/(tc.buy+tc.neutral+tc.sell):null,averageBalance=periodBalances.length?avg(periodBalances):null,overallBalance=technicalBalance==null?averageBalance:averageBalance==null?technicalBalance:(technicalBalance+averageBalance)/2,tr=renderGauge('technicalGauge',tc),mr=renderGauge('movingAverageGauge',mc),overall=renderGauge('overallGauge',all,overallBalance);
  const names={buy:'ซื้อ',sell:'ขาย',hold:'ถือหุ้นไว้',overbought:'ซื้อมากเกินไป',oversold:'ขายมากเกินไป',volLow:'ผันผวนน้อยลง',volHigh:'ผันผวนมากขึ้น',neutral:'ถือหุ้นไว้',none:'ข้อมูลไม่พอ'},classes={overbought:'sell',oversold:'buy',hold:'neutral',volLow:'neutral',volHigh:'neutral'};
  for(const [prefix,rating,counts] of [['technical',tr,tc],['movingAverage',mr,mc],['overall',overall,all]]){
    $(`${prefix}Rating`).textContent=rating.label;$(`${prefix}Rating`).className=`ta-gauge-label ${rating.className}`;
    $(`${prefix}Counts`).textContent=prefix==='overall'?`ตัวชี้วัด ${technicalBalance==null?'—':Math.round(50+technicalBalance*50)+'/100'} · ค่าเฉลี่ย ${averageBalance==null?'—':Math.round(50+averageBalance*50)+'/100'}`:rating.total?`ซื้อ ${counts.buy} · กลาง ${counts.neutral} · ขาย ${counts.sell}`:'ข้อมูลย้อนหลังไม่พอ';
  }
  const asofUsed=asof?usTradingDate(rows.at(-1).t):'';$('taIndicatorPeriod').textContent=`${periodName} \u00b7 ${rows.length} \u0e41\u0e17\u0e48\u0e07${asof?` \u00b7 \u0e16\u0e36\u0e07 ${asofUsed}`:''}`;$('taAsOfStatus').textContent=asof?`\u0e40\u0e27\u0e25\u0e32\u0e44\u0e17\u0e22 ${taAsOfLabel(asof)} \u00b7 \u0e43\u0e0a\u0e49\u0e41\u0e17\u0e48\u0e07\u0e17\u0e35\u0e48\u0e1b\u0e34\u0e14\u0e41\u0e25\u0e49\u0e27\u0e16\u0e36\u0e07 ${asofUsed}`:'\u0e27\u0e34\u0e40\u0e04\u0e23\u0e32\u0e30\u0e2b\u0e4c\u0e08\u0e32\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14';renderHistoricalOutcomes(rows,futureRows,asof,overallBalance,periodName,technicalReliabilityAcrossFrames(history.rows));
  $('taIndicatorRows').innerHTML=technical.map(item=>`<tr><td>${item.name}</td><td>${item.value??'—'}</td><td><span class="ta-signal ${classes[item.signal]||item.signal}">${names[item.signal]}</span></td></tr>`).join('');
  $('taMovingAverageRows').innerHTML=moving.map(item=>`<tr><td>${item.name}</td><td>${item.value??'—'}</td><td><span class="ta-signal ${item.signal}">${names[item.signal]}</span></td></tr>`).join('');
}
async function fetchHistory(symbol,historyRange='10y'){
  const res=await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(historyRange)}`,{cache:'no-store'});if(!res.ok)throw new Error(`โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  const json=await res.json();if(json.error)throw new Error(json.error);const result=json?.chart?.result?.[0];if(!result)throw new Error(json?.chart?.error?.description||'ไม่พบข้อมูลหุ้นนี้');
  const q=result.indicators.quote[0], adj=result.indicators.adjclose?.[0]?.adjclose;
  const rows=result.timestamp.map((t,i)=>toCandle(t,q.open[i],q.high[i],q.low[i],q.close[i],q.volume[i]||0)).filter(x=>[x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.c>0);
  if(rows.length<60)throw new Error('ข้อมูลย้อนหลังต้องมีอย่างน้อย 60 แท่ง · ค่าเฉลี่ย 100/200 วันจะแสดงเมื่อมีข้อมูลครบตามช่วง');
  const dividends=Object.values(result.events?.dividends||{}).map(event=>({date:Number(event.date),amount:Number(event.amount)})).filter(event=>Number.isFinite(event.date)&&Number.isFinite(event.amount)&&event.amount>0).map(event=>({...event,date:usTradingDate(event.date)})).sort((a,b)=>a.date.localeCompare(b.date));
  return {rows,rawRows:rows,dividends,totalReturnRows:result.timestamp.map((t,i)=>{const close=q.close[i],adjusted=adj?.[i],factor=Number.isFinite(adjusted)&&Number.isFinite(close)&&close!==0?adjusted/close:1,scale=value=>Number.isFinite(value)?value*factor:NaN;return toCandle(t,scale(q.open[i]),scale(q.high[i]),scale(q.low[i]),Number.isFinite(adjusted)?adjusted:close,q.volume[i]||0)}).filter(x=>[x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.c>0),meta:result.meta};
}
async function fetchAlpacaDailyHistory(symbol,force=false){if(!force&&state.alpacaDailyHistories[symbol])return state.alpacaDailyHistories[symbol];const data=await alpacaApi(`daily?symbol=${encodeURIComponent(symbol)}${force?'&_='+Date.now():''}`,{cache:'no-store'}),rows=(data.bars||[]).map(row=>toCandle(typeof row.t==='number'?row.t:Date.parse(row.t)/1000,row.o,row.h,row.l,row.c,row.v||0)).filter(row=>[row.t,row.o,row.h,row.l,row.c].every(Number.isFinite)&&row.c>0);if(rows.length<30)throw new Error(`${symbol}: Alpaca มีข้อมูลรายวันเพียง ${rows.length} แท่ง`);const history={rows,rawRows:rows,totalReturnRows:[],dividends:[],meta:{currency:'USD'},feed:data.feed||'IEX'};state.alpacaDailyHistories[symbol]=history;return history}
const maxChartHistories=new Map(),maxChartPending=new Map();
async function loadMaxChartHistory(symbol){
  if(maxChartHistories.has(symbol))return maxChartHistories.get(symbol);
  if(maxChartPending.has(symbol))return maxChartPending.get(symbol);
  const promise=fetchHistory(symbol,'max').then(history=>{maxChartHistories.set(symbol,history.rows);if(state.symbol===symbol&&state.range==='max'&&state.source!=='csv')redrawChart();return history.rows}).finally(()=>maxChartPending.delete(symbol));
  maxChartPending.set(symbol,promise);return promise;
}
function parseCsvRecords(text, delimiter) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(ch===delimiter&&!quoted){row.push(cell.trim());cell=''}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);row=[];cell=''}
    else cell+=ch;
  }
  row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);return rows;
}
function csvDate(value){
  const s=String(value||'').trim();if(!s)return NaN;
  if(/^\d{8}$/.test(s)){const y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6,8));return Date.UTC(y,m-1,d)}
  if(/^\d+(\.\d+)?$/.test(s)){const n=Number(s);if(n>1e12)return n;if(n>1e9)return n*1000;if(n>20000&&n<100000)return Date.UTC(1899,11,30)+n*86400000}
  const iso=Date.parse(s);if(Number.isFinite(iso))return iso;
  const m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);if(!m)return NaN;
  let a=Number(m[1]),b=Number(m[2]),year=Number(m[3]);if(year<100)year+=year<70?2000:1900;
  let month,day;if(a>12){day=a;month=b}else if(b>12){month=a;day=b}else{day=a;month=b}
  return Date.UTC(year,month-1,day);
}
function parsePriceCsv(text,symbol,fileName){
  text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/).find(x=>x.trim())||'';let commas=0,semicolons=0,tabs=0,quoted=false;
  for(let i=0;i<first.length;i++){if(first[i]==='"')quoted=!quoted;else if(!quoted){if(first[i]===',')commas++;if(first[i]===';')semicolons++;if(first[i]==='\t')tabs++}}
  const delimiter=tabs>commas&&tabs>semicolons?'\t':semicolons>commas?';':',';const records=parseCsvRecords(text,delimiter);if(records.length<2)throw new Error('ไฟล์ CSV ไม่มีข้อมูลราคาให้อ่าน');
  const norm=s=>String(s).toLowerCase().replace(/[\s_./()\-]+/g,'');const headers=records[0].map(norm);
  const index=(names)=>headers.findIndex(h=>names.includes(h));
  const cols={date:index(['date','datetime','timestamp','time','วันที่','วัน']),open:index(['open','o','ราคาเปิด','เปิด']),high:index(['high','h','ราคาสูงสุด','สูงสุด']),low:index(['low','l','ราคาต่ำสุด','ต่ำสุด']),close:index(['close','c','ราคาปิด','ปิด','ราคาล่าสุด','adjustedclose','adjclose']),adj:index(['adjustedclose','adjclose']),volume:index(['volume','vol','v','ปริมาณ','ปริมาณซื้อขาย'])};
  if(cols.date<0||cols.close<0)throw new Error('ไม่พบคอลัมน์วันที่หรือราคาปิด (Date, Close)');
  const rows=[];for(const values of records.slice(1)){
    const get=i=>i<0?'':values[i]??'';const date=csvDate(get(cols.date)),closeRaw=Number(String(get(cols.close)).replace(/,/g,''));if(!Number.isFinite(date)||!Number.isFinite(closeRaw)||closeRaw<=0)continue;
    const rawClose=cols.adj>=0?Number(String(get(cols.adj)).replace(/,/g,'')):closeRaw;const factor=Number.isFinite(rawClose)&&rawClose>0?rawClose/closeRaw:1;
    let close=closeRaw*factor,open=Number(String(get(cols.open)).replace(/,/g,'')),high=Number(String(get(cols.high)).replace(/,/g,'')),low=Number(String(get(cols.low)).replace(/,/g,''));
    open=Number.isFinite(open)&&open>0?open*factor:close;high=Number.isFinite(high)&&high>0?high*factor:Math.max(open,close);low=Number.isFinite(low)&&low>0?low*factor:Math.min(open,close);
    const volume=Number(String(get(cols.volume)||'0').replace(/,/g,''))||0;rows.push({t:Math.floor(date/1000),o:open,h:Math.max(high,open,close),l:Math.min(low,open,close),c:close,v:volume});
  }
  const byDate=new Map(rows.map(x=>[x.t,x]));const ordered=[...byDate.values()].sort((a,b)=>a.t-b.t);if(ordered.length<60)throw new Error(`มีข้อมูลที่ใช้ได้ ${ordered.length} วัน ต้องมีอย่างน้อย 60 วัน · ค่าเฉลี่ย 100/200 วันต้องมีข้อมูลเพิ่มตามช่วง`);
  const last=ordered.at(-1),prev=ordered.at(-2),currency=symbol.endsWith('.BK')?'THB':'USD';
  return {rows:ordered,rawRows:ordered,meta:{currency,regularMarketPrice:last.c,regularMarketOpen:last.o,regularMarketDayHigh:last.h,regularMarketDayLow:last.l,chartPreviousClose:prev.c,exchangeName:symbol.endsWith('.BK')?'SET':'CSV'},source:'csv',sourceLabel:fileName};
}
function price(n, currency){return `${fmt(n, currency==='THB'?2:2)} ${currency}`}
function levelCandidates(rows, current, e20, e50, e200) {
  const step=current<10?0.5:current<20?1:current<100?5:current<500?10:current<1000?50:100;
  const roundDown=Math.floor(current/step)*step;
  const psychologicalSupport=roundDown<current?roundDown:roundDown-step;
  const emaLevels=[[e20,'EMA 20'],[e50,'EMA 50'],[e200,'EMA 200']].filter(x=>Number.isFinite(x[0]));
  const below=emaLevels.filter(x=>x[0]<current).sort((a,b)=>b[0]-a[0]);
  const nearestEma=below[0]||emaLevels.sort((a,b)=>Math.abs(a[0]-current)-Math.abs(b[0]-current))[0];
  const supports=[
    {p:rows.at(-1).l,type:'Low ล่าสุด',side:'support'},
    ...(nearestEma?[{p:nearestEma[0],type:nearestEma[1],side:'support'}]:[]),
    {p:Math.max(step,psychologicalSupport),type:'แนวจิตวิทยา',side:'support'}
  ];
  const recent=rows.slice(-180);let recentHigh=null;
  for(let i=2;i<recent.length-2;i++){
    const point=recent[i];
    if(point.h>=recent[i-1].h&&point.h>=recent[i-2].h&&point.h>recent[i+1].h&&point.h>recent[i+2].h)recentHigh={p:point.h,type:'แนวต้านล่าสุด',side:'resistance'};
  }
  if(!recentHigh)recentHigh={p:Math.max(...rows.slice(-20).map(x=>x.h)),type:'แนวต้านล่าสุด',side:'resistance'};
  const resistances=[recentHigh,...[1,2,3].map((n)=>({p:roundDown+step*n,type:'แนวจิตวิทยา',side:'resistance'}))]
    .sort((a,b)=>Math.abs(a.p-current)-Math.abs(b.p-current));
  return {supports,resistances};
}
function getTrend(closes,e20,e50){
  const current=closes.at(-1), older=closes[Math.max(0,closes.length-11)], slope=current-older;
  if(e20==null||e50==null)return {key:'side',label:'ออกข้าง',text:'ข้อมูลยังไม่พอ'};
  if(current>e20&&e20>e50&&slope>0)return {key:'up',label:'ขาขึ้น',text:'Uptrend'};
  if(current<e20&&e20<e50&&slope<0)return {key:'down',label:'ขาลง',text:'Downtrend'};
  return {key:'side',label:'ออกข้าง',text:'Sideways'};
}
function analyzeDividendEvents(rows,dividends=[]){
  const today=usTradingDate(Date.now()/1000),events=dividends.map(x=>({...x})).sort((a,b)=>a.date.localeCompare(b.date)),upcoming=events.filter(x=>x.date>today).at(0)||null,history=[];
  for(const event of events.filter(x=>x.date<=today)){
    let exIndex=rows.findIndex(row=>usTradingDate(row.t)===event.date);if(exIndex<0)exIndex=rows.findIndex(row=>usTradingDate(row.t)>event.date);if(exIndex<=0)continue;
    const before=rows[exIndex-1],priceRecoveryIndex=rows.findIndex((row,i)=>i>=exIndex&&row.c>before.c),totalReturnIndex=rows.findIndex((row,i)=>i>=exIndex&&row.c+event.amount>before.c);
    history.push({...event,previousClose:before.c,exClose:rows[exIndex]?.c??null,priceRecoveryDays:priceRecoveryIndex<0?null:priceRecoveryIndex-exIndex,totalReturnDays:totalReturnIndex<0?null:totalReturnIndex-exIndex});
  }
  const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2},priceRecoveries=history.map(x=>x.priceRecoveryDays).filter(Number.isFinite),totalRecoveries=history.map(x=>x.totalReturnDays).filter(Number.isFinite);
  return {upcoming,latest:history.at(-1)||null,samples:history.length,history:history.slice(-8).reverse(),medianPriceRecovery:median(priceRecoveries),medianTotalReturn:median(totalRecoveries),priceRecoveredCount:priceRecoveries.length,totalRecoveredCount:totalRecoveries.length};
}
function analyzeWatchPlan(symbol,history){
  const {rows,meta}=history,closes=rows.map(x=>x.c),e20=ema(closes,20).at(-1),e50=ema(closes,50).at(-1),e200=ema(closes,200).at(-1);
  const current=meta.regularMarketPrice||rows.at(-1).c,currency=meta.currency||(symbol.endsWith('.BK')?'THB':'USD');
  const daily=getTrend(closes,e20,e50),weeklyRows=aggregate(rows,'week'),weeklyCloses=weeklyRows.map(x=>x.c),weekly=getTrend(weeklyCloses,ema(weeklyCloses,20).at(-1),ema(weeklyCloses,50).at(-1));
  const rsiValue=rsi(closes),macdValue=macd(closes),forecast=estimateForward(rows,1),levels=levelCandidates(rows,current,e20,e50,e200),uniqueLevels=items=>items.filter(x=>Number.isFinite(x.p)&&x.p>0).sort((a,b)=>a.p-b.p).filter((x,i,a)=>i===0||Math.abs(x.p-a[i-1].p)/Math.max(x.p,a[i-1].p)>.0015);
  const step=current<10?.5:current<20?1:current<100?5:current<500?10:current<1000?50:100,roundDown=Math.floor(current/step)*step,psychological=Array.from({length:7},(_,i)=>({p:roundDown+(i-3)*step,type:'แนวจิตวิทยา'})).filter(x=>x.p>0),emaLevels=[[e20,'EMA 20'],[e50,'EMA 50'],[e200,'EMA 200']].filter(x=>Number.isFinite(x[0])).map(x=>({p:x[0],type:x[1]})),swingRows=rows.slice(-180),supportPivots=turningPoints(swingRows,'support').map(x=>({p:x.p,type:'Swing low'})),resistancePivots=turningPoints(swingRows,'resistance').map(x=>({p:x.p,type:'Swing high'}));
  const allSupportLevels=uniqueLevels([...levels.supports,...emaLevels,...supportPivots,...psychological]),allResistanceLevels=uniqueLevels([...levels.resistances,...emaLevels,...resistancePivots,...psychological]),supportLevels=allSupportLevels.filter(x=>x.p<current).sort((a,b)=>b.p-a.p),resistanceLevels=allResistanceLevels.filter(x=>x.p>Math.max(current,0)).sort((a,b)=>a.p-b.p),supportByDistance=[...supportLevels].sort((a,b)=>b.p-a.p),resistanceByDistance=[...resistanceLevels].sort((a,b)=>a.p-b.p),support1=supportByDistance[0]||null,support2=supportByDistance[1]||null,resistance1=resistanceByDistance[0]||null,resistance2=resistanceByDistance[1]||null;
  const support=supportLevels[0]||{p:Math.max(current*.5,current-step),type:'แนวรับโดยประมาณ'};
  const entryLow=support.p*1.006,entryHigh=support.p*1.02,entry=(entryLow+entryHigh)/2,stop=support.p*.985,riskPerShare=Math.max(entry-stop,.0001);
  const resistance=resistanceLevels.find(x=>x.p>entry)||null;
  const target=resistance?.p||entry+riskPerShare*2,rewardRisk=(target-entry)/riskPerShare;
  const supportGap=(current-support.p)/current,nearSupport=supportGap>=0&&supportGap<=.03;
  const scoreParts={dailyTrend:daily.key==='up'?2:daily.key==='down'?-2:0,weeklyTrend:weekly.key==='up'?2:weekly.key==='down'?-2:0,macd:macdValue.hist>0?1:-1,rsi:rsiValue>=38&&rsiValue<=65?1:rsiValue>=70?-2:rsiValue<30&&macdValue.hist>0?1:0,forecast:forecast?.change>.1?1:forecast?.change<-.1?-1:0,nearSupport:nearSupport?1:0},score=Object.values(scoreParts).reduce((sum,value)=>sum+value,0),forecastChange=forecast?.change??0,forecastOkay=forecastChange>=-.1,scoreDetails=`รายวัน ${scoreParts.dailyTrend>0?'+':''}${scoreParts.dailyTrend} · รายสัปดาห์ ${scoreParts.weeklyTrend>0?'+':''}${scoreParts.weeklyTrend} · MACD ${scoreParts.macd>0?'+':''}${scoreParts.macd} · RSI ${scoreParts.rsi>0?'+':''}${scoreParts.rsi} · คาดการณ์ ${scoreParts.forecast>0?'+':''}${scoreParts.forecast} · ใกล้แนวรับ ${scoreParts.nearSupport>0?'+':''}${scoreParts.nearSupport} · R:R ≥ 1.5 เป็นเงื่อนไขบังคับแยกจากคะแนน · ผ่านเมื่อคะแนน ≥ 4, D/W ไม่ลง, MACD > 0, RSI < 70, คาดการณ์ไม่ติดลบชัดเจน (≥ −0.1%) และราคายังอยู่ระหว่าง Stop/Target`;
  const qualificationChecks={score:score>=4,daily:daily.key!=='down',weekly:weekly.key!=='down',macd:macdValue.hist>0,rsi:rsiValue<70,forecast:forecastOkay,rewardRisk:rewardRisk>=1.5,priceRange:current>stop&&current<target};
  const qualified=Object.values(qualificationChecks).every(Boolean);
  const planOdds=historicalPlanOdds(rows,{trendKey:daily.key,rsi:rsiValue,macdHist:macdValue.hist,entry,stop,target});
  const atZone=current>=entryLow&&current<=entryHigh;
  let daysToTarget=null;if(forecast&&target>entry){const drift=Math.log1p(forecast.change/100),dailyVol=(forecast.volatility||0)/100,distance=Math.log(target/entry),toDays=rate=>rate<=0?'> 60':Math.ceil(distance/rate)>60?'> 60':Math.max(1,Math.ceil(distance/rate));daysToTarget={fast:toDays(drift+dailyVol),typical:toDays(drift),slow:toDays(drift-dailyVol)}}
  const nearLevel=(level,tolerance=.02)=>Boolean(level&&Math.abs(current-level.p)/current<=tolerance),between=(a,b)=>Boolean(a&&b&&current>Math.min(a.p,b.p)&&current<Math.max(a.p,b.p)),priceZones={belowS1:Boolean(support1&&current<support1.p),nearS1:nearLevel(support1),betweenS1S2:between(support1,support2),nearSupport:supportLevels.some(level=>nearLevel(level)),aboveR1:Boolean(resistance1&&current>resistance1.p),betweenR1R2:between(resistance1,resistance2),aboveR2:Boolean(resistance2&&current>resistance2.p)};
  const factors=[`D ${daily.label}`,`W ${weekly.label}`,...(forecast?.factors||[]),`รับ ${support.type} ${fmt(support.p)}`,`ต้าน ${resistance?.type||'—'} ${resistance?fmt(resistance.p):'—'}`,`R:R ${fmt(rewardRisk,1)}`];
  const dividend=analyzeDividendEvents(rows,history.dividends||[]);
  return {symbol,history,current,currency,daily,weekly,emas:{ema20:e20,ema50:e50,ema200:e200},rsi:rsiValue,macd:macdValue,forecast,levels,support,supportLevels,resistanceLevels,support1,support2,resistance1,resistance2,priceZones,dividend,entryLow,entryHigh,entry,stop,target,rewardRisk,nearSupport,score,scoreParts,scoreDetails,qualificationChecks,qualified,atZone,daysToTarget,factors,planOdds,shares:0,amount:0,riskAmount:0};
}
function explainPlanDecision(plan){
  const reasons=[],trendText=`แนวโน้มรายวัน ${plan.daily.label} / รายสัปดาห์ ${plan.weekly.label}; ราคาปัจจุบัน ${fmt(plan.current)} เทียบ EMA20 ${fmt(plan.emas?.ema20)}, EMA50 ${fmt(plan.emas?.ema50)}, EMA200 ${fmt(plan.emas?.ema200)}`;
  if(plan.current<=plan.stop)return {action:'ถึงจุด Stop · พิจารณาขายตามแผน',reason:`ราคาปัจจุบัน ${fmt(plan.current)} ต่ำกว่าหรือเท่าจุด Stop ${fmt(plan.stop)} · ${trendText}`};
  if(plan.current>=plan.target)return {action:'ถึงเป้าหมาย · พิจารณาขายทำกำไร',reason:`ราคาปัจจุบัน ${fmt(plan.current)} ถึงหรือสูงกว่าเป้าหมาย ${fmt(plan.target)} · ควรทบทวนการขายและความเสี่ยง · ${trendText}`};
  if(plan.daily.key==='down')reasons.push('แนวโน้มรายวันยังเป็นขาลง');
  if(plan.weekly.key==='down')reasons.push('แนวโน้มรายสัปดาห์ยังเป็นขาลง');
  if(plan.score<4)reasons.push(`คะแนน ${plan.score} ยังต่ำกว่าเกณฑ์ 4`);
  if(plan.macd.hist<=0)reasons.push(`MACD histogram ${fmt(plan.macd.hist,3)} ยังไม่ยืนยันแรงบวก`);
  if(plan.rsi>=70)reasons.push(`RSI ${fmt(plan.rsi,1)} อยู่เขตซื้อมากเกินไป`);
  if((plan.forecast?.change??0)<-.1)reasons.push('ค่าประมาณแนวโน้มระยะสั้นติดลบชัดเจน');
  if(plan.rewardRisk<1.5)reasons.push(`อัตราผลตอบแทนต่อความเสี่ยง ${fmt(plan.rewardRisk,2)} ต่ำกว่าเกณฑ์ 1.5`);
  if(!plan.qualified)return {action:'รอ · ยังไม่ผ่านเกณฑ์',reason:`${reasons.length?reasons.join(' · '):'สัญญาณเทคนิคยังไม่ผ่านเกณฑ์ซื้อพร้อมกัน'} · ${trendText} · RSI ${fmt(plan.rsi,1)} · MACD hist ${fmt(plan.macd.hist,3)}`};
  if(plan.current>plan.entryHigh)return {action:'รอราคาย่อเข้าโซน',reason:`สัญญาณผ่านเกณฑ์ แต่ราคาปัจจุบัน ${fmt(plan.current)} สูงกว่าโซนเข้าซื้อ ${fmt(plan.entryLow)}–${fmt(plan.entryHigh)} · ไม่ไล่ราคา · ${trendText}`};
  if(plan.current<plan.entryLow)return {action:'รอยืนยันแนวรับ',reason:`ราคายังต่ำกว่าโซนเข้าซื้อ ${fmt(plan.entryLow)}–${fmt(plan.entryHigh)} · รอการยืนเหนือโซน/แนวรับก่อน · ${trendText}`};
  if(!plan.atZone)return {action:'รอสัญญาณยืนยัน',reason:`ราคาอยู่ใกล้โซนแต่ยังไม่เข้าเงื่อนไขเข้าแผน · รอแท่งราคายืนยัน · ${trendText}`};
  return {action:'เข้าโซนตามแผน · พิจารณาซื้อ',reason:`แนวโน้มและตัวกรองผ่านเกณฑ์, ราคาอยู่ในโซน ${fmt(plan.entryLow)}–${fmt(plan.entryHigh)}, Stop ${fmt(plan.stop)}, เป้าหมาย ${fmt(plan.target)} · ${trendText} · RSI ${fmt(plan.rsi,1)} · MACD hist ${fmt(plan.macd.hist,3)}`};
}
function historicalPlanOdds(rows,setup){
  const data=rows.slice(-1260),closes=data.map(x=>x.c),e20=ema(closes,20),e50=ema(closes,50),rsiValues=rsiSeries(closes),macdValues=macdSeries(closes),horizon=20;
  if(!(setup.entry>setup.stop&&setup.target>setup.entry))return {samples:0,hits:0,rate:null,horizon};
  const upPct=setup.target/setup.entry-1,downPct=1-setup.stop/setup.entry;if(!(upPct>0&&downPct>0))return {samples:0,hits:0,rate:null,horizon};
  const rsiBand=value=>value<30?'oversold':value<50?'low':value<70?'mid':'overbought',currentBand=rsiBand(setup.rsi),macdBull=setup.macdHist>0;
  let samples=0,hits=0,lastSampleIndex=-horizon;const targetDays=[];
  for(let i=210;i+horizon<data.length;i++){
    const close=closes[i],older=closes[i-10],trend=e20[i]==null||e50[i]==null?'side':close>e20[i]&&e20[i]>e50[i]&&close>older?'up':close<e20[i]&&e20[i]<e50[i]&&close<older?'down':'side',hist=macdValues.line[i]-macdValues.signal[i],rsiValue=rsiValues[i];
    if(!Number.isFinite(hist)||!Number.isFinite(rsiValue)||trend!==setup.trendKey||(hist>0)!==macdBull||rsiBand(rsiValue)!==currentBand||i-lastSampleIndex<horizon)continue;
    const entry=close,target=entry*(1+upPct),stop=entry*(1-downPct);samples++;let outcome=false;
    lastSampleIndex=i;
    for(let j=i+1;j<=i+horizon;j++){
      const hitTarget=data[j].h>=target,hitStop=data[j].l<=stop;
      if(hitTarget||hitStop){outcome=hitTarget&&!hitStop;if(outcome)targetDays.push(j-i);break}
    }
    if(outcome)hits++;
  }
  const orderedDays=[...targetDays].sort((a,b)=>a-b),middle=Math.floor(orderedDays.length/2),medianDays=orderedDays.length?(orderedDays.length%2?orderedDays[middle]:(orderedDays[middle-1]+orderedDays[middle])/2):null;
  return {samples,hits,rate:samples?hits/samples:null,horizon,targetPct:upPct*100,stopPct:downPct*100,medianDays,minDays:orderedDays[0]??null,maxDays:orderedDays.at(-1)??null};
}
function turningPoints(rows,side){
  if(rows.length<3)return [];
  const value=side==='support'?'l':'h',baseRadius=Math.max(1,Math.min(3,Math.floor(rows.length/18)));
  for(const radius of baseRadius===1?[1]:[baseRadius,1]){
    const candidates=[];
    for(let i=radius;i<rows.length-radius;i++){
      const p=rows[i][value],near=rows.slice(i-radius,i).concat(rows.slice(i+1,i+radius+1)).map(x=>x[value]);
      if(side==='support'?near.every(x=>p<=x)&&near.some(x=>p<x):near.every(x=>p>=x)&&near.some(x=>p>x))candidates.push({i,p});
    }
    const selected=[];
    for(const point of candidates){
      const previous=selected.at(-1);
      if(previous&&point.i-previous.i<=radius){if(side==='support'?point.p<previous.p:point.p>previous.p)selected[selected.length-1]=point}
      else selected.push(point);
    }
    if(selected.length>=3)return selected;
  }
  return [];
}
function isIntraday(interval){return ['1min','5min','15min','1h'].includes(interval)}
function chartTime(t,intraday){return intraday?new Date(t*1000).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}):labelDate(t)}
const usDateFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}),usTimeFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function usTradingDate(t){const parts=usDateFormatter.formatToParts(new Date(t*1000));return `${parts.find(x=>x.type==='year').value}-${parts.find(x=>x.type==='month').value}-${parts.find(x=>x.type==='day').value}`}
function isRegularSessionBar(c){const parts=usTimeFormatter.formatToParts(new Date(c.t*1000)),minutes=Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value);return minutes>=570&&minutes<960}
function makeTradingHourBars(rows){const buckets=new Map();for(const c of rows){const parts=usTimeFormatter.formatToParts(new Date(c.t*1000)),minutes=Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value);if(minutes<570||minutes>=960)continue;const date=usTradingDate(c.t),bucket=Math.floor((minutes-570)/60),key=`${date}-${bucket}`;let bar=buckets.get(key);if(!bar){bar={t:c.t,o:c.o,h:c.h,l:c.l,c:c.c,v:Number(c.v)||0};buckets.set(key,bar)}else{bar.h=Math.max(bar.h,c.h);bar.l=Math.min(bar.l,c.l);bar.c=c.c;bar.v+=Number(c.v)||0}}return [...buckets.values()].sort((a,b)=>a.t-b.t)}
function chartSvg(rows, interval, range, forecast, levels){
  const intraday=isIntraday(interval),data=interval==='1w'?aggregate(rows,'week'):interval==='1mo'?aggregate(rows,'month'):rows;
  const rangeDays=({'1m':31,'3m':93,'6m':186,'1y':366,'2y':732,'5y':1826}[range]||186),cutoff=range==='max'?data[0].t:data.at(-1).t-rangeDays*86400;
  const liveDates=intraday?[...new Set(data.map(c=>usTradingDate(c.t)))].slice(-(state.liveRange==='5d'?5:1)):null;
  const sessionRows=intraday?data.filter(c=>liveDates.includes(usTradingDate(c.t))&&isRegularSessionBar(c)):[];
  const filteredRows=intraday?(sessionRows.length?sessionRows:data.filter(c=>liveDates.includes(usTradingDate(c.t)))):data.filter(x=>x.t>=cutoff),filtered=filteredRows.length?filteredRows:data,maxBars=intraday?3000:range==='max'?25000:range==='5y'?3000:720,total=Math.min(filtered.length,maxBars),minBars=Math.min(12,total);
  const visibleCount=Math.max(minBars,Math.min(total,Math.round(total/state.zoom))),maxPan=total-visibleCount;state.pan=Math.max(0,Math.min(maxPan,state.pan));
  const end=total-state.pan,start=end-visibleCount,shown=filtered.slice(start,end);const filteredOffset=data.indexOf(filtered[0]),offset=filteredOffset+start;const showForecast=interval==='1d'&&!!forecast&&shown.at(-1)?.t===data.at(-1)?.t,horizon=showForecast?forecast.days:0;
  const cs=data.map(x=>x.c), e20=intraday?[]:ema(cs,20),e50=intraday?[]:ema(cs,50),e200=intraday?[]:ema(cs,200);
  const W=900,H=300,left=58,right=55,top=12,bottom=12,plotW=W-left-right,plotH=H-top-bottom,slots=shown.length+horizon;
  const atr=showForecast?atrSeries(data).at(-1):null,risk=Number.isFinite(atr)&&atr>0?atr*Math.sqrt(horizon):null,base=showForecast?forecast.base:null;
  const nearestSupport=showForecast?(levels?.supports||[]).filter(item=>item.p<base).sort((a,b)=>b.p-a.p)[0]:null,aboveTargets=showForecast?(levels?.resistances||[]).filter(item=>item.p>base).sort((a,b)=>a.p-b.p):[];
  const forecastLevels=showForecast&&risk?{stop:nearestSupport&&base-nearestSupport.p<=risk*2?nearestSupport.p:base-risk,target1:aboveTargets[0]&&aboveTargets[0].p-base<=risk*1.5?aboveTargets[0].p:base+risk,target2:aboveTargets[1]&&aboveTargets[1].p>=(aboveTargets[0]?.p||base+risk)&&aboveTargets[1].p-base<=risk*4?aboveTargets[1].p:base+risk*2}:null;
  const stepVol=showForecast?(forecast.volatility/100)/Math.sqrt(horizon):0,drift=showForecast?Math.log(forecast.close/base):0,path=showForecast?Array.from({length:horizon},(_,i)=>{const step=i+1,mid=base*Math.exp(drift*step/horizon),spread=stepVol*Math.sqrt(step);return {mid,low:mid*Math.exp(-spread),high:mid*Math.exp(spread)}}):[];
  const values=shown.flatMap(x=>[x.l,x.h]);if(showForecast){values.push(forecast.low,forecast.high,...path.flatMap(point=>[point.low,point.high]));if(forecastLevels)values.push(forecastLevels.stop,forecastLevels.target1,forecastLevels.target2)}const min=Math.min(...values),max=Math.max(...values),pad=(max-min)*.1||1,yMin=min-pad,yMax=max+pad;
  const x=i=>left+(i+.5)*plotW/slots,y=v=>top+(yMax-v)/(yMax-yMin)*plotH;
  state.chartView={data:shown,start,total,visibleCount,left,right,top,bottom,plotW,plotH,slots,yMin,yMax,forecast:showForecast?forecast:null,ema20:e20,ema50:e50,ema200:e200,offset,intraday};
  let svg='';for(let n=0;n<5;n++){const yy=top+n*plotH/4,val=yMax-n*(yMax-yMin)/4;svg+=`<line x1="${left}" y1="${yy}" x2="${W-right+3}" y2="${yy}" stroke="#202831" stroke-width="1"/><text x="${W-right+8}" y="${yy+3}">${fmt(val,1)}</text>`}
  const candleW=Math.max(shown.length>500?0.65:1,Math.min(7,plotW/shown.length*.58));shown.forEach((c,i)=>{const xx=x(i),up=c.c>=c.o,color=up?'#44d49a':'#f07880',y1=y(Math.max(c.o,c.c)),y2=y(Math.min(c.o,c.c));svg+=`<line x1="${xx}" y1="${y(c.h)}" x2="${xx}" y2="${y(c.l)}" stroke="${color}" stroke-width="${shown.length>500?0.7:1}" opacity=".85"/><rect x="${xx-candleW/2}" y="${y1}" width="${candleW}" height="${Math.max(1.3,y2-y1)}" rx=".7" fill="${color}" opacity=".85"><title>${new Date(c.t*1000).toLocaleDateString('th-TH')} · ${fmt(c.c)}</title></rect>`});
  for(const [arr,color,width] of [[e20,'#edc06a',1.1],[e50,'#83aaff',1],[e200,'#b091ee',1]]){let d='';for(let i=0;i<shown.length;i++){const v=arr[offset+i];if(v==null)continue;d+=(d?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1)}if(d)svg+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" opacity=".88"/>`}
  for(const [side,color,label] of [['support','#54d29b','แนวโน้มแนวรับ'],['resistance','#ef8187','แนวโน้มแนวต้าน']]){
    const pivots=turningPoints(shown,side);if(pivots.length<3)continue;
    const points=pivots.map(point=>({x:x(point.i),y:y(point.p),price:point.p,date:shown[point.i].t}));
    const d=points.map((point,i)=>`${i?'L':'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const titles=points.map(point=>`${label} · ${labelDate(point.date)} · ${fmt(point.price)} ${$('currency').textContent}`).join(' | ');
    svg+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".78"><title>${escapeHtml(titles)}</title></path>`;
    for(const point of points)svg+=`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.2" fill="#10151c" stroke="${color}" stroke-width="1.7"><title>${label} · ${labelDate(point.date)} · ${fmt(point.price)} ${$('currency').textContent}</title></circle>`;
  }
  if(levels){
    const groups=[];
    for(const [side,items,color,prefix,labelX] of [['support',levels.supports,'#54d29b','S',3],['resistance',levels.resistances,'#ef8187','R',31]]){
      const visible=items.map((item,i)=>({...item,tag:`${prefix}${i+1}`,color,side})).filter(item=>item.p>=yMin&&item.p<=yMax).sort((a,b)=>y(a.p)-y(b.p));let group=null;
      for(const item of visible){const yy=y(item.p);if(group&&yy-group.bottom<=10){group.items.push(item);group.bottom=yy}else{group={side,color,labelX,items:[item],top:yy,bottom:yy};groups.push(group)}}
    }
    for(const group of groups){
      const center=(group.top+group.bottom)/2,merged=group.items.length>1,tags=group.items.map(x=>Number(x.tag.slice(1))),label=tags.length>1?`${group.side==='support'?'S':'R'}${tags[0]}-${tags.at(-1)}`:group.items[0].tag;
      const detail=group.items.map(x=>`${x.tag} ${x.type}: ${fmt(x.p)} ${$('currency').textContent}`).join(' · ');
      if(merged)svg+=`<rect x="${left}" y="${group.top}" width="${plotW}" height="${Math.max(3,group.bottom-group.top)}" fill="${group.color}" fill-opacity=".09"><title>${escapeHtml(detail)}</title></rect>`;
      svg+=`<line x1="${left}" y1="${center}" x2="${W-right+2}" y2="${center}" stroke="${group.color}" stroke-width="${merged?1.8:1.15}" stroke-dasharray="${merged?'':'5 3'}" opacity=".9"><title>${escapeHtml(detail)}</title></line>`;
      svg+=`<rect x="${group.labelX}" y="${center-6}" width="26" height="12" rx="3" fill="${group.color}" fill-opacity=".2"/><text x="${group.labelX+3}" y="${center+3}" style="font-size:8px;fill:${group.color}">${label}</text>`;
    }
  }
  if(showForecast){
    const lastIndex=shown.length-1,firstFuture=shown.length,lastX=x(lastIndex),endIndex=shown.length+horizon-1,fx=x(endIndex),forecastChange=forecast.change,color=forecastChange>.005?'#7ee0ac':forecastChange<-.005?'#f08a91':'#e4bf73',projectionLeft=x(firstFuture)-plotW/slots/2,projectionRight=x(endIndex)+plotW/slots/2;
    let upper=`M${projectionLeft.toFixed(1)},${y(shown.at(-1).c).toFixed(1)}`,lower='',mid=`M${lastX.toFixed(1)},${y(shown.at(-1).c).toFixed(1)}`;
    path.forEach((point,i)=>{const xx=x(shown.length+i);upper+=` L${xx.toFixed(1)},${y(point.high).toFixed(1)}`;mid+=` L${xx.toFixed(1)},${y(point.mid).toFixed(1)}`});
    for(let i=path.length-1;i>=0;i--){const point=path[i],xx=x(shown.length+i);lower+=` L${xx.toFixed(1)},${y(point.low).toFixed(1)}`}lower+=` L${projectionLeft.toFixed(1)},${y(shown.at(-1).c).toFixed(1)}`;
    svg+=`<rect x="${projectionLeft}" y="${top}" width="${Math.max(1,projectionRight-projectionLeft)}" height="${plotH}" fill="${color}" fill-opacity=".055"/><line x1="${projectionLeft}" y1="${top}" x2="${projectionLeft}" y2="${H-bottom}" stroke="#9aa8b4" stroke-dasharray="2 4" opacity=".7"/><path d="${upper}${lower} Z" fill="${color}" fill-opacity=".18" stroke="none"/><path d="${mid}" fill="none" stroke="${color}" stroke-width="2.2" stroke-dasharray="5 4" marker-end="url(#forecastArrow)"/><defs><marker id="forecastArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="${color}"/></marker></defs><text x="${projectionLeft+4}" y="${top+10}" fill="${color}" font-size="8">คาดการณ์ ${forecast.days} วัน</text>`;
    if(forecastLevels){for(const [key,label,levelColor,dash] of [['target2','Target 2','#75d6a1','5 3'],['target1','Target 1','#75d6a1','5 3'],['stop','Stop Loss','#f08a91','4 3']]){const value=forecastLevels[key],yy=y(value);svg+=`<line x1="${projectionLeft}" y1="${yy}" x2="${projectionRight}" y2="${yy}" stroke="${levelColor}" stroke-width="1.2" stroke-dasharray="${dash}" opacity=".9"><title>${label} ${fmt(value)} ${$('currency').textContent}</title></line><text x="${Math.max(left,projectionLeft-5)}" y="${yy-3}" text-anchor="end" fill="${levelColor}" font-size="8">${label}: ${fmt(value)}</text>`}}
    svg+=`<circle cx="${fx}" cy="${y(forecast.close)}" r="3.5" fill="${color}"/><rect x="${W-right-47}" y="${y(forecast.close)-8}" width="43" height="16" rx="3" fill="${color}" fill-opacity=".9"/><text x="${W-right-44}" y="${y(forecast.close)+3}" fill="#0a0d12" font-size="8">${fmt(forecast.close,1)}</text>`;
  }
  const last=shown.at(-1),py=y(last.c);svg+=`<line x1="${left}" y1="${py}" x2="${W-right+3}" y2="${py}" stroke="#9aa8b4" stroke-dasharray="2 4" opacity=".65"/><rect x="${W-right+5}" y="${py-8}" width="49" height="16" rx="3" fill="#303943"/><text x="${W-right+9}" y="${py+3}" fill="#e1e8ed">${fmt(last.c,1)}</text>`;
  svg+=`<line id="hoverCrossV" x1="0" y1="${top}" x2="0" y2="${H-bottom}" stroke="#dce5ed" stroke-dasharray="3 3" opacity="0" pointer-events="none"/><line id="hoverCrossH" x1="${left}" y1="0" x2="${W-right}" y2="0" stroke="#dce5ed" stroke-dasharray="3 3" opacity="0" pointer-events="none"/><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent" pointer-events="all"/>`;
  $('axisStart').textContent=chartTime(shown[0].t,intraday);$('axisMiddle').textContent=chartTime(shown[Math.floor(shown.length/2)].t,intraday);$('axisEnd').textContent=showForecast?`ประมาณ ${forecast.days} วัน`:chartTime(last.t,intraday);$('chartFootData').textContent=intraday?`${shown.length} แท่ง · ${{'1min':'1 นาที','5min':'5 นาที','15min':'15 นาที','1h':'1 ชั่วโมง'}[interval]} · ${state.liveBarsFeed||'Alpaca ตามสิทธิ์บัญชี'} · วันตลาดสหรัฐฯ · เวลาไทย · อัปเดตทุก 15 วินาที`:`${shown.length} แท่ง · ${interval==='1w'?'รายสัปดาห์':interval==='1mo'?'รายเดือน':'รายวัน'}`;
  return svg;
}
function syncChartControls(){const intraday=isIntraday(state.interval);document.querySelector('.range-tabs').hidden=intraday;document.querySelector('.live-range-tabs').hidden=!intraday;document.querySelector('.chart-legend').hidden=intraday;$('chartTooltip').style.display='none'}
async function loadLiveBars(){if(!isIntraday(state.interval)||state.source==='csv'||!state.symbol)return;const timeframe=state.interval==='1h'?'1Min':({'1min':'1Min','5min':'5Min','15min':'15Min'})[state.interval],symbol=state.symbol,interval=state.interval,liveRange=state.liveRange;try{const data=await alpacaApi(`bars?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&range=${liveRange}`);if(symbol!==state.symbol||interval!==state.interval||liveRange!==state.liveRange)return;state.liveBarsFeed=data.feed||'';state.liveBars=interval==='1h'?makeTradingHourBars(data.bars||[]):(data.bars||[]);if(!state.liveBars.length){$('chartFootData').textContent='ไม่มีแท่งระหว่างวัน · ตลาดอาจปิด หรือยังไม่ได้ตั้งค่า Alpaca';state.chartView=null;$('priceChart').innerHTML='<text x="450" y="150" text-anchor="middle" fill="#87919d">ไม่มีข้อมูลแท่งระหว่างวันในช่วงที่เลือก</text>';return}redrawChart()}catch(err){if(symbol===state.symbol&&interval===state.interval){$('chartFootData').textContent=err.message.includes('.env')?'ตั้งค่า Alpaca API Key ใน .env เพื่อใช้กราฟระหว่างวัน':`โหลดกราฟระหว่างวันไม่ได้ · ${err.message}`}}}
function setLivePolling(){if(state.liveTimer){clearInterval(state.liveTimer);state.liveTimer=null}if(isIntraday(state.interval)&&state.source!=='csv'){loadLiveBars();state.liveTimer=setInterval(loadLiveBars,15000)}}
function redrawChart(){if(!state.history)return;syncChartControls();const intraday=isIntraday(state.interval),rows=intraday?state.liveBars:state.range==='max'&&state.source!=='csv'&&maxChartHistories.has(state.symbol)?maxChartHistories.get(state.symbol):state.history.rows;if(!intraday&&state.range==='max'&&state.source!=='csv'&&!maxChartHistories.has(state.symbol)&&!maxChartPending.has(state.symbol))loadMaxChartHistory(state.symbol).catch(error=>toast(`โหลดกราฟ MAX ไม่สำเร็จ · ${error.message}`));if(rows?.length)$('priceChart').innerHTML=chartSvg(rows,state.interval,state.range,intraday?null:estimateForward(state.history.rows,state.forecastDays),intraday?null:state.levels);else if(intraday){state.chartView=null;$('priceChart').innerHTML='<text x="450" y="150" text-anchor="middle" fill="#87919d">กำลังโหลดแท่งราคาระหว่างวันจาก Alpaca…</text>'}}
function showChartHover(event){
  const svg=$('priceChart'),view=state.chartView,tip=$('chartTooltip');if(!view||state.drag?.moved)return;
  const rect=svg.getBoundingClientRect(),wrap=svg.parentElement.getBoundingClientRect(),vx=(event.clientX-rect.left)/rect.width*900,vy=(event.clientY-rect.top)/rect.height*300;
  if(vx<view.left||vx>900-view.right||vy<view.top||vy>300-view.bottom){tip.style.display='none';return}
  const crossX=svg.querySelector('#hoverCrossV'),crossY=svg.querySelector('#hoverCrossH');if(!crossX||!crossY)return;
  const priceAtCursor=view.yMax-(vy-view.top)/view.plotH*(view.yMax-view.yMin);crossX.setAttribute('x1',vx);crossX.setAttribute('x2',vx);crossX.setAttribute('opacity','.7');crossY.setAttribute('y1',vy);crossY.setAttribute('y2',vy);crossY.setAttribute('opacity','.7');
  const slot=Math.floor((vx-view.left)/(view.plotW/view.slots));let body;
  if(view.forecast&&slot>=view.data.length){body=`<b>ประมาณ ${view.forecast.days} วันทำการ</b><span>ตำแหน่งชี้: ${fmt(priceAtCursor)} ${$('currency').textContent}</span><span>ราคาประเมิน: ${fmt(view.forecast.close)} ${$('currency').textContent}</span>`}
  else{
    const index=Math.max(0,Math.min(view.data.length-1,slot)),c=view.data[index],globalIndex=view.offset+index;
    const ma20=view.ema20[globalIndex],ma50=view.ema50[globalIndex],ma200=view.ema200[globalIndex];
    const nearLevels=view.intraday?[]:[...(state.levels?.supports||[]),...(state.levels?.resistances||[])].filter(level=>Math.abs(level.p-priceAtCursor)<(view.yMax-view.yMin)/view.plotH*4);
    const levelText=nearLevels.map(level=>`${level.type} ${fmt(level.p)}`).join(' · ');
    body=`<b>${chartTime(c.t,view.intraday)} · ชี้ที่ ${fmt(priceAtCursor)} ${$('currency').textContent}</b><span>เปิด ${fmt(c.o)}　สูง ${fmt(c.h)}</span><span>ต่ำ ${fmt(c.l)}　ปิด ${fmt(c.c)}</span>${view.intraday?'':`<span>EMA 20 ${fmt(ma20)} · 50 ${fmt(ma50)} · 200 ${fmt(ma200)}</span>`}${levelText?`<span>${escapeHtml(levelText)}</span>`:''}`;
  }
  tip.innerHTML=body;tip.style.display='block';const tipW=tip.offsetWidth,tipH=tip.offsetHeight;tip.style.left=`${Math.max(3,Math.min(wrap.width-tipW-4,event.clientX-wrap.left+12))}px`;tip.style.top=`${Math.max(3,Math.min(wrap.height-tipH-4,event.clientY-wrap.top+12))}px`;
}
function labelDate(t){return new Date(t*1000).toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'2-digit'})}
function renderLevels(container, list, currency){$(container).innerHTML=list.map((x,i)=>`<div class="level-entry"><span class="level-type">${escapeHtml(x.type)} <em>${i===0?'ใกล้สุด':i===1?'ถัดไป':`ระดับ ${i+1}`}</em></span><span class="level-price">${price(x.p,currency)}</span></div>`).join('')}
const intradayForecastFrames=[{label:'1 นาที',timeframe:'1Min',minutes:1,volatilityFloor:.00025},{label:'5 นาที',timeframe:'5Min',minutes:5,volatilityFloor:.00055},{label:'15 นาที',timeframe:'15Min',minutes:15,volatilityFloor:.0009},{label:'30 นาที',timeframe:'30Min',minutes:30,volatilityFloor:.0013},{label:'1 ชั่วโมง',timeframe:'1Hour',minutes:60,volatilityFloor:.002},{label:'5 ชั่วโมง',timeframe:'5Hour',minutes:300,volatilityFloor:.0035}];
function intradaySignal(rows,forecast){
  const technical=signalCounts(technicalSignals(rows)),technicalTotal=technical.buy+technical.neutral+technical.sell,technicalBalance=technicalTotal?(technical.buy-technical.sell)/technicalTotal:null,closes=rows.map(x=>x.c),last=closes.at(-1),moving=[];
  for(const period of [5,10,20,50,100,200])for(const kind of ['SMA','EMA']){const value=kind==='SMA'?simpleAverage(closes,period):ema(closes,period).at(-1);if(Number.isFinite(value))moving.push(last>value?1:last<value?-1:0)}
  const movingBalance=moving.length?avg(moving):null,balance=technicalBalance==null?movingBalance:movingBalance==null?technicalBalance:(technicalBalance+movingBalance)/2,rating=ratingFor(technical,balance);
  return {...rating,change:forecast.change,close:forecast.close,low:forecast.low,high:forecast.high,base:forecast.base};
}
function drawIntradayPriceForecast(item,currency){
  const {rows,forecast,signal}=item;if(!forecast||!signal)return '';
  const shown=rows.slice(-28),last=shown.at(-1),prices=shown.flatMap(x=>[x.l,x.h]).concat([signal.low,signal.high]),rawMin=Math.min(...prices),rawMax=Math.max(...prices),pad=(rawMax-rawMin||last.c*.004)*.16,min=Math.max(.000001,rawMin-pad),max=rawMax+pad,W=440,H=190,left=48,right=53,top=12,bottom=23,plotW=W-left-right,plotH=H-top-bottom,slots=shown.length+1,x=i=>left+(i+.5)*plotW/slots,y=v=>top+(max-v)/(max-min)*plotH,color=signal.change>.005?'#62d69e':signal.change<-.005?'#f07f88':'#e4bf73';
  let svg='';for(let n=0;n<3;n++){const val=max-n*(max-min)/2,yy=top+n*plotH/2;svg+=`<line x1="${left}" y1="${yy}" x2="${W-right+2}" y2="${yy}" stroke="#202831"/><text x="${left-5}" y="${yy+3}" text-anchor="end" fill="#697682" font-size="8">${fmt(val,2)}</text>`}
  const candleW=Math.max(3,Math.min(7,plotW/slots*.58));shown.forEach((bar,i)=>{const xx=x(i),barColor=bar.c>=bar.o?'#44d49a':'#f07880',bodyTop=y(Math.max(bar.o,bar.c)),bodyBottom=y(Math.min(bar.o,bar.c));svg+=`<line x1="${xx}" y1="${y(bar.h)}" x2="${xx}" y2="${y(bar.l)}" stroke="${barColor}" stroke-width="1"/><rect x="${xx-candleW/2}" y="${bodyTop}" width="${candleW}" height="${Math.max(1.4,bodyBottom-bodyTop)}" rx=".6" fill="${barColor}"><title>${new Date(bar.t*1000).toLocaleString('th-TH')} · ${fmt(bar.c)}</title></rect>`});
  const lastX=x(shown.length-1),futureX=x(shown.length),baseY=y(last.c),futureY=y(signal.close),highY=y(signal.high),lowY=y(signal.low);svg+=`<line x1="${left}" y1="${baseY}" x2="${W-right+2}" y2="${baseY}" stroke="#9aa8b4" stroke-dasharray="2 4" opacity=".5"/><line x1="${lastX}" y1="${baseY}" x2="${futureX}" y2="${futureY}" stroke="${color}" stroke-width="2.2" stroke-dasharray="5 3"><title>ค่าคาดการณ์จากการปรับเทียบกับผลย้อนหลัง · สัญญาณเทคนิค ${escapeHtml(signal.label)}</title></line><line x1="${futureX}" y1="${highY}" x2="${futureX}" y2="${lowY}" stroke="${color}" stroke-width="8" stroke-linecap="round" opacity=".22"/><circle cx="${futureX}" cy="${futureY}" r="4" fill="${color}" stroke="#10151c" stroke-width="1.5"/><text x="${W-right+5}" y="${futureY+3}" fill="${color}" font-size="8">${fmt(signal.close)}</text><text x="${left}" y="${H-6}" fill="#74818c" font-size="8">อดีต ${shown.length} แท่ง</text><text x="${W-right+2}" y="${H-6}" text-anchor="end" fill="${color}" font-size="8">แท่งถัดไป</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="กราฟราคา ${escapeHtml(item.label)} และแนวโน้มคาดการณ์">${svg}</svg>`;
}
function renderIntradayForecasts(results,status=''){
  const cards=$('intradayForecastCards');if(!cards)return;const valid=results.filter(x=>x.forecast&&x.signal),note=$('intradayForecastNote');
  const decision=$('intradayDecision');if(decision){const fresh=valid.filter(x=>!x.stale),scored=fresh.map(x=>x.signal.label==='\u0e0b\u0e37\u0e49\u0e2d'||x.signal.label==='\u0e0b\u0e37\u0e49\u0e2d\u0e17\u0e31\u0e19\u0e17\u0e35'?1:x.signal.label==='\u0e02\u0e32\u0e22'||x.signal.label==='\u0e02\u0e32\u0e22\u0e17\u0e31\u0e19\u0e17\u0e35'?-1:0),buy=scored.filter(x=>x>0).length,sell=scored.filter(x=>x<0).length,wait=scored.filter(x=>x===0).length;let title='\u0e23\u0e2d\u0e01\u0e48\u0e2d\u0e19',kind='wait',detail=`\u0e2a\u0e31\u0e0d\u0e0d\u0e32\u0e13\u0e0b\u0e37\u0e49\u0e2d ${buy} \u0e01\u0e23\u0e2d\u0e1a · \u0e02\u0e32\u0e22 ${sell} \u0e01\u0e23\u0e2d\u0e1a · \u0e40\u0e1b\u0e47\u0e19\u0e01\u0e25\u0e32\u0e07 ${wait} \u0e01\u0e23\u0e2d\u0e1a`;if(fresh.length<Math.ceil(intradayForecastFrames.length*.8))detail=`\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e1e\u0e2d\u0e22\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e2a\u0e23\u0e38\u0e1b · \u0e44\u0e14\u0e49\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25 ${fresh.length}/${intradayForecastFrames.length} \u0e01\u0e23\u0e2d\u0e1a`;else if(buy>=4&&sell<=1){title='\u0e2a\u0e31\u0e0d\u0e0d\u0e32\u0e13\u0e2a\u0e19\u0e31\u0e1a\u0e2a\u0e19\u0e38\u0e19\u0e01\u0e32\u0e23\u0e0b\u0e37\u0e49\u0e2d';kind='buy'}else if(sell>=4&&buy<=1){title='\u0e2a\u0e31\u0e0d\u0e0d\u0e32\u0e13\u0e44\u0e21\u0e48\u0e2a\u0e19\u0e31\u0e1a\u0e2a\u0e19\u0e38\u0e19\u0e01\u0e32\u0e23\u0e0b\u0e37\u0e49\u0e2d';kind='sell'}decision.className=`intraday-decision ${kind}`;decision.innerHTML=`<div><small>\u0e2a\u0e23\u0e38\u0e1b\u0e2a\u0e31\u0e0d\u0e0d\u0e32\u0e13\u0e08\u0e32\u0e01 ${fresh.length}/${intradayForecastFrames.length} \u0e01\u0e23\u0e2d\u0e1a\u0e40\u0e27\u0e25\u0e32</small><b>${title}</b><span>${detail}</span></div><small>\u0e40\u0e1b\u0e47\u0e19\u0e2a\u0e31\u0e0d\u0e0d\u0e32\u0e13\u0e17\u0e32\u0e07\u0e40\u0e17\u0e04\u0e19\u0e34\u0e04 \u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48\u0e01\u0e32\u0e23\u0e23\u0e31\u0e1a\u0e1b\u0e23\u0e30\u0e01\u0e31\u0e19\u0e1c\u0e25</small>`} ;
  if(!valid.length){cards.innerHTML=`<div class="intraday-forecast-state">${escapeHtml(status||'รอข้อมูลระหว่างวันจาก Alpaca')}</div>`;note.textContent='ต้องตั้งค่า Alpaca API Key และมีข้อมูลแท่งราคาเพียงพอ · กราฟคาดการณ์เป็นฉากทัศน์ ไม่ใช่การรับประกันราคา';return}
  const actionClass={'ซื้อทันที':'buy-immediate','ซื้อ':'buy','เป็นกลาง':'neutral','ขาย':'sell','ขายทันที':'sell-immediate'},currency=$('currency').textContent;
  cards.innerHTML=results.map(item=>{if(!item.forecast||!item.signal)return `<article class="intraday-forecast-card unavailable"><header><b>${escapeHtml(item.label)}</b><span>ข้อมูลไม่พอ</span></header><div class="intraday-mini-chart">${escapeHtml(item.error||'ต้องมีแท่งราคามากกว่า 35 แท่ง')}</div></article>`;const s=item.signal,cal=item.forecast.calibration,move=s.change>=0?'+':'';let calibrationText='ข้อมูลย้อนหลังยังน้อย · ใช้ราคาล่าสุดเป็นฐาน';if(cal?.skill!=null)calibrationText=cal.skill>.02?`ทดสอบย้อนหลัง ${cal.observations} จุด · MSE ลดลง ${(cal.skill*100).toFixed(1)}% เทียบราคาคงเดิม`:`ทดสอบย้อนหลัง ${cal.observations} จุด · ยังไม่ชนะฐานราคาคงเดิม`;return `<article class="intraday-forecast-card"><header><b>${escapeHtml(item.label)}</b><span class="intraday-action ${actionClass[s.label]||'neutral'}">${item.stale?'ข้อมูลล่าสุดเดิม':escapeHtml(s.label)}</span></header><div class="intraday-mini-chart">${drawIntradayPriceForecast(item,currency)}</div><footer><span>ล่าสุด ${fmt(item.forecast.base)}</span><b class="${s.change<-.005?'down':s.change>.005?'up':'flat'}">คาดการณ์ ${fmt(s.close)} (${move}${fmt(s.change,3)}%)</b><small>กรอบประมาณ ${fmt(s.low)} – ${fmt(s.high)} ${escapeHtml(currency)}</small><small>${calibrationText}</small>${item.stale?`<small>เชื่อมต่อครั้งนี้ไม่สำเร็จ · แสดงข้อมูลเดิม (${escapeHtml(item.error)})</small>`:''}</footer></article>`}).join('');note.textContent=`แท่งราคา ${valid.map(x=>`${x.label} ${x.rows.length} แท่ง${x.stale?' (ข้อมูลเดิม)':''}`).join(' · ')} · เส้นประใช้ค่าที่ทดสอบแบบเดินหน้าจากข้อมูลในอดีต; หากไม่ชนะฐานราคาคงเดิมจะคาดใกล้ราคาล่าสุด · ป้ายซื้อ/ขายเป็นสัญญาณเทคนิคแยกจากค่าคาดการณ์${status?` · ${status}`:''} · ไม่รับประกันราคา`;
}
async function refreshIntradayForecasts(){
  const requestId=++state.intradayForecastRequestId,symbol=state.symbol;if(!symbol)return;
  if(state.source==='csv'){renderIntradayForecasts([],'นำเข้า CSV รายวันอยู่ · กราฟคาดการณ์ระหว่างวันต้องใช้ข้อมูล Alpaca');return}
  if(!$('intradayForecastCards').querySelector('.intraday-forecast-card'))renderIntradayForecasts([],'กำลังโหลดข้อมูลระหว่างวัน…');else $('intradayForecastNote').textContent='กำลังอัปเดตแท่งราคาและสัญญาณของแต่ละกรอบเวลา…';
  const results=await Promise.all(intradayForecastFrames.map(async frame=>{const key=`${symbol}:${frame.timeframe}`;try{let data;for(let attempt=0;attempt<3;attempt++){try{data=await alpacaApi(`bars?symbol=${encodeURIComponent(symbol)}&timeframe=${frame.timeframe}&range=5d`,{cache:'no-store'});break}catch(err){const transient=!err.status||err.status===429||err.status===502||err.status===504||(err.status===503&&err.message.includes('เชื่อมต่อ Alpaca ไม่ได้'));if(!transient||attempt===2)throw err;await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)))}}const rows=data.bars||[];if(rows.length<35){const previous=state.intradayForecastCache[key];return previous?{...previous,stale:true,error:`มีข้อมูลใหม่เพียง ${rows.length} แท่ง · ต้องมีอย่างน้อย 35 แท่ง`}:{...frame,rows,feed:data.feed,error:`มีข้อมูล ${rows.length} แท่ง · ต้องมีอย่างน้อย 35 แท่ง`}}const forecast=estimateForward(rows,1,frame.volatilityFloor),result={...frame,rows,feed:data.feed,forecast,signal:intradaySignal(rows,forecast),samples:rows.length};state.intradayForecastCache[key]=result;return result}catch(err){const previous=state.intradayForecastCache[key];return previous?{...previous,stale:true,error:err.message||'โหลดข้อมูลไม่สำเร็จ'}:{...frame,error:err.message||'โหลดข้อมูลไม่สำเร็จ'}}}));
  if(requestId!==state.intradayForecastRequestId||symbol!==state.symbol)return;
  const errors=results.filter(x=>!x.forecast).length,stale=results.filter(x=>x.stale).length,feeds=[...new Set(results.map(x=>x.feed).filter(Boolean))],feedNote=feeds.some(feed=>feed.includes('fallback'))?' · ใช้ IEX fallback สำหรับบัญชีที่ไม่มี SIP':feeds.includes('subscription-default')?' · feed ตามสิทธิ์บัญชี':'',status=errors===results.length?(results[0]?.error||'โหลดข้อมูลระหว่างวันไม่สำเร็จ'):stale?`อัปเดตไม่สำเร็จ ${stale} กรอบ · แสดงข้อมูลเดิมในกรอบที่เคยโหลดได้`:errors?`คำนวณได้ ${results.length-errors}/${results.length} กรอบ · ข้อมูลไม่พร้อม ${errors} กรอบ`:'';renderIntradayForecasts(results,status+feedNote);
}
function scheduleIntradayForecasts(){if(state.intradayForecastTimer){clearInterval(state.intradayForecastTimer);state.intradayForecastTimer=null}refreshIntradayForecasts();if(state.source!=='csv')state.intradayForecastTimer=setInterval(refreshIntradayForecasts,60000)}
function alpacaTimestamp(value){if(typeof value==='number'&&Number.isFinite(value))return value;const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed/1000:NaN}
function easternTradeParts(timestamp){const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp*1000)).map(part=>[part.type,part.value]));return {date:`${values.year}-${values.month}-${values.day}`,minute:Number(values.hour)*60+Number(values.minute)}}
function isAfterHoursTrade(timestamp){if(!Number.isFinite(timestamp))return false;const {minute}=easternTradeParts(timestamp);return minute>=16*60&&minute<20*60}
function mergeRealtimeSnapshot(history,snapshot){
  const trade=snapshot?.latestTrade,minute=snapshot?.minuteBar,daily=snapshot?.dailyBar,previous=snapshot?.prevDailyBar,tradeTime=alpacaTimestamp(trade?.t)||alpacaTimestamp(minute?.t)||alpacaTimestamp(daily?.t),price=Number(trade?.p)||Number(minute?.c)||Number(daily?.c);
  if(!(price>0)||!Number.isFinite(tradeTime))return null;
  if(trade?.p>0&&isAfterHoursTrade(alpacaTimestamp(trade.t))){const afterHoursTime=alpacaTimestamp(trade.t),regularPrice=Number(daily?.c)||Number(history.meta.regularMarketPrice)||history.rows.at(-1).c;return {...history,meta:{...history.meta,regularMarketPrice:regularPrice,afterHoursPrice:Number(trade.p),afterHoursTime,afterHoursFetchedAt:Date.now()/1000,afterHoursCheckedAt:Date.now()/1000,liveFeed:'feed ตามสิทธิ์ Alpaca'}}}
  const rows=[...history.rows],day=usTradingDate(tradeTime);let currentBar=null;
  if(daily&&[daily.o,daily.h,daily.l,daily.c].every(value=>Number.isFinite(Number(value))&&Number(value)>0)){
    const dailyTime=alpacaTimestamp(daily.t)||tradeTime;currentBar=toCandle(dailyTime,Number(daily.o),Math.max(Number(daily.h),price),Math.min(Number(daily.l),price),price,Number(daily.v)||0);
  }else{
    const index=rows.findIndex(row=>usTradingDate(row.t)===day);
    if(index>=0){const old=rows[index];currentBar={...old,h:Math.max(old.h,price),l:Math.min(old.l,price),c:price};}
  }
  if(currentBar){const index=rows.findIndex(row=>usTradingDate(row.t)===day);if(index>=0)rows[index]=currentBar;else rows.push(currentBar);rows.sort((a,b)=>a.t-b.t)}
  const meta={...history.meta,regularMarketPrice:price,regularMarketTime:tradeTime,afterHoursCheckedAt:Date.now()/1000,liveFeed:'feed ตามสิทธิ์ Alpaca'};
  if(previous&&Number(previous.c)>0)meta.chartPreviousClose=Number(previous.c);
  if(daily){meta.regularMarketOpen=Number(daily.o)||meta.regularMarketOpen;meta.regularMarketDayHigh=Math.max(Number(daily.h)||price,price);meta.regularMarketDayLow=Math.min(Number(daily.l)||price,price);meta.regularMarketVolume=Number(daily.v)||0}
  const rawRows=history.rawRows?rows:undefined;return {...history,rows,rawRows,meta};
}
async function refreshMarketSnapshot(){
  const symbol=state.symbol;if(!symbol||!state.history||state.source==='csv'||state.view!=='analysis'||document.visibilityState!=='visible'||state.marketPending)return;state.marketPending=true;
  try{const snapshot=await alpacaApi(`snapshot?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store'});if(symbol!==state.symbol||state.source==='csv')return;const history=mergeRealtimeSnapshot(state.history,snapshot);if(!history)return;state.history=history;state.watchHistories[symbol]=history;update(history,symbol,{skipForecastSchedule:true})}catch(error){if(error.message?.includes('.env'))$('updatedAt').textContent='กรุณาตั้ง Alpaca API Key เพื่อดูราคาล่าสุด';else $('dataSource').textContent=`ราคาล่าสุดจาก Alpaca ยังโหลดไม่ได้ · ${error.message||'ลองใหม่อัตโนมัติ'}`}finally{state.marketPending=false}
}
function setMarketSnapshotPolling(){if(state.marketTimer)clearInterval(state.marketTimer);state.marketTimer=null;if(state.source==='csv')return;refreshMarketSnapshot();state.marketTimer=setInterval(refreshMarketSnapshot,15000)}
function update(history,symbol,options={}){
  const {rows,meta}=history;const closes=rows.map(x=>x.c);const e20s=ema(closes,20),e50s=ema(closes,50),e200s=ema(closes,200);const e20=e20s.at(-1),e50=e50s.at(-1),e200=e200s.at(-1);
  const live=meta.regularMarketPrice||rows.at(-1).c,quoteRows=history.rawRows||rows,quoteTime=Number(meta.regularMarketTime)||Date.now()/1000,quoteDay=new Date(quoteTime*1000).toISOString().slice(0,10),lastQuoteDay=new Date(quoteRows.at(-1).t*1000).toISOString().slice(0,10),prev=quoteRows.length>1&&lastQuoteDay===quoteDay?quoteRows.at(-2).c:quoteRows.at(-1).c,basisGap=Math.abs(live-quoteRows.at(-1).c)/Math.max(live,quoteRows.at(-1).c),moveGap=prev>0?Math.abs(live-prev)/prev:Infinity,quoteBasisAligned=basisGap<.35&&moveGap<1;const currency=meta.currency|| (symbol.endsWith('.BK')?'THB':'USD');const change=quoteBasisAligned?live-prev:NaN,pct=quoteBasisAligned&&prev>0?change/prev*100:NaN;
  const label=metaBySymbol[symbol]||{name:meta.shortName||symbol.replace(/\.BK$/,''),sub:`${meta.longName||meta.shortName||symbol} · ${meta.exchangeName||'ตลาดหลักทรัพย์'}`,market:meta.exchangeName||'ตลาด'};
  $('assetName').textContent=label.name;$('assetSub').textContent=label.sub;$('assetLogo').textContent=label.name.slice(0,1).toUpperCase();document.querySelector('.exchange-tag').textContent=label.market;$('currency').textContent=currency;$('levelUnit').textContent=currency;
  $('lastPrice').textContent=fmt(live);$('priceChange').className='price-change'+(change<0?' down':'');$('priceChange').innerHTML=quoteBasisAligned?`${change>=0?'+':''}${fmt(change)} (${pct>=0?'+':''}${fmt(pct)}%) <span>วันนี้</span>`:`<span>การเปลี่ยนแปลงวันนี้ไม่พร้อม · ฐานราคาไม่ตรงกัน</span>`;
  const afterHoursTime=Number(meta.afterHoursTime),hasAfterHours=Number.isFinite(afterHoursTime)&&afterHoursTime>(Number(meta.regularMarketTime)||0),easternNow=easternTradeParts(Date.now()/1000),isPostMarketNow=easternNow.minute>=16*60&&easternNow.minute<20*60,showAfterHours=currency==='USD'&&(hasAfterHours||(isPostMarketNow&&Number.isFinite(Number(meta.afterHoursCheckedAt))));const afterHoursNode=$('afterHoursQuote');afterHoursNode.hidden=!showAfterHours;afterHoursNode.textContent=!showAfterHours?'':hasAfterHours?`หลังตลาด ${fmt(Number(meta.afterHoursPrice))} USD · ซื้อขายล่าสุด ${new Date(afterHoursTime*1000).toLocaleString('th-TH',{timeZone:'America/New_York',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})} ET · ดึงข้อมูล ${new Date((Number(meta.afterHoursFetchedAt)||Number(meta.afterHoursCheckedAt))*1000).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} เวลาไทย`:`ยังไม่มีรายการซื้อขายหลังตลาดปิด · ตรวจล่าสุด ${new Date(Number(meta.afterHoursCheckedAt)*1000).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} เวลาไทย`;
  const last=rows.at(-1);$('openPrice').textContent=fmt(meta.regularMarketOpen||last.o);$('dayRange').textContent=`${fmt(meta.regularMarketDayLow||last.l)} / ${fmt(meta.regularMarketDayHigh||last.h)}`;$('volume').textContent=Number(last.v).toLocaleString('en-US');$('historyPeriod').textContent=`${rows.length} วัน`;
  const daily=getTrend(closes,e20,e50),weeklyRows=aggregate(rows,'week'),wc=weeklyRows.map(x=>x.c),we20=ema(wc,20).at(-1),we50=ema(wc,50).at(-1),weekly=getTrend(wc,we20,we50);
  for(const [id,t] of [['dailyTrend',daily],['weeklyTrend',weekly]]){const el=$(id);el.textContent=t.label;el.className=`trend-pill ${t.key==='up'?'':t.key==='down'?'down':'side'}`}
  $('trendSummary').textContent=`รายวัน${daily.label} และรายสัปดาห์${weekly.label} · ${live>e20?'ราคายืนเหนือ':'ราคาต่ำกว่า'} EMA 20`;for(const [id,v] of [['trendEma20',e20],['trendEma50',e50],['trendEma200',e200]])$(id).textContent=fmt(v);
  const r=rsi(closes),m=macd(closes);$('rsiValue').textContent=fmt(r,1);$('rsiNeedle').style.left=`${Math.max(2,Math.min(98,r))}%`;
  const rsiState=r>=70?['Overbought','negative']:r<=30?['Oversold','positive']:['Neutral',''];$('rsiState').textContent=rsiState[0];$('rsiState').className='indicator-state '+rsiState[1];
  $('macdValue').textContent=fmt(m.line);$('macdSub').textContent=`Signal ${fmt(m.signal)} · Hist ${fmt(m.hist)}`;const macdUp=m.line>m.signal;$('macdState').textContent=macdUp?'Bullish':'Bearish';$('macdState').className='indicator-state '+(macdUp?'positive':'negative');
  for(const [id,period,v] of [['emaBadge20','20',e20],['emaBadge50','50',e50],['emaBadge200','200',e200]])$(id).innerHTML=`${period} <b>${fmt(v)}</b>`;
  $('emaState').textContent=live>e20&&live>e50?'เหนือเส้น EMA':'ต่ำกว่า EMA';$('emaState').className='indicator-state '+(live>e20?'positive':'negative');
  const levels=levelCandidates(rows,live,e20,e50,e200);state.levels=levels;renderLevels('supportList',levels.supports,currency);renderLevels('resistanceList',levels.resistances,currency);
  const support=levels.supports.filter(x=>x.p<live).sort((a,b)=>b.p-a.p)[0]?.p||levels.supports[0].p,resistance=levels.resistances.filter(x=>x.p>live).sort((a,b)=>a.p-b.p)[0]?.p||Math.max(...rows.slice(-20).map(x=>x.h)),atrNow=atrSeries(rows).at(-1),riskUnit=Number.isFinite(atrNow)?atrNow:live*.02,planMode=$('strategyPlanSelect')?.value||'shortPullback';
  const fast5=ema(closes,5).at(-1),mediumTrend=Number.isFinite(e50s.at(-1))?e50s.at(-1):live,longTrend=Number.isFinite(e200s.at(-1))?e200s.at(-1):live;
  let entryLo,entryHi,stop,target,buyHint,targetHint,stopHint;
  const planItem=strategyCatalog.find(item=>item.id===planMode)||{planType:'pullback',stopAtr:1.5,rewardRisk:2,entryRule:'',exitRule:''},isNoTarget=!!planItem.noTarget,isBreakout=planItem.planType==='breakout',planRiskAtr=planItem.stopAtr??1.5,planReward=planItem.rewardRisk??0;
  $('targetTitle').textContent=isNoTarget?'จุดขายตามระบบ':'เป้าทำกำไร';$('targetKind').textContent=isNoTarget?'TRAILING EXIT':'TAKE PROFIT';
  if(planItem.planType==='pullback'){
    const short=planMode==='shortPullback',anchor=short?e20:e20,trend=short?fast5>e20:e20>mediumTrend;entryLo=Math.max(support,Math.min(live,anchor*.99));entryHi=Math.max(entryLo,Math.min(live*1.01,anchor*1.01));stop=Math.max(live*.01,entryLo-riskUnit*planRiskAtr);target=entryHi+(entryHi-stop)*planReward;buyHint=`รอย่อ/รอยืนกลับเหนือ EMA ${short?'5/20':'20/50'} · ${trend?'แนวโน้มผ่าน':'รอยืนยันแนวโน้ม'}`;targetHint=`เป้ากำไร ${planReward}R`;stopHint=`Stop ${planRiskAtr} ATR จากโซนเข้า`;
  }else if(isBreakout){
    const channelPeriod=planItem.channelPeriod||20,exitPeriod=planItem.exitChannelPeriod,channel=rows.slice(-(channelPeriod+1),-1),channelHigh=Math.max(...channel.map(row=>row.h));entryLo=channelHigh;entryHi=channelHigh*1.003;stop=Math.max(live*.01,entryLo-riskUnit*planRiskAtr);if(!isNoTarget){target=entryHi+(entryHi-stop)*planReward;targetHint=`เป้ากำไร ${planReward}R`}else if(exitPeriod){const trail=rows.slice(-(exitPeriod+1),-1),trailingLow=Math.min(...trail.map(row=>row.l));target=trailingLow;targetHint=`Trailing Exit เมื่อปิดต่ำกว่า Low ${exitPeriod} วัน (${fmt(trailingLow)})`}else{target=Math.max(stop,live-riskUnit*2);targetHint='ออกเมื่อสัญญาณแนวโน้มอ่อนตัว'};buyHint=`รอราคาปิดทะลุ High ${channelPeriod} วัน (${fmt(channelHigh)})`;stopHint=`Stop ${planRiskAtr} ATR`;
  }else if(planItem.planType==='pullback'||planItem.planType==='momentum'){
    const anchor=planMode==='shortMacd'?ema(closes,21).at(-1):planMode==='shortMomentum'?ema(closes,10).at(-1):planMode==='mediumMacd'?e50:e20;entryLo=Math.min(live,anchor*.99);entryHi=Math.max(entryLo,Math.min(live*1.01,anchor*1.01));stop=Math.max(live*.01,entryLo-riskUnit*planRiskAtr);target=entryHi+(entryHi-stop)*Math.max(1,planReward);buyHint=`รอราคาใกล้ EMA ${planMode==='mediumMacd'?'50':planMode==='shortMacd'?'21':planMode==='shortMomentum'?'10':'20'} · ${planItem.entryRule}`;targetHint=`เป้ากำไร ${Math.max(1,planReward)}R`;stopHint=`Stop ${planRiskAtr} ATR`;
  }else if(planItem.planType==='reversal'){
    const middle=ema(closes,20).at(-1);entryLo=Math.max(support,Math.min(live,middle*.97));entryHi=Math.min(live*1.01,middle);stop=Math.max(live*.01,entryLo-riskUnit*planRiskAtr);target=entryHi+(entryHi-stop)*planReward;buyHint=`รอแรงกลับตัวใกล้ EMA 20 · ${planItem.entryRule}`;targetHint=`เป้ากำไร ${planReward}R`;stopHint=`Stop ${planRiskAtr} ATR`;
  }else if(planItem.planType==='relative'){
    const anchor=planMode==='longRelative'?longTrend:e50;entryLo=Math.max(support,Math.min(live,anchor*.99));entryHi=Math.max(entryLo,Math.min(live*1.01,anchor*1.01));stop=Math.max(live*.01,entryLo-riskUnit*planRiskAtr);target=isNoTarget?Math.max(stop,live-riskUnit*2):entryHi+(entryHi-stop)*planReward;buyHint=`แรงเทียบ SPY ต้องผ่านเงื่อนไข · ${planItem.entryRule}`;targetHint=isNoTarget?'ออกเมื่อ Relative Strength อ่อนตัว':`เป้ากำไร ${planReward}R`;stopHint=`Stop ${planRiskAtr} ATR`;
  }else{
    const trend=e50>longTrend&&live>longTrend,channel=rows.slice(-50),trailingLow=Math.min(...channel.map(row=>row.l));entryLo=Math.max(support,Math.min(live,longTrend));entryHi=Math.max(entryLo,Math.min(live*1.01,longTrend*1.01));stop=Math.max(live*.01,entryHi-riskUnit*planRiskAtr);target=trailingLow;buyHint=`รอตามแนวโน้ม · ${planItem.entryRule} · ${trend?'แนวโน้มผ่าน':'ยังไม่ยืนยัน'}`;targetHint=`Trailing/Trend exit · ${planItem.exitRule}`;stopHint=`Stop ${planRiskAtr} ATR`;
  }
  $('buyZone').textContent=entryHi-entryLo<Math.max(entryHi,entryLo)*.0001?`${fmt(entryHi)} ${currency}`:`${fmt(entryLo)} – ${fmt(entryHi)} ${currency}`;$('stopLoss').textContent=`${fmt(stop)} ${currency}`;$('takeProfit').textContent=`${fmt(target)} ${currency}`;$('buyHint').textContent=buyHint;$('targetHint').textContent=targetHint;$('stopHint').textContent=stopHint;
  const risk=Math.max(.0001,entryHi-stop),rr=NO_TARGET_STRATEGIES.includes(planMode)?NaN:(target-entryHi)/risk;$('rrRatio').textContent=NO_TARGET_STRATEGIES.includes(planMode)?'ใช้ Trailing Exit':`1 : ${fmt(rr,1)}`;
  const trendOkay=isBreakout?live>Math.max(...rows.slice(-(Number(planItem.channelPeriod||20)+1),-1).map(row=>row.h)):planItem.planType==='trend'?e50>longTrend&&live>longTrend:planItem.planType==='relative'?live>(planMode==='longRelative'?longTrend:e50):planMode==='shortPullback'?fast5>e20&&r<70:planItem.planType==='reversal'?r<60:live>e20&&r<75,planSignal=live>=entryLo&&live<=entryHi?'ราคาอยู่ในโซนเข้าตามแผน':live<entryLo?'รอราคาฟื้นเข้าโซน':'รอราคาย่อตัวเข้าโซน';$('setupSignal').textContent=trendOkay?`แนวโน้มผ่าน · ${planSignal}`:`รอยืนยันแนวโน้ม · ${planSignal}`;$('setupHint').textContent=isNoTarget?`ไม่มีเป้ากำไรคงที่ · ${planItem.exitRule} · Stop ${fmt(stop)} ${currency}`:REGIME_STRATEGIES.includes(planMode)?'กลยุทธ์นี้จะเปิดสถานะได้เมื่อ SPY ปิดเหนือ SMA 200 และข้อมูล SPY พร้อม':'แนวโน้มของกลยุทธ์ · รอแท่งราคาปิดยืนยัน';
  const main=$('mainSignal'),sigTitle=$('signalTitle'),sigDesc=$('signalDesc');let type,title,desc;if(daily.key==='up'&&weekly.key!=='down'&&m.hist>0){type='up';title='โมเมนตัมเชิงบวก';desc='แนวโน้มและ MACD สนับสนุน';}else if(daily.key==='down'&&weekly.key==='down'&&m.hist<0){type='down';title='โมเมนตัมอ่อนตัว';desc='แนวโน้มทั้งสองกรอบเวลาเป็นลบ';}else{type='side';title='รอสัญญาณยืนยัน';desc='แนวโน้มยังไม่สอดคล้องกันชัดเจน';}main.style.borderColor=type==='up'?'#293831':type==='down'?'#503238':'#4b4130';sigTitle.style.color=type==='up'?'var(--green)':type==='down'?'var(--red)':'var(--amber)';sigTitle.textContent=title;sigDesc.textContent=desc;main.querySelector('.signal-pip').style.background=type==='up'?'var(--green)':type==='down'?'var(--red)':'var(--amber)';
  const forecast=estimateForward(rows,state.forecastDays);if(forecast){const direction=forecast.change>.05?'up':forecast.change<-.05?'down':'flat';$('forecastDirection').textContent=`อีก ${forecast.days} วันทำการ · ${direction==='up'?'เอนเอียงขึ้น':direction==='down'?'เอนเอียงลง':'ทรงตัว'} (${forecast.change>=0?'+':''}${fmt(forecast.change,2)}%)`;$('forecastDirection').className=`forecast-direction ${direction==='up'?'':direction==='down'?'down':'flat'}`;$('forecastPrice').textContent=price(forecast.close,currency);$('forecastBand').textContent=`${fmt(forecast.low)} – ${fmt(forecast.high)} ${currency}`;const calibration=forecast.calibration,calibrationNote=calibration?.skill==null?'ข้อมูลทดสอบยังน้อย · ใช้ฐานราคาคงเดิม':calibration.skill>.02?`MSE ลดลง ${(calibration.skill*100).toFixed(1)}% เทียบฐานราคาคงเดิม (${calibration.observations} จุด)`:`แบบจำลองยังไม่ชนะฐานราคาคงเดิม (${calibration.observations} จุด)`;$('forecastBase').textContent=`ฐาน ${fmt(forecast.base)} ${currency} · ${calibrationNote} · ช่วงแกว่งอิงความผันผวนย้อนหลัง × √${forecast.days} · ไม่รับประกันราคา`}else{$('forecastDirection').textContent='ข้อมูลไม่เพียงพอ';$('forecastPrice').textContent='—';$('forecastBand').textContent='—';$('forecastBase').textContent='ต้องมีข้อมูลย้อนหลังอย่างน้อย 11 วันทำการเพื่อประมาณการ'}
  redrawChart();renderTechnicalAnalysis(history);renderMonthlySeasonality(history);renderWeekdaySeasonality(history);renderCalendarTiming(history);if(!options.skipForecastSchedule)scheduleIntradayForecasts();$('updatedAt').textContent=state.source==='csv'?'ข้อมูลจากไฟล์ CSV':meta.liveFeed&&meta.regularMarketTime?`ราคาล่าสุด ${new Date(meta.regularMarketTime*1000).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:`อัปเดต ${new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}`;$('marketState').textContent=state.source==='csv'?'นำเข้า CSV แล้ว':meta.liveFeed?'ราคาล่าสุด':'ข้อมูลพร้อม';$('dataSource').textContent=state.source==='csv'?`ไฟล์ CSV · ${history.sourceLabel}`:meta.liveFeed?`ราคา/แท่งล่าสุด Alpaca (${meta.liveFeed}) · ประวัติจาก Yahoo Finance`:`ข้อมูลจาก Yahoo Finance · ${meta.exchangeName||label.market}`;
}
function setLoading(on){state.loading=on;$('loadBtn').disabled=on;$('symbolInput').disabled=on;$('loadBtn').innerHTML=on?'กำลังโหลด…':'วิเคราะห์ <span>↗</span>';if(on)$('marketState').textContent='กำลังโหลด'}
let toastTimer;function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500)}
async function loadSymbol(raw){if(state.loading)return;const symbol=raw.trim().toUpperCase().replace(/\s+/g,'');if(!symbol)return;if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)){toast('รองรับเฉพาะ Ticker หุ้นสหรัฐฯ เช่น AAPL หรือ NVDA');return}const previous={symbol:state.symbol,source:state.source,history:state.history,zoom:state.zoom,pan:state.pan,range:state.range,interval:state.interval};if(state.liveTimer){clearInterval(state.liveTimer);state.liveTimer=null}if(state.marketTimer){clearInterval(state.marketTimer);state.marketTimer=null}if(symbol!==state.symbol){persistChartView();state.symbol=symbol;state.liveBars=null;applyChartView(symbol)}state.source='yahoo';$('symbolInput').value=symbol;setLoading(true);try{const history=await fetchHistory(symbol);state.history=history;state.watchHistories[symbol]=history;update(history,symbol);document.querySelectorAll('.watch-row').forEach(x=>x.classList.toggle('selected',x.dataset.symbol===symbol));document.title=`${symbol} — Signal Technical Analysis`;setLivePolling();setMarketSnapshotPolling()}catch(err){state.symbol=previous.symbol;state.source=previous.source;state.history=previous.history;state.zoom=previous.zoom;state.pan=previous.pan;state.range=previous.range;state.interval=previous.interval;applyChartView(previous.symbol);$('symbolInput').value=previous.symbol;document.querySelectorAll('.watch-row').forEach(x=>x.classList.toggle('selected',x.dataset.symbol===previous.symbol));if(previous.history){update(previous.history,previous.symbol);document.title=`${previous.symbol} — Signal Technical Analysis`;setLivePolling();setMarketSnapshotPolling()}else $('marketState').textContent='ข้อมูลไม่พร้อม';toast(`${err.message} · คงข้อมูล ${previous.symbol} ไว้`)}finally{setLoading(false)}}
async function updateWatchPrices(){const rows=[...document.querySelectorAll('.watch-row')];await Promise.allSettled(rows.map(async row=>{const symbol=row.dataset.symbol,cached=symbol===state.symbol&&state.source==='csv'&&state.history?state.history:await fetchHistory(symbol);state.watchHistories[symbol]=cached;const v=cached.meta.regularMarketPrice||cached.rows.at(-1).c;row.querySelector('.watch-price').textContent=fmt(v,symbol.endsWith('.BK')?2:0)}))}
function renderCapitalFields(currencies){
  document.querySelectorAll('[data-capital-currency]').forEach(input=>state.capitalByCurrency[input.dataset.capitalCurrency]=input.value);
  const list=[...new Set(currencies.filter(x=>/^[A-Za-z]{3}$/.test(x||'')))];if(!list.length)list.push('THB','USD');
  $('capitalFields').innerHTML=list.map(currency=>`<label class="setting-field"><span>งบ ${escapeHtml(currency)}</span><div class="setting-input"><input type="number" min="0" step="100" data-capital-currency="${escapeHtml(currency)}" placeholder="ระบุงบลงทุน" value="${escapeHtml(state.capitalByCurrency[currency]||'')}"/><b>${escapeHtml(currency)}</b></div></label>`).join('');
}
async function loadSp500Universe(){if(state.sp500Stocks.length)return state.sp500Stocks;if(!state.sp500LoadPromise)state.sp500LoadPromise=fetch('/sp500.json',{cache:'force-cache'}).then(async response=>{if(!response.ok)throw new Error('โหลดรายชื่อ S&P 500 ไม่สำเร็จ');const data=await response.json();state.sp500Stocks=(data.stocks||[]).filter(x=>x.symbol&&x.name);$('sp500Updated').textContent=`รายชื่อข้อมูล ${data.updated||'ล่าสุด'} · ${state.sp500Stocks.length} หุ้น`;return state.sp500Stocks}).catch(err=>{state.sp500LoadPromise=null;throw err});return state.sp500LoadPromise}
async function loadAllUsUniverse(){if(state.allUsStocks.length)return state.allUsStocks;if(!state.allUsLoadPromise)state.allUsLoadPromise=fetch('/api/universe/us-stocks',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'โหลดรายชื่อหุ้นสหรัฐฯ ไม่สำเร็จ');state.allUsStocks=(data.stocks||[]).filter(x=>x.symbol&&x.name);$('allUsUpdated').textContent=`${state.allUsStocks.length.toLocaleString()} หุ้น · อัปเดต ${new Date(data.updated_at).toLocaleDateString('th-TH')}`;return state.allUsStocks}).catch(error=>{state.allUsLoadPromise=null;throw error});return state.allUsLoadPromise}
function renderTaScreenerRows(matches,stocks){
  const body=$('taScreenerRows');if(!matches.length){body.innerHTML='<tr><td colspan="7">ยังไม่พบหุ้นที่ตรงกับเงื่อนไขทั้ง 4 กรอบเวลาจากแท่งที่ปิดแล้ว</td></tr>';return}
  const badge=rating=>`<span class="ta-screener-signal ${escapeHtml(rating.className)}">${escapeHtml(rating.label)}</span>`;
  body.innerHTML=matches.sort((a,b)=>b.alignment-a.alignment).map(item=>{const stock=stocks.find(x=>x.symbol===item.symbol),time=new Date(item.minute.time*1000).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});return `<tr><td><button type="button" class="ta-screener-symbol" data-ta-screener-symbol="${escapeHtml(item.symbol)}"><b>${escapeHtml(item.symbol)}</b><small>${escapeHtml(stock?.name||'')} · ${time}</small></button></td><td class="ta-screener-number">${fmt(item.minute.current,2)}</td><td>${badge(item.daily.rating)}</td><td>${badge(item.minute.rating)}</td><td>${badge(item.five.rating)}</td><td>${badge(item.fifteen.rating)}</td><td class="ta-screener-number">${fmt(item.alignment,0)}%</td></tr>`}).join('');
}
async function scanSp500Technical(){
  const button=$('runTaScreener'),requestId=++state.taScreenerRequestId,frames=[{key:'daily',timeframe:'1Day',seconds:86400,label:'รายวัน'},{key:'minute',timeframe:'1Min',seconds:60,label:'1 นาที'},{key:'five',timeframe:'5Min',seconds:300,label:'5 นาที'},{key:'fifteen',timeframe:'15Min',seconds:900,label:'15 นาที'}];
  button.disabled=true;$('taScreenerRows').innerHTML='<tr><td colspan="7">กำลังเตรียมรายชื่อ S&amp;P 500…</td></tr>';$('taScreenerStatus').textContent='กำลังเตรียมข้อมูลรายวัน, 1, 5 และ 15 นาที…';
  try{
    const stocks=await loadSp500Universe(),chunks=[];for(let i=0;i<stocks.length;i+=30)chunks.push(stocks.slice(i,i+30));let next=0,completed=0,failed=0,lastError='';const matches=[],feeds=new Set(),scanTime=Date.now()/1000;
    const worker=async()=>{while(next<chunks.length&&requestId===state.taScreenerRequestId){const chunk=chunks[next++];try{
      const results=await Promise.all(frames.map(frame=>alpacaApi(`bars/batch?symbols=${encodeURIComponent(chunk.map(x=>x.symbol).join(','))}&timeframe=${frame.timeframe}&_=${Date.now()}`,{cache:'no-store'})));results.forEach(result=>{if(result.feed)feeds.add(result.feed)});
      const summaries={};for(let i=0;i<frames.length;i++){const frame=frames[i],result=results[i],grouped=result.bars||{};summaries[frame.key]={};for(const stock of chunk){const rows=(grouped[stock.symbol]||[]).filter(bar=>Number.isFinite(bar.t)&&(frame.timeframe==='1Day'?usTradingDate(bar.t)<usTradingDate(scanTime):bar.t+frame.seconds<=scanTime)&&(frame.timeframe==='1Day'||isRegularSessionBar(bar)));if(rows.length>=200)summaries[frame.key][stock.symbol]=summarizeTechnicalBars(rows)}}
      const isBuy=rating=>rating?.className==='buy'||rating?.className==='buy-immediate',isSell=rating=>rating?.className==='sell'||rating?.className==='sell-immediate';
      for(const stock of chunk){const daily=summaries.daily[stock.symbol],minute=summaries.minute[stock.symbol],five=summaries.five[stock.symbol],fifteen=summaries.fifteen[stock.symbol];if(!daily||!minute||!five||!fifteen){failed++;continue}if(isBuy(daily.rating)&&isBuy(minute.rating)&&isSell(five.rating)&&isSell(fifteen.rating)){const alignment=(daily.rating.score+minute.rating.score+(100-five.rating.score)+(100-fifteen.rating.score))/4;matches.push({symbol:stock.symbol,daily,minute,five,fifteen,alignment})}}
    }catch(error){failed+=chunk.length;lastError=error.message}
      completed+=chunk.length;if(requestId===state.taScreenerRequestId){renderTaScreenerRows(matches,stocks);$('taScreenerStatus').textContent=`กำลังสแกน 4 กรอบเวลา · ${completed}/${stocks.length} หุ้น · ตรงเงื่อนไข ${matches.length} · ข้อมูลไม่ครบ ${failed}`}
    }};
    await Promise.all(Array.from({length:Math.min(3,chunks.length)},worker));if(requestId!==state.taScreenerRequestId)return;
    renderTaScreenerRows(matches,stocks);$('taScreenerStatus').textContent=`สแกนครบ 4 กรอบ · ตรงเงื่อนไข ${matches.length}/${stocks.length} หุ้น · ข้อมูลไม่ครบ ${failed}${lastError?` · ${lastError}`:''}${feeds.size?` · Feed ${[...feeds].join(', ')}`:''} · อัปเดต ${new Date().toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){if(requestId===state.taScreenerRequestId){$('taScreenerStatus').textContent=`สแกนไม่สำเร็จ: ${error.message}`;$('taScreenerRows').innerHTML=`<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`}}
  finally{if(requestId===state.taScreenerRequestId)button.disabled=false}
}
function renderSp500Search(){const query=$('sp500Search').value.trim().toLowerCase(),box=$('sp500SearchResults');if(!query){box.hidden=true;box.innerHTML='';return}const matches=state.sp500Stocks.filter(x=>`${x.symbol} ${x.name} ${x.sector||''}`.toLowerCase().includes(query)).slice(0,12);box.hidden=false;box.innerHTML=matches.length?matches.map(x=>`<button type="button" class="sp500-search-result" data-sp500-symbol="${escapeHtml(x.symbol)}"><span><b>${escapeHtml(x.symbol)}</b><small>${escapeHtml(x.name)}${x.sector?` · ${escapeHtml(x.sector)}`:''}</small></span><i>กรองผล</i></button>`).join(''):'<div class="sp500-no-match">ไม่พบหุ้นที่ตรงกับคำค้น</div>'}
function updatePlanUniverseUI(){const sp500=state.planUniverse==='sp500',allUs=state.planUniverse==='allus',watch=!sp500&&!allUs;$('planUniverseWatch').classList.toggle('active',watch);$('planUniverseWatch').setAttribute('aria-selected',String(watch));$('planUniverseSp500').classList.toggle('active',sp500);$('planUniverseSp500').setAttribute('aria-selected',String(sp500));$('planUniverseAllUs').classList.toggle('active',allUs);$('planUniverseAllUs').setAttribute('aria-selected',String(allUs));$('sp500Picker').hidden=!sp500;$('allUsPicker').hidden=!allUs;$('plansHeading').textContent=allUs?'แผนลงทุนหุ้นสหรัฐฯ ทั้งตลาด':'แผนลงทุนหุ้นสหรัฐฯ';$('plansSubheading').textContent=allUs?'ค้นหาและจัดอันดับหุ้นทุกตัวจากตลาดหลักทรัพย์สหรัฐฯ':sp500?'ค้นหาและวิเคราะห์เฉพาะหุ้นใน S&P 500':'วิเคราะห์หุ้นจาก Watchlist';$('refreshPlans').textContent=sp500?'↻ อัปเดตและสแกน S&P 500':allUs?'↻ สแกนหุ้นสหรัฐฯ ทั้งตลาด':'↻ อัปเดตและวิเคราะห์ Watchlist';$('planTotalLabel').textContent=sp500?'หุ้นใน S&P 500':allUs?'หุ้นในตลาดสหรัฐฯ':'หุ้นใน Watchlist'}
async function selectPlanUniverse(universe){
  if(!['watchlist','sp500','allus'].includes(universe))return;
  state.planUniverse=universe;state.planVisibleLimit=50;state.planScanMessage='';updatePlanUniverseUI();
  document.querySelectorAll('.nav-item[data-view="plans"]').forEach(link=>link.classList.toggle('active',link.dataset.planUniverse?link.dataset.planUniverse===universe:universe==='watchlist'));document.querySelector('.breadcrumb').innerHTML=`ตลาดทุน <span>/</span> ${universe==='allus'?'หุ้นสหรัฐฯ ทั้งตลาด':universe==='sp500'?'แผนลงทุน S&P 500':'แผนลงทุน Watchlist'}`;
  if(universe==='sp500'){
    $('planStatus').textContent='กำลังโหลดรายชื่อ S&P 500…';
    try{await loadSp500Universe();renderSp500Search()}
    catch(error){$('planStatus').textContent=error.message||'โหลดรายชื่อ S&P 500 ไม่สำเร็จ';toast('โหลดรายชื่อ S&P 500 ไม่สำเร็จ');return}
  }else if(universe==='allus'){
    $('planStatus').textContent='กำลังโหลดรายชื่อหุ้นสหรัฐฯ ทั้งตลาด…';
    try{await loadAllUsUniverse()}
    catch(error){$('planStatus').textContent=error.message||'โหลดรายชื่อหุ้นสหรัฐฯ ไม่สำเร็จ';toast('โหลดรายชื่อหุ้นสหรัฐฯ ไม่สำเร็จ');return}
  }
  await scanPlanUniverse(false);
}
function matchesPlanFilter(plan,filter){
  if(plan.error)return false;
  if(filter==='zone')return plan.atZone;
  if(filter==='qualified')return plan.qualified;
  if(filter==='rsi_overbought')return Number.isFinite(plan.rsi)&&plan.rsi>70;
  if(filter==='rsi_oversold')return Number.isFinite(plan.rsi)&&plan.rsi<30;
  const zones=plan.priceZones||{};
  if(filter==='below_s1')return zones.belowS1;
  if(filter==='near_s1')return zones.nearS1;
  if(filter==='between_s1_s2')return zones.betweenS1S2;
  if(filter==='near_support')return zones.nearSupport;
  if(filter==='above_r1')return zones.aboveR1;
  if(filter==='between_r1_r2')return zones.betweenR1R2;
  if(filter==='above_r2')return zones.aboveR2;
  return true;
}
function renderPlanDividend(info,currency){
  if(!info)return '';
  const upcoming=info.upcoming?`<b>${escapeHtml(info.upcoming.date)}</b> · ${fmt(info.upcoming.amount)} ${escapeHtml(currency)}/หุ้น${info.upcoming.special?' · ปันผลพิเศษ':''}${info.upcoming.payableDate?` · จ่าย ${escapeHtml(info.upcoming.payableDate)}`:''}`:info.upcomingSkipped?'ไม่ได้โหลดกำหนดการ XD ในสแกนจักรวาลหุ้นทั้งหมด':info.upcomingError?.includes('ALPACA_API_KEY')?'ตั้งค่า Alpaca API ใน .env เพื่อดูวัน XD รอบถัดไป':info.upcomingError?`ตรวจวัน XD ไม่สำเร็จ · ${escapeHtml(info.upcomingError)}`:info.upcomingChecked?'ยังไม่พบวัน XD ถัดไปที่ประกาศ':'กำลังตรวจวัน XD รอบถัดไป';
  const last=info.latest?`ล่าสุด ${escapeHtml(info.latest.date)} · ${fmt(info.latest.amount)} ${escapeHtml(currency)}/หุ้น`:'ยังไม่มี XD ย้อนหลังที่คำนวณได้';
  const totalDays=info.samples?(Number.isFinite(info.medianTotalReturn)?`${info.medianTotalReturn} วันซื้อขาย`:'ยังไม่ฟื้นเป็นบวกในข้อมูลที่มี'):'ยังไม่มีข้อมูล XD ย้อนหลัง';
  const priceDays=info.samples?(Number.isFinite(info.medianPriceRecovery)?`${info.medianPriceRecovery} วันซื้อขาย`:'ยังไม่กลับเหนือราคาปิดก่อน XD'):'ยังไม่มีข้อมูล XD ย้อนหลัง';
  const rows=info.history.map(event=>`<tr><td>${escapeHtml(event.date)}</td><td>${fmt(event.amount)} ${escapeHtml(currency)}</td><td>${Number.isFinite(event.totalReturnDays)?`${event.totalReturnDays} วัน`:'ยังไม่บวก'}</td><td>${Number.isFinite(event.priceRecoveryDays)?`${event.priceRecoveryDays} วัน`:'ยังไม่ฟื้น'}</td></tr>`).join('');
  return `<section class="plan-dividend"><div class="plan-dividend-title">ปันผลและวัน XD</div><div>XD ถัดไป: ${upcoming}</div><div>${last}</div><small>ย้อนหลัง ${info.samples} ครั้ง · กำไรรวมเงินปันผลเป็นบวกค่ากลาง ${totalDays} (${info.totalRecoveredCount} ครั้ง) · ราคากลับเหนือก่อน XD ${priceDays} (${info.priceRecoveredCount} ครั้ง)</small>${rows?`<details><summary>ดูผล XD ย้อนหลัง</summary><div class="plan-dividend-table-wrap"><table><thead><tr><th>วัน XD</th><th>ปันผล/หุ้น</th><th>รวมปันผลเป็นบวก</th><th>ราคาฟื้น</th></tr></thead><tbody>${rows}</tbody></table></div></details>`:''}<small class="plan-dividend-method">วันฟื้นนับเป็นวันซื้อขายหลัง XD · ผลรวมปันผลยังไม่หักภาษี/ค่าธรรมเนียม · ประวัติจาก Yahoo, กำหนดการจาก Alpaca (ประกาศอาจล่าช้า)</small></section>`;
}
async function attachUpcomingDividendDates(symbols,plans){
  const valid=plans.filter(plan=>!plan.error&&plan.dividend),chunks=[];
  for(let i=0;i<symbols.length;i+=100)chunks.push(symbols.slice(i,i+100));
  const results=await Promise.allSettled(chunks.map(async chunk=>({symbols:chunk,data:await alpacaApi(`dividends?symbols=${encodeURIComponent(chunk.join(','))}`,{cache:'no-store'})})));
  for(let i=0;i<results.length;i++){
    const result=results[i],chunk=chunks[i];
    if(result.status==='fulfilled')for(const symbol of chunk){const plan=valid.find(item=>item.symbol===symbol);if(!plan)continue;plan.dividend.upcoming=result.value.data.upcoming?.[symbol]||null;plan.dividend.upcomingChecked=true;plan.dividend.upcomingError=null}
    else for(const symbol of chunk){const plan=valid.find(item=>item.symbol===symbol);if(plan){plan.dividend.upcomingChecked=true;plan.dividend.upcomingError=result.reason?.message||'โหลดกำหนดการ XD ไม่สำเร็จ'}}
  }
}
function renderPlanCards(){
  const container=$('plansList'),capital={...state.capitalByCurrency};document.querySelectorAll('[data-capital-currency]').forEach(input=>capital[input.dataset.capitalCurrency]=Math.max(0,Number(input.value)||0));
  const plans=[...state.planCandidates].sort((a,b)=>Number(b.qualified)-Number(a.qualified)||b.score-a.score),eligibleByCurrency={};for(const p of plans)if(p.qualified)eligibleByCurrency[p.currency]=(eligibleByCurrency[p.currency]||0)+1;
  for(const plan of plans){plan.shares=0;plan.amount=0;plan.riskAmount=0;plan.riskPct=null;plan.budgetRiskPct=null;if(!plan.qualified||!capital[plan.currency])continue;const shareBudget=capital[plan.currency]/Math.max(1,eligibleByCurrency[plan.currency]||1),lot=plan.currency==='THB'?100:1,byBudget=Math.floor(shareBudget/plan.entry),shares=Math.floor(byBudget/lot)*lot;plan.shares=shares;plan.amount=shares*plan.entry;plan.riskAmount=shares*(plan.entry-plan.stop);plan.riskPct=plan.amount?plan.riskAmount/plan.amount*100:null;plan.budgetRiskPct=capital[plan.currency]?plan.riskAmount/capital[plan.currency]*100:null}
  $('planCount').textContent=plans.filter(x=>x.qualified).length;$('planTotal').textContent=plans.length;if(!state.planScanMessage)$('planStatus').textContent=plans.length?'จัดอันดับจากสัญญาณเทคนิคล่าสุด':state.planUniverse==='sp500'?'กำลังเตรียมข้อมูล S&P 500':state.planUniverse==='allus'?'กำลังเตรียมรายชื่อหุ้นสหรัฐฯ':'เพิ่มหุ้นใน Watchlist เพื่อเริ่มวิเคราะห์';
  if(!plans.length){$('planVisibleCount').textContent='แสดง 0 / 0 หุ้น';container.innerHTML=state.planUniverse==='sp500'||state.planUniverse==='allus'?'<div class="panel plan-empty"><span>⌕</span><b>กำลังดึงและวิเคราะห์หุ้น</b><small>ติดตามจำนวนหุ้นที่ประมวลผลได้ในสถานะด้านบน</small></div>':'<div class="panel plan-empty"><span>☆</span><b>Watchlist ยังว่าง</b><small>เพิ่มหุ้นจากแถบด้านซ้าย แล้วกลับมาวิเคราะห์อีกครั้ง</small></div>';return}
  const filter=$('planFilter')?.value||'all',sort=$('planSort')?.value||'recommended',universeStocks=state.planUniverse==='sp500'?state.sp500Stocks:state.planUniverse==='allus'?state.allUsStocks:[],stockBySymbol=new Map(universeStocks.map(stock=>[stock.symbol,stock])),query=state.planUniverse==='sp500'?$('sp500Search').value.trim().toLowerCase():state.planUniverse==='allus'?$('allUsSearch').value.trim().toLowerCase():'';let visible=plans.filter(p=>matchesPlanFilter(p,filter)).filter(p=>{if(!query)return true;const stock=stockBySymbol.get(p.symbol);return `${p.symbol} ${stock?.name||''} ${stock?.sector||''}`.toLowerCase().includes(query)}),scoreOf=x=>Number.isFinite(x.score)?x.score:-Infinity;
  if(sort==='score')visible.sort((a,b)=>scoreOf(b)-scoreOf(a));else if(sort==='rr')visible.sort((a,b)=>(Number.isFinite(b.rewardRisk)?b.rewardRisk:-Infinity)-(Number.isFinite(a.rewardRisk)?a.rewardRisk:-Infinity));else if(sort==='zone')visible.sort((a,b)=>Number(b.atZone)-Number(a.atZone)||scoreOf(b)-scoreOf(a));else visible.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||scoreOf(b)-scoreOf(a));
  const page=visible.slice(0,state.planVisibleLimit);$('planVisibleCount').textContent=`แสดง ${page.length} / ${visible.length} ผลลัพธ์ · ทั้งหมด ${plans.length} หุ้น`;
  if(!visible.length){const stillScanning=state.planScanMessage.startsWith('กำลังดึงข้อมูล'),validPlans=plans.filter(x=>!x.error),checks=[['คะแนน ≥ 4','score'],['แนวโน้มรายวันไม่ลง','daily'],['แนวโน้มรายสัปดาห์ไม่ลง','weekly'],['MACD บวก','macd'],['RSI < 70','rsi'],['คาดการณ์ไม่ติดลบชัดเจน','forecast'],['R:R ≥ 1.5','rewardRisk'],['ราคาอยู่ระหว่าง Stop/Target','priceRange']],failedChecks=checks.map(([label,key])=>({label,count:validPlans.filter(p=>!p.qualificationChecks?.[key]).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count).slice(0,4),qualificationSummary=filter==='qualified'&&!query&&validPlans.length&&!stillScanning?`ไม่ผ่านบ่อย: ${failedChecks.map(x=>`${x.label} (${x.count}/${validPlans.length})`).join(' · ')||'ไม่มีหุ้นผ่านทุกเกณฑ์ในรอบสแกนนี้'}`:'';container.innerHTML=`<div class="panel plan-empty"><span>⌕</span><b>${stillScanning?'กำลังค้นหาหุ้นที่ตรงกับคำค้น':'ไม่พบหุ้นตามคำค้น/ตัวกรอง'}</b><small>${stillScanning?'ผลจะแสดงเมื่อระบบดึงข้อมูลหุ้นตัวนั้นเสร็จ':qualificationSummary||'ลองค้นหาด้วย Ticker หรือเลือกตัวกรองอื่น'}${qualificationSummary?'<br>เกณฑ์บังคับ: คะแนน ≥ 4, D/W ไม่ลง, MACD > 0, RSI < 70, คาดการณ์ ≥ −0.1%, R:R ≥ 1.5 และราคายังไม่หลุด Stop/Target':''}</small></div>`;return}
  container.innerHTML=page.map(p=>{
    const companyName=state.planUniverse==='sp500'?state.sp500Stocks.find(x=>x.symbol===p.symbol)?.name||'':state.planUniverse==='allus'?state.allUsStocks.find(x=>x.symbol===p.symbol)?.name||'':'';
    if(p.error)return `<article class="panel plan-card"><div class="plan-card-head"><div><b>${escapeHtml(p.symbol)}</b><small>${escapeHtml(companyName)}${companyName?' · ':''}ข้อมูลไม่พร้อม</small></div><span class="plan-badge wait">รอข้อมูล</span></div><p class="plan-reason">${escapeHtml(p.error)}</p></article>`;
    const decision=explainPlanDecision(p),status=decision.action,odds=p.planOdds;
    decision.reason+=odds?.samples?` · อัตราย้อนหลังที่ถึงเป้าก่อน Stop ภายใน ${odds.horizon} วันทำการ: ${fmt(odds.rate*100,1)}% (${odds.hits}/${odds.samples} เหตุการณ์ที่แนวโน้ม, RSI และ MACD คล้ายกัน โดยเว้นช่วงตัวอย่างอย่างน้อย ${odds.horizon} แท่ง${odds.samples<30?' · ตัวอย่างน้อย':''}; ใช้ระยะเป้า/Stop ของแผนปัจจุบัน; วันที่แตะทั้งสองระดับในแท่งเดียวคิดเป็นไม่สำเร็จ) · ในกรณีที่ถึงเป้า ใช้เวลาค่ากลาง ${odds.medianDays!=null?`${odds.medianDays} วันทำการ (ช่วงที่พบ ${odds.minDays}–${odds.maxDays} วัน)`: 'ยังไม่มีกรณีตัวอย่างที่ถึงเป้า'}`:' · ยังไม่มีตัวอย่างย้อนหลังที่มีรูปแบบสัญญาณและระยะเป้า/Stop ใกล้เคียงพอ จึงไม่แสดงเปอร์เซ็นต์หรือระยะเวลาถือ';
    const badge=p.current<=p.stop?'wait':p.current>=p.target?'good':p.qualified?(p.atZone?'good':'watch'):'wait';
    const allocation=p.qualified?(p.shares?`${p.shares.toLocaleString()} หุ้น · ${fmt(p.amount)} ${p.currency}`:capital[p.currency]?'งบไม่พอสำหรับขั้นต่ำ':'กรอกงบ '+p.currency):'ยังไม่จัดสรร';
    const dayLabel=value=>typeof value==='number'?String(value):'60+',historicalDays=p.planOdds?.medianDays,days=p.qualified&&p.daysToTarget?{main:`≈ ${dayLabel(p.daysToTarget.typical)} วันทำการ`,note:`แบบจำลอง ${dayLabel(p.daysToTarget.fast)}–${dayLabel(p.daysToTarget.slow)} วัน`}:null,daysTitle=p.daysToTarget?`แบบจำลองจากแนวโน้ม/ความผันผวนปัจจุบัน: เร็ว ${p.daysToTarget.fast} · ค่ากลาง ${p.daysToTarget.typical} · ช้า ${p.daysToTarget.slow} วันทำการ; ไม่ใช่กำหนดขาย${historicalDays!=null?` · กรณีย้อนหลังที่ชนะใช้ค่ากลาง ${historicalDays} วัน (ช่วง ${p.planOdds.minDays}–${p.planOdds.maxDays})`:''}`:historicalDays!=null?`แบบจำลองปัจจุบันประเมินไม่ได้ · กรณีย้อนหลังที่ชนะใช้ค่ากลาง ${historicalDays} วัน (ช่วง ${p.planOdds.minDays}–${p.planOdds.maxDays})`:'';
    const reasons=[...p.factors,`RSI(14) ${fmt(p.rsi,1)}`,`S1 ${p.support1?fmt(p.support1.p):'—'}`,`S2 ${p.support2?fmt(p.support2.p):'—'}`,`R1 ${p.resistance1?fmt(p.resistance1.p):'—'}`,`R2 ${p.resistance2?fmt(p.resistance2.p):'—'}`,`องค์ประกอบคะแนน: ${p.scoreDetails||'—'}`].join(' · '),fresh=p.freshSignals||[];
    const position=state.positions[p.symbol]||[],holding=position.length?positionTargets(p,position):null;
    const lotRows=(position.length?position:[{}]).map((lot,i)=>`<div class="buy-lot"><b>ไม้ที่ ${i+1}</b><label>เงินที่ซื้อ (${escapeHtml(p.currency)})<input type="number" min="0" step="any" data-lot-amount placeholder="เช่น 1000" value="${lot.amount?escapeHtml(lot.amount):''}"></label><label>ราคาต่อหุ้น (${escapeHtml(p.currency)})<input type="number" min="0" step="any" data-lot-price placeholder="เช่น 150.50" value="${lot.price?escapeHtml(lot.price):''}"></label><button type="button" class="lot-remove" title="ลบไม้นี้" aria-label="ลบไม้นี้">×</button></div>`).join('');
    const holdingPanel=`<details class="owned-position" data-symbol="${escapeHtml(p.symbol)}" ${position.length?'open':''}><summary>${position.length?`รายการซื้อของฉัน (${position.length} ไม้)`:'บันทึกหุ้นที่ซื้อแล้ว'}</summary><div class="owned-form"><div class="buy-lots">${lotRows}</div><div class="owned-actions"><button type="button" class="lot-add">+ เพิ่มไม้ซื้อ</button><button type="button" class="position-save" data-symbol="${escapeHtml(p.symbol)}">บันทึกข้อมูลซื้อ</button>${position.length?`<button type="button" class="position-clear" data-symbol="${escapeHtml(p.symbol)}">ลบรายการซื้อทั้งหมด</button>`:''}</div></div>${holding?`<div class="holding-summary"><div><span>ยอดซื้อรวม</span><b>${fmt(holding.amount)} ${escapeHtml(p.currency)}</b></div><div><span>จำนวนหุ้นโดยประมาณ</span><b>${fmt(holding.shares,4)}</b></div><div><span>ราคาเฉลี่ยถ่วงน้ำหนัก</span><b>${fmt(holding.entry)} ${escapeHtml(p.currency)}</b></div><div><span>มูลค่าปัจจุบัน</span><b>${fmt(holding.currentValue)} ${escapeHtml(p.currency)}</b></div><div><span>กำไร / ขาดทุนโดยประมาณ</span><b class="${holding.pnl>=0?'pnl-positive':'pnl-negative'}">${holding.pnl>=0?'+':''}${fmt(holding.pnl)} ${escapeHtml(p.currency)} (${fmt(holding.pnlPct,2)}%)</b></div><div class="sell-recommendation"><span>ราคาที่แนะนำให้ขาย / หุ้น</span><b class="target-value">${fmt(holding.target)} ${escapeHtml(p.currency)}</b><small>หากขายครบ จะได้เงินประมาณ ${fmt(holding.saleValue)} ${escapeHtml(p.currency)} · กำไร/ขาดทุน ${holding.saleProfit>=0?'+':''}${fmt(holding.saleProfit)} ${escapeHtml(p.currency)}</small></div><div><span>Stop อิงแนวรับ</span><b class="stop-value">${fmt(holding.stop)} ${escapeHtml(p.currency)}</b></div><small>ราคาเป้าหมายอิงแนวต้านใกล้ราคาเฉลี่ย ต้นทุน/กำไรเป็นค่าประมาณ ไม่รวมค่าธรรมเนียมและภาษี</small></div>`:''}</details>`;
    return `<article class="panel plan-card ${p.qualified?'recommended':''} ${fresh.length?'has-fresh-signal':''}"><div class="plan-card-head"><div><b>${escapeHtml(p.symbol)}</b><small>${escapeHtml(companyName)}${companyName?' · ':''}${escapeHtml(p.currency)} · ราคาล่าสุด ${fmt(p.current)}</small></div><div class="plan-card-actions"><span class="plan-badge ${badge}">${escapeHtml(status)}</span><button class="plan-view" data-symbol="${escapeHtml(p.symbol)}">ดูกราฟ ↗</button></div></div>${fresh.length?`<div class="plan-fresh-signals"><b>สัญญาณใหม่</b>${fresh.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>`:''}<div class="plan-card-trends"><span class="trend-pill ${p.daily.key==='down'?'down':p.daily.key==='side'?'side':''}">รายวัน ${p.daily.label}</span><span class="trend-pill ${p.weekly.key==='down'?'down':p.weekly.key==='side'?'side':''}">รายสัปดาห์ ${p.weekly.label}</span><span class="score-chip">คะแนน ${p.score}</span></div><div class="plan-decision"><b>เหตุผลของแผน</b><p>${escapeHtml(decision.reason)}</p></div>${renderPlanDividend(p.dividend,p.currency)}<div class="plan-metrics"><div><span>โซนเข้าซื้อ</span><b>${fmt(p.entryLow)} – ${fmt(p.entryHigh)} ${p.currency}</b></div><div><span>Stop loss</span><b class="stop-value">${fmt(p.stop)} ${p.currency}</b></div><div><span>เป้าขาย</span><b class="target-value">${fmt(p.target)} ${p.currency}</b></div><div><span>ถือประมาณ</span><b title="${escapeHtml(daysTitle)}">${days?.main||(p.qualified?'ประเมินไม่ได้':'—')}</b>${days?`<small class="plan-days-note">${days.note}</small>`:''}</div></div><div class="plan-allocation"><div><span>งบประเมินสำหรับหุ้นนี้</span><b>${allocation}</b></div><small>ความเสี่ยง ${p.riskPct!=null?`${fmt(p.riskPct,2)}% ของเงินในหุ้นนี้ · ${fmt(p.budgetRiskPct,2)}% ของงบรวม`: '—'} · ขาดทุนที่ Stop ≈ ${p.shares?fmt(p.riskAmount):'—'} ${p.currency} · R:R ${fmt(p.rewardRisk,1)}</small></div>${holdingPanel}<div class="plan-reason"><span>รายละเอียดสัญญาณ</span>${escapeHtml(reasons)}</div></article>`
  }).join('')+(visible.length>page.length?`<button type="button" class="plan-load-more" data-plan-more>แสดงเพิ่มอีก ${Math.min(50,visible.length-page.length)} หุ้น · เหลือ ${visible.length-page.length}</button>`:'');
}
function markNewPlanSignals(plan){
  const rows=plan.history?.rows||[],closes=rows.map(x=>x.c);if(closes.length<2)return plan;const current20=ema(closes,20).at(-1),current50=ema(closes,50).at(-1),prior20=ema(closes.slice(0,-1),20).at(-1),prior50=ema(closes.slice(0,-1),50).at(-1),currentRsi=rsi(closes),priorRsi=rsi(closes.slice(0,-1)),currentMacd=macd(closes).hist,priorMacd=macd(closes.slice(0,-1)).hist;
  const lastTime=rows.at(-1).t,snapshot={lastTime,emaAbove:current20>current50,emaBelow:current20<current50,oversold:currentRsi<=30,overbought:currentRsi>=70,macdBullish:currentMacd>0,macdBearish:currentMacd<0,atZone:Boolean(plan.atZone)},previous=state.signalSnapshots[plan.symbol],newCandle=!previous||previous.lastTime!==lastTime,signals=[];
  if(snapshot.emaAbove&&((newCandle&&prior20<=prior50)||previous?.emaAbove===false))signals.push(prior20<=prior50?'Golden Cross · EMA20 ตัดขึ้นเหนือ EMA50':'EMA20 กลับขึ้นเหนือ EMA50');
  if(snapshot.emaBelow&&((newCandle&&prior20>=prior50)||previous?.emaBelow===false))signals.push(prior20>=prior50?'Death Cross · EMA20 ตัดลงใต้ EMA50':'EMA20 กลับลงใต้ EMA50');
  if(snapshot.oversold&&((newCandle&&priorRsi>30)||previous?.oversold===false))signals.push('RSI เพิ่งเข้าเขต Oversold');
  if(snapshot.overbought&&((newCandle&&priorRsi<70)||previous?.overbought===false))signals.push('RSI เพิ่งเข้าเขต Overbought');
  if(snapshot.macdBullish&&((newCandle&&priorMacd<=0)||previous?.macdBullish===false))signals.push('MACD พลิกเป็นบวก');
  if(snapshot.macdBearish&&((newCandle&&priorMacd>=0)||previous?.macdBearish===false))signals.push('MACD พลิกเป็นลบ');
  const priorClose=closes.at(-2),justEntered=priorClose<plan.entryLow||priorClose>plan.entryHigh;if(snapshot.atZone&&(previous?.atZone===false||(!previous&&newCandle&&justEntered)))signals.push('ราคาเข้าโซนซื้อ');
  state.signalSnapshots[plan.symbol]=snapshot;plan.freshSignals=signals;return plan;
}
async function scanPlanUniverse(force=false){
  const scanAll=state.planUniverse==='sp500'||state.planUniverse==='allus',allUs=state.planUniverse==='allus',stocks=allUs?state.allUsStocks:state.sp500Stocks,symbols=scanAll?stocks.map(x=>x.symbol):[...document.querySelectorAll('.watch-block .watch-row')].map(x=>x.dataset.symbol),scanId=(state.planScanId=(state.planScanId||0)+1),source=allUs?'หุ้นสหรัฐฯ ทั้งตลาด':scanAll?'หุ้น S&P 500':'หุ้นใน Watchlist',cachedPlans=allUs?state.allUsPlans:state.sp500Plans;
  if(scanAll&&!force&&cachedPlans.length){state.planCandidates=cachedPlans;state.planScanMessage=`${source} · ${cachedPlans.length.toLocaleString()} หุ้น · ใช้ผลสแกนล่าสุด`;$('planStatus').textContent=state.planScanMessage;renderCapitalFields(state.planCandidates.filter(x=>!x.error).map(x=>x.currency));renderPlanCards();return}
  if(!symbols.length){state.planCandidates=[];$('planStatus').textContent=state.planUniverse==='sp500'?'ไม่พบรายชื่อหุ้น S&P 500':allUs?'ไม่พบรายชื่อหุ้นสหรัฐฯ':'เพิ่มหุ้นใน Watchlist เพื่อเริ่มวิเคราะห์';renderCapitalFields([]);renderPlanCards();return}
  state.planScanMessage=`กำลังดึงข้อมูล ${source} · 0/${symbols.length}`;$('planStatus').textContent=state.planScanMessage;if(scanAll&&!cachedPlans.length){state.planCandidates=[];renderCapitalFields([]);renderPlanCards()}const results=Array(symbols.length);let next=0,completed=0;
  const worker=async()=>{while(next<symbols.length&&scanId===state.planScanId){const i=next++,symbol=symbols[i];try{let history=scanAll?null:symbol===state.symbol&&state.source==='csv'&&state.history?state.history:!force?state.watchHistories[symbol]:null;if(!history)history=await fetchHistory(symbol);if(!scanAll)state.watchHistories[symbol]=history;const plan=analyzeWatchPlan(symbol,history);if(scanAll){markNewPlanSignals(plan);delete plan.history}results[i]={status:'fulfilled',value:plan}}catch(error){results[i]={status:'rejected',reason:error}}completed++;if(scanId===state.planScanId){state.planScanMessage=`กำลังดึงข้อมูล ${source} · ${completed}/${symbols.length}`;$('planStatus').textContent=state.planScanMessage;if(scanAll&&completed%25===0){state.planCandidates=results.flatMap((item,index)=>item?[item.status==='fulfilled'?item.value:{symbol:symbols[index],error:item.reason?.message||'ดึงข้อมูลไม่ได้'}]:[]);renderPlanCards()}}}};
  await Promise.all(Array.from({length:Math.min(6,symbols.length)},worker));if(scanId!==state.planScanId)return;
  state.planCandidates=results.map((result,i)=>result?.status==='fulfilled'?result.value:{symbol:symbols[i],error:result?.reason?.message||'ดึงข้อมูลไม่ได้'});if(!scanAll)state.planCandidates=state.planCandidates.map(x=>{if(x.error)return x;markNewPlanSignals(x);trackPlanAlerts(x);return x});persistSignalSnapshots();persistPlanTracking();renderPlanAlerts();const failed=state.planCandidates.filter(x=>x.error).length;state.planScanMessage=allUs?'จัดอันดับเสร็จ · เตรียมผลหุ้นสหรัฐฯ ทั้งตลาด':`สแกนราคาเสร็จ · กำลังตรวจวัน XD ${source}`;$('planStatus').textContent=state.planScanMessage;renderCapitalFields(state.planCandidates.filter(x=>!x.error).map(x=>x.currency));renderPlanCards();if(!allUs)await attachUpcomingDividendDates(symbols,state.planCandidates);else for(const plan of state.planCandidates)if(plan.dividend)plan.dividend.upcomingSkipped=true;if(scanId!==state.planScanId)return;if(scanAll){if(allUs)state.allUsPlans=state.planCandidates;else state.sp500Plans=state.planCandidates}state.planScanMessage=scanAll?`สแกนเสร็จ · สำเร็จ ${symbols.length-failed}/${symbols.length} หุ้น${failed?` · ข้อมูลผิดพลาด ${failed} ตัว`:''}`:`วิเคราะห์ Watchlist ${symbols.length-failed}/${symbols.length} หุ้น`;$('planStatus').textContent=state.planScanMessage;renderPlanCards();
}
async function renderPortfolio(force=false){
  const symbols=Object.keys(state.positions).filter(s=>state.positions[s]?.length);$('portfolioRows').innerHTML='';$('portfolioSummary').innerHTML='';$('portfolioStatus').textContent='กำลังโหลดราคา…';$('portfolioEmpty').hidden=true;
  if(!symbols.length){$('portfolioStatus').textContent='ไม่มีรายการซื้อ';$('portfolioEmpty').hidden=false;$('portfolioRows').innerHTML='<tr><td colspan="7">ยังไม่มีหุ้นที่บันทึกรายการซื้อ</td></tr>';return}
  const results=await Promise.allSettled(symbols.map(async symbol=>{const history=symbol===state.symbol&&state.source==='csv'&&state.history?state.history:!force&&state.watchHistories[symbol]?state.watchHistories[symbol]:await fetchHistory(symbol);state.watchHistories[symbol]=history;const lots=state.positions[symbol],shares=lots.reduce((sum,x)=>sum+x.amount/x.price,0),cost=lots.reduce((sum,x)=>sum+x.amount,0),average=cost/shares,price=history.meta.regularMarketPrice||history.rows.at(-1).c,currency=history.meta.currency||(symbol.endsWith('.BK')?'THB':'USD'),value=shares*price,pnl=value-cost;return {symbol,shares,cost,average,price,currency,value,pnl,pct:pnl/cost*100,lots:lots.length}}));
  const rows=results.map((x,i)=>x.status==='fulfilled'?x.value:{symbol:symbols[i],error:x.reason?.message||'ราคาไม่พร้อม'}),totals={};for(const x of rows)if(!x.error){const t=totals[x.currency]||{cost:0,value:0,pnl:0,count:0};t.cost+=x.cost;t.value+=x.value;t.pnl+=x.pnl;t.count++;totals[x.currency]=t}
  $('portfolioSummary').innerHTML=Object.entries(totals).map(([currency,t])=>`<article class="panel portfolio-stat"><span>พอร์ต ${escapeHtml(currency)}</span><b>${fmt(t.value)} ${escapeHtml(currency)}</b><small>ลงทุน ${fmt(t.cost)} · กำไร/ขาดทุน <i class="${t.pnl>=0?'pnl-positive':'pnl-negative'}">${t.pnl>=0?'+':''}${fmt(t.pnl)} ${escapeHtml(currency)}</i></small></article>`).join('');
  $('portfolioRows').innerHTML=rows.map(x=>x.error?`<tr><td>${escapeHtml(x.symbol)}</td><td colspan="6" class="portfolio-error">${escapeHtml(x.error)}</td></tr>`:`<tr><td><b>${escapeHtml(x.symbol)}</b><small>${x.lots} ไม้ · ${escapeHtml(x.currency)}</small></td><td>${fmt(x.shares,4)}</td><td>${fmt(x.average)}</td><td>${fmt(x.price)}</td><td>${fmt(x.cost)} ${escapeHtml(x.currency)}</td><td>${fmt(x.value)} ${escapeHtml(x.currency)}</td><td class="${x.pnl>=0?'pnl-positive':'pnl-negative'}">${x.pnl>=0?'+':''}${fmt(x.pnl)} (${fmt(x.pct,2)}%)</td></tr>`).join('');$('portfolioStatus').textContent=`${rows.filter(x=>!x.error).length}/${symbols.length} หุ้น`;$('portfolioEmpty').hidden=true;
}
function populateBacktestSymbols(){const symbols=[...new Set([...document.querySelectorAll('.watch-row')].map(x=>x.dataset.symbol).concat(Object.keys(state.positions),state.backtestExtraSymbols,state.symbol))],select=$('backtestSymbol'),selected=select.value||state.symbol;select.innerHTML=symbols.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');select.value=symbols.includes(selected)?selected:state.symbol;const cached=state.watchHistories[select.value]||(select.value===state.symbol?state.history:null);$('backtestCurrency').textContent=cached?.meta.currency||(select.value.endsWith('.BK')?'THB':'USD')}
async function addBacktestSymbol(){const input=$('backtestSymbolSearch'),button=$('addBacktestSymbol'),symbol=input.value.trim().toUpperCase().replace(/\s+/g,'');if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)){toast('กรอก Ticker หุ้นสหรัฐฯ เช่น TSLA หรือ BRK.B');input.focus();return}button.disabled=true;button.textContent='กำลังค้นหา…';try{const history=await fetchAlpacaDailyHistory(symbol,true);if(!state.backtestExtraSymbols.includes(symbol))state.backtestExtraSymbols.push(symbol);populateBacktestSymbols();$('backtestSymbol').value=symbol;$('backtestCurrency').textContent=history.meta.currency||'USD';input.value='';toast(`เพิ่ม ${symbol} สำหรับทดสอบย้อนหลังแล้ว`)}catch(error){toast(`ค้นหา ${symbol} ไม่สำเร็จ · ${error.message||'ไม่พบข้อมูล'}`)}finally{button.disabled=false;button.textContent='เพิ่มหุ้น'}}
let strategyCatalog=[],botStrategyCatalog=[];
function renderStrategySelect(select,catalog,selected){const groups=new Map();for(const item of catalog){if(!groups.has(item.group))groups.set(item.group,[]);groups.get(item.group).push(item)}select.innerHTML=[...groups].map(([group,items])=>`<optgroup label="${escapeHtml(group)}">${items.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}</optgroup>`).join('');if(catalog.some(item=>item.id===selected))select.value=selected}
function syncBotStrategyHelp(){const id=$('botStrategy').value,item=botStrategyCatalog.find(value=>value.id===id)||strategyCatalog.find(value=>value.id===id);$('botStrategyHelp').textContent=item?`${item.mode==='intraday'?'บอท Intraday · สตรีมสด/แท่ง 1 นาที':'บอทรายวัน · ตรวจเมื่อแท่งปิด'} · เข้า: ${item.entryRule} · ออก: ${item.exitRule}${item.stopAtr?` · Stop ${item.stopAtr} ATR / ${item.rewardRisk}R`:''}`:''}
async function loadStrategyCatalog(){const backtest=$('backtestStrategy'),bot=$('botStrategy'),plan=$('strategyPlanSelect');backtest.disabled=true;bot.disabled=true;plan.disabled=true;try{const response=await fetch('/api/strategy/catalog',{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'โหลดรายการกลยุทธ์ไม่สำเร็จ');strategyCatalog=data.strategies||[];botStrategyCatalog=data.bot_strategies||[];REGIME_STRATEGIES.splice(0,REGIME_STRATEGIES.length,...strategyCatalog.filter(item=>item.regimeFilter).map(item=>item.id));NO_TARGET_STRATEGIES.splice(0,NO_TARGET_STRATEGIES.length,...strategyCatalog.filter(item=>item.noTarget).map(item=>item.id));let selectedPlan='shortPullback';try{const saved=localStorage.getItem('signal_analysis_strategy_plan_v2');if(strategyCatalog.some(item=>item.id===saved))selectedPlan=saved}catch(_){}renderStrategySelect(backtest,strategyCatalog,'shortPullback');renderStrategySelect(bot,botStrategyCatalog,'botOrb15');renderStrategySelect(plan,strategyCatalog,selectedPlan);backtest.disabled=false;bot.disabled=false;plan.disabled=false;syncBacktestStrategyUI();syncBotStrategyHelp();renderBotSymbols(botSelectedSymbols,false,botSelectedStrategies)}catch(error){$('backtestStrategyHelp').textContent=error.message||'โหลดรายการกลยุทธ์ไม่สำเร็จ';toast('โหลดรายการกลยุทธ์ไม่สำเร็จ · รีเฟรชหน้าเว็บแล้วลองอีกครั้ง')}}
function syncBacktestStrategyUI(){
  const strategy=$('backtestStrategy').value;
  const item=strategyCatalog.find(value=>value.id===strategy),help=item?`ซื้อ: ${item.entryRule} · ขาย: ${item.exitRule} · Stop ${item.stopAtr} ATR${item.noTarget?' · ไม่มีเป้ากำไรคงที่':` · เป้า ${item.rewardRisk}R`}${item.maxHoldingBars?` · ถือสูงสุด ${item.maxHoldingBars} วัน`:''}`:'';
  const regimeNote=REGIME_STRATEGIES.includes(strategy)?' · หาก SPY ต่ำกว่า SMA 200 หรือข้อมูลไม่ครบ จะไม่เปิดสถานะใหม่':'',entryNote=' · ใช้แท่งรายวัน Alpaca/IEX · Limit สูงกว่าราคาปิดสัญญาณประมาณ 1% หมดอายุใน 7 วัน',capitalNote=' · Backtest ใช้เงินเริ่มต้นเปิดได้ครั้งละหนึ่งสถานะ ไม่จำลองเพดานวงเงินและตัวหยุดขาดทุนรายวันของบอท',exitNote=NO_TARGET_STRATEGIES.includes(strategy)?' · ใช้ Stop ป้องกันและออกตามแนวโน้ม/Trailing Low ไม่มี Take Profit คงที่':' · ใช้ Stop และเป้ากำไรตาม ATR/Risk:Reward';
  $('backtestTimeframe').value='1d';$('backtestTimeframe').disabled=true;
  $('backtestStrategyHelp').innerHTML=`<b>กติกา:</b> ${help}${regimeNote}${entryNote}${exitNote}${capitalNote} · สัญญาณประเมินเมื่อแท่งวันปิด และจำลองออกตามสัญญาณที่ราคาเปิดวันถัดไป`;
  $('backtestForwardPanel').hidden=false;
}
async function historicalSignalEvents(rows,strategy){
  const payload={strategy,rows:rows.map(({t,o,h,l,c,v})=>({t,o,h,l,c,v}))};
  if(REGIME_STRATEGIES.includes(strategy)){const spyHistory=await fetchAlpacaDailyHistory('SPY',true);payload.spy_rows=spyHistory.rows.map(({t,o,h,l,c,v})=>({t,o,h,l,c,v}))}
  const response=await fetch('/api/strategy/signals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'คำนวณสัญญาณกลยุทธ์ไม่สำเร็จ');return result;
}
async function historicalSignalBatch(rows,strategies){
  const payload={strategies,rows:rows.map(({t,o,h,l,c,v})=>({t,o,h,l,c,v}))};
  if(strategies.some(strategy=>REGIME_STRATEGIES.includes(strategy))){const spy=await fetchAlpacaDailyHistory('SPY',true);payload.spy_rows=spy.rows.map(({t,o,h,l,c,v})=>({t,o,h,l,c,v}))}
  const response=await fetch('/api/strategy/signals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await response.json();
  if(!response.ok)throw new Error(result.error||'คำนวณสัญญาณเปรียบเทียบไม่สำเร็จ');return result.strategies||{};
}
function runHistoricalBacktest(history,strategy,capital,feePct,slippagePct,signalSet,holdoutPct=30,rangeStart=0,rangeEnd=null,selectedBars=null,timeframe='1d'){
  const sourceRows=history.rows,endIndex=rangeEnd==null?sourceRows.length-1:Math.min(rangeEnd,sourceRows.length-1),rows=sourceRows.slice(0,endIndex+1),n=rows.length,fee=feePct/100,slip=slippagePct/100,periodsPerYear=252,{events,begin,atr:atrValues}=signalSet,riskAtr=signalSet.riskAtr||1.5,rewardRisk=signalSet.rewardRisk||2,entryBufferPct=signalSet.entryBufferPct||.01,entryBufferAbsolute=signalSet.entryBufferAbsolute||.02,pendingDays=signalSet.pendingDays||7,first=Math.max(begin,rangeStart);
  if(first>=n||(holdoutPct?n<=first+40:n<=first+2))throw new Error(holdoutPct?'ข้อมูลในช่วงที่เลือกไม่พอสำหรับช่วงฝึกและช่วงทดสอบอย่างน้อย 20 แท่งต่อช่วง':'ข้อมูลในช่วงที่เลือกไม่พอสำหรับกลยุทธ์นี้');
  const available=n-first,split=holdoutPct?first+Math.floor(available*(1-holdoutPct/100)):n;
  if(holdoutPct&&(split-first<20||n-split<20))throw new Error('ข้อมูลในช่วงที่เลือกแบ่งทดสอบนอกตัวอย่างไม่ได้ · ขยายช่วงวันที่หรือเลือกข้อมูลทดสอบสัดส่วนต่ำลง');
  const simulate=(hold,start,end)=>{
    let cash=capital,shares=0,entryCost=0,totalFees=0,wins=0,trades=0,peak=capital,maxDrawdown=0,stop=null,target=null,entrySignalIndex=null,pendingEntry=null,exposureBars=0,buySignalEvents=0,entriesFilled=0,entriesExpired=0;
    const curve=[],actions=[],tradePnls=[];
    const buy=(price,index,signalIndex,limitPrice=null)=>{const execution=limitPrice==null?price*(1+slip):Math.min(price*(1+slip),limitPrice);shares=cash/(execution*(1+fee));const notional=shares*execution;totalFees+=notional*fee;entryCost=notional*(1+fee);cash=0;if(!hold){actions.push({side:'ซื้อ',index:index-start,time:rows[index].t,price:execution,shares});const atr=atrValues[signalIndex],reference=rows[signalIndex].c,intendedEntry=limitPrice??reference;if(Number.isFinite(atr)&&atr>0){const risk=atr*riskAtr;stop=limitPrice==null?reference-risk:Math.min(reference-risk,limitPrice-entryBufferAbsolute);target=NO_TARGET_STRATEGIES.includes(strategy)?Number.POSITIVE_INFINITY:intendedEntry+(intendedEntry-stop)*rewardRisk}entrySignalIndex=signalIndex}};
    const sell=(price,index,slipped=true)=>{const execution=price*(slipped?1-slip:1),notional=shares*execution,proceeds=notional*(1-fee),pnl=proceeds-entryCost;totalFees+=notional*fee;if(pnl>0)wins++;trades++;tradePnls.push(pnl);if(!hold)actions.push({side:'ขาย',index:index-start,time:rows[index].t,price:execution,shares,pnl});cash=proceeds;shares=0;entryCost=0;stop=null;target=null;entrySignalIndex=null};
    if(hold)buy(rows[start].o,start,start);
    for(let i=start;i<=end;i++){
      let enteredThisBar=false,entryAtOpen=false;
      if(!hold&&i>start){const signal=events[i-1],timeExit=!!signalSet.maxHoldingBars&&shares>0&&i-1-entrySignalIndex>=signalSet.maxHoldingBars;if(shares>0&&(signal===-1||timeExit))sell(rows[i].o,i);else if(shares===0&&!pendingEntry&&signal===1){const signalIndex=i-1,reference=rows[signalIndex].c,limitPrice=Math.max(reference*(1+entryBufferPct),reference+entryBufferAbsolute);pendingEntry={signalIndex,limitPrice,time:rows[signalIndex].t}}}
      if(!hold&&!shares&&pendingEntry){const expired=rows[i].t-pendingEntry.time>pendingDays*86400;if(expired){pendingEntry=null;entriesExpired++}else if(rows[i].l<=pendingEntry.limitPrice){entryAtOpen=rows[i].o<=pendingEntry.limitPrice;const fillPrice=Math.min(rows[i].o,pendingEntry.limitPrice);buy(fillPrice,i,pendingEntry.signalIndex,pendingEntry.limitPrice);pendingEntry=null;enteredThisBar=true;entriesFilled++}}
      if(!hold&&i>start&&events[i-1]===1)buySignalEvents++;
      if(!hold&&shares>0&&stop!=null&&target!=null){const bar=rows[i];if(bar.o<=stop)sell(bar.o,i);else if(entryAtOpen&&bar.o>=target)sell(bar.o,i,false);else if(bar.l<=stop)sell(stop,i);else if((!enteredThisBar||entryAtOpen)&&bar.h>=target)sell(target,i,false)}
      if(shares>0)exposureBars++;
      const equity=cash+(shares?shares*rows[i].c*(1-fee):0);curve.push(equity);peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak?1-equity/peak:0);
    }
    if(shares>0)sell(rows[end].c,end);const ending=cash;if(curve.length)curve[curve.length-1]=ending;peak=capital;maxDrawdown=0;for(const equity of curve){peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak?1-equity/peak:0)}
    const grossProfit=tradePnls.filter(x=>x>0).reduce((a,b)=>a+b,0),grossLoss=-tradePnls.filter(x=>x<0).reduce((a,b)=>a+b,0),bars=end-start+1,years=bars/periodsPerYear,cagr=ending>0&&years>0?(Math.pow(ending/capital,1/years)-1)*100:-100;
    return {ending,returnPct:(ending/capital-1)*100,cagr,wins,trades,winRate:trades?wins/trades*100:0,maxDrawdown:maxDrawdown*100,fees:totalFees,profitFactor:grossLoss?grossProfit/grossLoss:null,expectancy:tradePnls.length?tradePnls.reduce((a,b)=>a+b,0)/tradePnls.length:null,exposurePct:bars?exposureBars/bars*100:0,bars,curve,actions,from:rows[start].t,to:rows[end].t,buySignalEvents,entriesFilled,entriesExpired};
  };
  const outStart=holdoutPct?split:first,out=simulate(false,outStart,n-1),hold=simulate(true,outStart,n-1),inSample=holdoutPct?simulate(false,first,split-1):null;
  return {strategy:out,hold,inSample,bars:out.bars,from:out.from,to:out.to,currency:history.meta.currency||'USD',prices:rows.slice(outStart).map(x=>x.c),holdoutPct,selectedBars:selectedBars??Math.max(0,Math.min(endIndex,sourceRows.length-1)-rangeStart+1),usableBars:n-first,timeframe};
}
function runWalkForwardChecks(history,strategy,capital,feePct,slippagePct,signalSet,rangeStart,rangeEnd,timeframe){
  const begin=signalSet.begin||0,usableEnd=Math.min(rangeEnd??history.rows.length-1,history.rows.length-1),available=usableEnd-Math.max(begin,rangeStart)+1;
  const folds=Math.min(4,Math.floor(available/20));if(folds<2)return [];
  const first=Math.max(begin,rangeStart),width=Math.floor((usableEnd-first+1)/folds),checks=[];
  for(let fold=0;fold<folds;fold++){
    const start=first+fold*width,end=fold===folds-1?usableEnd:start+width-1;
    if(end-start+1<20)continue;
    try{checks.push(runHistoricalBacktest(history,strategy,capital,feePct,slippagePct,signalSet,0,start,end,null,timeframe).strategy)}catch(_){/* Skip a fold that lacks enough usable bars. */}
  }
  return checks;
}
function benchmarkBuyHold(history,startTime,endTime,capital,feePct,slippagePct){
  const rows=history.totalReturnRows?.length===history.rows.length?history.totalReturnRows:history.rows;
  const first=rows.find(row=>row.t>=startTime),last=rows.findLast(row=>row.t<=endTime);if(!first||!last||last.t<=first.t||first.o<=0||last.c<=0)return null;
  const fee=feePct/100,slip=slippagePct/100,buy=first.o*(1+slip),sell=last.c*(1-slip),shares=capital/(buy*(1+fee)),ending=shares*sell*(1-fee);
  return {returnPct:(ending/capital-1)*100,ending,from:first.t,to:last.t};
}
function drawBacktestChart(result){const svg=$('backtestChart');if(!result){svg.innerHTML='';return}const a=result.strategy.curve,b=result.hold.curve,count=Math.min(a.length,b.length),all=[...a,...b],min=Math.min(...all),max=Math.max(...all),span=max-min||1,x=i=>40+i/(count-1)*840,y=v=>225-(v-min)/span*195,points=values=>values.slice(-count).map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');svg.innerHTML=`<line x1="40" y1="225" x2="880" y2="225" stroke="#29323a"/><line x1="40" y1="30" x2="40" y2="225" stroke="#29323a"/><polyline points="${points(a)}" fill="none" stroke="#65d39c" stroke-width="2"/><polyline points="${points(b)}" fill="none" stroke="#9aa7f3" stroke-width="2"/><text x="42" y="18" fill="#81909a" font-size="10">${escapeHtml(fmt(min))}</text><text x="815" y="18" fill="#81909a" font-size="10">${escapeHtml(fmt(max))}</text>`}
function drawBacktestPriceChart(result){const svg=$('backtestPriceChart');if(!result){svg.innerHTML='';return}const values=result.prices,count=values.length,min=Math.min(...values),max=Math.max(...values),span=max-min||1,x=i=>40+i/(count-1)*840,y=v=>225-(v-min)/span*195,points=values.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),markers=result.strategy.actions.map((a,i)=>{const cx=x(Math.min(count-1,Math.max(0,a.index))),cy=y(a.price),color=a.side==='ซื้อ'?'#65d39c':'#ed8589',date=new Date(a.time*1000).toLocaleDateString('th-TH'),title=`${a.side} · ${date} · ${fmt(a.price)} ${result.currency}`;return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${color}" stroke="#0a0d12" stroke-width="2"><title>${escapeHtml(title)}</title></circle>${result.strategy.actions.length<=28?`<text x="${(cx+6).toFixed(1)}" y="${(cy-7).toFixed(1)}" fill="${color}" font-size="8">${a.side==='ซื้อ'?'B':'S'}${i+1}</text>`:''}`}).join('');svg.innerHTML=`<line x1="40" y1="225" x2="880" y2="225" stroke="#29323a"/><line x1="40" y1="30" x2="40" y2="225" stroke="#29323a"/><polyline points="${points}" fill="none" stroke="#aab7c1" stroke-width="1.5"/>${markers}<text x="42" y="18" fill="#81909a" font-size="10">${escapeHtml(fmt(max))}</text><text x="42" y="238" fill="#81909a" font-size="10">${new Date(result.from*1000).toLocaleDateString('th-TH')}</text><text x="800" y="238" fill="#81909a" font-size="10">${new Date(result.to*1000).toLocaleDateString('th-TH')}</text>`}
function selectBacktestRange(history,timeframe,dateFrom,dateTo){
  const rows=timeframe==='1w'?aggregate(history.rows,'week'):timeframe==='1mo'?aggregate(history.rows,'month'):history.rows;
  const from=dateFrom?Date.parse(`${dateFrom}T00:00:00Z`)/1000:-Infinity,to=dateTo?Date.parse(`${dateTo}T23:59:59Z`)/1000:Infinity;
  if(from>to)throw new Error('วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด');
  const startIndex=rows.findIndex(row=>row.t>=from),endIndex=rows.findLastIndex(row=>row.t<=to);
  if(startIndex<0||endIndex<startIndex)throw new Error('ไม่พบแท่งข้อมูลในช่วงวันที่ที่เลือก');
  return {history:{...history,rows:rows.slice(0,endIndex+1)},startIndex,endIndex,selectedBars:endIndex-startIndex+1,timeframe};
}
async function projectStrategySignal(history,strategy,days){
  const rows=history.rows,closes=rows.map(x=>x.c),forecast=estimateForward(rows,days);if(!forecast)throw new Error('ข้อมูลย้อนหลังไม่พอสำหรับคำนวณประมาณการ');
  const {events,begin,regime_pass:regimePass}=await historicalSignalEvents(rows,strategy);if(rows.length<=begin+2)throw new Error('ข้อมูลย้อนหลังไม่พอสำหรับกลยุทธ์นี้');
  let holding=false;for(let i=begin;i<events.length;i++){if(events[i]===1)holding=true;else if(events[i]===-1)holding=false}
  const item=strategyCatalog.find(value=>value.id===strategy);if(!item)throw new Error('ไม่พบกติกากลยุทธ์');let buyTrigger,sellTrigger;
  if(item.planType==='breakout'){const period=item.channelPeriod||20;buyTrigger=Math.max(...rows.slice(-(period+1),-1).map(row=>row.h));sellTrigger=item.exitChannelPeriod?Math.min(...rows.slice(-(item.exitChannelPeriod+1),-1).map(row=>row.l)):ema(closes,20).at(-1)}
  else if(strategy==='shortPullback'){buyTrigger=ema(closes,5).at(-1);sellTrigger=ema(closes,20).at(-1)}
  else if(item.planType==='pullback'){buyTrigger=ema(closes,20).at(-1);sellTrigger=ema(closes,50).at(-1)}
  else if(item.planType==='momentum'){const period=strategy==='shortMomentum'?10:strategy==='mediumMacd'?50:21;buyTrigger=ema(closes,period).at(-1);sellTrigger=ema(closes,period===10?20:period===21?21:200).at(-1)}
  else if(item.planType==='reversal'){buyTrigger=ema(closes,20).at(-1);sellTrigger=ema(closes,20).at(-1)}
  else if(item.planType==='relative'){const period=strategy==='longRelative'?200:50;buyTrigger=ema(closes,period).at(-1);sellTrigger=ema(closes,period===200?100:50).at(-1)}
  else{buyTrigger=ema(closes,200).at(-1);sellTrigger=ema(closes,200).at(-1)}
  const indicator=`${item.label} · เข้า: ${item.entryRule} · ออก: ${item.exitRule}`;
  if(!Number.isFinite(buyTrigger)||buyTrigger<=0||!Number.isFinite(sellTrigger)||sellTrigger<=0)throw new Error('ข้อมูลย้อนหลังไม่พอสำหรับคำนวณ EMA ของกลยุทธ์นี้');
  const current=closes.at(-1),side=holding?'ขาย':'ซื้อ',trigger=holding?sellTrigger:buyTrigger,regimeAllowed=!REGIME_STRATEGIES.includes(strategy)||regimePass?.at(-1)===true,within=regimeAllowed&&(holding?forecast.low<=trigger:forecast.high>=trigger);
  return {strategy,days,current,forecast,holding,buyTrigger,sellTrigger,trigger,side,indicator,within,regimePass:regimePass?.at(-1),currency:history.meta.currency||'USD'};
}
function drawForwardSignalChart(result){const svg=$('backtestForwardChart');if(!result){svg.innerHTML='';return}const prices=[result.current,result.forecast.low,result.forecast.high,result.forecast.close,result.buyTrigger,result.sellTrigger],low=Math.min(...prices),high=Math.max(...prices),pad=(high-low||result.current*.03)*.12,min=Math.max(.000001,low-pad),max=high+pad,y=v=>160-(v-min)/(max-min)*125,buyY=y(result.buyTrigger),sellY=y(result.sellTrigger),same=Math.abs(result.buyTrigger-result.sellTrigger)<Math.max(result.buyTrigger,result.sellTrigger)*.0001,buyLine=`<line x1="80" y1="${buyY.toFixed(1)}" x2="820" y2="${buyY.toFixed(1)}" stroke="${same?'#b49af8':'#65d39c'}" stroke-dasharray="5 4"/>`,sellLine=same?'':`<line x1="80" y1="${sellY.toFixed(1)}" x2="820" y2="${sellY.toFixed(1)}" stroke="#ed8589" stroke-dasharray="5 4"/>`,buyLabel=same?`ระดับเข้า/ออก ${fmt(result.buyTrigger)} ${escapeHtml(result.currency)}`:`ระดับเข้า ${fmt(result.buyTrigger)}`,sellLabel=same?'':`ระดับออก ${fmt(result.sellTrigger)}`;svg.innerHTML=`<line x1="55" y1="160" x2="850" y2="160" stroke="#29323a"/>${buyLine}${sellLine}<line x1="820" y1="${y(result.forecast.low).toFixed(1)}" x2="820" y2="${y(result.forecast.high).toFixed(1)}" stroke="#9aa7f3" stroke-width="10" stroke-linecap="round" opacity=".55"/><line x1="80" y1="${y(result.current).toFixed(1)}" x2="820" y2="${y(result.forecast.close).toFixed(1)}" stroke="#aab7c1" stroke-width="2"/><circle cx="80" cy="${y(result.current).toFixed(1)}" r="5" fill="#d5dfe5"/><circle cx="820" cy="${y(result.forecast.close).toFixed(1)}" r="5" fill="#9aa7f3"/><text x="80" y="180" fill="#81909a" font-size="10">ราคาล่าสุด ${escapeHtml(fmt(result.current))}</text><text x="700" y="180" fill="#81909a" font-size="10">≈ ${result.days} วัน</text><text x="85" y="${Math.max(15,buyY-6).toFixed(1)}" fill="${same?'#b49af8':'#65d39c'}" font-size="10">${buyLabel}</text>${same?'':`<text x="510" y="${Math.max(15,sellY-6).toFixed(1)}" fill="#ed8589" font-size="10">${sellLabel} ${escapeHtml(result.currency)}</text>`}<text x="825" y="${Math.max(15,y(result.forecast.high)-5).toFixed(1)}" fill="#aab5f2" font-size="9">${escapeHtml(fmt(result.forecast.high))}</text><text x="825" y="${Math.min(176,y(result.forecast.low)+10).toFixed(1)}" fill="#aab5f2" font-size="9">${escapeHtml(fmt(result.forecast.low))}</text>`}
async function executeStrategyProjection(){const button=$('projectBacktest'),symbol=$('backtestSymbol').value,strategy=$('backtestStrategy').value,days=Math.max(1,Math.min(60,Math.round(Number($('backtestForwardDays').value)||20)));$('backtestForwardDays').value=days;button.disabled=true;button.textContent='กำลังคำนวณ…';try{const history=await fetchAlpacaDailyHistory(symbol,true),result=await projectStrategySignal(history,strategy,days),status=result.holding?'กลยุทธ์มีสถานะถืออยู่':'กลยุทธ์ยังรอเข้าซื้อ',range=`ช่วงราคาในอีก ${days} วันโดยประมาณ ${fmt(result.forecast.low)}–${fmt(result.forecast.high)} ${escapeHtml(result.currency)} · ค่ากลาง ${fmt(result.forecast.close)} ${escapeHtml(result.currency)}`,regimeText=REGIME_STRATEGIES.includes(strategy)?` · SPY ${result.regimePass?'เหนือ':'ไม่เหนือ'} SMA 200`:'';$('forwardStrategyResult').innerHTML=`<div><b class="${result.holding?'pnl-positive':'pnl-negative'}">${status} · ${result.holding?'รอสัญญาณขาย':'รอสัญญาณซื้อ'}</b><span>ราคาอ้างอิงเข้า ${fmt(result.buyTrigger)} · ระดับออก ${fmt(result.sellTrigger)} ${escapeHtml(result.currency)}${regimeText}</span><span>${escapeHtml(result.indicator)} · ${range}</span><small>${result.within?'ช่วงราคาประมาณการอาจแตะระดับกลยุทธ์':'ช่วงราคาประมาณการอาจยังไม่ถึงระดับกลยุทธ์'} · ค่าประมาณไม่ใช่สัญญาณซื้อขายหรือการรับประกัน</small></div>`;drawForwardSignalChart(result)}catch(err){$('forwardStrategyResult').innerHTML=`<div><b>${escapeHtml(err.message||'คำนวณไม่ได้')}</b></div>`;drawForwardSignalChart(null)}finally{button.disabled=false;button.textContent='คำนวณประมาณการ'}}
async function executeStrategyComparison(){
  const button=$('compareStrategies'),resultBox=$('strategyCompareResult'),symbol=$('backtestSymbol').value,capital=Number($('backtestCapital').value),fee=Number($('backtestFee').value),slippage=Number($('backtestSlippage').value),holdoutPct=Number($('backtestHoldout').value),dateFrom=$('backtestDateFrom').value,dateTo=$('backtestDateTo').value;
  if(!(capital>0&&fee>=0&&fee<=5&&slippage>=0&&slippage<=5)){toast('ตรวจสอบเงินเริ่มต้น ค่าธรรมเนียม และ slippage');return}
  if(!(holdoutPct>0&&holdoutPct<100)){toast('เลือกช่วงทดสอบนอกตัวอย่าง 20%, 30% หรือ 40% ก่อนเปรียบเทียบ');return}
  const strategies=strategyCatalog;if(!strategies.length){toast('รายการกลยุทธ์ยังโหลดไม่เสร็จ');return}
  button.disabled=true;button.textContent='กำลังทดสอบ 15 กลยุทธ์…';resultBox.hidden=false;resultBox.innerHTML='<div class="backtest-empty">กำลังโหลดข้อมูลและจำลองการซื้อขายของทุกกลยุทธ์</div>';
  try{
    const raw=await fetchAlpacaDailyHistory(symbol,true),selection=selectBacktestRange(raw,'1d',dateFrom,dateTo),history=selection.history,signals=await historicalSignalBatch(history.rows,strategies.map(item=>item.id));
    const commonStart=Math.max(selection.startIndex,...strategies.map(item=>signals[item.id]?.begin||0)),n=history.rows.length,available=n-commonStart;
    if(available<100)throw new Error('ข้อมูลหลัง warm-up เหลือน้อยเกินไป · ขยายช่วงวันที่หรือเลือกหุ้นที่มีประวัติยาวขึ้น');
    const split=commonStart+Math.floor(available*(1-holdoutPct/100));if(split-commonStart<40||n-split<20)throw new Error('ข้อมูลไม่พอแบ่งช่วงฝึกและช่วงทดสอบนอกตัวอย่าง');
    const rows=[];
    for(const item of strategies){
      try{
        const signal=signals[item.id];if(!signal)throw new Error('ไม่มีผลคำนวณสัญญาณ');
        const bt=runHistoricalBacktest(history,item.id,capital,fee,slippage,signal,holdoutPct,commonStart,selection.endIndex,selection.selectedBars,'1d');
        const folds=runWalkForwardChecks(history,item.id,capital,fee,slippage,signal,commonStart,split-1,'1d'),sorted=folds.map(fold=>fold.returnPct).sort((a,b)=>a-b),median=sorted.length?(sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2):null,foldTrades=folds.reduce((sum,fold)=>sum+fold.trades,0),eligible=bt.strategy.trades>=3&&folds.length>=2&&foldTrades>=5;
        rows.push({item,oos:bt.strategy,hold:bt.hold,folds,median,foldTrades,eligible});
      }catch(error){rows.push({item,error:error.message||'ทดสอบไม่ได้',eligible:false})}
    }
    const ranked=rows.filter(row=>row.median!=null).sort((a,b)=>b.median-a.median||a.oos.maxDrawdown-b.oos.maxDrawdown),qualified=ranked.filter(row=>row.eligible),best=qualified[0],period=`${new Date(history.rows[commonStart].t*1000).toLocaleDateString('th-TH')}–${new Date(history.rows.at(-1).t*1000).toLocaleDateString('th-TH')}`,metric=value=>`${value>=0?'+':''}${fmt(value,2)}%`;
    const alpha=best?best.oos.returnPct-best.hold.returnPct:0,decision=best?`<div class="strategy-compare-winner"><span>อันดับ 1 จาก Walk-forward</span><b>${escapeHtml(best.item.label)}</b><small>ค่ากลางผลตอบแทน ${metric(best.median)} ต่อช่วง · OOS ล่าสุด ${metric(best.oos.returnPct)} · ซื้อแล้วถือหุ้นเดียวกัน ${metric(best.hold.returnPct)} · เหนือ/ต่ำกว่า ${metric(alpha)} · ปิด ${best.oos.trades} รอบ · Drawdown ${fmt(best.oos.maxDrawdown,2)}%</small></div>`:`<div class="strategy-compare-winner muted"><span>ยังระบุผู้ชนะไม่ได้</span><b>จำนวนรอบซื้อขายหรือช่วง Walk-forward ยังไม่พอ</b><small>ขยายช่วงข้อมูลหรือทดลองหุ้นที่มีประวัติยาวขึ้น แล้วเปรียบเทียบใหม่</small></div>`;
    const table=`<div class="portfolio-table-wrap"><table class="ta-table portfolio-table strategy-compare-table"><thead><tr><th>อันดับ</th><th>กลยุทธ์</th><th>WF median / ช่วงบวก</th><th>OOS ล่าสุด</th><th>รอบปิด OOS</th><th>Drawdown OOS</th><th>WF trades</th></tr></thead><tbody>${ranked.map(row=>`<tr><td>${row.eligible?qualified.indexOf(row)+1:'—'}</td><td>${escapeHtml(row.item.label)}${row.eligible?'':'<small>ข้อมูลยังไม่พอจัดอันดับ</small>'}</td><td>${metric(row.median)} · ${row.folds.filter(fold=>fold.returnPct>0).length}/${row.folds.length}</td><td class="${row.oos.returnPct>=0?'pnl-positive':'pnl-negative'}">${metric(row.oos.returnPct)}</td><td>${row.oos.trades}</td><td>${fmt(row.oos.maxDrawdown,2)}%</td><td>${row.foldTrades}</td></tr>`).join('')}${rows.filter(row=>row.error).map(row=>`<tr><td>—</td><td>${escapeHtml(row.item.label)}</td><td colspan="5">${escapeHtml(row.error)}</td></tr>`).join('')}</tbody></table></div>`;
    const trainText=`หุ้น ${symbol} · ${period} · ทุน ${fmt(capital)} USD · fee ${fmt(fee,2)}% · slippage ${fmt(slippage,2)}% · OOS ${holdoutPct}% ล่าสุด`;
    resultBox.innerHTML=`<div class="panel-heading"><div><div class="panel-title">ผลเปรียบเทียบกลยุทธ์</div><div class="panel-sub">${escapeHtml(trainText)} · ข้อมูล ${escapeHtml(raw.feed||'Alpaca IEX')}</div></div></div>${decision}${table}<div class="strategy-compare-note">จัดอันดับด้วยค่ามัธยฐานของผลตอบแทน Walk-forward ในช่วงฝึก; OOS ล่าสุดแยกไว้ตรวจสอบและไม่ใช้จัดอันดับ · ต้องมีอย่างน้อย 3 รอบปิดใน OOS และ 5 รอบรวมใน Walk-forward จึงถือว่ามีข้อมูลพอ · การลองหลายกลยุทธ์เพิ่มโอกาส overfit และผลย้อนหลังไม่รับประกันอนาคต</div>`;
  }catch(error){resultBox.innerHTML=`<div class="backtest-empty">${escapeHtml(error.message||'เปรียบเทียบกลยุทธ์ไม่สำเร็จ')}</div>`}
  finally{button.disabled=false;button.textContent='เปรียบเทียบทั้ง 15 กลยุทธ์'}
}
async function executeBacktest(){
  const symbol=$('backtestSymbol').value,strategy=$('backtestStrategy').value,capital=Number($('backtestCapital').value),fee=Number($('backtestFee').value),slippage=Number($('backtestSlippage').value),timeframe='1d',dateFrom=$('backtestDateFrom').value,dateTo=$('backtestDateTo').value;
  if(!(capital>0&&fee>=0&&fee<=5&&slippage>=0&&slippage<=5)){toast('ตรวจสอบเงินเริ่มต้น ค่าธรรมเนียม และ slippage (0–5%)');return}
  const button=$('runBacktest');button.disabled=true;button.textContent='กำลังคำนวณ…';
  try{
    const rawHistory=await fetchAlpacaDailyHistory(symbol,true),selection=selectBacktestRange(rawHistory,timeframe,dateFrom,dateTo),history=selection.history;
    const signalSet=await historicalSignalEvents(history.rows,strategy),result=runHistoricalBacktest(history,strategy,capital,fee,slippage,signalSet,Number($('backtestHoldout').value),selection.startIndex,selection.endIndex,selection.selectedBars,timeframe);const walkForward=runWalkForwardChecks(history,strategy,capital,fee,slippage,signalSet,selection.startIndex,selection.endIndex,timeframe);let vooBenchmark=null;if(result.currency==='USD'){try{const voo=await fetchAlpacaDailyHistory('VOO',true);vooBenchmark=benchmarkBuyHold(voo,result.from,result.to,capital,fee,slippage)}catch(_){vooBenchmark=null}}const currency=result.currency,metric=(title,value,detail='')=>`<article class="panel backtest-metric"><span>${title}</span><b>${value}</b>${detail?`<small>${detail}</small>`:''}</article>`,alpha=result.strategy.returnPct-result.hold.returnPct,strategyName=(strategyCatalog.find(item=>item.id===strategy)?.label||strategy);
    const timeframeLabel=({'1m':'ราย 1 นาที','1d':'รายวัน','1w':'รายสัปดาห์','1mo':'รายเดือน'})[timeframe],actualRange=`${new Date(result.from*1000).toLocaleDateString('th-TH')}–${new Date(result.to*1000).toLocaleDateString('th-TH')}`;$('backtestDataSummary').textContent=`ข้อมูล Alpaca ${rawHistory.feed||'IEX'} · ${timeframeLabel} · ปรับ Split แล้ว ไม่รวมปันผล · ในช่วงวันที่ ${selection.selectedBars.toLocaleString()} แท่ง · หลัง warm-up ใช้ได้ ${result.usableBars.toLocaleString()} แท่ง · ช่วงทดสอบ ${result.strategy.bars.toLocaleString()} แท่ง (${actualRange})${result.inSample?` · ช่วงฝึก ${result.inSample.bars.toLocaleString()} แท่ง`:''}`;
    const pf=result.strategy.profitFactor==null?'—':fmt(result.strategy.profitFactor,2),testTag=result.holdoutPct?`OOS · กันข้อมูล ${result.holdoutPct}% ล่าสุดไว้ทดสอบ`:'รวมทุกข้อมูล · ไม่มี OOS',trainText=result.inSample?`ช่วงฝึก ${fmt(result.inSample.returnPct,2)}% (${new Date(result.inSample.from*1000).toLocaleDateString('th-TH')}–${new Date(result.inSample.to*1000).toLocaleDateString('th-TH')})`:testTag;
    $('backtestSummary').innerHTML=metric(`ผลตอบแทนกลยุทธ์ · ${result.holdoutPct?'OOS':'รวม'}`,`${result.strategy.returnPct>=0?'+':''}${fmt(result.strategy.returnPct,2)}%`,`${fmt(result.strategy.ending)} ${currency} · CAGR ${fmt(result.strategy.cagr,2)}% · ${new Date(result.from*1000).toLocaleDateString('th-TH')}–${new Date(result.to*1000).toLocaleDateString('th-TH')}`)+metric(`ซื้อแล้วถือ · ${result.holdoutPct?'OOS':'รวม'}`,`${result.hold.returnPct>=0?'+':''}${fmt(result.hold.returnPct,2)}%`,`${fmt(result.hold.ending)} ${currency} · CAGR ${fmt(result.hold.cagr,2)}%`)+metric('ชนะ / ปิดสถานะ',`${fmt(result.strategy.winRate,1)}%`,`${result.strategy.wins} จาก ${result.strategy.trades} รอบ · ${fmt(result.strategy.exposurePct,1)}% ของช่วงที่มีสถานะ`)+metric('ขาดทุนสูงสุด',`${fmt(result.strategy.maxDrawdown,2)}%`,`กลยุทธ์ · ซื้อแล้วถือ ${fmt(result.hold.maxDrawdown,2)}%`)+metric('กำไรขาดทุนต่อรอบ',`${result.strategy.expectancy==null?'—':`${result.strategy.expectancy>=0?'+':''}${fmt(result.strategy.expectancy)} ${currency}`}`,`Profit factor ${pf} · ${trainText}`)+metric('เทียบซื้อแล้วถือ',`${alpha>=0?'+':''}${fmt(alpha,2)} จุดเปอร์เซ็นต์`,`${strategyName} · ${result.bars.toLocaleString()} ${timeframeLabel} แท่ง · รวมค่าธรรมเนียมและ Slippage`)+metric('ค่าธรรมเนียมรวม',`${fmt(result.strategy.fees)} ${currency}`,`กลยุทธ์ · ซื้อแล้วถือ ${fmt(result.hold.fees)} ${currency} · Slippage ${fmt(slippage,2)}% ต่อครั้ง`);
    $('backtestSummary').innerHTML+=metric('สัญญาณซื้อ / จับคู่จริง',`${result.strategy.buySignalEvents} / ${result.strategy.entriesFilled}`,`OOS · หมดอายุไม่ถูกจับคู่ ${result.strategy.entriesExpired} รายการ · สัญญาณเป็นบวกไม่ได้แปลว่าคำสั่ง Limit จะถูกจับคู่`);
    const wfMean=walkForward.length?walkForward.reduce((sum,fold)=>sum+fold.returnPct,0)/walkForward.length:null;$('backtestSummary').innerHTML+=(vooBenchmark?metric('ซื้อแล้วถือ VOO',`${vooBenchmark.returnPct>=0?'+':''}${fmt(vooBenchmark.returnPct,2)}%`,`${fmt(vooBenchmark.ending)} USD · เทียบช่วง OOS เดียวกัน · ใช้ค่าธรรมเนียม/Slippage ที่กำหนด`):'')+(wfMean==null?'':metric('ตรวจ OOS หลายช่วง',`${walkForward.filter(fold=>fold.returnPct>0).length}/${walkForward.length} ช่วงเป็นบวก`, `ผลตอบแทนเฉลี่ย ${wfMean>=0?'+':''}${fmt(wfMean,2)}% ต่อช่วง · พารามิเตอร์เดิมทุกช่วง`));drawBacktestChart(result);drawBacktestPriceChart(result);$('backtestCurrency').textContent=currency;$('backtestPriceCaption').textContent=`${symbol} · จุด B คือซื้อ · จุด S คือขาย · ชี้ที่จุดเพื่อดูวันที่และราคาจำลอง`;$('backtestTradeCount').textContent=`${result.strategy.actions.length} คำสั่ง · ${result.strategy.trades} รอบซื้อขาย`;
    const realizedPnl=result.strategy.actions.filter(a=>a.side==='ขาย').reduce((sum,a)=>sum+a.pnl,0);$('backtestTradePnl').className=result.strategy.trades?(realizedPnl>=0?'pnl-positive':'pnl-negative'):'';$('backtestTradePnl').textContent=result.strategy.trades?`รวม ${realizedPnl>=0?'กำไร':'ขาดทุน'} ${realizedPnl>=0?'+':''}${fmt(realizedPnl)} ${currency} · สุทธิหลังค่าธรรมเนียม/Slippage`:'ยังไม่มีรอบซื้อขายที่ปิดแล้ว';
    $('backtestTradeRows').innerHTML=result.strategy.actions.length?result.strategy.actions.map(a=>`<tr><td>${new Date(a.time*1000).toLocaleDateString('th-TH')}</td><td><span class="seasonality-badge ${a.side==='ซื้อ'?'up':'down'}">${a.side}</span></td><td>${fmt(a.price)} ${escapeHtml(currency)}</td><td>${fmt(a.shares,4)}</td><td class="${a.side==='ขาย'?(a.pnl>=0?'pnl-positive':'pnl-negative'):''}">${a.side==='ขาย'?`${a.pnl>=0?'+':''}${fmt(a.pnl)} ${escapeHtml(currency)}`:'—'}</td></tr>`).join(''):'<tr><td colspan="5">ไม่พบจุดซื้อขายตามกลยุทธ์ในช่วงข้อมูลนี้</td></tr>';
  }catch(err){$('backtestDataSummary').textContent=`Backtest error: ${err.message||'Check selected data'}`;$('backtestSummary').innerHTML=`<div class="panel backtest-empty">${escapeHtml(err.message||'คำนวณไม่ได้')}</div>`;drawBacktestChart(null);drawBacktestPriceChart(null);$('backtestTradeRows').innerHTML='';$('backtestTradeCount').textContent='—';$('backtestTradePnl').className='';$('backtestTradePnl').textContent='กำไร/ขาดทุนสุทธิรวม —'}
  finally{button.disabled=false;button.textContent='คำนวณผลย้อนหลัง'}
}
const forecastHomeSlots=['.chart-panel','.forecast-panel'].map(selector=>{const node=document.querySelector(selector);return {node,parent:node.parentNode,next:node.nextSibling}});
function placeForecastComponents(inForecast){if(inForecast){$('forecastChartMount').append(forecastHomeSlots[0].node);$('forecastSummaryMount').append(forecastHomeSlots[1].node);return}for(const slot of forecastHomeSlots)slot.parent.insertBefore(slot.node,slot.next?.parentNode===slot.parent?slot.next:null)}
function showView(name,hash){placeForecastComponents(name==='forecast');state.view=name;if(name==='analysis'&&state.history)refreshMarketSnapshot();const pageByView={analysis:'analysisPage',forecast:'forecastPage',plans:'plansPage',portfolio:'portfolioPage',backtest:'backtestPage',trading:'tradingPage'};for(const [view,id] of Object.entries(pageByView))$(id).hidden=view!==name;document.querySelectorAll('.nav-item[data-view]').forEach(x=>{const universeMatches=name!=='plans'||(x.dataset.planUniverse?state.planUniverse==='sp500':state.planUniverse!=='sp500');x.classList.toggle('active',x.dataset.view===name&&universeMatches)});const crumb={analysis:'วิเคราะห์ทางเทคนิค',forecast:'คาดการณ์ราคา',plans:'แผนลงทุนหุ้นสหรัฐฯ',portfolio:'ภาพรวมพอร์ต',backtest:'ทดสอบกลยุทธ์ย้อนหลัง',trading:'Alpaca Paper Trading'};document.querySelector('.breadcrumb').innerHTML=`ตลาดทุน <span>/</span> ${crumb[name]||crumb.analysis}`;if(name==='plans'){window.scrollTo({top:0,behavior:'smooth'});}else if(name==='portfolio'){window.scrollTo({top:0,behavior:'smooth'});renderPortfolio()}else if(name==='backtest'){window.scrollTo({top:0,behavior:'smooth'});populateBacktestSymbols()}else if(name==='trading'){window.scrollTo({top:0,behavior:'smooth'});refreshAlpaca();refreshAutoBot()}else if(hash==='#watchlist'||hash==='#analysis')document.querySelector(hash)?.scrollIntoView({behavior:'smooth',block:'start'});else window.scrollTo({top:0,behavior:'smooth'})}
const watchBlock=document.querySelector('.watch-block');let draggedWatchItem=null;
watchBlock.addEventListener('input',e=>{if(e.target.id==='watchSearch')filterWatchlist()});
watchBlock.addEventListener('click',e=>{const remove=e.target.closest('.watch-remove');if(remove){const item=remove.closest('.watch-item'),name=item.querySelector('.watch-name').childNodes[0]?.textContent.trim();item.remove();persistWatchlist();filterWatchlist();toast(`ลบ ${name||'หุ้น'} ออกจาก Watchlist แล้ว`);if(state.view==='plans')scanPlanUniverse(false);return}const row=e.target.closest('.watch-row');if(row){if(state.view!=='analysis')showView('analysis','#analysis');loadSymbol(row.dataset.symbol)}});
watchBlock.addEventListener('dragstart',e=>{const item=e.target.closest('.watch-item');if(!item||e.target.closest('.watch-remove')){e.preventDefault();return}draggedWatchItem=item;item.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',item.querySelector('.watch-row').dataset.symbol)});
watchBlock.addEventListener('dragover',e=>{const target=e.target.closest('.watch-item');if(draggedWatchItem&&target){e.preventDefault();document.querySelectorAll('.watch-item.drag-over').forEach(item=>item.classList.remove('drag-over'));if(target!==draggedWatchItem)target.classList.add('drag-over')}});
watchBlock.addEventListener('drop',e=>{const target=e.target.closest('.watch-item');if(!draggedWatchItem||!target||target===draggedWatchItem)return;e.preventDefault();const rect=target.getBoundingClientRect(),insertAfter=e.clientY>rect.top+rect.height/2;watchBlock.insertBefore(draggedWatchItem,insertAfter?target.nextSibling:target);persistWatchlist();filterWatchlist()});
watchBlock.addEventListener('dragend',()=>{draggedWatchItem?.classList.remove('dragging');draggedWatchItem=null;document.querySelectorAll('.watch-item.drag-over').forEach(item=>item.classList.remove('drag-over'))});
$('loadBtn').addEventListener('click',()=>loadSymbol($('symbolInput').value));$('symbolInput').addEventListener('keydown',e=>{if(e.key==='Enter')loadSymbol(e.currentTarget.value)});$('refreshBtn').addEventListener('click',()=>state.source==='csv'?toast('กำลังใช้ข้อมูลจาก CSV · นำเข้าไฟล์ใหม่เพื่ออัปเดต'):loadSymbol(state.symbol));$('addWatch').addEventListener('click',()=>{const raw=prompt('กรอกสัญลักษณ์หุ้นสหรัฐฯ เช่น NVDA หรือ SPY');if(!raw)return;const symbol=raw.trim().toUpperCase().replace(/\s+/g,'');if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)){toast('กรอก Ticker หุ้นสหรัฐฯ ให้ถูกต้อง');return}const existing=[...document.querySelectorAll('.watch-row')].find(x=>x.dataset.symbol===symbol);if(!existing){document.querySelector('.watch-block').append(makeWatchItem(symbol));persistWatchlist();toast(`เพิ่ม ${symbol} ใน Watchlist แล้ว`)}loadSymbol(symbol).then(()=>{updateWatchPrices();if(!$('plansPage').hidden)scanPlanUniverse(false)})});
$('importBtn').addEventListener('click',()=>$('csvInput').click());$('csvInput').addEventListener('change',async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{const history=parsePriceCsv(await file.text(),state.symbol,file.name);if(state.liveTimer){clearInterval(state.liveTimer);state.liveTimer=null}state.liveBars=null;state.interval='1d';document.querySelectorAll('[data-interval]').forEach(x=>x.classList.toggle('active',x.dataset.interval==='1d'));state.history=history;state.watchHistories[state.symbol]=history;state.source='csv';update(history,state.symbol);document.title=`${state.symbol} — Signal Technical Analysis`;const n=history.rows.length;toast(`นำเข้าข้อมูล ${n.toLocaleString()} วันสำเร็จ${n<200?' · EMA 200 ต้องใช้ข้อมูลอย่างน้อย 200 วัน':''}`)}catch(err){toast(err.message)}finally{input.value=''}});
document.querySelectorAll('[data-interval]').forEach(b=>b.addEventListener('click',()=>{if(isIntraday(b.dataset.interval)&&state.source==='csv'){toast('ข้อมูล CSV ที่นำเข้ามาเป็นรายวัน · กราฟระหว่างวันใช้ข้อมูล Alpaca');return}document.querySelectorAll('[data-interval]').forEach(x=>x.classList.toggle('active',x===b));state.interval=b.dataset.interval;state.zoom=1;state.pan=0;if(isIntraday(state.interval)){state.liveBars=null;redrawChart();setLivePolling()}else{if(state.liveTimer){clearInterval(state.liveTimer);state.liveTimer=null}redrawChart()}persistChartView()}));
document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-range]').forEach(x=>x.classList.toggle('active',x===b));state.range=b.dataset.range;state.zoom=1;state.pan=0;redrawChart();persistChartView();if(state.range==='max'&&state.source!=='csv')loadMaxChartHistory(state.symbol).catch(error=>toast(`โหลดกราฟ MAX ไม่สำเร็จ · ${error.message}`))}));
document.querySelectorAll('[data-live-range]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-live-range]').forEach(x=>x.classList.toggle('active',x===b));state.liveRange=b.dataset.liveRange;state.zoom=1;state.pan=0;setLivePolling()}));
document.querySelectorAll('[data-ta-timeframe]').forEach(b=>b.addEventListener('click',()=>{state.taTimeframe=b.dataset.taTimeframe;state.taPending=null;state.taRequestId++;document.querySelectorAll('[data-ta-timeframe]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active))});if(state.history)renderTechnicalAnalysis(state.history)}));
function bkkNowParts(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),get=type=>parts.find(x=>x.type===type).value;return {day:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`}}
function commitTaAsOfSelection(){const now=bkkNowParts(),dayInput=$('taAsOfDay'),timeInput=$('taAsOfTime');if(!dayInput.value&&timeInput.value)dayInput.value=now.day;if(dayInput.value===now.day){timeInput.max=now.time;if(timeInput.value>now.time)timeInput.value=now.time}else timeInput.removeAttribute('max');if(dayInput.value&&!timeInput.value)timeInput.value='23:59';$('taAsOfDate').value=dayInput.value?`${dayInput.value}T${timeInput.value}`:'';$('taAsOfDate').dispatchEvent(new Event('change',{bubbles:true}))}
$('taAsOfDate').addEventListener('change',()=>{state.taRows=null;state.taPending=null;state.taRequestId++;if(state.history)renderTechnicalAnalysis(state.history)});$('taAsOfDay').addEventListener('change',commitTaAsOfSelection);$('taAsOfTime').addEventListener('change',commitTaAsOfSelection);document.querySelectorAll('[data-ta-lookback]').forEach(button=>button.addEventListener('click',()=>{const now=bkkNowParts(),[year,month,day]=now.day.split('-').map(Number),days=Number(button.dataset.taLookback),selected=new Date(Date.UTC(year,month-1,day-days)).toISOString().slice(0,10);$('taAsOfDay').value=selected;$('taAsOfTime').value=now.time;commitTaAsOfSelection()}));$('taLatest').addEventListener('click',()=>{$('taAsOfDay').value='';$('taAsOfTime').value='';$('taAsOfDate').value='';state.taRows=null;state.taPending=null;state.taRequestId++;if(state.history)renderTechnicalAnalysis(state.history)});
$('forecastDays').addEventListener('change',e=>{state.forecastDays=Math.max(1,Math.min(60,Math.round(Number(e.currentTarget.value)||1)));e.currentTarget.value=state.forecastDays;if(state.history)update(state.history,state.symbol)});
document.querySelector('.plan-universe-switch').addEventListener('click',e=>{const button=e.target.closest('[data-universe]');if(button)selectPlanUniverse(button.dataset.universe)});
$('sp500Search').addEventListener('input',()=>{renderSp500Search();state.planVisibleLimit=50;renderPlanCards()});$('sp500SearchResults').addEventListener('click',e=>{const result=e.target.closest('[data-sp500-symbol]');if(!result)return;$('sp500Search').value=result.dataset.sp500Symbol;$('sp500SearchResults').hidden=true;state.planVisibleLimit=50;renderPlanCards()});
$('allUsSearch').addEventListener('input',()=>{state.planVisibleLimit=50;renderPlanCards()});document.querySelector('.nav-item[data-view="plans"]:not([data-plan-universe])').addEventListener('click',()=>selectPlanUniverse('watchlist'));
$('refreshPlans').addEventListener('click',()=>scanPlanUniverse(true));setInterval(()=>{if(document.visibilityState==='visible'&&state.planUniverse==='watchlist'&&state.view!=='trading')scanPlanUniverse(true)},15*60*1000);$('enablePlanNotifications').addEventListener('click',async()=>{if(typeof Notification==='undefined'){toast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน');return}try{const permission=await Notification.requestPermission();renderPlanAlerts();toast(permission==='granted'?'เปิดการแจ้งเตือนแผนแล้ว':'ยังไม่ได้อนุญาตการแจ้งเตือน')}catch(_){toast('เปิดการแจ้งเตือนไม่สำเร็จ')}});$('capitalFields').addEventListener('input',e=>{const input=e.target.closest('[data-capital-currency]');if(!input)return;state.capitalByCurrency[input.dataset.capitalCurrency]=input.value;renderPlanCards()});
const resetPlanResults=()=>{state.planVisibleLimit=50;renderPlanCards()};$('planSort').addEventListener('change',resetPlanResults);$('planFilter').addEventListener('change',resetPlanResults);$('plansList').addEventListener('click',e=>{if(!e.target.closest('[data-plan-more]'))return;state.planVisibleLimit+=50;renderPlanCards()});
$('refreshPortfolio').addEventListener('click',()=>renderPortfolio(true));$('runBacktest').addEventListener('click',()=>executeBacktest());$('compareStrategies').addEventListener('click',()=>executeStrategyComparison());$('projectBacktest').addEventListener('click',()=>executeStrategyProjection());$('addBacktestSymbol').addEventListener('click',addBacktestSymbol);$('backtestSymbolSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addBacktestSymbol()}});$('backtestSymbol').addEventListener('change',()=>{populateBacktestSymbols();if(!$('backtestForwardPanel').hidden)executeStrategyProjection()});$('backtestStrategy').addEventListener('change',()=>{syncBacktestStrategyUI();if(!$('backtestForwardPanel').hidden)executeStrategyProjection()});$('botStrategy').addEventListener('change',syncBotStrategyHelp);syncBacktestStrategyUI();loadStrategyCatalog();
$('refreshAlpaca').addEventListener('click',refreshAlpaca);$('alpacaSide').addEventListener('change',updateAlpacaOrderFields);$('alpacaType').addEventListener('change',updateAlpacaOrderFields);$('alpacaOrderForm').addEventListener('submit',submitAlpacaOrder);updateAlpacaOrderFields();
$('botStart').addEventListener('click',startAutoBot);$('botStop').addEventListener('click',stopAutoBot);$('botSymbolAdd').addEventListener('click',addBotSymbol);$('botSymbolSearch').addEventListener('input',event=>renderBotSymbolSuggestions(event.target.value));$('botSymbolSearch').addEventListener('keydown',event=>{if(event.key!=='Enter')return;const first=$('botSymbolSuggestions').querySelector('[data-bot-suggest]');if(first){event.preventDefault();$('botSymbolSearch').value=first.dataset.botSuggest;renderBotSymbolSuggestions('')}});$('botSymbolSuggestions').addEventListener('click',event=>{const option=event.target.closest('[data-bot-suggest]');if(!option)return;$('botSymbolSearch').value=option.dataset.botSuggest;renderBotSymbolSuggestions('');$('botSymbolSearch').focus()});document.addEventListener('click',event=>{if(!event.target.closest('.bot-symbol-search-wrap'))renderBotSymbolSuggestions('')});$('botSymbolList').addEventListener('click',event=>{const button=event.target.closest('[data-remove-bot-symbol]');if(!button)return;renderBotSymbols(botSelectedSymbols.filter(symbol=>symbol!==button.dataset.removeBotSymbol))});$('botSymbolList').addEventListener('change',event=>{const select=event.target.closest('[data-bot-strategy-symbol]');if(!select)return;botSelectedStrategies[select.dataset.botStrategySymbol]=select.value;try{localStorage.setItem(BOT_STRATEGIES_KEY,JSON.stringify(botSelectedStrategies))}catch(_){}});let storedBotSymbols=null,storedBotStrategies={};try{storedBotSymbols=JSON.parse(localStorage.getItem(BOT_SYMBOLS_KEY)||'null');storedBotStrategies=JSON.parse(localStorage.getItem(BOT_STRATEGIES_KEY)||'{}')||{}}catch(_){}renderBotSymbols(storedBotSymbols||['AAPL'],!!storedBotSymbols,storedBotStrategies);let alpacaPollCount=0;setInterval(()=>{if(state.view==='trading'){refreshAutoBot();if(++alpacaPollCount%6===0)refreshAlpaca()}},10000);
const strategyPlanStorageKey='signal_analysis_strategy_plan_v2';$('strategyPlanSelect').addEventListener('change',e=>{try{localStorage.setItem(strategyPlanStorageKey,e.currentTarget.value)}catch(_){}if(state.history)update(state.history,state.symbol)});
document.querySelectorAll('.nav-item[data-view]').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();const hash=link.getAttribute('href');history.replaceState(null,'',hash);showView(link.dataset.view,hash);if(link.dataset.planUniverse)selectPlanUniverse(link.dataset.planUniverse)}));
  $('plansList').addEventListener('click',e=>{const add=e.target.closest('.lot-add');if(add){const box=add.closest('.owned-position'),symbol=box.dataset.symbol,plan=state.planCandidates.find(x=>x.symbol===symbol),currency=escapeHtml(plan?.currency||'USD'),list=box.querySelector('.buy-lots'),i=list.children.length+1,row=document.createElement('div');row.className='buy-lot';row.innerHTML=`<b>ไม้ที่ ${i}</b><label>เงินที่ซื้อ (${currency})<input type="number" min="0" step="any" data-lot-amount placeholder="เช่น 1000"></label><label>ราคาต่อหุ้น (${currency})<input type="number" min="0" step="any" data-lot-price placeholder="เช่น 150.50"></label><button type="button" class="lot-remove" title="ลบไม้นี้" aria-label="ลบไม้นี้">×</button>`;list.append(row);return}const removeLot=e.target.closest('.lot-remove');if(removeLot){removeLot.closest('.buy-lot').remove();return}const save=e.target.closest('.position-save');if(save){const card=save.closest('.plan-card'),rows=[...card.querySelectorAll('.buy-lot')],lots=[];for(const row of rows){const rawAmount=row.querySelector('[data-lot-amount]').value.trim(),rawPrice=row.querySelector('[data-lot-price]').value.trim();if(!rawAmount&&!rawPrice)continue;const amount=Number(rawAmount),price=Number(rawPrice);if(!(amount>0&&price>0&&Number.isFinite(amount)&&Number.isFinite(price))){toast('กรอกยอดซื้อและราคาต่อหุ้นให้ครบทุกไม้');return}lots.push({amount,price})}if(!lots.length){toast('กรอกข้อมูลซื้ออย่างน้อย 1 ไม้');return}state.positions[save.dataset.symbol]=lots;persistPositions();renderPlanCards();toast(`บันทึกข้อมูลซื้อ ${save.dataset.symbol} ${lots.length} ไม้แล้ว`);return}const clear=e.target.closest('.position-clear');if(clear){delete state.positions[clear.dataset.symbol];persistPositions();renderPlanCards();toast(`ลบรายการซื้อ ${clear.dataset.symbol} แล้ว`);return}const button=e.target.closest('.plan-view');if(!button)return;const symbol=button.dataset.symbol;history.replaceState(null,'','#analysis');showView('analysis','#analysis');loadSymbol(symbol)});
const chartSvgRoot=$('priceChart');
chartSvgRoot.addEventListener('pointerdown',e=>{if(e.button!==0||!state.chartView)return;const rect=chartSvgRoot.getBoundingClientRect();state.drag={pointerId:e.pointerId,startX:e.clientX,pan:state.pan,total:state.chartView.total,count:state.chartView.visibleCount,plotW:state.chartView.plotW,rectWidth:rect.width,moved:false};chartSvgRoot.setPointerCapture(e.pointerId)});
chartSvgRoot.addEventListener('pointermove',e=>{
  if(state.drag&&state.drag.pointerId===e.pointerId){const d=state.drag,dx=e.clientX-d.startX;if(Math.abs(dx)>3)d.moved=true;if(d.moved){const barDelta=Math.round(dx/d.rectWidth*900/d.plotW*d.count);state.pan=Math.max(0,Math.min(d.total-d.count,d.pan+barDelta));chartSvgRoot.classList.add('dragging');redrawChart()}return}
  showChartHover(e);
});
function endChartDrag(e){if(!state.drag||state.drag.pointerId!==e.pointerId)return;const moved=state.drag.moved;state.drag=null;chartSvgRoot.classList.remove('dragging');if(moved){persistChartView();$('chartTooltip').style.display='none'}else showChartHover(e)}
chartSvgRoot.addEventListener('pointerup',endChartDrag);chartSvgRoot.addEventListener('pointercancel',endChartDrag);
chartSvgRoot.addEventListener('pointerleave',()=>{if(!state.drag){$('chartTooltip').style.display='none';chartSvgRoot.querySelector('#hoverCrossV')?.setAttribute('opacity','0');chartSvgRoot.querySelector('#hoverCrossH')?.setAttribute('opacity','0')}});
chartSvgRoot.addEventListener('wheel',e=>{if(!state.chartView)return;e.preventDefault();const view=state.chartView,rect=chartSvgRoot.getBoundingClientRect(),vx=(e.clientX-rect.left)/rect.width*900,fraction=Math.max(0,Math.min(1,(vx-view.left)/view.plotW));const count=Math.max(Math.min(12,view.total),Math.min(view.total,Math.round(view.visibleCount*Math.exp(e.deltaY*.0012))));if(count===view.visibleCount)return;const anchor=view.start+fraction*(view.visibleCount-1),start=Math.max(0,Math.min(view.total-count,Math.round(anchor-fraction*(count-1))));state.zoom=view.total/count;state.pan=view.total-start-count;redrawChart();persistChartView()},{passive:false});
function zoomChart(multiplier){const view=state.chartView;if(!view)return;const fraction=.5,count=Math.max(Math.min(12,view.total),Math.min(view.total,Math.round(view.visibleCount/multiplier)));if(count===view.visibleCount)return;const anchor=view.start+fraction*(view.visibleCount-1),start=Math.max(0,Math.min(view.total-count,Math.round(anchor-fraction*(count-1))));state.zoom=view.total/count;state.pan=view.total-start-count;redrawChart();persistChartView()}
$('zoomIn').addEventListener('click',()=>zoomChart(1.4));$('zoomOut').addEventListener('click',()=>zoomChart(1/1.4));$('zoomReset').addEventListener('click',()=>{state.zoom=1;state.pan=0;redrawChart();persistChartView();$('chartTooltip').style.display='none'});
$('todayDate').textContent=new Date().toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const thaiNow=bkkNowParts();$('taAsOfDate').max=`${thaiNow.day}T${thaiNow.time}`;$('taAsOfDay').max=thaiNow.day;
$('runTaScreener').addEventListener('click',scanSp500Technical);$('taScreenerRows').addEventListener('click',e=>{const button=e.target.closest('[data-ta-screener-symbol]');if(!button)return;$('sp500Search').value=button.dataset.taScreenerSymbol;renderSp500Search();$('sp500SearchResults').hidden=true;state.planVisibleLimit=50;renderPlanCards();$('plansList').scrollIntoView({behavior:'smooth',block:'start'})});
document.querySelectorAll('[data-pivot-timeframe]').forEach(button=>button.addEventListener('click',()=>{state.pivotTimeframe=button.dataset.pivotTimeframe;state.pivotRows=null;state.pivotPendingKey=null;state.pivotRequestId++;document.querySelectorAll('[data-pivot-timeframe]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active))});if(state.history)renderPivotTable(state.history)}));
const pivotAsOf=$('pivotAsOf'),pivotNow=bkkNowParts();pivotAsOf.max=`${pivotNow.day}T${pivotNow.time}`;pivotAsOf.addEventListener('change',()=>{state.pivotRows=null;state.pivotPendingKey=null;state.pivotRequestId++;if(state.history)renderPivotTable(state.history)});$('pivotLatest').addEventListener('click',()=>{pivotAsOf.value='';state.pivotRows=null;state.pivotPendingKey=null;state.pivotRequestId++;if(state.history)renderPivotTable(state.history)});
updatePlanUniverseUI();
restoreWatchlist();
restorePositions();
restoreChartViews();applyChartView(state.symbol);restoreSignalSnapshots();restorePlanTracking();renderPlanAlerts();
loadSymbol(state.symbol).then(()=>updateWatchPrices());
