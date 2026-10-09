(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const strength = {
    "패닉셀": 4,
    "급락": 3,
    "조정": 2,
    "단기조정": 1
  };
  let signals = [];
  let latestData = {};
  let historyRecords = [];
  let selectedTicker = null;
  let chartPeriod = 90;
  let resizeObserver = null;
  const number = value =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 2) => {
    const n = number(value);
    return n === null ? "—" : n.toLocaleString("en-US", {
      maximumFractionDigits: digits
    });
  };
  function safe(value) {
    return String(value ?? "—").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }
  function showPage(name) {
    $$(".tabs [data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === name);
    });
    $$(".page").forEach(page => {
      page.classList.toggle("active", page.id === "page-" + name);
    });
    window.scrollTo({ top: 0, behavior: "auto" });
    if (name === "detail") {
      requestAnimationFrame(drawChart);
    }
  }
  function priceSeries(ticker) {
    const rows = latestData.price_history?.[ticker];
    return Array.isArray(rows)
      ? rows.filter(row =>
          number(row.open) !== null &&
          number(row.high) !== null &&
          number(row.low) !== null &&
          number(row.close) !== null
        ).sort((a, b) => a.date.localeCompare(b.date))
      : [];
  }
  function movingAverage(rows, period) {
    return rows.map((row, index) => {
      if (index + 1 < period) return null;
      const slice = rows.slice(index - period + 1, index + 1);
      return slice.reduce((sum, item) => sum + item.close, 0) / period;
    });
  }
  function rsiSeries(rows, period = 14) {
    const result = Array(rows.length).fill(null);
    if (rows.length <= period) return result;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = rows[i].close - rows[i - 1].close;
      gains += Math.max(0, diff);
      losses += Math.max(0, -diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const value = () => avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);
    result[period] = value();
    for (let i = period + 1; i < rows.length; i++) {
      const diff = rows[i].close - rows[i - 1].close;
      avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
      result[i] = value();
    }
    return result;
  }
  function metricCard(label, value, note = "") {
    return `
      <article class="metric">
        <span>${safe(label)}</span>
        <b>${safe(value)}</b>
        <small>${safe(note)}</small>
      </article>
    `;
  }
  function renderMacro(data) {
    const macro = data.macro || {};
    $("#marketState").innerHTML = `
      <div class="state-title">시장 상태</div>
      <h3>${safe(macro.state || "분석 데이터 대기")}</h3>
      <p>${safe(macro.reason || "시장 지표 연결 대기 중입니다.")}</p>
    `;
    const entries = Object.entries(macro.values || {});
    const names = ["나스닥-100", "S&P 500", "VIX", "비트코인"];
    $("#macroMetrics").innerHTML = names.map(name => {
      const item = macro.values?.[name];
      if (!item) {
        return metricCard(name, "—", "데이터 미확인");
      }
      return metricCard(
        name,
        fmt(typeof item === "object" ? item.value : item, 2),
        typeof item === "object" ? item.updated_at : "날짜 미확인"
      );
    }).join("");
  }
  function renderSignals() {
    const query = ($("#search").value || "").trim().toLowerCase();
    const filter = $("#signalFilter").value;
    const sort = $("#sort").value;
    const filtered = signals.filter(item =>
      `${item.ticker || ""} ${item.name || ""}`
        .toLowerCase().includes(query) &&
      (filter === "all" || item.signal === filter)
    );
    filtered.sort((a, b) => {
      if (sort === "ticker") {
        return String(a.ticker).localeCompare(String(b.ticker));
      }
      if (sort === "drop") {
        return Number(a.drawdown ?? 0) - Number(b.drawdown ?? 0);
      }
      return (strength[b.signal] || 0) - (strength[a.signal] || 0);
    });
    $("#scanCount").textContent = `${filtered.length}개 신호`;
    if (!filtered.length) {
      $("#signalList").innerHTML =
        '<div class="panel">조건에 맞는 신호가 없습니다.</div>';
      return;
    }
    $("#signalList").innerHTML = filtered.map(item => `
      <article class="panel signal signal-clickable"
        data-ticker="${safe(item.ticker)}"
        tabindex="0" role="button"
        aria-label="${safe(item.ticker)} 종목 상세 보기">
        <strong>${safe(item.ticker)} · ${safe(item.name)}</strong>
        <b>${safe(item.signal)}</b>
        <p>종가 ${fmt(item.close)} · 고점 대비 ${fmt(item.drawdown)}%</p>
        <small>RSI ${fmt(item.rsi14)} · 기준일 ${safe(item.date)}</small>
        <div class="card-hint">상세 차트 보기 →</div>
      </article>
    `).join("");
    $$("#signalList [data-ticker]").forEach(card => {
      const open = () => openDetail(card.dataset.ticker);
      card.addEventListener("click", open);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }
  function openDetail(ticker) {
    const item = signals.find(row => row.ticker === ticker);
    if (!item) return;
    selectedTicker = ticker;
    chartPeriod = 90;
    $("#detailTitle").textContent = `${item.ticker} · ${item.name}`;
    renderDetail(item);
    showPage("detail");
    requestAnimationFrame(drawChart);
  }
  function renderDetail(item) {
    const rows = priceSeries(item.ticker);
    const last = rows[rows.length - 1];
    const ma20 = movingAverage(rows, 20);
    const ma50 = movingAverage(rows, 50);
    const ma200 = movingAverage(rows, 200);
    const rsi = rsiSeries(rows);
    const i = rows.length - 1;
    const actualPriceDate = last?.date || "미확인";
    const chartAvailable = rows.length > 0;
    $("#detailBody").innerHTML = `
      <div class="panel" style="margin-bottom:14px">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center">
          <div>
            <div class="muted">가격 데이터 기준일</div>
            <strong>${safe(actualPriceDate)}</strong>
            <div class="muted">통화 USD · 출처 Yahoo Finance</div>
          </div>
          <label class="muted" style="font-size:13px">
            차트 기간
            <select id="chartPeriod" style="display:block;margin-top:4px">
              <option value="30">1개월</option>
              <option value="90" selected>3개월</option>
              <option value="180">6개월</option>
              <option value="365">1년</option>
            </select>
          </label>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin:16px 0;font-size:12px">
          <span>🟢 상승</span><span>🔴 하락</span>
          <span>━ MA20</span><span>━ MA50</span><span>━ MA200</span>
        </div>
        <div id="chartMessage" class="muted" style="font-size:13px;margin-bottom:8px">
          ${chartAvailable
            ? `${rows.length}개 거래일 데이터`
            : "저장된 가격 데이터가 없습니다. 스캔을 다시 실행하세요."}
        </div>
        <div style="width:100%;height:300px;position:relative">
          <canvas id="priceChart"
            role="img"
            aria-label="${safe(item.ticker)} 캔들스틱 및 이동평균선 차트"
            style="width:100%;height:300px;display:block"></canvas>
        </div>
        <div style="width:100%;height:90px;margin-top:12px">
          <canvas id="volumeChart"
            aria-label="거래량 차트"
            style="width:100%;height:90px;display:block"></canvas>
        </div>
      </div>
      <div class="grid">
        ${metricCard("신호", item.signal, `신호 기준일 ${item.date}`)}
        ${metricCard("종가", fmt(item.close), "신호 발생 시점")}
        ${metricCard("고점 대비 하락률", `${fmt(item.drawdown)}%`, "최근 60거래일 고점 기준")}
        ${metricCard("RSI(14)", fmt(item.rsi14), "신호 발생 시점")}
        ${metricCard("현재 RSI(14)", fmt(rsi[i]), actualPriceDate)}
        ${metricCard("MA20", fmt(ma20[i]), "20거래일 평균")}
        ${metricCard("MA50", fmt(ma50[i]), "50거래일 평균")}
        ${metricCard("MA200", fmt(ma200[i]), "200거래일 평균")}
        ${metricCard("거래량", fmt(last?.volume, 0), actualPriceDate)}
        ${metricCard("20일 평균 거래량", fmt(
          rows.length >= 20
            ? rows.slice(-20).reduce((s, r) => s + r.volume, 0) / 20
            : null, 0), "최근 20거래일")}
      </div>
      <div class="panel">
        <h3>신호 근거</h3>
        <p>신호: <strong>${safe(item.signal)}</strong></p>
        <p>신호 기준일: ${safe(item.date)}</p>
        <p>고점 대비 하락률: ${fmt(item.drawdown)}%</p>
        <p>RSI(14): ${fmt(item.rsi14)}</p>
        <p class="muted">차트는 저장된 일봉 데이터 기준이며 실시간 시세가 아닙니다.</p>
      </div>
    `;
    $("#chartPeriod").addEventListener("change", event => {
      chartPeriod = Number(event.target.value) || 90;
      drawChart();
    });
    if (resizeObserver) resizeObserver.disconnect();
    const canvas = $("#priceChart");
    if (canvas && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => drawChart());
      resizeObserver.observe(canvas.parentElement);
    }
    requestAnimationFrame(drawChart);
  }
  function drawChart() {
    if (!selectedTicker) return;
    const allRows = priceSeries(selectedTicker);
    const rows = allRows.slice(-chartPeriod);
    const canvas = $("#priceChart");
    const volumeCanvas = $("#volumeChart");
    if (!canvas || !volumeCanvas) return;
    if (!rows.length) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      $("#chartMessage").textContent =
        "가격 기록이 없어 차트를 그릴 수 없습니다.";
      return;
    }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    function prepare(target) {
      const width = Math.max(280, target.clientWidth);
      const height = target.clientHeight;
      target.width = Math.round(width * dpr);
      target.height = Math.round(height * dpr);
      const ctx = target.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      return { ctx, width, height };
    }
    const { ctx, width, height } = prepare(canvas);
    const pad = { left: 8, right: 52, top: 12, bottom: 22 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const allMa20 = movingAverage(allRows, 20);
    const allMa50 = movingAverage(allRows, 50);
    const allMa200 = movingAverage(allRows, 200);
    const startIndex = allRows.length - rows.length;
    const ma20 = allMa20.slice(startIndex);
    const ma50 = allMa50.slice(startIndex);
    const ma200 = allMa200.slice(startIndex);
    const values = [];
    rows.forEach(row => values.push(row.high, row.low));
    [ma20, ma50, ma200].forEach(series =>
      series.forEach(value => {
        if (value !== null && Number.isFinite(value)) values.push(value);
      })
    );
    let min = Math.min(...values);
    let max = Math.max(...values);
    const padding = (max - min || max * 0.04 || 1) * 0.08;
    min -= padding;
    max += padding;
    const y = value =>
      pad.top + (max - value) / (max - min) * plotH;
    const step = plotW / rows.length;
    const candleW = Math.max(1, Math.min(9, step * 0.62));
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4;
      const yy = pad.top + plotH * (1 - i / 4);
      ctx.strokeStyle = "#e4e7ec";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, yy);
      ctx.lineTo(width - pad.right, yy);
      ctx.stroke();
      ctx.fillStyle = "#667085";
      ctx.fillText(fmt(value, 0), width - 4, yy);
    }
    rows.forEach((row, i) => {
      const x = pad.left + step * (i + 0.5);
      const up = row.close >= row.open;
      const color = up ? "#16845b" : "#c03939";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(row.high));
      ctx.lineTo(x, y(row.low));
      ctx.stroke();
      const top = y(Math.max(row.open, row.close));
      const bottom = y(Math.min(row.open, row.close));
      ctx.fillRect(
        x - candleW / 2,
        top,
        candleW,
        Math.max(1, bottom - top)
      );
    });
    const line = (series, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      let started = false;
      series.forEach((value, i) => {
        if (value === null || !Number.isFinite(value)) {
          started = false;
          return;
        }
        const x = pad.left + step * (i + 0.5);
        const yy = y(value);
        if (!started) {
          ctx.moveTo(x, yy);
          started = true;
        } else {
          ctx.lineTo(x, yy);
        }
      });
      ctx.stroke();
    };
    line(ma20, "#3b5fe5");
    line(ma50, "#e69b27");
    line(ma200, "#8b5cf6");
    ctx.fillStyle = "#667085";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(rows[0].date.slice(5), pad.left, height - 2);
    ctx.textAlign = "right";
    ctx.fillText(rows[rows.length - 1].date.slice(5), width - pad.right, height - 2);
    const volume = prepare(volumeCanvas);
    const vctx = volume.ctx;
    const vmax = Math.max(1, ...rows.map(row => row.volume));
    const vstep = volume.width / rows.length;
    vctx.strokeStyle = "#e4e7ec";
    vctx.beginPath();
    vctx.moveTo(0, 1);
    vctx.lineTo(volume.width, 1);
    vctx.stroke();
    rows.forEach((row, i) => {
      const barH = row.volume / vmax * (volume.height - 8);
      vctx.fillStyle = row.close >= row.open ? "#16845b" : "#c03939";
      vctx.fillRect(
        i * vstep + vstep * 0.2,
        volume.height - barH,
        Math.max(1, vstep * 0.6),
        barH
      );
    });
    $("#chartMessage").textContent =
      `${rows.length}개 거래일 · ${rows[0].date} ~ ${rows[rows.length - 1].date} · 일봉`;
  }
  function calculatePerformance() {
    const targets = [5, 10, 20];
    const entries = [];
    for (const record of historyRecords) {
      const scanDate = record.scan_date || record.date;
      if (!scanDate || !Array.isArray(record.signals)) continue;
      for (const signal of record.signals) {
        const ticker = signal.ticker;
        const rows = priceSeries(ticker);
        const signalIndex = rows.findIndex(row => row.date >= signal.date);
        if (signalIndex < 0) continue;
        const entry = rows[signalIndex + 1];
        if (!entry || !Number.isFinite(entry.open) || entry.open <= 0) continue;
        const result = { ticker, signal: signal.signal, date: signal.date };
        targets.forEach(days => {
          const exit = rows[signalIndex + days];
          result[days] = exit
            ? (exit.close / entry.open - 1) * 100
            : null;
        });
        entries.push(result);
      }
    }
    $("#performanceSummary").innerHTML = targets.map(days => {
      const known = entries.filter(item => item[days] !== null);
      const wins = known.filter(item => item[days] > 0).length;
      const average = known.length
        ? known.reduce((sum, item) => sum + item[days], 0) / known.length
        : null;
      const unresolved = entries.length - known.length;
      const winRate = known.length ? `${(wins / known.length * 100).toFixed(1)}%` : "—";
      return `
        <article class="metric">
          <span>${days}거래일</span>
          <b>${average === null ? "—" : `${average >= 0 ? "+" : ""}${average.toFixed(2)}%`}</b>
          <small>승률 ${winRate} · 확정 ${known.length} · 미확정 ${unresolved}</small>
        </article>
      `;
    }).join("");
    const target = $("#historyList");
    if (!entries.length) {
      target.innerHTML =
        '<p class="muted">성과를 계산할 신호 기록이 없습니다.</p>';
      return;
    }
    target.innerHTML = entries.slice().reverse().slice(0, 100).map(item => {
      const results = targets.map(days => {
        const value = item[days];
        const label = value === null
          ? "미확정"
          : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
        return `${days}일 ${label}`;
      }).join(" · ");
      return `
        <div class="panel history-row">
          <strong>${safe(item.ticker)} · ${safe(item.signal)}</strong>
          <div class="muted">${safe(item.date)}</div>
          <p>${safe(results)}</p>
        </div>
      `;
    }).join("");
  }
  async function loadHistory() {
    const target = $("#historyList");
    try {
      const response = await fetch(
        `./data/signal_history.json?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("이력 파일을 읽지 못했습니다.");
      const raw = await response.json();
      historyRecords = Array.isArray(raw)
        ? raw
        : Array.isArray(raw.records) ? raw.records : [];
      calculatePerformance();
    } catch (error) {
      target.textContent = "신호 이력을 불러오지 못했습니다.";
      console.error(error);
    }
  }
  async function refreshData() {
    const button = $("#refreshData");
    button.disabled = true;
    button.textContent = "불러오는 중…";
    $("#updated").textContent = "데이터 갱신 중";
    try {
      const response = await fetch(
        `./data/latest.json?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("최신 데이터 파일을 읽지 못했습니다.");
      latestData = await response.json();
      signals = Array.isArray(latestData.signals) ? latestData.signals : [];
      renderMacro(latestData);
      renderSignals();
      $("#updated").textContent =
        "데이터 기준: " + (latestData.updated_at || "시각 미확인");
      $("#scannerStatus").textContent =
        `데이터 새로고침 완료 · ${signals.length}개 신호`;
      await loadHistory();
      if (selectedTicker) {
        const item = signals.find(row => row.ticker === selectedTicker);
        if (item) renderDetail(item);
      }
      button.textContent = "✓ 새로고침 완료";
      setTimeout(() => {
        if (button.isConnected) button.textContent = "↻ 새로고침";
      }, 1800);
    } catch (error) {
      $("#updated").textContent = "데이터 불러오기 실패";
      $("#scannerStatus").textContent =
        "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      button.textContent = "다시 시도";
      console.error(error);
    } finally {
      button.disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $$(".tabs [data-page]").forEach(button => {
      button.addEventListener("click", () => showPage(button.dataset.page));
    });
    $("#backScanner").addEventListener("click", () => showPage("scanner"));
    $("#refreshData").addEventListener("click", refreshData);
    ["search", "signalFilter", "sort"].forEach(id => {
      $("#" + id).addEventListener("input", renderSignals);
      $("#" + id).addEventListener("change", renderSignals);
    });
    showPage("macro");
    refreshData();
  });
})();
