(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const SIGNAL_STRENGTH = { "패닉셀": 4, "급락": 3, "조정": 2, "단기조정": 1 };
  const MACRO_NAMES = ["나스닥-100", "S&P 500", "미국 2년물 금리", "미국 10년물 금리", "VIX", "금", "원·달러 환율", "비트코인"];
  let data = {};
  let signals = [];
  let history = [];
  let selectedTicker = null;
  let chartPeriod = 90;
  let resizeTimer;
  const num = v => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const fmt = (v, d = 2) => num(v) === null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
  const safe = v => String(v ?? "—").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function showPage(name) {
    $$(".tabs [data-page]").forEach(b => b.classList.toggle("active", b.dataset.page === name));
    $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + name));
    if (name === "detail") requestAnimationFrame(drawStockChart);
  }
  function renderMetricCard(label, value, note = "") {
    return `<article class="metric"><span>${safe(label)}</span><b>${safe(value)}</b><small>${safe(note)}</small></article>`;
  }
  // ── 시장 요약: 숫자와 최근 30일 차트를 같은 카드에 표시 ──
  function renderMacro() {
    const macro = data.macro || {};
    const values = macro.values || {};
    const histories = data.macro_history || {};
    $("#marketState").innerHTML = `
      <div class="state-title">MARKET OVERVIEW</div>
      <h3>${safe(macro.state || "분석 데이터 대기")}</h3>
      <p>${safe(macro.reason || "시장 지표 연결 대기 중입니다.")}</p>`;
    $("#macroMetrics").innerHTML = MACRO_NAMES.map((name, i) => {
      const item = values[name];
      const value = item && typeof item === "object" ? item.value : item;
      const date = item && typeof item === "object" ? item.updated_at || "" : "";
      const suffix = name.includes("금리") ? "%" : name === "VIX" ? "pt" : "";
      const rows = (histories[name] || []).filter(r => r.date && num(r.close) !== null).sort((a, b) => a.date.localeCompare(b.date));
      const latest = rows.length ? num(rows[rows.length - 1].close) : null;
      const previous = rows.length > 1 ? num(rows[rows.length - 2].close) : null;
      const change = latest !== null && previous !== null && previous !== 0 ? (latest / previous - 1) * 100 : null;
      return `<article class="metric macro-card">
        <span>${safe(name)}</span>
        <b>${value == null ? "—" : safe(fmt(value) + suffix)}</b>
        <small>${safe(date || "데이터 미확인")}${change === null ? "" : ` · ${change >= 0 ? "+" : ""}${fmt(change)}%`}</small>
        <div class="macro-chart-wrap"><canvas id="macroChart${i}" class="macro-chart" aria-label="${safe(name)} 최근 30일 추이"></canvas></div>
        <div class="macro-range">최근 30일</div>
      </article>`;
    }).join("");
    MACRO_NAMES.forEach((name, i) => drawMacroChart($(`#macroChart${i}`), histories[name] || []));
  }
  function drawMacroChart(canvas, source) {
    if (!canvas) return;
    const all = (Array.isArray(source) ? source : []).filter(r => r.date && num(r.close) !== null).sort((a, b) => a.date.localeCompare(b.date));
    const lastDate = all.length ? new Date(all[all.length - 1].date + "T12:00:00Z") : null;
    const start = lastDate ? new Date(lastDate.getTime() - 30 * 86400000) : null;
    const rows = start ? all.filter(r => {
      const d = new Date(r.date + "T12:00:00Z");
      return d >= start && d <= lastDate;
    }) : [];
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(120, canvas.clientWidth || 200);
    const h = 62;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (rows.length < 2) {
      ctx.fillStyle = "#98a2b3";
      ctx.font = "11px sans-serif";
      ctx.fillText("최근 한 달 데이터 부족", 4, 22);
      return;
    }
    const vals = rows.map(r => Number(r.close));
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= Math.abs(min) * .01 || 1; max += Math.abs(max) * .01 || 1; }
    const pad = 4, plotH = h - pad * 2, plotW = w - 6;
    const y = v => pad + (max - v) / (max - min) * plotH;
    ctx.strokeStyle = "#edf0f5";
    for (let i = 0; i < 3; i++) {
      const yy = pad + plotH * i / 2;
      ctx.beginPath(); ctx.moveTo(3, yy); ctx.lineTo(w - 3, yy); ctx.stroke();
    }
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = 3 + i / (vals.length - 1) * plotW;
      if (i === 0) ctx.moveTo(x, y(v)); else ctx.lineTo(x, y(v));
    });
    ctx.strokeStyle = "#3b5fe5";
    ctx.lineWidth = 1.7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  // ── 주가 데이터 공통 계산 ──
  function getPriceRows(ticker) {
    const source = data.price_history?.[ticker];
    if (!Array.isArray(source)) return [];
    return source.map(r => ({
      ...r,
      open: num(r.open), high: num(r.high), low: num(r.low),
      close: num(r.close), volume: num(r.volume) ?? 0
    })).filter(r => r.date && r.open !== null && r.high !== null && r.low !== null && r.close !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  function movingAverage(rows, period) {
    return rows.map((r, i) => i + 1 < period ? null :
      rows.slice(i - period + 1, i + 1).reduce((sum, x) => sum + x.close, 0) / period);
  }
  function calculateRSI(rows, period = 14) {
    const result = Array(rows.length).fill(null);
    if (rows.length <= period) return result;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = rows[i].close - rows[i - 1].close;
      gains += Math.max(0, d); losses += Math.max(0, -d);
    }
    let avgGain = gains / period, avgLoss = losses / period;
    const current = () => avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
    result[period] = current();
    for (let i = period + 1; i < rows.length; i++) {
      const d = rows[i].close - rows[i - 1].close;
      avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
      result[i] = current();
    }
    return result;
  }
  function sparklineSVG(values, color) {
    const vals = values.map(Number).filter(Number.isFinite);
    if (vals.length < 2) return `<span class="spark-empty">차트 데이터 부족</span>`;
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const points = vals.map((v, i) => `${(2 + i / (vals.length - 1) * 96).toFixed(1)},${(25 - (v - min) / (max - min) * 21).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 100 28" role="img" aria-label="최근 주가 추이"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  // ── 신호 스캐너: 카드형 디자인 ──
  function renderSignals() {
    const query = ($("#search").value || "").trim().toLowerCase();
    const filter = $("#signalFilter").value;
    const sort = $("#sort").value;
    const filtered = signals.filter(item =>
      `${item.ticker || ""} ${item.name || ""}`.toLowerCase().includes(query) &&
      (filter === "all" || item.signal === filter));
    filtered.sort((a, b) => {
      if (sort === "ticker") return String(a.ticker).localeCompare(String(b.ticker));
      if (sort === "drop") return Number(a.drawdown ?? 0) - Number(b.drawdown ?? 0);
      return (SIGNAL_STRENGTH[b.signal] || 0) - (SIGNAL_STRENGTH[a.signal] || 0);
    });
    $("#scanCount").textContent = `${filtered.length}개 신호`;
    if (!filtered.length) {
      $("#signalList").innerHTML = `<div class="panel empty-state"><strong>검색 결과가 없습니다</strong><p>검색어 또는 신호 필터를 변경해 주세요.</p></div>`;
      return;
    }
    $("#signalList").innerHTML = filtered.map(item => {
      const rows = getPriceRows(item.ticker);
      const recent = rows.slice(-30);
      const closes = recent.map(r => r.close);
      const trendUp = closes.length > 1 && closes.at(-1) >= closes[0];
      const tone = ({ "패닉셀": "panic", "급락": "drop", "조정": "correction", "단기조정": "short" })[item.signal] || "neutral";
      const last = rows.at(-1);
      const rsi = calculateRSI(rows).at(-1);
      const last20 = rows.slice(-20);
      const low20 = last20.length ? Math.min(...last20.map(r => r.low)) : null;
      const rebound = low20 > 0 && last ? (last.close / low20 - 1) * 100 : null;
      const volAvg = num(item.avg_volume20), vol = num(item.volume);
      const volRatio = volAvg > 0 && vol !== null ? vol / volAvg : null;
      return `<article class="signal-card signal-clickable" data-ticker="${safe(item.ticker)}" tabindex="0" role="button" aria-label="${safe(item.ticker)} 상세 보기">
        <div class="signal-card-top">
          <div class="ticker-mark">${safe((item.ticker || "?").slice(0, 2))}</div>
          <div class="signal-identity"><strong>${safe(item.ticker)}</strong><span>${safe(item.name || item.ticker)}</span><small>${safe(last?.date || item.date || "기준일 미확인")}</small></div>
          <span class="signal-badge ${tone}">${safe(item.signal)}</span>
        </div>
        <div class="signal-card-middle">
          <div class="signal-price"><b>$${fmt(last?.close ?? item.close)}</b><span class="drawdown-value">${fmt(item.drawdown)}% <small>60일 고점 대비</small></span></div>
          <div class="signal-spark">${sparklineSVG(closes, trendUp ? "#15966a" : "#e04f5f")}</div>
          <span class="signal-chevron" aria-hidden="true">›</span>
        </div>
        <div class="signal-stats">
          <div><span>RSI(14)</span><b>${fmt(rsi)}</b></div>
          <div><span>20일 저점 대비</span><b>${rebound === null ? "—" : (rebound >= 0 ? "+" : "") + fmt(rebound) + "%"}</b></div>
          <div><span>거래량/평균</span><b>${volRatio === null ? "—" : fmt(volRatio) + "배"}</b></div>
        </div>
      </article>`;
    }).join("");
    $$("#signalList [data-ticker]").forEach(card => {
      const open = () => openDetail(card.dataset.ticker);
      card.addEventListener("click", open);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
  }
  // ── 종목 상세 및 규칙 기반 관찰 메모 ──
  function buildObservationMemo(rows, rsi, ma20, ma50, ma200) {
    const last = rows.at(-1);
    if (!last || rows.length < 20) return {
      headline: "분석 데이터 부족",
      body: "최근 가격 기록이 충분하지 않아 추세를 판단하기 어렵습니다.",
      positive: "추가 일봉 데이터 확보",
      caution: "신호만으로 매수 결정을 내리지 않기",
      watch: "가격 이력과 거래량 확인"
    };
    const i = rows.length - 1;
    const rsiNow = rsi[i], rsiPrev = rsi[Math.max(0, i - 5)];
    const rsiChange = rsiNow != null && rsiPrev != null ? rsiNow - rsiPrev : null;
    const last20 = rows.slice(-20);
    const low20 = Math.min(...last20.map(r => r.low));
    const rebound = low20 > 0 ? (last.close / low20 - 1) * 100 : null;
    const gap20 = ma20[i] ? (last.close / ma20[i] - 1) * 100 : null;
    const gap50 = ma50[i] ? (last.close / ma50[i] - 1) * 100 : null;
    const gap200 = ma200[i] ? (last.close / ma200[i] - 1) * 100 : null;
    const avgVolume = last20.reduce((s, r) => s + (r.volume || 0), 0) / last20.length;
    const volRatio = avgVolume > 0 ? (last.volume || 0) / avgVolume : null;
    const positives = [], cautions = [], watch = [];
    if (rsiChange !== null && rsiChange > 0) positives.push("RSI 개선");
    if (rebound !== null && rebound > 0) positives.push(`20일 저점 대비 +${rebound.toFixed(1)}%`);
    if (volRatio !== null && volRatio > 1.2) positives.push("평균보다 거래량 증가");
    if (gap20 !== null && gap20 < 0) cautions.push("MA20 아래");
    if (gap50 !== null && gap50 < 0) cautions.push("MA50 아래");
    if (gap200 !== null && gap200 < 0) cautions.push("MA200 아래");
    if (rsiNow !== null && rsiNow < 30) watch.push("과매도 지속 여부");
    if (rebound !== null && rebound > 0) watch.push("반등 저점 유지 여부");
    watch.push("다음 거래일 종가와 거래량");
    let headline = "추세 확인 필요";
    if (rsiNow !== null && rsiNow < 30 && rebound > 0) headline = "과매도 구간에서 반등 시도";
    else if (rebound > 5 && rsiChange > 0) headline = "단기 반등 흐름 관찰";
    else if (gap20 < -8 && gap50 < -8) headline = "중기 이동평균선 아래의 약세 흐름";
    else if (gap20 > 0 && rsiChange > 0) headline = "단기 회복 신호 관찰";
    const signed = v => v == null ? "미확인" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
    const body = [
      rsiNow == null ? "RSI 데이터 부족" : `RSI ${rsiNow.toFixed(1)}${rsiChange == null ? "" : ` (5거래일 ${rsiChange >= 0 ? "+" : ""}${rsiChange.toFixed(1)})`}`,
      `20일 저점 대비 ${signed(rebound)}`,
      `MA20 대비 ${signed(gap20)}`,
      volRatio == null ? "거래량 비교 불가" : `20일 평균 거래량 대비 ${volRatio.toFixed(2)}배`
    ].join(" · ");
    return {
      headline,
      body: body + ". 실제 지표를 규칙 기반으로 정리한 참고 정보이며, 매수 추천이나 미래 수익 예측이 아닙니다.",
      positive: positives.slice(0, 3).join(" · ") || "뚜렷한 긍정 요인 미확인",
      caution: cautions.slice(0, 3).join(" · ") || "이동평균선 위치를 계속 확인",
      watch: watch.slice(0, 3).join(" · ")
    };
  }
  function openDetail(ticker) {
    const item = signals.find(r => r.ticker === ticker);
    if (!item) return;
    selectedTicker = ticker;
    chartPeriod = 90;
    $("#detailTitle").textContent = `${item.ticker} · ${item.name || item.ticker}`;
    renderDetail(item);
    showPage("detail");
    requestAnimationFrame(drawStockChart);
  }
  function renderDetail(item) {
    const rows = getPriceRows(item.ticker);
    const last = rows.at(-1);
    const ma20 = movingAverage(rows, 20), ma50 = movingAverage(rows, 50), ma200 = movingAverage(rows, 200);
    const rsi = calculateRSI(rows), i = rows.length - 1;
    const memo = buildObservationMemo(rows, rsi, ma20, ma50, ma200);
    $("#detailBody").innerHTML = `
      <div class="panel detail-chart-panel">
        <div class="detail-toolbar"><div><div class="muted">가격 데이터 기준일</div><strong>${safe(last?.date || "미확인")}</strong><div class="muted">출처: 저장된 일봉 데이터</div></div>
        <label class="muted chart-period-label">차트 기간<select id="chartPeriod"><option value="30">1개월</option><option value="90" selected>3개월</option><option value="180">6개월</option><option value="365">1년</option></select></label></div>
        <div class="chart-legend"><span>🟢 상승</span><span>🔴 하락</span><span class="ma20-label">MA20</span><span class="ma50-label">MA50</span><span class="ma200-label">MA200</span></div>
        <div id="chartMessage" class="muted chart-message"></div><div class="detail-canvas-wrap"><canvas id="priceChart" aria-label="캔들스틱 및 거래량 차트"></canvas></div>
      </div>
      <div class="grid">
        ${renderMetricCard("신호", item.signal, `신호일 ${item.date}`)}
        ${renderMetricCard("신호 당시 종가", "$" + fmt(item.close), "신호 발생 시점")}
        ${renderMetricCard("고점 대비 하락률", fmt(item.drawdown) + "%", "최근 60거래일")}
        ${renderMetricCard("신호 당시 RSI", fmt(item.rsi14), "신호 발생 시점")}
        ${renderMetricCard("현재 RSI(14)", fmt(rsi[i]), last?.date || "")}
        ${renderMetricCard("MA20", "$" + fmt(ma20[i]), "20거래일 평균")}
        ${renderMetricCard("MA50", "$" + fmt(ma50[i]), "50거래일 평균")}
        ${renderMetricCard("MA200", "$" + fmt(ma200[i]), "200거래일 평균")}
        ${renderMetricCard("최근 거래량", fmt(last?.volume, 0), last?.date || "")}
      </div>
      <section class="observation-card">
        <div class="observation-heading"><span class="observation-icon">✦</span><div><span class="observation-kicker">RULE-BASED MARKET READ</span><h3>관찰 메모</h3></div><span class="observation-date">${safe(last?.date || "기준일 미확인")}</span></div>
        <strong class="observation-headline">${safe(memo.headline)}</strong><p class="observation-body">${safe(memo.body)}</p>
        <div class="observation-points">
          <div class="observation-point good"><span>긍정 요인</span><p>${safe(memo.positive)}</p></div>
          <div class="observation-point caution"><span>주의 요인</span><p>${safe(memo.caution)}</p></div>
          <div class="observation-point watch"><span>관찰 포인트</span><p>${safe(memo.watch)}</p></div>
        </div>
        <div class="reference-links"><a href="https://finance.yahoo.com/quote/${encodeURIComponent(item.ticker)}/" target="_blank" rel="noopener noreferrer">애널리스트 참고 정보 ↗</a><a href="https://news.google.com/search?q=${encodeURIComponent(item.ticker + " stock")}" target="_blank" rel="noopener noreferrer">관련 뉴스 검색 ↗</a></div>
      </section>`;
    $("#chartPeriod").addEventListener("change", e => {
      chartPeriod = Number(e.target.value) || 90;
      drawStockChart();
    });
    requestAnimationFrame(drawStockChart);
  }
  function drawStockChart() {
    if (!selectedTicker) return;
    const all = getPriceRows(selectedTicker), rows = all.slice(-chartPeriod);
    const canvas = $("#priceChart");
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(280, canvas.clientWidth || 320), h = 285;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!rows.length) {
      ctx.fillStyle = "#667085"; ctx.font = "13px sans-serif"; ctx.fillText("가격 데이터가 없습니다.", 8, 25);
      $("#chartMessage").textContent = "저장된 가격 기록 없음"; return;
    }
    const left = 5, right = 44, top = 7, bottom = 20, sep = h * .70;
    const volTop = sep + 13, volBottom = h - bottom, plotW = w - left - right, plotH = sep - top - 6;
    const offset = all.length - rows.length;
    const mas = [20, 50, 200].map(p => movingAverage(all, p).slice(offset));
    const prices = [];
    rows.forEach(r => prices.push(r.high, r.low));
    mas.forEach(s => s.forEach(v => { if (v != null && Number.isFinite(v)) prices.push(v); }));
    let min = Math.min(...prices), max = Math.max(...prices);
    const pad = (max - min || Math.abs(max) * .04 || 1) * .04;
    min -= pad; max += pad;
    const y = v => top + (max - v) / (max - min) * plotH;
    const step = plotW / rows.length, cw = Math.max(1, Math.min(8, step * .65));
    ctx.font = "10px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let n = 0; n <= 4; n++) {
      const v = min + (max - min) * n / 4, yy = top + plotH * (1 - n / 4);
      ctx.strokeStyle = "#edf0f5"; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(w - right, yy); ctx.stroke();
      ctx.fillStyle = "#667085"; ctx.fillText(fmt(v, 1), w - 2, yy);
    }
    rows.forEach((r, i) => {
      const x = left + step * (i + .5), color = r.close >= r.open ? "#16845b" : "#c03939";
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y(r.high)); ctx.lineTo(x, y(r.low)); ctx.stroke();
      ctx.fillRect(x - cw / 2, y(Math.max(r.open, r.close)), cw, Math.max(1, y(Math.min(r.open, r.close)) - y(Math.max(r.open, r.close))));
    });
    ["#356ae6", "#e69b27", "#8b5cf6"].forEach((color, s) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      let started = false;
      mas[s].forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) { started = false; return; }
        const x = left + step * (i + .5);
        if (!started) { ctx.moveTo(x, y(v)); started = true; } else ctx.lineTo(x, y(v));
      });
      ctx.stroke();
    });
    ctx.strokeStyle = "#d0d5dd"; ctx.beginPath(); ctx.moveTo(left, sep); ctx.lineTo(w - right, sep); ctx.stroke();
    ctx.fillStyle = "#667085"; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText("거래량", left, sep + 7);
    const maxVol = Math.max(1, ...rows.map(r => r.volume || 0)), vh = volBottom - volTop;
    rows.forEach((r, i) => {
      const x = left + step * (i + .5), bh = (r.volume || 0) / maxVol * vh;
      ctx.fillStyle = r.close >= r.open ? "#16845b" : "#c03939";
      ctx.fillRect(x - cw / 2, volBottom - bh, Math.max(1, cw), bh);
    });
    ctx.textBaseline = "bottom"; ctx.textAlign = "left"; ctx.fillStyle = "#667085"; ctx.fillText(rows[0].date.slice(5), left, h - 1);
    ctx.textAlign = "right"; ctx.fillText(rows.at(-1).date.slice(5), w - right, h - 1);
    $("#chartMessage").textContent = `${rows.length}개 거래일 · ${rows[0].date} ~ ${rows.at(-1).date}`;
  }
  // ── 이력 및 성과: 다음 거래일 시가 진입, 5/10/20거래일 후 종가 ──
  function calculatePerformance() {
    const targets = [5, 10, 20], entries = [], seen = new Set();
    for (const record of history) {
      if (!Array.isArray(record.signals)) continue;
      for (const sig of record.signals) {
        const ticker = sig.ticker, date = sig.date || record.scan_date || record.date;
        if (!ticker || !date) continue;
        const key = `${ticker}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rows = getPriceRows(ticker);
        const si = rows.findIndex(r => r.date >= date);
        if (si < 0) continue;
        const entry = rows[si + 1];
        const item = { ticker, signal: sig.signal, date, entryDate: entry?.date || "미확정", entryPrice: entry && entry.open > 0 ? entry.open : null };
        targets.forEach(days => {
          const exit = entry ? rows[si + 1 + days] : null;
          item[days] = entry && entry.open > 0 && exit ? (exit.close / entry.open - 1) * 100 : null;
        });
        entries.push(item);
      }
    }
    $("#performanceSummary").innerHTML = targets.map(days => {
      const known = entries.filter(e => e[days] !== null), wins = known.filter(e => e[days] > 0).length;
      const avg = known.length ? known.reduce((s, e) => s + e[days], 0) / known.length : null;
      const pending = entries.filter(e => e[days] === null).length;
      return `<article class="metric"><span>${days}거래일</span><b>${avg === null ? "—" : (avg >= 0 ? "+" : "") + avg.toFixed(2) + "%"}</b><small>승률 ${known.length ? (wins / known.length * 100).toFixed(1) + "%" : "—"} · 확정 ${known.length} · 미확정 ${pending}</small></article>`;
    }).join("");
    if (!entries.length) {
      $("#historyList").innerHTML = '<p class="muted">성과를 계산할 신호 기록이 없습니다.</p>'; return;
    }
    $("#historyList").innerHTML = entries.slice().reverse().slice(0, 100).map(item => {
      const results = targets.map(days => `${days}일 ${item[days] === null ? "미확정" : (item[days] >= 0 ? "+" : "") + item[days].toFixed(2) + "%"}`).join(" · ");
      return `<div class="panel history-row"><strong>${safe(item.ticker)} · ${safe(item.signal)}</strong><div class="muted">신호일 ${safe(item.date)} · 진입일 ${safe(item.entryDate)} · 진입가 ${item.entryPrice === null ? "미확정" : "$" + fmt(item.entryPrice)}</div><p>${safe(results)}</p></div>`;
    }).join("");
  }
  async function loadHistory() {
    try {
      const res = await fetch(`./data/signal_history.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("이력 파일 읽기 실패");
      const raw = await res.json();
      history = Array.isArray(raw) ? raw : Array.isArray(raw.records) ? raw.records : [];
      calculatePerformance();
    } catch (e) {
      $("#historyList").textContent = "이력을 불러오지 못했습니다.";
      console.error(e);
    }
  }
  async function refreshData() {
    const button = $("#refreshData");
    button.disabled = true; button.textContent = "불러오는 중…";
    try {
      const res = await fetch(`./data/latest.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("최신 데이터 파일 읽기 실패");
      data = await res.json();
      signals = Array.isArray(data.signals) ? data.signals : [];
      renderMacro(); renderSignals();
      $("#updated").textContent = "데이터 기준: " + (data.updated_at || "시각 미확인");
      const meta = data.scan_meta || {};
      $("#scannerStatus").textContent = meta.is_full_nasdaq100 === false
        ? `갱신 완료 · ${signals.length}개 신호 · 대체 종목 목록 사용`
        : `갱신 완료 · ${signals.length}개 신호`;
      await loadHistory();
      button.textContent = "✓ 갱신 완료";
      setTimeout(() => { if (button.isConnected) button.textContent = "↻ 새로고침"; }, 1600);
    } catch (e) {
      $("#updated").textContent = "데이터 불러오기 실패";
      $("#scannerStatus").textContent = "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      button.textContent = "다시 시도";
      console.error(e);
    } finally { button.disabled = false; }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $$(".tabs [data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
    $("#backScanner").addEventListener("click", () => showPage("scanner"));
    $("#refreshData").addEventListener("click", refreshData);
    ["search", "signalFilter", "sort"].forEach(id => {
      $("#" + id).addEventListener("input", renderSignals);
      $("#" + id).addEventListener("change", renderSignals);
    });
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        MACRO_NAMES.forEach((name, i) => drawMacroChart($(`#macroChart${i}`), data.macro_history?.[name] || []));
        if (selectedTicker) drawStockChart();
      }, 120);
    });
    showPage("macro");
    refreshData();
  });
})();
