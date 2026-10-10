(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const SIGNAL_STRENGTH = { "패닉셀": 4, "급락": 3, "조정": 2, "단기조정": 1 };
  const MACRO_NAMES = ["나스닥-100", "S&P 500", "미국 2년물 금리", "미국 10년물 금리", "VIX", "금", "원·달러 환율", "비트코인"];

  let latestData = {};
  let signals = [];
  let historyRecords = [];
  let selectedTicker = null;
  let chartPeriod = 90;
  let resizeTimer = null;
  let favorites = new Set();

  function number(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    if (typeof v === "string" && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function fmt(v, digits = 2) {
    const n = number(v);
    return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });
  }
  function signed(v, digits = 2, suffix = "%") {
    const n = number(v);
    return n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
  }
  function safe(v) {
    return String(v ?? "—").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function validDate(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function normalizeTicker(v) {
    if (typeof v !== "string") return "";
    return v.trim().toUpperCase();
  }
  function normalizeSignal(raw) {
    if (!isObject(raw)) return null;
    const ticker = normalizeTicker(raw.ticker);
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const signal = typeof raw.signal === "string" ? raw.signal.trim() : "";
    const close = number(raw.close), drawdown = number(raw.drawdown), rsi14 = number(raw.rsi14);
    if (!/^[A-Z0-9.^_-]{1,20}$/.test(ticker) || !name || name.length > 200) return null;
    if (!Object.prototype.hasOwnProperty.call(SIGNAL_STRENGTH, signal)) return null;
    if (!validDate(raw.date) || close === null || close <= 0) return null;
    if (drawdown === null || drawdown > 0 || drawdown < -100) return null;
    if (rsi14 === null || rsi14 < 0 || rsi14 > 100) return null;
    return { ...raw, ticker, name, signal, close, drawdown, rsi14, date: raw.date };
  }
  function normalizePriceRows(source) {
    if (!Array.isArray(source)) return [];
    const map = new Map();
    for (const row of source) {
      if (!isObject(row) || !validDate(row.date) || map.has(row.date)) continue;
      const open = number(row.open), high = number(row.high), low = number(row.low), close = number(row.close), volume = number(row.volume);
      if ([open, high, low, close].some(v => v === null || v <= 0)) continue;
      if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) continue;
      if (volume !== null && volume < 0) continue;
      map.set(row.date, { date: row.date, open, high, low, close, volume: volume ?? 0 });
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  function validateLatestData(raw) {
    if (!isObject(raw)) throw new Error("최신 데이터가 JSON 객체가 아닙니다.");
    if (!Array.isArray(raw.signals)) throw new Error("signals 배열이 없거나 잘못되었습니다.");
    if (raw.price_history !== undefined && !isObject(raw.price_history)) throw new Error("price_history 형식 오류");
    if (raw.macro !== undefined && !isObject(raw.macro)) throw new Error("macro 형식 오류");
    if (raw.macro_history !== undefined && !isObject(raw.macro_history)) throw new Error("macro_history 형식 오류");
    const seen = new Set(), cleanSignals = [];
    for (const rawItem of raw.signals) {
      const item = normalizeSignal(rawItem);
      if (!item || seen.has(item.ticker)) continue;
      seen.add(item.ticker);
      cleanSignals.push(item);
    }
    return { ...raw, signals: cleanSignals, price_history: raw.price_history || {}, macro: raw.macro || {}, macro_history: raw.macro_history || {} };
  }
  function showPage(name) {
    $$(".tabs [data-page]").forEach(b => b.classList.toggle("active", b.dataset.page === name));
    $$(".page").forEach(p => p.classList.toggle("active", p.id === `page-${name}`));
    if (name === "detail") requestAnimationFrame(drawStockChart);
  }
  function renderMetricCard(label, value, note = "") {
    return `<article class="metric"><span>${safe(label)}</span><b>${safe(value)}</b><small>${safe(note)}</small></article>`;
  }
  function getPriceRows(ticker) { return normalizePriceRows(latestData.price_history?.[ticker]); }

  // 시장 요약: 원본 데이터가 검증된 경우에만 표시
  function renderMacro(data) {
    const macro = data.macro || {}, values = macro.values || {}, histories = data.macro_history || {};
    $("#marketState").innerHTML = `<div class="state-title">시장 상태</div><h3>${safe(macro.state || "분석 데이터 대기")}</h3><p>${safe(macro.reason || "시장 지표 연결 대기 중입니다.")}</p>`;
    $("#macroMetrics").innerHTML = MACRO_NAMES.map((name, i) => {
      const raw = values[name], value = isObject(raw) ? raw.value : raw;
      const date = isObject(raw) && validDate(raw.updated_at) ? raw.updated_at : "데이터 미확인";
      const suffix = name.includes("금리") ? "%" : name === "VIX" ? "pt" : "";
      const n = number(value);
      return `<article class="metric macro-card"><span>${safe(name)}</span><b>${n === null ? "—" : safe(fmt(n) + suffix)}</b><small>${safe(date)}</small><div class="macro-chart-wrap"><canvas id="macroChart${i}" class="macro-chart" aria-label="${safe(name)} 최근 30일 추이"></canvas></div><div class="macro-range">최근 30일</div></article>`;
    }).join("");
    MACRO_NAMES.forEach((name, i) => drawMacroChart($(`#macroChart${i}`), histories[name] || []));
  }
  function drawMacroChart(canvas, source) {
    if (!canvas) return;
    const rows = (Array.isArray(source) ? source : []).filter(r => isObject(r) && validDate(r.date) && number(r.close) !== null).sort((a,b) => a.date.localeCompare(b.date));
    const last = rows.length ? new Date(`${rows[rows.length - 1].date}T12:00:00Z`) : null;
    const start = last ? new Date(last.getTime() - 30 * 86400000) : null;
    const visible = start ? rows.filter(r => { const d = new Date(`${r.date}T12:00:00Z`); return d >= start && d <= last; }) : [];
    const dpr = Math.max(1, window.devicePixelRatio || 1), w = Math.max(120, canvas.clientWidth || 200), h = 62;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    if (visible.length < 2) { ctx.fillStyle="#98a2b3"; ctx.font="11px sans-serif"; ctx.fillText("최근 한 달 데이터 부족",4,22); return; }
    const vals = visible.map(r => number(r.close)); let min = Math.min(...vals), max = Math.max(...vals);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (min === max) { const p = Math.abs(max)*.01 || 1; min -= p; max += p; }
    ctx.strokeStyle="#eaecf0"; ctx.lineWidth=1;
    for(let i=0;i<=2;i++){ const y=4+(h-8)*i/2; ctx.beginPath();ctx.moveTo(3,y);ctx.lineTo(w-3,y);ctx.stroke(); }
    ctx.beginPath(); vals.forEach((v,i)=>{const x=3+i/(vals.length-1)*(w-6),y=4+(max-v)/(max-min)*(h-8); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
    ctx.strokeStyle="#3b5fe5";ctx.lineWidth=1.7;ctx.lineJoin="round";ctx.stroke();
  }

  // 스캐너
  function renderSignals() {
    const search = (($("#search")?.value) || "").trim().toLowerCase();
    const filter = $("#signalFilter")?.value || "all", sort = $("#sort")?.value || "strength";
    const filtered = signals.filter(x => `${x.ticker} ${x.name}`.toLowerCase().includes(search) && (filter === "all" || x.signal === filter));
    filtered.sort((a,b) => sort === "ticker" ? a.ticker.localeCompare(b.ticker) : sort === "drop" ? a.drawdown-b.drawdown : (SIGNAL_STRENGTH[b.signal]||0)-(SIGNAL_STRENGTH[a.signal]||0));
    $("#scanCount").textContent = `${filtered.length}개 신호`;
    if (!filtered.length) { $("#signalList").innerHTML = '<div class="panel">조건에 맞는 유효한 신호가 없습니다.</div>'; return; }
    $("#signalList").innerHTML = filtered.map(x => `<article class="panel signal signal-clickable" data-ticker="${safe(x.ticker)}" tabindex="0" role="button"><strong>${safe(x.ticker)} · ${safe(x.name)}</strong><b>${safe(x.signal)}</b><p>종가 ${fmt(x.close)} · 고점 대비 ${fmt(x.drawdown)}%</p><small>RSI ${fmt(x.rsi14)} · 기준일 ${safe(x.date)}</small><div class="card-hint">상세 차트 보기 →</div></article>`).join("");
    $$("#signalList [data-ticker]").forEach(card => { const open=()=>openDetail(card.dataset.ticker); card.addEventListener("click",open); card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}}); });
  }
  function movingAverage(rows, period) {
    return rows.map((_, i) => {
      if (i + 1 < period) return null;
      const slice = rows.slice(i-period+1,i+1);
      if (slice.length !== period || slice.some(r => number(r.close) === null)) return null;
      return slice.reduce((s,r)=>s+r.close,0)/period;
    });
  }
  function calculateRSI(rows, period=14) {
    const out=Array(rows.length).fill(null); if(!Number.isInteger(period)||period<1||rows.length<=period)return out;
    let gains=0,losses=0;
    for(let i=1;i<=period;i++){const d=rows[i].close-rows[i-1].close;gains+=Math.max(0,d);losses+=Math.max(0,-d);}
    let ag=gains/period, al=losses/period;
    const value=()=>al===0?(ag===0?50:100):100-100/(1+ag/al);
    out[period]=value();
    for(let i=period+1;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;ag=(ag*(period-1)+Math.max(0,d))/period;al=(al*(period-1)+Math.max(0,-d))/period;out[i]=value();}
    return out;
  }
  function getCompanyMeta(item) {
    const meta = latestData.company_info?.[item.ticker] || latestData.stock_info?.[item.ticker] || {};
    const price = number(meta.current_price ?? meta.price ?? item.current_price ?? item.close);
    const change = number(meta.change ?? meta.price_change ?? item.change);
    const changePct = number(meta.change_percent ?? meta.change_pct ?? item.change_percent ?? item.change_pct);
    const cap = number(meta.market_cap ?? item.market_cap);
    const sector = meta.sector || item.sector || "섹터 미확인";
    const exchange = meta.index || meta.exchange || item.index || "나스닥-100";
    return { meta, price, change, changePct, cap, sector, exchange };
  }
  function moneyCap(v) {
    const n=number(v); if(n===null||n<0)return "미확인";
    if(n>=1e12)return `${(n/1e12).toFixed(2)}조 달러`;
    if(n>=1e9)return `${(n/1e9).toFixed(2)}B 달러`;
    if(n>=1e6)return `${(n/1e6).toFixed(2)}M 달러`;
    return `${fmt(n,0)} 달러`;
  }
  function metricTile(label, value, tone="neutral", icon="•") {
    return `<article class="sd-metric"><div class="sd-metric-head"><span>${safe(label)}</span><i class="sd-icon ${safe(tone)}">${safe(icon)}</i></div><b class="${safe(tone)}">${safe(value)}</b></article>`;
  }
  function openDetail(ticker) {
    const item=signals.find(x=>x.ticker===ticker); if(!item)return;
    selectedTicker=ticker; chartPeriod=90;
    const title=$("#detailTitle"); if(title)title.textContent=`${item.ticker} · ${item.name}`;
    renderDetail(item); showPage("detail"); requestAnimationFrame(drawStockChart);
  }
  function renderDetail(item) {
    const rows=getPriceRows(item.ticker), last=rows[rows.length-1], i=rows.length-1;
    const ma20=movingAverage(rows,20), ma50=movingAverage(rows,50), ma200=movingAverage(rows,200), rsi=calculateRSI(rows,14);
    const rsi5=calculateRSI(rows,5);
    const meta=getCompanyMeta(item);
    const basePrice=meta.price;
    const prevPrice=rows.length>1?rows[rows.length-2].close:null;
    const derivedChange=basePrice!==null&&prevPrice!==null?basePrice-prevPrice:null;
    const derivedPct=derivedChange!==null&&prevPrice>0?derivedChange/prevPrice*100:null;
    const change=meta.change!==null?meta.change:derivedChange;
    const changePct=meta.changePct!==null?meta.changePct:derivedPct;
    const currentRsi=number(rsi[i]);
    const rsi5Change=(i>=5&&rsi5[i]!==null&&rsi5[i-5]!==null)?rsi5[i]-rsi5[i-5]:null;
    const high60=rows.slice(-60).reduce((m,r)=>Math.max(m,r.high),0);
    const low20=rows.slice(-20).reduce((m,r)=>Math.min(m,r.low),Infinity);
    const drawdown60=high60>0&&basePrice!==null?(basePrice/high60-1)*100:null;
    const fromLow20=Number.isFinite(low20)&&low20>0&&basePrice!==null?(basePrice/low20-1)*100:null;
    const ma20Gap=ma20[i]&&basePrice!==null?(basePrice/ma20[i]-1)*100:null;
    const ma50Gap=ma50[i]&&basePrice!==null?(basePrice/ma50[i]-1)*100:null;
    const ma200Gap=ma200[i]&&basePrice!==null?(basePrice/ma200[i]-1)*100:null;
    const avgVol=rows.length>=20?rows.slice(-20).reduce((s,r)=>s+r.volume,0)/20:null;
    const volumeRatio=avgVol>0&&last?last.volume/avgVol:null;
    const downTone=v=>number(v)===null?"neutral":v<0?"negative":"positive";
    const rsiTone=v=>number(v)===null?"neutral":v<30?"positive":v>70?"negative":"blue";
    const memoDate=last?.date || item.date;
    const positive=[]; const caution=[]; const watch=[];
    if(currentRsi!==null&&currentRsi>=(rsi[i-5]??currentRsi))positive.push("RSI 반등 또는 유지");
    if(volumeRatio!==null&&volumeRatio>1.2)positive.push(`거래량 평균 대비 ${volumeRatio.toFixed(2)}배`);
    if(fromLow20!==null&&fromLow20>0)positive.push(`20일 저점 대비 ${signed(fromLow20)}`);
    if(ma50Gap!==null&&ma50Gap<0)caution.push("MA50 아래에서 거래 중");
    if(ma200Gap!==null&&ma200Gap<0)caution.push("MA200 아래에서 거래 중");
    if(currentRsi!==null&&currentRsi<30)caution.push("RSI 과매도 구간");
    if(!positive.length)positive.push("유효한 단기 반등 근거 부족");
    if(!caution.length)caution.push("주요 이동평균 이격도 확인");
    watch.push("20일 이동평균선 회복 여부", "다음 실적 발표 및 공시 일정");
    const storedMemo=meta.memo || item.memo || "";
    const memoText=storedMemo || `${drawdown60!==null?`60일 고점 대비 ${Math.abs(drawdown60).toFixed(1)}% 조정 구간입니다. `:""}${currentRsi!==null?`RSI(14)는 ${currentRsi.toFixed(1)}입니다. `:""}${volumeRatio!==null?`거래량은 20일 평균 대비 ${volumeRatio.toFixed(2)}배입니다. `:""}${ma50Gap!==null&&ma200Gap!==null?`MA50 대비 ${ma50Gap.toFixed(1)}%, MA200 대비 ${ma200Gap.toFixed(1)}%입니다. 추가 추세 확인이 필요합니다.`:"지표 데이터가 충분하지 않아 관찰이 필요합니다."}`;
    const favorite=favorites.has(item.ticker);
    const priceText=basePrice===null?"—":`$${fmt(basePrice)}`;
    const changeText=change===null&&changePct===null?"등락 데이터 미확인":`${change===null?"":`${change>0?"+":""}${fmt(change)}`} ${changePct===null?"":`(${signed(changePct)})`}`.trim();
    const changeClass=changePct===null?"neutral":changePct<0?"negative":"positive";
    $("#detailBody").innerHTML=`
      <div class="sd-detail">
        <div class="sd-back-row"><button type="button" id="sdBack" class="sd-back">← 목록으로 돌아가기</button><button type="button" id="sdFavorite" class="sd-favorite ${favorite?"is-favorite":""}" aria-label="관심 종목">${favorite?"★":"☆"}</button></div>
        <section class="sd-identity">
          <div class="sd-logo">${safe(item.ticker.slice(0,1))}</div>
          <div class="sd-name"><h2>${safe(item.ticker)}</h2><p>${safe(meta.meta.company_name || item.name)}</p></div>
          <div class="sd-tags"><span>${safe(meta.sector)}</span><span>${safe(meta.exchange)}</span></div>
        </section>
        <section class="sd-price-row"><div><div class="sd-price">${safe(priceText)} <span class="${changeClass}">${safe(changeText)}</span></div><div class="sd-price-date">${safe(last?.date || item.date)} · USD</div></div><div class="sd-signal"><small>신호</small><b>${safe(item.signal)}</b></div></section>
        <section class="sd-chart-card">
          <div class="sd-chart-controls"><div class="sd-periods"><button data-period="30">1개월</button><button data-period="90" class="active">3개월</button><button data-period="180">6개월</button><button data-period="365">1년</button></div><div class="sd-legend"><span class="ma20-label">● MA20</span><span class="ma50-label">● MA50</span><span class="ma200-label">● MA200</span></div></div>
          <div id="chartMessage" class="muted chart-message"></div><div class="detail-canvas-wrap"><canvas id="priceChart" aria-label="캔들스틱 및 거래량 차트"></canvas></div>
        </section>
        <section class="sd-metrics">
          ${metricTile("60일 고점 대비",signed(drawdown60),downTone(drawdown60),"↓")}
          ${metricTile("RSI (14)",fmt(currentRsi,1),rsiTone(currentRsi),"∿")}
          ${metricTile("RSI 5일 변화",signed(rsi5Change),downTone(rsi5Change),"↑")}
          ${metricTile("20일 저점 대비",signed(fromLow20),downTone(fromLow20),"↑")}
          ${metricTile("MA20 대비",signed(ma20Gap),downTone(ma20Gap),"↘")}
          ${metricTile("MA50 대비",signed(ma50Gap),downTone(ma50Gap),"↘")}
          ${metricTile("MA200 대비",signed(ma200Gap),downTone(ma200Gap),"↘")}
          ${metricTile("거래량 / 20일 평균",volumeRatio===null?"—":`${volumeRatio.toFixed(2)}배`,volumeRatio!==null&&volumeRatio>1?"blue":"neutral","▥")}
          ${metricTile("시가총액",moneyCap(meta.cap),"neutral","▦")}
        </section>
        <section class="sd-memo"><header><strong>▤　관찰 메모</strong><time>${safe(memoDate)} 기준</time></header><p>${safe(memoText)}</p><div class="sd-factor positive"><b>⬆　긍정 요인</b><span>${safe(positive.join(" · "))}</span></div><div class="sd-factor negative"><b>⬇　주의 요인</b><span>${safe(caution.join(" · "))}</span></div><div class="sd-factor neutral"><b>⊙　관찰 포인트</b><span>${safe(watch.join(" · "))}</span></div><small class="sd-disclaimer">자동 계산 참고 정보이며 매수·매도 추천이 아닙니다. 누락된 데이터는 임의 추정하지 않습니다.</small></section>
      </div>`;
    $("#sdBack").addEventListener("click",()=>showPage("scanner"));
    $("#sdFavorite").addEventListener("click",()=>{
      if(favorites.has(item.ticker))favorites.delete(item.ticker);else favorites.add(item.ticker);
      try{localStorage.setItem("hyeonu-stock-favorites",JSON.stringify([...favorites]));}catch(_e){}
      const b=$("#sdFavorite");if(b){b.textContent=favorites.has(item.ticker)?"★":"☆";b.classList.toggle("is-favorite",favorites.has(item.ticker));}
    });
    $$(".sd-periods [data-period]").forEach(b=>b.addEventListener("click",()=>{
      const n=Number(b.dataset.period);if(![30,90,180,365].includes(n))return;
      chartPeriod=n;$$(".sd-periods button").forEach(x=>x.classList.toggle("active",x===b));drawStockChart();
    }));
    requestAnimationFrame(drawStockChart);
  }
  function drawStockChart() {
    if(!selectedTicker)return;
    const all=getPriceRows(selectedTicker), rows=all.slice(-chartPeriod), canvas=$("#priceChart");
    if(!canvas)return;
    const dpr=Math.max(1,window.devicePixelRatio||1), width=Math.max(280,canvas.clientWidth||320), height=285;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.height=`${height}px`;
    const ctx=canvas.getContext("2d");if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const message=$("#chartMessage");
    if(!rows.length){ctx.fillStyle="#667085";ctx.font="13px sans-serif";ctx.fillText("가격 데이터가 없습니다.",8,25);if(message)message.textContent="저장된 가격 기록 없음";return;}
    const left=4,right=43,top=6,bottom=20,separator=height*.70,volumeTop=separator+13,volumeBottom=height-bottom,plotW=width-left-right,plotH=separator-top-6,offset=all.length-rows.length;
    const ma20=movingAverage(all,20).slice(offset),ma50=movingAverage(all,50).slice(offset),ma200=movingAverage(all,200).slice(offset);
    const prices=[];rows.forEach(r=>prices.push(r.high,r.low));[ma20,ma50,ma200].forEach(s=>s.forEach(v=>{if(v!==null&&Number.isFinite(v))prices.push(v);}));
    let min=Math.min(...prices),max=Math.max(...prices);if(!Number.isFinite(min)||!Number.isFinite(max)){if(message)message.textContent="가격 데이터를 검증할 수 없습니다.";return;}
    const pad=(max-min||Math.abs(max)*.04||1)*.04;min-=pad;max+=pad;const y=v=>top+(max-v)/(max-min)*plotH,step=plotW/rows.length,candleW=Math.max(1,Math.min(8,step*.65));
    ctx.font="10px sans-serif";ctx.textAlign="right";ctx.textBaseline="middle";
    for(let i=0;i<=4;i++){const val=min+(max-min)*i/4,yy=top+plotH*(1-i/4);ctx.strokeStyle="#eaecf0";ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();ctx.fillStyle="#667085";ctx.fillText(fmt(val,1),width-2,yy);}
    rows.forEach((r,i)=>{const x=left+step*(i+.5),up=r.close>=r.open,color=up?"#16845b":"#c03939";ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y(r.high));ctx.lineTo(x,y(r.low));ctx.stroke();const a=y(Math.max(r.open,r.close)),b=y(Math.min(r.open,r.close));ctx.fillRect(x-candleW/2,a,candleW,Math.max(1,b-a));});
    function drawMA(series,color){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.2;let started=false;series.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){started=false;return;}const x=left+step*(i+.5);if(!started){ctx.moveTo(x,y(v));started=true;}else ctx.lineTo(x,y(v));});ctx.stroke();}
    drawMA(ma20,"#356ae6");drawMA(ma50,"#e69b27");drawMA(ma200,"#8b5cf6");
    ctx.strokeStyle="#d0d5dd";ctx.beginPath();ctx.moveTo(left,separator);ctx.lineTo(width-right,separator);ctx.stroke();ctx.fillStyle="#667085";ctx.font="10px sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";ctx.fillText("거래량",left,separator+7);
    const maxVol=Math.max(1,...rows.map(r=>r.volume||0)),volH=volumeBottom-volumeTop;
    rows.forEach((r,i)=>{const x=left+step*(i+.5),bh=(r.volume||0)/maxVol*volH;ctx.fillStyle=r.close>=r.open?"#16845b":"#c03939";ctx.fillRect(x-candleW/2,volumeBottom-bh,Math.max(1,candleW),bh);});
    ctx.textBaseline="bottom";ctx.textAlign="left";ctx.fillStyle="#667085";ctx.fillText(rows[0].date.slice(5),left,height-1);ctx.textAlign="right";ctx.fillText(rows[rows.length-1].date.slice(5),width-right,height-1);
    if(message)message.textContent=`${rows.length}개 거래일 · ${rows[0].date} ~ ${rows[rows.length-1].date}`;
  }

  // 이력 및 성과: 미래 구간이 없으면 미확정으로 분리
  function calculatePerformance() {
    const targets=[5,10,20],entries=[],seen=new Set();
    for(const record of historyRecords){
      if(!isObject(record)||!Array.isArray(record.signals))continue;
      for(const raw of record.signals){
        if(!isObject(raw))continue;
        const ticker=normalizeTicker(raw.ticker),date=raw.date||record.scan_date||record.date,signal=String(raw.signal||"");
        if(!ticker||!validDate(date))continue;
        const key=`${ticker}|${date}|${signal}`;if(seen.has(key))continue;seen.add(key);
        const rows=getPriceRows(ticker),signalIndex=rows.findIndex(r=>r.date>=date);if(signalIndex<0)continue;
        const entry=rows[signalIndex+1];if(!entry||entry.open<=0)continue;
        const item={ticker,signal,date,entryDate:entry.date};
        targets.forEach(days=>{const exit=rows[signalIndex+days+1];item[days]=exit?(exit.close/entry.open-1)*100:null;});entries.push(item);
      }
    }
    $("#performanceSummary").innerHTML=targets.map(days=>{const known=entries.filter(x=>x[days]!==null&&Number.isFinite(x[days])),wins=known.filter(x=>x[days]>0).length,avg=known.length?known.reduce((s,x)=>s+x[days],0)/known.length:null;return `<article class="metric"><span>${days}거래일</span><b>${avg===null?"—":signed(avg)}</b><small>승률 ${known.length?(wins/known.length*100).toFixed(1)+"%":"—"} · 확정 ${known.length} · 미확정 ${entries.length-known.length}</small></article>`;}).join("");
    if(!entries.length){$("#historyList").innerHTML='<p class="muted">성과를 계산할 신호 기록이 없습니다.</p>';return;}
    $("#historyList").innerHTML=entries.slice().reverse().slice(0,100).map(x=>{const results=targets.map(d=>`${d}일 ${x[d]===null?"미확정":signed(x[d])}`).join(" · ");return `<div class="panel history-row"><strong>${safe(x.ticker)} · ${safe(x.signal)}</strong><div class="muted">신호일 ${safe(x.date)} · 진입일 ${safe(x.entryDate)}</div><p>${safe(results)}</p></div>`;}).join("");
  }
  async function loadHistory() {
    try {
      const response=await fetch(`./data/signal_history.json?t=${Date.now()}`,{cache:"no-store"});if(!response.ok)throw new Error("이력 파일 HTTP 오류");
      const raw=await response.json();historyRecords=Array.isArray(raw)?raw:(isObject(raw)&&Array.isArray(raw.records)?raw.records:[]);calculatePerformance();
    } catch(e) { historyRecords=[];$("#historyList").textContent="이력을 불러오지 못했습니다.";console.error("[history]",e); }
  }
  async function refreshData() {
    const button=$("#refreshData");if(!button)return;button.disabled=true;button.textContent="불러오는 중…";
    try {
      const response=await fetch(`./data/latest.json?t=${Date.now()}`,{cache:"no-store"});if(!response.ok)throw new Error(`최신 데이터 HTTP ${response.status}`);
      const raw=await response.json();latestData=validateLatestData(raw);signals=latestData.signals;
      renderMacro(latestData);renderSignals();
      $("#updated").textContent="데이터 기준: "+(validDate(latestData.updated_at)?latestData.updated_at:(latestData.updated_at||"시각 미확인"));
      const meta=latestData.scan_meta||{};$("#scannerStatus").textContent=`검증 완료 · ${signals.length}개 유효 신호${meta.is_full_nasdaq100===false?" · 대체 종목 목록 사용":""}`;
      await loadHistory();button.textContent="✓ 갱신 완료";setTimeout(()=>{if(button.isConnected)button.textContent="↻ 새로고침";},1600);
    } catch(e) { $("#updated").textContent="데이터 불러오기 실패";$("#scannerStatus").textContent=`데이터 오류: ${e.message||"원인을 확인할 수 없습니다."}`;button.textContent="다시 시도";console.error("[data validation]",e); }
    finally { button.disabled=false; }
  }
  document.addEventListener("DOMContentLoaded",()=>{
    try { const stored=JSON.parse(localStorage.getItem("hyeonu-stock-favorites")||"[]");if(Array.isArray(stored))favorites=new Set(stored.filter(x=>typeof x==="string")); } catch(_e) { favorites=new Set(); }
    $$(".tabs [data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
    $("#backScanner")?.addEventListener("click",()=>showPage("scanner"));$("#refreshData")?.addEventListener("click",refreshData);
    ["search","signalFilter","sort"].forEach(id=>{const el=$("#"+id);el?.addEventListener("input",renderSignals);el?.addEventListener("change",renderSignals);});
    window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{MACRO_NAMES.forEach((name,i)=>drawMacroChart($(`#macroChart${i}`),latestData.macro_history?.[name]||[]));if(selectedTicker)drawStockChart();},120);});
    showPage("macro");refreshData();
  });
})();
