(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const SIGNAL_STRENGTH = {
    "패닉셀": 4,
    "급락": 3,
    "조정": 2,
    "단기조정": 1
  };

  const MACRO_NAMES = [
    "나스닥-100",
    "S&P 500",
    "미국 2년물 금리",
    "미국 10년물 금리",
    "VIX",
    "금",
    "원·달러 환율",
    "비트코인"
  ];

  let latestData = {};
  let signals = [];
  let historyRecords = [];
  let selectedTicker = null;
  let chartPeriod = 90;
  let resizeTimer = null;

  function number(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function fmt(value, digits = 2) {
    const n = number(value);

    return n === null
      ? "—"
      : n.toLocaleString("en-US", {
          maximumFractionDigits: digits
        });
  }

  function safe(value) {
    return String(value ?? "—").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function showPage(name) {
    $$(".tabs [data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === name);
    });

    $$(".page").forEach(page => {
      page.classList.toggle("active", page.id === "page-" + name);
    });

    if (name === "detail") {
      requestAnimationFrame(drawStockChart);
    }
  }

  function renderMetricCard(label, value, note = "") {
    return `
      <article class="metric">
        <span>${safe(label)}</span>
        <b>${safe(value)}</b>
        <small>${safe(note)}</small>
      </article>
    `;
  }

  // --------------------------------------
  // 시장 요약
  // --------------------------------------

  function renderMacro(data) {
    const macro = data.macro || {};
    const values = macro.values || {};
    const histories = data.macro_history || {};

    $("#marketState").innerHTML = `
      <div class="state-title">시장 상태</div>
      <h3>${safe(macro.state || "분석 데이터 대기")}</h3>
      <p>${safe(macro.reason || "시장 지표 연결 대기 중입니다.")}</p>
    `;

    // 기존 숫자 카드와 별도 그래프 카드를 만들지 않고,
    // 각 지표의 숫자와 차트를 같은 카드에 렌더링한다.
    $("#macroMetrics").innerHTML = MACRO_NAMES.map((name, index) => {
      const item = values[name];
      const value = item && typeof item === "object" ? item.value : item;
      const date = item && typeof item === "object"
        ? item.updated_at || ""
        : "";

      const suffix = name.includes("금리")
        ? "%"
        : name === "VIX" ? "pt" : "";

      return `
        <article class="metric macro-card">
          <span>${safe(name)}</span>
          <b>${value == null ? "—" : safe(fmt(value, 2) + suffix)}</b>
          <small>${safe(date || "데이터 미확인")}</small>
          <div class="macro-chart-wrap">
            <canvas
              id="macroChart${index}"
              class="macro-chart"
              aria-label="${safe(name)} 최근 30일 추이">
            </canvas>
          </div>
          <div class="macro-range">최근 30일</div>
        </article>
      `;
    }).join("");

    MACRO_NAMES.forEach((name, index) => {
      drawMacroChart(
        $(`#macroChart${index}`),
        histories[name] || []
      );
    });
  }

  function parseUTCDate(date) {
    if (!date) return null;

    const result = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function drawMacroChart(canvas, source) {
    if (!canvas) return;

    const allRows = (Array.isArray(source) ? source : [])
      .filter(row => row.date && number(row.close) !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    // 마지막 관측일 기준 30일. 주말·휴일은 관측값이 없으므로 건너뛴다.
    const latestDate = allRows.length
      ? parseUTCDate(allRows[allRows.length - 1].date)
      : null;

    const startDate = latestDate
      ? new Date(latestDate.getTime() - 30 * 86400000)
      : null;

    const rows = startDate
      ? allRows.filter(row => {
          const date = parseUTCDate(row.date);
          return date && date >= startDate && date <= latestDate;
        })
      : [];

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(120, canvas.clientWidth || 200);
    const height = 62;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (rows.length < 2) {
      ctx.fillStyle = "#98a2b3";
      ctx.font = "11px sans-serif";
      ctx.fillText("최근 한 달 데이터 부족", 4, 22);
      return;
    }

    const prices = rows.map(row => Number(row.close));
    let min = Math.min(...prices);
    let max = Math.max(...prices);

    if (min === max) {
      const padding = Math.abs(max) * 0.01 || 1;
      min -= padding;
      max += padding;
    }

    // 작은 차트에 불필요한 여백을 최소화한다.
    const pad = { left: 3, right: 3, top: 4, bottom: 4 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const y = value =>
      pad.top + (max - value) / (max - min) * plotH;

    ctx.strokeStyle = "#eaecf0";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 2; i++) {
      const yy = pad.top + plotH * i / 2;
      ctx.beginPath();
      ctx.moveTo(pad.left, yy);
      ctx.lineTo(width - pad.right, yy);
      ctx.stroke();
    }

    ctx.beginPath();

    rows.forEach((row, index) => {
      const x = pad.left + index / (rows.length - 1) * plotW;
      const yy = y(Number(row.close));

      if (index === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    });

    ctx.strokeStyle = "#3b5fe5";
    ctx.lineWidth = 1.7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // --------------------------------------
  // 종목 스캐너
  // --------------------------------------

  function renderSignals() {
    const query = ($("#search").value || "").trim().toLowerCase();
    const filter = $("#signalFilter").value;
    const sort = $("#sort").value;

    const filtered = signals.filter(item => {
      const searchable = `${item.ticker || ""} ${item.name || ""}`
        .toLowerCase();

      return searchable.includes(query) &&
        (filter === "all" || item.signal === filter);
    });

    filtered.sort((a, b) => {
      if (sort === "ticker") {
        return String(a.ticker).localeCompare(String(b.ticker));
      }

      if (sort === "drop") {
        return Number(a.drawdown ?? 0) - Number(b.drawdown ?? 0);
      }

      return (SIGNAL_STRENGTH[b.signal] || 0) -
        (SIGNAL_STRENGTH[a.signal] || 0);
    });

    $("#scanCount").textContent = `${filtered.length}개 신호`;

    if (!filtered.length) {
      $("#signalList").innerHTML =
        '<div class="panel">조건에 맞는 신호가 없습니다.</div>';
      return;
    }

    $("#signalList").innerHTML = filtered.map(item => `
      <article
        class="panel signal signal-clickable"
        data-ticker="${safe(item.ticker)}"
        tabindex="0"
        role="button">
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

  function getPriceRows(ticker) {
    const source = latestData.price_history?.[ticker];
    if (!Array.isArray(source)) return [];

    return source.map(row => ({
      ...row,
      open: number(row.open),
      high: number(row.high),
      low: number(row.low),
      close: number(row.close),
      volume: number(row.volume) ?? 0
    }))
    .filter(row =>
      row.date &&
      row.open !== null &&
      row.high !== null &&
      row.low !== null &&
      row.close !== null
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  }

  function movingAverage(rows, period) {
    return rows.map((row, index) => {
      if (index + 1 < period) return null;

      const slice = rows.slice(index - period + 1, index + 1);

      return slice.reduce((sum, item) => sum + item.close, 0) / period;
    });
  }

  function calculateRSI(rows, period = 14) {
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

    const current = () => {
      if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
      return 100 - 100 / (1 + avgGain / avgLoss);
    };

    result[period] = current();

    for (let i = period + 1; i < rows.length; i++) {
      const diff = rows[i].close - rows[i - 1].close;

      avgGain =
        (avgGain * (period - 1) + Math.max(0, diff)) / period;

      avgLoss =
        (avgLoss * (period - 1) + Math.max(0, -diff)) / period;

      result[i] = current();
    }

    return result;
  }

  // --------------------------------------
  // 종목 상세: 캔들 + 거래량 한 캔버스
  // --------------------------------------

  function openDetail(ticker) {
    const item = signals.find(row => row.ticker === ticker);
    if (!item) return;

    selectedTicker = ticker;
    chartPeriod = 90;

    $("#detailTitle").textContent = `${item.ticker} · ${item.name}`;

    renderDetail(item);
    showPage("detail");

    requestAnimationFrame(drawStockChart);
  }

  function renderDetail(item) {
    const rows = getPriceRows(item.ticker);
    const last = rows[rows.length - 1];

    const ma20 = movingAverage(rows, 20);
    const ma50 = movingAverage(rows, 50);
    const ma200 = movingAverage(rows, 200);
    const rsi = calculateRSI(rows);
    const i = rows.length - 1;

    $("#detailBody").innerHTML = `
      <div class="panel detail-chart-panel">
        <div class="detail-toolbar">
          <div>
            <div class="muted">가격 데이터 기준일</div>
            <strong>${safe(last?.date || "미확인")}</strong>
            <div class="muted">출처: 저장된 일봉 데이터</div>
          </div>
          <label class="muted chart-period-label">
            차트 기간
            <select id="chartPeriod">
              <option value="30">1개월</option>
              <option value="90" selected>3개월</option>
              <option value="180">6개월</option>
              <option value="365">1년</option>
            </select>
          </label>
        </div>

        <div class="chart-legend">
          <span>🟢 상승</span>
          <span>🔴 하락</span>
          <span class="ma20-label">MA20</span>
          <span class="ma50-label">MA50</span>
          <span class="ma200-label">MA200</span>
        </div>

        <div id="chartMessage" class="muted chart-message"></div>
        <div class="detail-canvas-wrap">
          <canvas id="priceChart" aria-label="캔들스틱 및 거래량 차트"></canvas>
        </div>
      </div>

      <div class="grid">
        ${renderMetricCard("신호", item.signal, `신호일 ${item.date}`)}
        ${renderMetricCard("신호 당시 종가", fmt(item.close), "신호 발생 시점")}
        ${renderMetricCard("고점 대비 하락률", `${fmt(item.drawdown)}%`, "최근 60거래일")}
        ${renderMetricCard("신호 당시 RSI", fmt(item.rsi14), "신호 발생 시점")}
        ${renderMetricCard("현재 RSI(14)", fmt(rsi[i]), last?.date || "")}
        ${renderMetricCard("MA20", fmt(ma20[i]), "20거래일 평균")}
        ${renderMetricCard("MA50", fmt(ma50[i]), "50거래일 평균")}
        ${renderMetricCard("MA200", fmt(ma200[i]), "200거래일 평균")}
        ${renderMetricCard("최근 거래량", fmt(last?.volume, 0), last?.date || "")}
      </div>
    `;

    $("#chartPeriod").addEventListener("change", event => {
      chartPeriod = Number(event.target.value) || 90;
      drawStockChart();
    });

    requestAnimationFrame(drawStockChart);
  }

  function drawStockChart() {
    if (!selectedTicker) return;

    const allRows = getPriceRows(selectedTicker);
    const rows = allRows.slice(-chartPeriod);
    const canvas = $("#priceChart");

    if (!canvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(280, canvas.clientWidth || 320);
    const height = 285;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!rows.length) {
      ctx.fillStyle = "#667085";
      ctx.font = "13px sans-serif";
      ctx.fillText("가격 데이터가 없습니다.", 8, 25);
      $("#chartMessage").textContent = "저장된 가격 기록 없음";
      return;
    }

    const left = 4;
    const right = 43;
    const top = 6;
    const bottom = 20;
    const separator = height * 0.70;
    const volumeTop = separator + 13;
    const volumeBottom = height - bottom;
    const plotW = width - left - right;
    const plotH = separator - top - 6;

    const offset = allRows.length - rows.length;

    const ma20 = movingAverage(allRows, 20).slice(offset);
    const ma50 = movingAverage(allRows, 50).slice(offset);
    const ma200 = movingAverage(allRows, 200).slice(offset);

    const prices = [];

    rows.forEach(row => prices.push(row.high, row.low));

    [ma20, ma50, ma200].forEach(series => {
      series.forEach(value => {
        if (value !== null && Number.isFinite(value)) {
          prices.push(value);
        }
      });
    });

    let min = Math.min(...prices);
    let max = Math.max(...prices);
    const pad = (max - min || Math.abs(max) * 0.04 || 1) * 0.04;

    min -= pad;
    max += pad;

    const y = value => top + (max - value) / (max - min) * plotH;
    const step = plotW / rows.length;
    const candleW = Math.max(1, Math.min(8, step * 0.65));

    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4;
      const yy = top + plotH * (1 - i / 4);

      ctx.strokeStyle = "#eaecf0";
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(width - right, yy);
      ctx.stroke();

      ctx.fillStyle = "#667085";
      ctx.fillText(fmt(value, 1), width - 2, yy);
    }

    rows.forEach((row, i) => {
      const x = left + step * (i + 0.5);
      const up = row.close >= row.open;
      const color = up ? "#16845b" : "#c03939";

      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.moveTo(x, y(row.high));
      ctx.lineTo(x, y(row.low));
      ctx.stroke();

      const candleTop = y(Math.max(row.open, row.close));
      const candleBottom = y(Math.min(row.open, row.close));

      ctx.fillRect(
        x - candleW / 2,
        candleTop,
        candleW,
        Math.max(1, candleBottom - candleTop)
      );
    });

    function drawMA(series, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;

      let started = false;

      series.forEach((value, i) => {
        if (value === null || !Number.isFinite(value)) {
          started = false;
          return;
        }

        const x = left + step * (i + 0.5);

        if (!started) {
          ctx.moveTo(x, y(value));
          started = true;
        } else {
          ctx.lineTo(x, y(value));
        }
      });

      ctx.stroke();
    }

    drawMA(ma20, "#356ae6");
    drawMA(ma50, "#e69b27");
    drawMA(ma200, "#8b5cf6");

    ctx.strokeStyle = "#d0d5dd";
    ctx.beginPath();
    ctx.moveTo(left, separator);
    ctx.lineTo(width - right, separator);
    ctx.stroke();

    ctx.fillStyle = "#667085";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("거래량", left, separator + 7);

    const maxVolume = Math.max(1, ...rows.map(row => row.volume || 0));
    const volumeHeight = volumeBottom - volumeTop;

    rows.forEach((row, i) => {
      const x = left + step * (i + 0.5);
      const barHeight = (row.volume || 0) / maxVolume * volumeHeight;

      ctx.fillStyle = row.close >= row.open ? "#16845b" : "#c03939";

      ctx.fillRect(
        x - candleW / 2,
        volumeBottom - barHeight,
        Math.max(1, candleW),
        barHeight
      );
    });

    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillStyle = "#667085";
    ctx.fillText(rows[0].date.slice(5), left, height - 1);

    ctx.textAlign = "right";
    ctx.fillText(rows[rows.length - 1].date.slice(5), width - right, height - 1);

    $("#chartMessage").textContent =
      `${rows.length}개 거래일 · ${rows[0].date} ~ ${rows[rows.length - 1].date}`;
  }

  // --------------------------------------
  // 이력 및 성과
  // --------------------------------------

  function calculatePerformance() {
    const targets = [5, 10, 20];
    const entries = [];
    const seen = new Set();

    for (const record of historyRecords) {
      if (!Array.isArray(record.signals)) continue;

      for (const signal of record.signals) {
        const ticker = signal.ticker;
        const date = signal.date || record.scan_date || record.date;

        if (!ticker || !date) continue;

        const key = `${ticker}|${date}|${signal.signal}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const rows = getPriceRows(ticker);
        const signalIndex = rows.findIndex(row => row.date >= date);

        if (signalIndex < 0) continue;

        const entry = rows[signalIndex + 1];

        if (!entry || entry.open <= 0) continue;

        const item = {
          ticker,
          signal: signal.signal,
          date,
          entryDate: entry.date
        };

        targets.forEach(days => {
          const exit = rows[signalIndex + days + 1];

          item[days] = exit
            ? (exit.close / entry.open - 1) * 100
            : null;
        });

        entries.push(item);
      }
    }

    $("#performanceSummary").innerHTML = targets.map(days => {
      const known = entries.filter(item => item[days] !== null);
      const wins = known.filter(item => item[days] > 0).length;

      const average = known.length
        ? known.reduce((sum, item) => sum + item[days], 0) / known.length
        : null;

      return `
        <article class="metric">
          <span>${days}거래일</span>
          <b>${average === null
            ? "—"
            : `${average >= 0 ? "+" : ""}${average.toFixed(2)}%`}</b>
          <small>
            승률 ${known.length
              ? (wins / known.length * 100).toFixed(1) + "%"
              : "—"}
            · 확정 ${known.length}
            · 미확정 ${entries.length - known.length}
          </small>
        </article>
      `;
    }).join("");

    if (!entries.length) {
      $("#historyList").innerHTML =
        '<p class="muted">성과를 계산할 신호 기록이 없습니다.</p>';
      return;
    }

    $("#historyList").innerHTML = entries.slice().reverse().slice(0, 100)
      .map(item => {
        const results = targets.map(days => {
          const value = item[days];

          return `${days}일 ${value === null
            ? "미확정"
            : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`}`;
        }).join(" · ");

        return `
          <div class="panel history-row">
            <strong>${safe(item.ticker)} · ${safe(item.signal)}</strong>
            <div class="muted">
              신호일 ${safe(item.date)} · 진입일 ${safe(item.entryDate)}
            </div>
            <p>${safe(results)}</p>
          </div>
        `;
      }).join("");
  }

  async function loadHistory() {
    try {
      const response = await fetch(
        `./data/signal_history.json?t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) throw new Error("이력 파일 읽기 실패");

      const raw = await response.json();

      historyRecords = Array.isArray(raw)
        ? raw
        : Array.isArray(raw.records) ? raw.records : [];

      calculatePerformance();
    } catch (error) {
      $("#historyList").textContent = "이력을 불러오지 못했습니다.";
      console.error(error);
    }
  }

  // --------------------------------------
  // 데이터 갱신
  // --------------------------------------

  async function refreshData() {
    const button = $("#refreshData");

    button.disabled = true;
    button.textContent = "불러오는 중…";

    try {
      const response = await fetch(
        `./data/latest.json?t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) throw new Error("최신 데이터 파일 읽기 실패");

      latestData = await response.json();
      signals = Array.isArray(latestData.signals)
        ? latestData.signals
        : [];

      renderMacro(latestData);
      renderSignals();

      $("#updated").textContent =
        "데이터 기준: " + (latestData.updated_at || "시각 미확인");

      const meta = latestData.scan_meta || {};

      $("#scannerStatus").textContent =
        meta.is_full_nasdaq100 === false
          ? `갱신 완료 · ${signals.length}개 신호 · 대체 종목 목록 사용`
          : `갱신 완료 · ${signals.length}개 신호`;

      await loadHistory();

      button.textContent = "✓ 갱신 완료";

      setTimeout(() => {
        if (button.isConnected) button.textContent = "↻ 새로고침";
      }, 1600);

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

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        MACRO_NAMES.forEach((name, index) => {
          drawMacroChart(
            $(`#macroChart${index}`),
            latestData.macro_history?.[name] || []
          );
        });

        if (selectedTicker) drawStockChart();
      }, 120);
    });

    showPage("macro");
    refreshData();
  });
})();
