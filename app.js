(() => {
  "use strict";

  // =========================================================
  // 1. 공통 설정 및 상태
  // =========================================================
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

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

  const FAVORITES_KEY = "hyeonu-stock-favorites";
  const VALID_PERIODS = [30, 90, 180, 365];
  const UNKNOWN_SECTOR = "섹터 미확인";
  const PAGE_ORDER = ["macro", "scanner", "detail", "history"];

  let latestData = {};
  let signals = [];
  let historyRecords = [];
  let selectedTicker = null;
  let chartPeriod = 90;
  let resizeTimer = null;
  let favorites = new Set();
  let refreshInProgress = false;
  let indicatorTab = "rsi";

  // =========================================================
  // 2. 공통 유틸리티
  // =========================================================

  function isObject(value) {
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value);
  }

  function number(value) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      typeof value === "boolean"
    ) {
      return null;
    }

    if (typeof value === "string" && !value.trim()) {
      return null;
    }

    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function fmt(value, digits = 2) {
    const n = number(value);

    if (n === null) {
      return "—";
    }

    return n.toLocaleString("en-US", {
      maximumFractionDigits: digits
    });
  }

  function signed(value, digits = 2, suffix = "%") {
    const n = number(value);

    if (n === null) {
      return "—";
    }

    const prefix = n > 0 ? "+" : "";
    return `${prefix}${n.toFixed(digits)}${suffix}`;
  }

  function safe(value) {
    return String(value ?? "—").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
    );
  }

  function validDate(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  }

  function normalizeTicker(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().toUpperCase();
  }

  function setText(selector, value) {
    const element = $(selector);

    if (element) {
      element.textContent = value;
    }
  }

  function setHTML(selector, value) {
    const element = $(selector);

    if (element) {
      element.innerHTML = value;
    }
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function moneyCap(value) {
    const n = number(value);

    if (n === null || n < 0) {
      return "미확인";
    }

    if (n >= 1e12) {
      return `${(n / 1e12).toFixed(2)}조 달러`;
    }

    if (n >= 1e9) {
      return `${(n / 1e9).toFixed(2)}B 달러`;
    }

    if (n >= 1e6) {
      return `${(n / 1e6).toFixed(2)}M 달러`;
    }

    return `${fmt(n, 0)} 달러`;
  }

  function readFavorites() {
    try {
      const stored = JSON.parse(
        localStorage.getItem(FAVORITES_KEY) || "[]"
      );

      favorites = new Set(
        Array.isArray(stored)
          ? stored.filter(
              value =>
                typeof value === "string" &&
                /^[A-Z0-9.^_-]{1,20}$/.test(value)
            )
          : []
      );
    } catch (error) {
      favorites = new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(
        FAVORITES_KEY,
        JSON.stringify([...favorites])
      );
    } catch (error) {
      console.warn("[favorites] 저장 실패", error);
    }
  }

  function toggleFavorite(ticker) {
    if (favorites.has(ticker)) {
      favorites.delete(ticker);
    } else {
      favorites.add(ticker);
    }

    saveFavorites();

    const button = $("#sdFavorite");

    if (button && selectedTicker === ticker) {
      const active = favorites.has(ticker);

      button.textContent = active ? "★" : "☆";
      button.classList.toggle("is-favorite", active);
      button.setAttribute(
        "aria-pressed",
        active ? "true" : "false"
      );
    }

    renderSignals();
  }

  // =========================================================
  // 3. 데이터 검증
  // =========================================================

  function normalizeSignal(raw) {
    if (!isObject(raw)) {
      return null;
    }

    const ticker = normalizeTicker(raw.ticker);
    const name =
      typeof raw.name === "string" ? raw.name.trim() : "";
    const signal =
      typeof raw.signal === "string" ? raw.signal.trim() : "";

    const close = number(raw.close);
    const drawdown = number(
      raw.drawdown ?? raw.drawdown60_pct
    );
    const rsi14 = number(raw.rsi14);

    if (!/^[A-Z0-9.^_-]{1,20}$/.test(ticker)) {
      return null;
    }

    if (!name || name.length > 200) {
      return null;
    }

    if (!Object.prototype.hasOwnProperty.call(
      SIGNAL_STRENGTH,
      signal
    )) {
      return null;
    }

    if (!validDate(raw.date)) {
      return null;
    }

    if (close === null || close <= 0) {
      return null;
    }

    if (
      drawdown === null ||
      drawdown > 0 ||
      drawdown < -100
    ) {
      return null;
    }

    if (
      rsi14 === null ||
      rsi14 < 0 ||
      rsi14 > 100
    ) {
      return null;
    }

    return {
      ...raw,
      ticker,
      name,
      signal,
      close,
      drawdown,
      rsi14,
      date: raw.date
    };
  }

  function normalizePriceRows(source) {
    if (!Array.isArray(source)) {
      return [];
    }

    const byDate = new Map();

    for (const row of source) {
      if (!isObject(row) || !validDate(row.date)) {
        continue;
      }

      const open = number(row.open);
      const high = number(row.high);
      const low = number(row.low);
      const close = number(row.close);
      const volume = number(row.volume);

      if (
        [open, high, low, close].some(
          value => value === null || value <= 0
        )
      ) {
        continue;
      }

      if (
        high < low ||
        high < Math.max(open, close) ||
        low > Math.min(open, close)
      ) {
        continue;
      }

      if (volume !== null && volume < 0) {
        continue;
      }

      byDate.set(row.date, {
        date: row.date,
        open,
        high,
        low,
        close,
        volume: volume ?? 0
      });
    }

    return [...byDate.values()].sort(
      (a, b) => a.date.localeCompare(b.date)
    );
  }

  function validateLatestData(raw) {
    if (!isObject(raw)) {
      throw new Error("최신 데이터가 JSON 객체가 아닙니다.");
    }

    if (!Array.isArray(raw.signals)) {
      throw new Error("signals 배열이 없거나 잘못되었습니다.");
    }

    for (const key of [
      "price_history",
      "macro",
      "macro_history",
      "company_info",
      "stock_info",
      "company_profiles",
      "profiles",
      "analyst_info",
      "analysts"
    ]) {
      if (
        raw[key] !== undefined &&
        !isObject(raw[key])
      ) {
        throw new Error(`${key} 데이터 형식이 잘못되었습니다.`);
      }
    }

    const cleanSignals = [];
    const seen = new Set();

    for (const rawItem of raw.signals) {
      const item = normalizeSignal(rawItem);

      if (!item || seen.has(item.ticker)) {
        continue;
      }

      seen.add(item.ticker);
      cleanSignals.push(item);
    }

    return {
      ...raw,
      signals: cleanSignals,
      price_history: raw.price_history || {},
      macro: raw.macro || {},
      macro_history: raw.macro_history || {}
    };
  }

  function getPriceRows(ticker) {
    return normalizePriceRows(
      latestData.price_history?.[ticker]
    );
  }

  // =========================================================
  // 4. 이동평균 및 RSI 계산
  // =========================================================

  function movingAverage(rows, period) {
    if (!Number.isInteger(period) || period < 1) {
      return rows.map(() => null);
    }

    return rows.map((row, index) => {
      if (index + 1 < period) {
        return null;
      }

      const start = index - period + 1;
      const slice = rows.slice(start, index + 1);

      if (
        slice.length !== period ||
        slice.some(item => number(item.close) === null)
      ) {
        return null;
      }

      const sum = slice.reduce(
        (total, item) => total + item.close,
        0
      );

      return sum / period;
    });
  }

  function calculateRSI(rows, period = 14) {
    const result = Array(rows.length).fill(null);

    if (
      !Number.isInteger(period) ||
      period < 1 ||
      rows.length <= period
    ) {
      return result;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const difference = rows[i].close - rows[i - 1].close;

      gains += Math.max(0, difference);
      losses += Math.max(0, -difference);
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    function currentRSI() {
      if (averageLoss === 0) {
        return averageGain === 0 ? 50 : 100;
      }

      const relativeStrength = averageGain / averageLoss;

      return 100 - 100 / (1 + relativeStrength);
    }

    result[period] = currentRSI();

    for (let i = period + 1; i < rows.length; i++) {
      const difference = rows[i].close - rows[i - 1].close;

      averageGain = (
        averageGain * (period - 1) +
        Math.max(0, difference)
      ) / period;

      averageLoss = (
        averageLoss * (period - 1) +
        Math.max(0, -difference)
      ) / period;

      result[i] = currentRSI();
    }

    return result;
  }

  // =========================================================
  // 5. 기업 정보 통합
  // =========================================================

  // =========================================================
  // 나스닥-100 종목별 섹터 매핑
  // 기존 데이터에 섹터가 없을 때 사용하는 대체 분류
  // =========================================================
  const SECTOR_BY_TICKER = {
    // 정보기술
    AAPL: "정보기술",
    AMD: "정보기술",
    ADI: "정보기술",
    ADP: "정보기술",
    AMAT: "정보기술",
    ARM: "정보기술",
    ASML: "정보기술",
    AVGO: "정보기술",
    CDNS: "정보기술",
    CSCO: "정보기술",
    CTSH: "정보기술",
    DELL: "정보기술",
    FTNT: "정보기술",
    INTC: "정보기술",
    INTU: "정보기술",
    KLAC: "정보기술",
    LRCX: "정보기술",
    MCHP: "정보기술",
    MRVL: "정보기술",
    MSFT: "정보기술",
    MU: "정보기술",
    NVDA: "정보기술",
    NXPI: "정보기술",
    ON: "정보기술",
    PANW: "정보기술",
    PLTR: "정보기술",
    QCOM: "정보기술",
    SNPS: "정보기술",
    STX: "정보기술",
    SNDK: "정보기술",
    TEAM: "정보기술",
    TXN: "정보기술",
    WDC: "정보기술",
    ZS: "정보기술",

    // 커뮤니케이션 서비스
    CHTR: "커뮤니케이션 서비스",
    CMCSA: "커뮤니케이션 서비스",
    EA: "커뮤니케이션 서비스",
    GOOG: "커뮤니케이션 서비스",
    GOOGL: "커뮤니케이션 서비스",
    META: "커뮤니케이션 서비스",
    NFLX: "커뮤니케이션 서비스",
    TMUS: "커뮤니케이션 서비스",
    TTWO: "커뮤니케이션 서비스",
    VRSK: "산업재",

    // 경기소비재
    ABNB: "경기소비재",
    AMZN: "경기소비재",
    BKNG: "경기소비재",
    DASH: "경기소비재",
    LULU: "경기소비재",
    MAR: "경기소비재",
    MELI: "경기소비재",
    ORLY: "경기소비재",
    PDD: "경기소비재",
    ROST: "경기소비재",
    SBUX: "경기소비재",
    TSLA: "경기소비재",

    // 필수소비재
    COST: "필수소비재",
    KDP: "필수소비재",
    MDLZ: "필수소비재",
    MNST: "필수소비재",
    PEP: "필수소비재",
    WMT: "필수소비재",

    // 헬스케어
    AMGN: "헬스케어",
    BIIB: "헬스케어",
    DXCM: "헬스케어",
    GILD: "헬스케어",
    IDXX: "헬스케어",
    ISRG: "헬스케어",
    MRNA: "헬스케어",
    REGN: "헬스케어",
    VRTX: "헬스케어",

    // 산업재
    ADIY: "산업재",
    HON: "산업재",
    PCAR: "산업재",
    PAYX: "산업재",
    FAST: "산업재",
    CTAS: "산업재",
    CPRT: "산업재",
    ODFL: "산업재",
    ROP: "산업재",
    AXON: "산업재",

    // 유틸리티
    AEP: "유틸리티",
    CEG: "유틸리티",
    XEL: "유틸리티",

    // 소재
    LIN: "소재",

    // 에너지
    FANG: "에너지",

    // 금융·기타 업종으로 분류될 수 있는 종목
    PYPL: "금융",
    COIN: "금융",
    HOOD: "금융",
    MSTR: "정보기술",
    SHOP: "경기소비재"
  };


  function getCompanyMeta(item) {
    const ticker = normalizeTicker(item.ticker);

    const companyInfo = latestData.company_info || {};
    const stockInfo = latestData.stock_info || {};
    const universe = latestData.universe || {};
    const companies = latestData.companies || {};
    const profiles = latestData.company_profiles || {};
    const alternateProfiles = latestData.profiles || {};

    const base =
      companyInfo[ticker] ||
      stockInfo[ticker] ||
      universe[ticker] ||
      companies[ticker] ||
      {};

    const profile =
      profiles[ticker] ||
      alternateProfiles[ticker] ||
      {};

    const meta = { ...profile, ...base };

    const price = number(
      meta.current_price ??
      meta.currentPrice ??
      meta.price ??
      item.current_price ??
      item.close
    );

    const change = number(
      meta.change ??
      meta.price_change ??
      meta.priceChange ??
      item.change
    );

    const changePct = number(
      meta.change_percent ??
      meta.change_pct ??
      meta.changePercent ??
      item.change_percent ??
      item.change_pct
    );

    const cap = number(
      meta.market_cap ??
      meta.marketCap ??
      meta.market_capitalization ??
      item.market_cap ??
      item.marketCap
    );

    // 실제 데이터의 섹터를 우선 사용하고,
    // 없으면 티커별 대체 분류표를 사용한다.
    const sectorCandidates = [
      meta.sector,
      meta.gics_sector,
      meta.gicsSector,
      item.sector,
      latestData.sectors?.[ticker],
      SECTOR_BY_TICKER[ticker]
    ];

    const sector = sectorCandidates.find(
      value =>
        typeof value === "string" &&
        value.trim().length > 0
    ) || UNKNOWN_SECTOR;

    const exchange =
      meta.index ||
      meta.exchange ||
      item.index ||
      "나스닥-100";

    return {
      meta,
      price,
      change,
      changePct,
      cap,
      sector,
      exchange
    };
  }


  // =========================================================
  // 6. 페이지 이동
  // =========================================================

  function showPage(name) {
    $$(".tabs [data-page]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === name
      );
    });

    $$(".page").forEach(page => {
      page.classList.toggle(
        "active",
        page.id === `page-${name}`
      );
    });

    if (name === "detail") {
      requestAnimationFrame(drawDetailCharts);
    }
  }

  // =========================================================
  // 7. 시장 요약
  // =========================================================

  // 비트코인: 현재가(카드 본문), 24시간 등락률, 7일 추세를 일봉 이력으로 계산
  function bitcoinTrendMarkup(source) {
    const rows = safeArray(source)
      .filter(row =>
        isObject(row) &&
        validDate(row.date) &&
        number(row.close) !== null
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    if (rows.length < 2) {
      return '<div class="macro-trend"><span>24시간·7일 데이터 부족</span></div>';
    }

    const lastIndex = rows.length - 1;
    const last = number(rows[lastIndex].close);
    const previous = number(rows[lastIndex - 1].close);
    const weekAgo = lastIndex >= 7
      ? number(rows[lastIndex - 7].close)
      : null;

    const change24 =
      previous !== null && previous > 0
        ? (last / previous - 1) * 100
        : null;

    const change7 =
      weekAgo !== null && weekAgo > 0
        ? (last / weekAgo - 1) * 100
        : null;

    const tone = value =>
      value === null
        ? "neutral"
        : value < 0
          ? "negative"
          : "positive";

    const trendLabel =
      change7 === null
        ? ""
        : change7 >= 0
          ? " 상승"
          : " 하락";

    return `
      <div class="macro-trend">
        <span>24시간 <b class="${tone(change24)}">${safe(signed(change24))}</b></span>
        <span>7일 <b class="${tone(change7)}">${safe(signed(change7))}${safe(trendLabel)}</b></span>
      </div>`;
  }

  function renderMacro(data) {
    const macro = data.macro || {};
    const values = macro.values || {};
    const histories = data.macro_history || {};

    setHTML(
      "#marketState",
      `<div class="state-title">시장 상태</div>
       <h3>${safe(macro.state || "분석 데이터 대기")}</h3>
       <p>${safe(macro.reason || "시장 지표 연결 대기 중입니다.")}</p>`
    );

    const container = $("#macroMetrics");

    if (!container) {
      return;
    }

    container.innerHTML = MACRO_NAMES.map((name, index) => {
      const raw = values[name];
      const value = isObject(raw) ? raw.value : raw;
      const updatedAt =
        isObject(raw) && validDate(raw.updated_at)
          ? raw.updated_at
          : "데이터 미확인";

      const suffix = name.includes("금리")
        ? "%"
        : name === "VIX"
          ? "pt"
          : "";

      const numericValue = number(value);

      return `
        <article class="metric macro-card">
          <span>${safe(name)}</span>
          <b>${numericValue === null
            ? "—"
            : safe(fmt(numericValue) + suffix)}</b>
          <small>${safe(updatedAt)}</small>
          ${name === "비트코인" ? bitcoinTrendMarkup(histories[name]) : ""}
          <div class="macro-chart-wrap">
            <canvas
              id="macroChart${index}"
              class="macro-chart"
              aria-label="${safe(name)} 최근 추이">
            </canvas>
          </div>
          <div class="macro-range">최근 30일</div>
        </article>`;
    }).join("");

    MACRO_NAMES.forEach((name, index) => {
      drawMacroChart(
        $(`#macroChart${index}`),
        histories[name] || []
      );
    });
  }

  function drawMacroChart(canvas, source) {
    if (!canvas) {
      return;
    }

    const rows = safeArray(source)
      .filter(row =>
        isObject(row) &&
        validDate(row.date) &&
        number(row.close) !== null
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    const last = rows.length
      ? new Date(`${rows[rows.length - 1].date}T12:00:00Z`)
      : null;

    const start = last
      ? new Date(last.getTime() - 30 * 86400000)
      : null;

    const visible = start
      ? rows.filter(row => {
          const date = new Date(`${row.date}T12:00:00Z`);
          return date >= start && date <= last;
        })
      : [];

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(120, canvas.clientWidth || 200);
    const height = 62;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (visible.length < 2) {
      ctx.fillStyle = "#98a2b3";
      ctx.font = "11px sans-serif";
      ctx.fillText("최근 데이터 부족", 4, 22);
      return;
    }

    const values = visible.map(row => number(row.close));
    let min = Math.min(...values);
    let max = Math.max(...values);

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return;
    }

    if (min === max) {
      const padding = Math.abs(max) * 0.01 || 1;
      min -= padding;
      max += padding;
    }

    ctx.strokeStyle = "#eaecf0";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 2; i++) {
      const y = 4 + (height - 8) * i / 2;
      ctx.beginPath();
      ctx.moveTo(3, y);
      ctx.lineTo(width - 3, y);
      ctx.stroke();
    }

    ctx.beginPath();

    values.forEach((value, index) => {
      const x = 3 + index / (values.length - 1) * (width - 6);
      const y = 4 + (max - value) / (max - min) * (height - 8);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.strokeStyle = "#3b5fe5";
    ctx.lineWidth = 1.7;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // =========================================================
  // 8. 종목 스캐너
  // =========================================================

  // 종목 카드 1개의 HTML (기존 카드 구조·표시 항목 그대로 유지)
  function renderSignalCard(item, meta) {
    const isFavorite = favorites.has(item.ticker);

    return `
        <article
          class="panel signal signal-clickable"
          data-ticker="${safe(item.ticker)}"
          tabindex="0"
          role="button"
          aria-label="${safe(item.ticker)} 상세 정보 보기">

          <div class="signal-card-top">
            <strong>${safe(item.ticker)} · ${safe(item.name)}</strong>
            <button
              type="button"
              class="signal-star ${isFavorite ? "is-favorite" : ""}"
              data-favorite="${safe(item.ticker)}"
              aria-label="관심 종목 ${safe(item.ticker)}"
              aria-pressed="${isFavorite}">
              ${isFavorite ? "★" : "☆"}
            </button>
          </div>

          <b>${safe(item.signal)}</b>
          <p>종가 ${fmt(item.close)} · 고점 대비 ${fmt(item.drawdown)}%</p>
          <small>RSI ${fmt(item.rsi14)} · 기준일 ${safe(item.date)}</small>

          <div class="card-meta-line">
            <span>${safe(meta.sector)}</span>
            <span>시총 ${safe(moneyCap(meta.cap))}</span>
          </div>

          <div class="card-hint">상세 차트 보기 →</div>
        </article>`;
  }

  // 영문(GICS·yfinance) 섹터명과 한글 대체 분류표가 섞여도
  // 같은 섹터가 두 그룹으로 갈라지지 않도록 그룹 제목만 통일한다.
  // (카드 안에 표시되는 meta.sector 값은 변경하지 않음)
  const SECTOR_ALIASES = {
    "information technology": "정보기술",
    "technology": "정보기술",
    "communication services": "커뮤니케이션 서비스",
    "communications": "커뮤니케이션 서비스",
    "consumer discretionary": "경기소비재",
    "consumer cyclical": "경기소비재",
    "consumer staples": "필수소비재",
    "consumer defensive": "필수소비재",
    "health care": "헬스케어",
    "healthcare": "헬스케어",
    "financials": "금융",
    "financial": "금융",
    "financial services": "금융",
    "industrials": "산업재",
    "energy": "에너지",
    "materials": "소재",
    "basic materials": "소재",
    "utilities": "유틸리티",
    "real estate": "부동산"
  };

  function sectorGroupLabel(sector) {
    const text = typeof sector === "string" ? sector.trim() : "";

    if (!text) {
      return UNKNOWN_SECTOR;
    }

    return SECTOR_ALIASES[text.toLowerCase()] || text;
  }

  // 화면 표시 단계에서만 섹터별로 묶는다. (signals 배열·filtered 배열은 변경하지 않음)
  // 각 섹터 내부는 기존 정렬 결과(filtered의 순서)를 그대로 유지한다.
  function groupBySector(items) {
    const groups = new Map();

    items.forEach(item => {
      const meta = getCompanyMeta(item);
      const sector = sectorGroupLabel(meta.sector);

      if (!groups.has(sector)) {
        groups.set(sector, []);
      }

      groups.get(sector).push({ item, meta });
    });

    // 종목 수 많은 섹터 먼저, 동수면 이름순, '섹터 미확인'은 항상 마지막
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === UNKNOWN_SECTOR && b[0] !== UNKNOWN_SECTOR) {
        return 1;
      }

      if (b[0] === UNKNOWN_SECTOR && a[0] !== UNKNOWN_SECTOR) {
        return -1;
      }

      if (b[1].length !== a[1].length) {
        return b[1].length - a[1].length;
      }

      return a[0].localeCompare(b[0], "ko");
    });
  }

  function renderSignals() {
    const search = ($("#search")?.value || "")
      .trim()
      .toLowerCase();

    const filter = $("#signalFilter")?.value || "all";
    const sort = $("#sort")?.value || "strength";

    const filtered = signals.filter(item => {
      const matchesSearch =
        `${item.ticker} ${item.name}`
          .toLowerCase()
          .includes(search);

      const matchesSignal =
        filter === "all" || item.signal === filter;

      return matchesSearch && matchesSignal;
    });

    filtered.sort((a, b) => {
      if (sort === "ticker") {
        return a.ticker.localeCompare(b.ticker);
      }

      if (sort === "drop") {
        return a.drawdown - b.drawdown;
      }

      return (
        (SIGNAL_STRENGTH[b.signal] || 0) -
        (SIGNAL_STRENGTH[a.signal] || 0)
      );
    });

    setText("#scanCount", `${filtered.length}개 신호`);

    const list = $("#signalList");

    if (!list) {
      return;
    }

    if (!filtered.length) {
      list.innerHTML = `
        <div class="panel">
          조건에 맞는 유효한 신호가 없습니다.
        </div>`;
      return;
    }

    list.innerHTML = groupBySector(filtered).map(([sector, entries]) => `
      <section class="sector-group" data-sector="${safe(sector)}">
        <h3 class="sector-group-title">
          <span>${safe(sector)}</span>
          <b>${entries.length}개 종목</b>
        </h3>
        <div class="sector-group-body">
          ${entries.map(entry => renderSignalCard(entry.item, entry.meta)).join("")}
        </div>
      </section>`
    ).join("");

    $$("#signalList [data-ticker]").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-favorite]")) {
          return;
        }

        openDetail(card.dataset.ticker);
      });

      card.addEventListener("keydown", event => {
        if (
          event.target !== card ||
          (event.key !== "Enter" && event.key !== " ")
        ) {
          return;
        }

        event.preventDefault();
        openDetail(card.dataset.ticker);
      });
    });

    $$("#signalList [data-favorite]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        toggleFavorite(button.dataset.favorite);
      });
    });
  }

  // =========================================================
  // 9. 상세 화면 보조 함수
  // =========================================================

  function metricTile(label, value, tone = "neutral", icon = "•") {
    return `
      <article class="sd-metric">
        <div class="sd-metric-head">
          <span>${safe(label)}</span>
          <i class="sd-icon ${safe(tone)}">${safe(icon)}</i>
        </div>
        <b class="${safe(tone)}">${safe(value)}</b>
      </article>`;
  }

  function getAnalystData(ticker, meta) {
    const root =
      latestData.analyst_info?.[ticker] ||
      latestData.analysts?.[ticker] ||
      meta.analyst_info ||
      meta.analysts ||
      {};

    const summary = root.summary || root.recommendations || root;

    const brokers = [
      root.brokers,
      root.reports,
      root.analyst_ratings
    ].find(Array.isArray) || [];

    const count = (...values) => {
      for (const value of values) {
        const n = number(value);

        if (n !== null) {
          return n;
        }
      }

      return null;
    };

    const strongBuy = count(
      summary.strongBuy,
      summary.strong_buy
    ) ?? 0;

    const buy = count(summary.buy) ?? 0;
    const hold = count(summary.hold) ?? 0;
    const sell = count(summary.sell) ?? 0;

    const strongSell = count(
      summary.strongSell,
      summary.strong_sell
    ) ?? 0;

    const hasRatings = [
      "strongBuy",
      "strong_buy",
      "buy",
      "hold",
      "sell",
      "strongSell",
      "strong_sell"
    ].some(key => number(summary[key]) !== null);

    return {
      root,
      summary,
      brokers,
      buyCount: hasRatings ? strongBuy + buy : null,
      holdCount: hasRatings ? hold : null,
      sellCount: hasRatings ? sell + strongSell : null,
      targetMean: count(
        summary.targetMean,
        summary.target_mean,
        summary.mean_target_price
      ),
      targetLow: count(
        summary.targetLow,
        summary.target_low,
        summary.low_target_price
      ),
      targetHigh: count(
        summary.targetHigh,
        summary.target_high,
        summary.high_target_price
      ),
      analystCount: count(
        summary.numberAnalysts,
        summary.number_of_analysts,
        summary.analyst_count
      )
    };
  }

  function renderAnalystSection(item, meta, price) {
    const data = getAnalystData(item.ticker, meta.meta);

    const targetUpside =
      data.targetMean !== null &&
      price !== null &&
      price > 0
        ? (data.targetMean / price - 1) * 100
        : null;

    const brokerRows = data.brokers
      .slice(0, 30)
      .filter(isObject)
      .map(row => {
        const firm =
          row.firm ||
          row.broker ||
          row.company ||
          row.organization ||
          "증권사 미확인";

        const rating =
          row.rating ||
          row.recommendation ||
          row.recommendationKey ||
          row.action ||
          "의견 미확인";

        const target = number(
          row.targetPrice ??
          row.target_price ??
          row.priceTarget ??
          row.target
        );

        const date =
          row.date ||
          row.updated_at ||
          row.period ||
          "기준일 미확인";

        return `
          <tr>
            <td>${safe(firm)}</td>
            <td>${safe(rating)}</td>
            <td>${target === null ? "—" : "$" + fmt(target)}</td>
            <td>${safe(date)}</td>
          </tr>`;
      })
      .join("");

    return `
      <section class="sd-analyst-card">
        <div class="sd-analyst-heading">
          <div>
            <p class="eyebrow">WALL STREET CONSENSUS</p>
            <h3>애널리스트 투자의견 · 목표가</h3>
          </div>
          <span class="sd-analyst-date">
            ${safe(
              data.root.updated_at ||
              data.root.updatedAt ||
              data.summary.updated_at ||
              "갱신일 미확인"
            )}
          </span>
        </div>

        <div class="sd-rating-grid">
          <div>
            <span>Buy</span>
            <b class="positive">
              ${data.buyCount === null ? "—" : fmt(data.buyCount, 0)}
            </b>
          </div>
          <div>
            <span>Hold</span>
            <b>
              ${data.holdCount === null ? "—" : fmt(data.holdCount, 0)}
            </b>
          </div>
          <div>
            <span>Sell</span>
            <b class="negative">
              ${data.sellCount === null ? "—" : fmt(data.sellCount, 0)}
            </b>
          </div>
        </div>

        <div class="sd-target-box">
          <div>
            <span>평균 목표가</span>
            <b>${data.targetMean === null ? "—" : "$" + fmt(data.targetMean)}</b>
          </div>
          <div>
            <span>현재가 대비</span>
            <b class="${
              targetUpside === null
                ? "neutral"
                : targetUpside >= 0
                  ? "positive"
                  : "negative"
            }">
              ${targetUpside === null ? "—" : signed(targetUpside)}
            </b>
          </div>
          <div>
            <span>최저 목표가</span>
            <b>${data.targetLow === null ? "—" : "$" + fmt(data.targetLow)}</b>
          </div>
          <div>
            <span>최고 목표가</span>
            <b>${data.targetHigh === null ? "—" : "$" + fmt(data.targetHigh)}</b>
          </div>
          <div>
            <span>애널리스트 수</span>
            <b>${data.analystCount === null ? "—" : fmt(data.analystCount, 0)}</b>
          </div>
        </div>

        <h4>증권사별 투자의견</h4>

        ${
          brokerRows
            ? `
              <div class="sd-broker-table-wrap">
                <table class="sd-broker-table">
                  <thead>
                    <tr>
                      <th>증권사</th>
                      <th>의견</th>
                      <th>목표가</th>
                      <th>기준일</th>
                    </tr>
                  </thead>
                  <tbody>${brokerRows}</tbody>
                </table>
              </div>`
            : `
              <p class="sd-analyst-empty">
                증권사별 개별 의견 데이터가 없습니다.
                실제 데이터가 연결되면 이 영역에 표시됩니다.
              </p>`
        }

        <p class="sd-analyst-disclaimer">
          애널리스트 의견과 목표가는 데이터 제공처의 갱신 시점에 따라 달라질 수 있습니다.
          데이터가 없는 항목은 임의로 추정하지 않습니다.
        </p>
      </section>`;
  }

  // =========================================================
  // 10. 상세 화면
  // =========================================================

  function openDetail(ticker) {
    const item = signals.find(
      row => row.ticker === ticker
    );

    if (!item) {
      return;
    }

    selectedTicker = ticker;
    chartPeriod = 90;
    indicatorTab = "rsi";

    setText(
      "#detailTitle",
      `${item.ticker} · ${item.name}`
    );

    renderDetail(item);
    showPage("detail");

    requestAnimationFrame(drawDetailCharts);
  }

  function renderDetail(item) {
    const rows = getPriceRows(item.ticker);
    const last = rows[rows.length - 1];
    const index = rows.length - 1;
    const meta = getCompanyMeta(item);

    const ma20 = movingAverage(rows, 20);
    const ma50 = movingAverage(rows, 50);
    const ma200 = movingAverage(rows, 200);
    const rsi14 = calculateRSI(rows, 14);
    const rsi5 = calculateRSI(rows, 5);

    const price = meta.price;

    const previousClose =
      rows.length > 1 ? rows[rows.length - 2].close : null;

    const calculatedChange =
      price !== null && previousClose !== null
        ? price - previousClose
        : null;

    const calculatedChangePct =
      calculatedChange !== null && previousClose > 0
        ? calculatedChange / previousClose * 100
        : null;

    const change =
      meta.change !== null ? meta.change : calculatedChange;

    const changePct =
      meta.changePct !== null
        ? meta.changePct
        : calculatedChangePct;

    const currentRSI = number(rsi14[index]);

    const rsi5Change =
      index >= 5 &&
      rsi5[index] !== null &&
      rsi5[index - 5] !== null
        ? rsi5[index] - rsi5[index - 5]
        : null;

    const high60 = rows
      .slice(-60)
      .reduce((maximum, row) => Math.max(maximum, row.high), 0);

    const low20 = rows.length
      ? rows.slice(-20).reduce(
          (minimum, row) => Math.min(minimum, row.low),
          Infinity
        )
      : null;

    const drawdown60 =
      high60 > 0 && price !== null
        ? (price / high60 - 1) * 100
        : null;

    const fromLow20 =
      low20 !== null &&
      Number.isFinite(low20) &&
      low20 > 0 &&
      price !== null
        ? (price / low20 - 1) * 100
        : null;

    function movingAverageGap(series) {
      const average = number(series[index]);

      if (average === null || average <= 0 || price === null) {
        return null;
      }

      return (price / average - 1) * 100;
    }

    const ma20Gap = movingAverageGap(ma20);
    const ma50Gap = movingAverageGap(ma50);
    const ma200Gap = movingAverageGap(ma200);

    const last20 = rows.slice(-20);
    const avgVolume =
      last20.length === 20
        ? last20.reduce((sum, row) => sum + row.volume, 0) / 20
        : null;

    const volumeRatio =
      avgVolume !== null &&
      avgVolume > 0 &&
      last
        ? last.volume / avgVolume
        : null;

    const downTone = value =>
      number(value) === null
        ? "neutral"
        : value < 0
          ? "negative"
          : "positive";

    const rsiTone = value =>
      number(value) === null
        ? "neutral"
        : value < 30
          ? "positive"
          : value > 70
            ? "negative"
            : "blue";

    const positive = [];
    const caution = [];
    const watch = [];

    if (currentRSI !== null && index >= 5 && rsi14[index - 5] !== null) {
      if (currentRSI > rsi14[index - 5]) {
        positive.push("RSI 5거래일 전 대비 상승");
      } else if (currentRSI < rsi14[index - 5]) {
        caution.push("RSI 5거래일 전 대비 하락");
      }
    }

    if (volumeRatio !== null && volumeRatio > 1.2) {
      positive.push(`거래량 평균 대비 ${volumeRatio.toFixed(2)}배`);
    }

    if (fromLow20 !== null && fromLow20 > 0) {
      positive.push(`20일 저점 대비 ${signed(fromLow20)}`);
    }

    if (ma50Gap !== null && ma50Gap < 0) {
      caution.push("MA50 아래에서 거래 중");
    }

    if (ma200Gap !== null && ma200Gap < 0) {
      caution.push("MA200 아래에서 거래 중");
    }

    if (currentRSI !== null && currentRSI < 30) {
      caution.push("RSI 과매도 구간");
    }

    if (!positive.length) {
      positive.push("뚜렷한 단기 반등 신호 미확인");
    }

    if (!caution.length) {
      caution.push("주요 이동평균 및 거래량 지속 확인");
    }

    watch.push(
      "20일 이동평균선 회복 여부",
      "다음 실적 발표 및 공시 일정"
    );

    const memoDate = last?.date || item.date;
    const storedMemo = meta.meta.memo || item.memo || "";

    const memoText = storedMemo ||
      [
        drawdown60 !== null
          ? `60일 고점 대비 ${Math.abs(drawdown60).toFixed(1)}% 조정.`
          : "",
        currentRSI !== null
          ? `RSI(14)는 ${currentRSI.toFixed(1)}.`
          : "",
        volumeRatio !== null
          ? `거래량은 20일 평균 대비 ${volumeRatio.toFixed(2)}배.`
          : "",
        ma50Gap !== null
          ? `MA50 대비 ${signed(ma50Gap)}.`
          : "",
        ma200Gap !== null
          ? `MA200 대비 ${signed(ma200Gap)}.`
          : "",
        "지표는 참고용이며 추가 추세 확인이 필요합니다."
      ].filter(Boolean).join(" ");

    const favorite = favorites.has(item.ticker);

    const changeText =
      change === null && changePct === null
        ? "등락 데이터 미확인"
        : [
            change === null
              ? ""
              : `${change > 0 ? "+" : ""}${fmt(change)}`,
            changePct === null
              ? ""
              : `(${signed(changePct)})`
          ].filter(Boolean).join(" ");

    const changeClass =
      changePct === null
        ? "neutral"
        : changePct < 0
          ? "negative"
          : "positive";

    const priceText = price === null
      ? "—"
      : `$${fmt(price)}`;

    const analystMarkup = renderAnalystSection(
      item,
      meta,
      price
    );

    setHTML("#detailBody", `
      <div class="sd-detail">

        <div class="sd-back-row">
          <button type="button" id="sdBack" class="sd-back">
            ← 목록으로 돌아가기
          </button>

          <button
            type="button"
            id="sdFavorite"
            class="sd-favorite ${favorite ? "is-favorite" : ""}"
            aria-label="관심 종목"
            aria-pressed="${favorite}">
            ${favorite ? "★" : "☆"}
          </button>
        </div>

        <section class="sd-identity">
          <div class="sd-logo">${safe(item.ticker.slice(0, 1))}</div>

          <div class="sd-name">
            <h2>${safe(item.ticker)}</h2>
            <p>${safe(meta.meta.company_name || item.name)}</p>
          </div>

          <div class="sd-tags">
            <span>${safe(meta.sector)}</span>
            <span>${safe(meta.exchange)}</span>
          </div>
        </section>

        <section class="sd-price-row">
          <div>
            <div class="sd-price">
              ${safe(priceText)}
              <span class="${changeClass}">${safe(changeText)}</span>
            </div>
            <div class="sd-price-date">
              ${safe(last?.date || item.date)} · USD
            </div>
          </div>

          <div class="sd-signal">
            <small>신호</small>
            <b>${safe(item.signal)}</b>
          </div>
        </section>

        <section class="sd-chart-card">
          <div class="sd-chart-controls">
            <div class="sd-periods">
              <button type="button" data-period="30">1개월</button>
              <button type="button" data-period="90" class="active">3개월</button>
              <button type="button" data-period="180">6개월</button>
              <button type="button" data-period="365">1년</button>
            </div>

            <div class="sd-legend">
              <span class="ma20-label">● MA20</span>
              <span class="ma50-label">● MA50</span>
              <span class="ma200-label">● MA200</span>
            </div>
          </div>

          <div id="chartMessage" class="muted chart-message"></div>

          <div class="detail-canvas-wrap">
            <canvas
              id="priceChart"
              aria-label="캔들스틱 및 거래량 차트">
            </canvas>
          </div>
        </section>

        <section class="sd-indicator-card">
          <div class="sd-indicator-tabs">
            <button type="button" data-indicator="rsi" class="active">RSI (14)</button>
            <button type="button" data-indicator="volume">거래량</button>
          </div>

          <div id="indicatorMessage" class="muted chart-message"></div>

          <div class="indicator-canvas-wrap">
            <canvas
              id="indicatorChart"
              aria-label="RSI 및 거래량 차트">
            </canvas>
          </div>
        </section>

        <section class="sd-metrics">
          ${metricTile("60일 고점 대비", signed(drawdown60), downTone(drawdown60), "↓")}
          ${metricTile("RSI (14)", fmt(currentRSI, 1), rsiTone(currentRSI), "∿")}
          ${metricTile("RSI 5일 변화", signed(rsi5Change), downTone(rsi5Change), "↑")}
          ${metricTile("20일 저점 대비", signed(fromLow20), downTone(fromLow20), "↑")}
          ${metricTile("MA20 대비", signed(ma20Gap), downTone(ma20Gap), "↘")}
          ${metricTile("MA50 대비", signed(ma50Gap), downTone(ma50Gap), "↘")}
          ${metricTile("MA200 대비", signed(ma200Gap), downTone(ma200Gap), "↘")}
          ${metricTile("거래량 / 20일 평균", volumeRatio === null ? "—" : `${volumeRatio.toFixed(2)}배`, volumeRatio !== null && volumeRatio > 1 ? "blue" : "neutral", "▥")}
          ${metricTile("시가총액", moneyCap(meta.cap), "neutral", "▦")}
        </section>

        <section class="sd-memo">
          <header>
            <strong>▤ 관찰 메모</strong>
            <time>${safe(memoDate)} 기준</time>
          </header>

          <p>${safe(memoText)}</p>

          <div class="sd-factor positive">
            <b>⬆ 긍정 요인</b>
            <span>${safe(positive.join(" · "))}</span>
          </div>

          <div class="sd-factor negative">
            <b>⬇ 주의 요인</b>
            <span>${safe(caution.join(" · "))}</span>
          </div>

          <div class="sd-factor neutral">
            <b>⊙ 관찰 포인트</b>
            <span>${safe(watch.join(" · "))}</span>
          </div>

          <small class="sd-disclaimer">
            자동 계산 참고 정보이며 매수·매도 추천이 아닙니다.
            누락된 데이터는 임의 추정하지 않습니다.
          </small>
        </section>

        ${analystMarkup}
      </div>
    `);

    $("#sdBack")?.addEventListener("click", () => {
      showPage("scanner");
    });

    $("#sdFavorite")?.addEventListener("click", () => {
      toggleFavorite(item.ticker);
    });

    $$(".sd-periods [data-period]").forEach(button => {
      button.addEventListener("click", () => {
        const period = Number(button.dataset.period);

        if (!VALID_PERIODS.includes(period)) {
          return;
        }

        chartPeriod = period;

        $$(".sd-periods button").forEach(element => {
          element.classList.toggle(
            "active",
            element === button
          );
        });

        drawDetailCharts();
      });
    });

    $$(".sd-indicator-tabs [data-indicator]").forEach(button => {
      button.addEventListener("click", () => {
        const tab = button.dataset.indicator;

        if (tab !== "rsi" && tab !== "volume") {
          return;
        }

        indicatorTab = tab;

        $$(".sd-indicator-tabs button").forEach(element => {
          element.classList.toggle(
            "active",
            element === button
          );
        });

        drawIndicatorChart();
      });
    });

    requestAnimationFrame(drawDetailCharts);
  }

  // =========================================================
  // 11. 상세 캔들 차트
  // =========================================================

  function drawStockChart() {
    if (!selectedTicker) {
      return;
    }

    const all = getPriceRows(selectedTicker);
    const rows = all.slice(-chartPeriod);
    const canvas = $("#priceChart");

    if (!canvas) {
      return;
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(280, canvas.clientWidth || 320);
    const height = 285;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const message = $("#chartMessage");

    if (!rows.length) {
      ctx.fillStyle = "#667085";
      ctx.font = "13px sans-serif";
      ctx.fillText("가격 데이터가 없습니다.", 8, 25);

      if (message) {
        message.textContent = "저장된 가격 기록 없음";
      }

      return;
    }

    const left = 4;
    const right = 43;
    const top = 6;
    const bottom = 20;
    const separator = height * 0.70;
    const volumeTop = separator + 13;
    const volumeBottom = height - bottom;
    const plotWidth = Math.max(1, width - left - right);
    const plotHeight = separator - top - 6;
    const offset = all.length - rows.length;

    const ma20 = movingAverage(all, 20).slice(offset);
    const ma50 = movingAverage(all, 50).slice(offset);
    const ma200 = movingAverage(all, 200).slice(offset);

    const prices = [];

    rows.forEach(row => {
      prices.push(row.high, row.low);
    });

    [ma20, ma50, ma200].forEach(series => {
      series.forEach(value => {
        if (value !== null && Number.isFinite(value)) {
          prices.push(value);
        }
      });
    });

    let min = Math.min(...prices);
    let max = Math.max(...prices);

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      if (message) {
        message.textContent = "가격 데이터를 검증할 수 없습니다.";
      }

      return;
    }

    const padding = (max - min || Math.abs(max) * 0.04 || 1) * 0.04;

    min -= padding;
    max += padding;

    const y = value =>
      top + (max - value) / (max - min) * plotHeight;

    const step = plotWidth / rows.length;
    const candleWidth = Math.max(
      1,
      Math.min(8, step * 0.65)
    );

    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4;
      const yy = top + plotHeight * (1 - i / 4);

      ctx.strokeStyle = "#eaecf0";
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(width - right, yy);
      ctx.stroke();

      ctx.fillStyle = "#667085";
      ctx.fillText(fmt(value, 1), width - 2, yy);
    }

    rows.forEach((row, index) => {
      const x = left + step * (index + 0.5);
      const rising = row.close >= row.open;
      const color = rising ? "#16845b" : "#c03939";

      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.moveTo(x, y(row.high));
      ctx.lineTo(x, y(row.low));
      ctx.stroke();

      const bodyTop = y(Math.max(row.open, row.close));
      const bodyBottom = y(Math.min(row.open, row.close));

      ctx.fillRect(
        x - candleWidth / 2,
        bodyTop,
        candleWidth,
        Math.max(1, bodyBottom - bodyTop)
      );
    });

    function drawMA(series, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;

      let started = false;

      series.forEach((value, index) => {
        if (value === null || !Number.isFinite(value)) {
          started = false;
          return;
        }

        const x = left + step * (index + 0.5);

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

    const maxVolume = Math.max(
      1,
      ...rows.map(row => row.volume || 0)
    );

    const volumeHeight = volumeBottom - volumeTop;

    rows.forEach((row, index) => {
      const x = left + step * (index + 0.5);
      const barHeight =
        (row.volume || 0) / maxVolume * volumeHeight;

      ctx.fillStyle =
        row.close >= row.open ? "#16845b" : "#c03939";

      ctx.fillRect(
        x - candleWidth / 2,
        volumeBottom - barHeight,
        Math.max(1, candleWidth),
        barHeight
      );
    });

    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillStyle = "#667085";
    ctx.fillText(rows[0].date.slice(5), left, height - 1);

    ctx.textAlign = "right";
    ctx.fillText(
      rows[rows.length - 1].date.slice(5),
      width - right,
      height - 1
    );

    if (message) {
      message.textContent =
        `${rows.length}개 거래일 · ` +
        `${rows[0].date} ~ ${rows[rows.length - 1].date}`;
    }
  }

  // 거래량 등 큰 수를 짧게 표시
  function compactNumber(value) {
    const n = number(value);

    if (n === null) {
      return "—";
    }

    if (n >= 1e9) {
      return `${(n / 1e9).toFixed(1)}B`;
    }

    if (n >= 1e6) {
      return `${(n / 1e6).toFixed(1)}M`;
    }

    if (n >= 1e3) {
      return `${(n / 1e3).toFixed(1)}K`;
    }

    return fmt(n, 0);
  }

  // 메인 차트와 같은 기간·같은 가로 간격을 사용하는 RSI / 거래량 차트
  function drawIndicatorChart() {
    const canvas = $("#indicatorChart");

    if (!canvas || !selectedTicker) {
      return;
    }

    const all = getPriceRows(selectedTicker);
    const rows = all.slice(-chartPeriod);
    const offset = all.length - rows.length;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(280, canvas.clientWidth || 320);
    const height = 150;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const message = $("#indicatorMessage");

    if (!rows.length) {
      ctx.fillStyle = "#667085";
      ctx.font = "13px sans-serif";
      ctx.fillText("가격 데이터가 없습니다.", 8, 25);

      if (message) {
        message.textContent = "저장된 가격 기록 없음";
      }

      return;
    }

    const left = 4;
    const right = 43;
    const top = 8;
    const bottom = 18;
    const plotWidth = Math.max(1, width - left - right);
    const plotHeight = height - top - bottom;
    const step = plotWidth / rows.length;
    const x = index => left + step * (index + 0.5);

    ctx.font = "10px sans-serif";
    ctx.textBaseline = "middle";

    if (indicatorTab === "volume") {
      const volumes = rows.map(row => row.volume || 0);
      const maxVolume = Math.max(1, ...volumes);

      const average20 = movingAverage(
        all.map(row => ({ close: row.volume || 0 })),
        20
      ).slice(offset);

      const barWidth = Math.max(1, Math.min(8, step * 0.65));

      [0, 0.5, 1].forEach(ratio => {
        const yy = top + plotHeight * (1 - ratio);

        ctx.strokeStyle = "#eaecf0";
        ctx.beginPath();
        ctx.moveTo(left, yy);
        ctx.lineTo(width - right, yy);
        ctx.stroke();

        ctx.fillStyle = "#667085";
        ctx.textAlign = "right";
        ctx.fillText(
          compactNumber(maxVolume * ratio),
          width - 2,
          yy
        );
      });

      rows.forEach((row, index) => {
        const barHeight =
          (row.volume || 0) / maxVolume * plotHeight;

        ctx.fillStyle =
          row.close >= row.open ? "#16845b" : "#c03939";

        ctx.fillRect(
          x(index) - barWidth / 2,
          top + plotHeight - barHeight,
          barWidth,
          barHeight
        );
      });

      ctx.beginPath();
      ctx.strokeStyle = "#e69b27";
      ctx.lineWidth = 1.2;

      let started = false;

      average20.forEach((value, index) => {
        if (value === null || !Number.isFinite(value)) {
          started = false;
          return;
        }

        const yy = top + plotHeight * (1 - value / maxVolume);

        if (!started) {
          ctx.moveTo(x(index), yy);
          started = true;
        } else {
          ctx.lineTo(x(index), yy);
        }
      });

      ctx.stroke();

      if (message) {
        const lastAverage = average20[average20.length - 1];

        message.textContent =
          `거래량 ${compactNumber(volumes[volumes.length - 1])}` +
          ` · 20일 평균 ${compactNumber(lastAverage)}`;
      }
    } else {
      const rsi = calculateRSI(all, 14).slice(offset);
      const y = value => top + (100 - value) / 100 * plotHeight;

      [30, 50, 70].forEach(level => {
        ctx.strokeStyle = level === 50 ? "#eaecf0" : "#d0d5dd";

        if (ctx.setLineDash) {
          ctx.setLineDash(level === 50 ? [] : [4, 3]);
        }

        ctx.beginPath();
        ctx.moveTo(left, y(level));
        ctx.lineTo(width - right, y(level));
        ctx.stroke();

        ctx.fillStyle = "#667085";
        ctx.textAlign = "right";
        ctx.fillText(String(level), width - 2, y(level));
      });

      if (ctx.setLineDash) {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.strokeStyle = "#245eea";
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";

      let started = false;

      rsi.forEach((value, index) => {
        if (value === null || !Number.isFinite(value)) {
          started = false;
          return;
        }

        if (!started) {
          ctx.moveTo(x(index), y(value));
          started = true;
        } else {
          ctx.lineTo(x(index), y(value));
        }
      });

      ctx.stroke();

      if (message) {
        const lastValue = rsi[rsi.length - 1];

        message.textContent =
          `RSI(14) ${fmt(lastValue, 1)} · 30 이하 과매도 / 70 이상 과매수 구간`;
      }
    }

    ctx.textBaseline = "bottom";
    ctx.fillStyle = "#667085";
    ctx.textAlign = "left";
    ctx.fillText(rows[0].date.slice(5), left, height - 1);

    ctx.textAlign = "right";
    ctx.fillText(
      rows[rows.length - 1].date.slice(5),
      width - right,
      height - 1
    );
  }

  function drawDetailCharts() {
    drawStockChart();
    drawIndicatorChart();
  }

  // =========================================================
  // 12. 신호 성과 및 이력
  // =========================================================

  function calculatePerformance() {
    const targets = [5, 10, 20];
    const entries = [];
    const seen = new Set();

    for (const record of historyRecords) {
      if (!isObject(record) || !Array.isArray(record.signals)) {
        continue;
      }

      for (const raw of record.signals) {
        if (!isObject(raw)) {
          continue;
        }

        const ticker = normalizeTicker(raw.ticker);
        const date = raw.date || record.scan_date || record.date;
        const signal = String(raw.signal || "");

        if (!ticker || !validDate(date)) {
          continue;
        }

        const key = `${ticker}|${date}|${signal}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        const rows = getPriceRows(ticker);
        const signalIndex = rows.findIndex(row => row.date >= date);

        if (signalIndex < 0) {
          continue;
        }

        const entry = rows[signalIndex + 1];

        if (!entry || entry.open <= 0) {
          continue;
        }

        const result = {
          ticker,
          signal,
          date,
          entryDate: entry.date
        };

        targets.forEach(days => {
          const exit = rows[signalIndex + days + 1];

          result[days] = exit
            ? (exit.close / entry.open - 1) * 100
            : null;
        });

        entries.push(result);
      }
    }

    const summary = $("#performanceSummary");

    if (summary) {
      summary.innerHTML = targets.map(days => {
        const known = entries.filter(
          item =>
            item[days] !== null &&
            Number.isFinite(item[days])
        );

        const wins = known.filter(
          item => item[days] > 0
        ).length;

        const average = known.length
          ? known.reduce(
              (sum, item) => sum + item[days],
              0
            ) / known.length
          : null;

        const winRate = known.length
          ? `${(wins / known.length * 100).toFixed(1)}%`
          : "—";

        return `
          <article class="metric">
            <span>${days}거래일</span>
            <b>${average === null ? "—" : signed(average)}</b>
            <small>
              승률 ${winRate} · 확정 ${known.length} ·
              미확정 ${entries.length - known.length}
            </small>
          </article>`;
      }).join("");
    }

    const historyList = $("#historyList");

    if (!historyList) {
      return;
    }

    if (!entries.length) {
      historyList.innerHTML =
        '<p class="muted">성과를 계산할 신호 기록이 없습니다.</p>';
      return;
    }

    historyList.innerHTML = entries
      .slice()
      .reverse()
      .slice(0, 100)
      .map(item => {
        const results = targets.map(days =>
          `${days}일 ${
            item[days] === null
              ? "미확정"
              : signed(item[days])
          }`
        ).join(" · ");

        return `
          <div class="panel history-row">
            <strong>
              ${safe(item.ticker)} · ${safe(item.signal)}
            </strong>
            <div class="muted">
              신호일 ${safe(item.date)} ·
              진입일 ${safe(item.entryDate)}
            </div>
            <p>${safe(results)}</p>
          </div>`;
      }).join("");
  }

  async function loadHistory() {
    try {
      const response = await fetch(
        `./data/signal_history.json?t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`이력 파일 HTTP ${response.status}`);
      }

      const raw = await response.json();

      historyRecords = Array.isArray(raw)
        ? raw
        : isObject(raw) && Array.isArray(raw.records)
          ? raw.records
          : [];

      calculatePerformance();
    } catch (error) {
      historyRecords = [];

      setText(
        "#historyList",
        "이력을 불러오지 못했습니다."
      );

      console.error("[history]", error);
    }
  }

  // =========================================================
  // 13. 데이터 새로고침
  // =========================================================

  async function refreshData() {
    const button = $("#refreshData");

    if (!button || refreshInProgress) {
      return;
    }

    refreshInProgress = true;
    button.disabled = true;
    button.textContent = "불러오는 중…";

    try {
      const response = await fetch(
        `./data/latest.json?t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`최신 데이터 HTTP ${response.status}`);
      }

      const raw = await response.json();
      const validated = validateLatestData(raw);

      latestData = validated;
      signals = validated.signals;

      renderMacro(latestData);
      renderSignals();

      const updatedAt = validDate(latestData.updated_at)
        ? latestData.updated_at
        : latestData.updated_at || "시각 미확인";

      setText("#updated", `데이터 기준: ${updatedAt}`);

      const scanMeta = latestData.scan_meta || {};

      setText(
        "#scannerStatus",
        `검증 완료 · ${signals.length}개 유효 신호` +
          (scanMeta.is_full_nasdaq100 === false
            ? " · 대체 종목 목록 사용"
            : "")
      );

      await loadHistory();

      button.textContent = "✓ 갱신 완료";

      window.setTimeout(() => {
        if (button.isConnected && !refreshInProgress) {
          button.textContent = "↻ 새로고침";
        }
      }, 1600);
    } catch (error) {
      setText("#updated", "데이터 불러오기 실패");

      setText(
        "#scannerStatus",
        `데이터 오류: ${error.message || "원인을 확인할 수 없습니다."}`
      );

      button.textContent = "다시 시도";

      console.error("[data validation]", error);
    } finally {
      refreshInProgress = false;
      button.disabled = false;
    }
  }

  // =========================================================
  // 14. 추가 스타일
  // =========================================================

  function installExtraStyles() {
    if ($("#analystUiStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "analystUiStyles";

    style.textContent = `
      .card-meta-line {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 9px;
      }

      .card-meta-line span {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        background: #eef4ff;
        color: #34557a;
        font-size: 11px;
      }

      .signal-card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .signal-star {
        border: 0;
        background: transparent;
        color: #98a2b3;
        font-size: 23px;
        cursor: pointer;
      }

      .signal-star.is-favorite {
        color: #e6a817;
      }

      .sector-group {
        grid-column: 1 / -1;
        width: 100%;
        margin: 0 0 18px;
      }

      .sector-group-title {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin: 6px 2px 10px;
        padding-bottom: 8px;
        border-bottom: 2px solid #e4e7ec;
        font-size: 16px;
      }

      .sector-group-title b {
        color: #667085;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }

      .sector-group-body {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      @media (max-width: 560px) {
        .sector-group-body {
          grid-template-columns: 1fr;
        }
      }

      .macro-trend {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 10px;
        margin-top: 2px;
        color: #667085;
        font-size: 11px;
      }

      .macro-trend b {
        font-weight: 750;
      }

      .sd-indicator-card {
        padding: 12px 12px 7px;
        border: 1px solid #e4e7ec;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 2px 8px rgba(16,24,40,.025);
        margin-bottom: 14px;
      }

      .sd-indicator-tabs {
        display: flex;
        gap: 5px;
        margin-bottom: 8px;
      }

      .sd-indicator-tabs button {
        padding: 7px 11px;
        border: 0;
        border-radius: 999px;
        background: #f2f4f7;
        color: #475467;
        font-size: 12px;
      }

      .sd-indicator-tabs button.active {
        background: #245eea;
        color: #fff;
      }

      .indicator-canvas-wrap {
        width: 100%;
        height: 150px;
        overflow: hidden;
      }

      #indicatorChart {
        display: block;
        width: 100%;
        height: 150px;
      }

      .sd-analyst-card {
        margin: 14px 0;
        padding: 14px;
        border: 1px solid #e4e7ec;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 2px 8px rgba(16,24,40,.025);
      }

      .sd-analyst-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .sd-analyst-heading h3 {
        margin: 0 0 12px;
        font-size: 19px;
      }

      .sd-analyst-date {
        color: #667085;
        font-size: 10px;
        white-space: nowrap;
      }

      .sd-rating-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .sd-rating-grid > div {
        padding: 12px 6px;
        text-align: center;
        border: 1px solid #e4e7ec;
        border-radius: 12px;
        background: #f8fafc;
      }

      .sd-rating-grid span,
      .sd-target-box span {
        display: block;
        color: #667085;
        font-size: 12px;
      }

      .sd-rating-grid b {
        display: block;
        margin-top: 4px;
        font-size: 25px;
      }

      .sd-target-box {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 12px 0;
        border: 1px solid #e4e7ec;
        border-radius: 12px;
        overflow: hidden;
      }

      .sd-target-box > div {
        padding: 11px;
        border-bottom: 1px solid #e4e7ec;
      }

      .sd-target-box > div:nth-child(odd) {
        border-right: 1px solid #e4e7ec;
      }

      .sd-target-box b {
        display: block;
        margin-top: 4px;
        font-size: 19px;
        overflow-wrap: anywhere;
      }

      .sd-analyst-card h4 {
        margin: 14px 0 8px;
        font-size: 16px;
      }

      .sd-broker-table-wrap {
        width: 100%;
        overflow-x: auto;
      }

      .sd-broker-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .sd-broker-table th,
      .sd-broker-table td {
        padding: 9px 7px;
        text-align: left;
        border-bottom: 1px solid #eaecf0;
        white-space: nowrap;
      }

      .sd-broker-table th {
        background: #f8fafc;
        color: #667085;
      }

      .sd-analyst-empty {
        padding: 12px;
        border-radius: 10px;
        background: #f8fafc;
        color: #667085;
        font-size: 13px;
        line-height: 1.6;
      }

      .sd-analyst-disclaimer {
        margin: 12px 0 0;
        color: #98a2b3;
        font-size: 10px;
        line-height: 1.6;
      }

      @media (max-width: 420px) {
        .sd-analyst-heading {
          flex-direction: column;
        }

        .sd-analyst-date {
          white-space: normal;
        }

        .sd-rating-grid b {
          font-size: 21px;
        }

        .sd-target-box b {
          font-size: 17px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  // =========================================================
  // 좌우 스와이프 화면 이동
  // =========================================================

  function visibleSwipePages() {
    return PAGE_ORDER.filter(name =>
      $(`#page-${name}`) &&
      (name !== "detail" || selectedTicker)
    );
  }

  function currentPageName() {
    return $(".tabs [data-page].active")?.dataset.page || "macro";
  }

  function installSwipeNavigation() {
    const area = $("main");

    if (!area) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    area.addEventListener("touchstart", event => {
      tracking = false;

      if (event.touches.length !== 1) {
        return;
      }

      const target = event.target;

      // 차트 조작, 입력창, 가로 스크롤 표에서 시작한 터치는 제외
      if (
        target &&
        target.closest &&
        target.closest(
          "canvas, input, select, textarea, .sd-broker-table-wrap"
        )
      ) {
        return;
      }

      const touch = event.touches[0];

      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
    }, { passive: true });

    area.addEventListener("touchend", event => {
      if (!tracking) {
        return;
      }

      tracking = false;

      const touch = event.changedTouches[0];

      if (!touch || Date.now() - startTime > 700) {
        return;
      }

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (
        Math.abs(dx) < 70 ||
        Math.abs(dx) < Math.abs(dy) * 1.5
      ) {
        return;
      }

      const pages = visibleSwipePages();
      const index = pages.indexOf(currentPageName());

      if (index < 0) {
        return;
      }

      const next = dx < 0 ? pages[index + 1] : pages[index - 1];

      if (!next) {
        return;
      }

      showPage(next);
      window.scrollTo({ top: 0 });
    }, { passive: true });
  }

  // =========================================================
  // 15. 초기화
  // =========================================================

  function initialize() {
    readFavorites();
    installExtraStyles();

    $$(".tabs [data-page]").forEach(button => {
      button.addEventListener("click", () => {
        showPage(button.dataset.page);
      });
    });

    $("#backScanner")?.addEventListener("click", () => {
      showPage("scanner");
    });

    $("#refreshData")?.addEventListener("click", refreshData);

    ["search", "signalFilter", "sort"].forEach(id => {
      const element = $("#" + id);

      element?.addEventListener("input", renderSignals);
      element?.addEventListener("change", renderSignals);
    });

    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);

      resizeTimer = window.setTimeout(() => {
        MACRO_NAMES.forEach((name, index) => {
          drawMacroChart(
            $(`#macroChart${index}`),
            latestData.macro_history?.[name] || []
          );
        });

        if (selectedTicker) {
          drawDetailCharts();
        }
      }, 120);
    });

    installSwipeNavigation();

    showPage("macro");
    refreshData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, {
      once: true
    });
  } else {
    initialize();
  }
})();
