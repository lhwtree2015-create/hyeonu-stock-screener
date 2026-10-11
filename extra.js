(() => {
  "use strict";

  const App = window.HyeonuApp;

  if (!App) {
    console.error("[extra] app.js가 먼저 로드되어야 합니다.");
    return;
  }

  const {
    $, $$, safe, fmt, signed, number, isObject, safeArray,
    sectorGroupLabel, openDetailAny, applyLiveQuotes
  } = App;

  const CONFIG = window.HYEONU_CONFIG || {};

  // =========================================================
  // 공통 도구
  // =========================================================

  async function fetchTimeout(url, options = {}, ms = 10000) {
    const controller = typeof AbortController === "function"
      ? new AbortController()
      : null;

    const timer = controller
      ? setTimeout(() => controller.abort(), ms)
      : null;

    try {
      return await fetch(url, controller
        ? { ...options, signal: controller.signal }
        : options);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function fetchJson(path) {
    try {
      const response = await fetchTimeout(
        `${path}?t=${Date.now()}`, { cache: "no-store" }, 20000
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.warn("[extra]", path, error);
      return null;
    }
  }

  async function pool(items, size, task) {
    let index = 0;

    const workers = Array.from(
      { length: Math.min(size, items.length) },
      async () => {
        while (index < items.length) {
          const item = items[index++];

          try {
            await task(item);
          } catch (error) {
            /* 개별 실패는 무시 */
          }
        }
      }
    );

    await Promise.all(workers);
  }

  function safeUrl(url) {
    return typeof url === "string" && /^https:\/\//.test(url) ? url : "";
  }

  function initial(text) {
    return String(text || "")
      .replace(/[^A-Za-z0-9가-힣]/g, "")
      .charAt(0)
      .toUpperCase() || "?";
  }

  function tone(value) {
    return value === null || value === undefined || value === 0
      ? "flat"
      : value > 0
        ? "up"
        : "down";
  }

  function priceUsd(value) {
    const n = number(value);

    if (n === null) {
      return "—";
    }

    const digits = n >= 1 ? 2 : n >= 0.01 ? 4 : 6;

    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: Math.min(digits, 2),
      maximumFractionDigits: digits
    })}`;
  }

  function compactUsd(value) {
    const n = number(value);

    if (n === null) {
      return "—";
    }

    if (n >= 1e12) {
      return `$${(n / 1e12).toFixed(2)}T`;
    }

    if (n >= 1e9) {
      return `$${(n / 1e9).toFixed(1)}B`;
    }

    if (n >= 1e6) {
      return `$${(n / 1e6).toFixed(1)}M`;
    }

    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  function titleCase(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\b([a-z])/g, match => match.toUpperCase());
  }

  function spark(values, color) {
    if (!Array.isArray(values) || values.length < 2) {
      return "";
    }

    const w = 120;
    const h = 44;
    const pad = 3;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    const points = values
      .map((value, index) =>
        `${(pad + index / (values.length - 1) * (w - pad * 2)).toFixed(1)},` +
        `${(pad + (max - value) / span * (h - pad * 2)).toFixed(1)}`
      )
      .join(" ");

    return `
      <svg class="sc-spark" viewBox="0 0 ${w} ${h}"
           preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${pad},${h} ${points} ${w - pad},${h}"
                 fill="${color}" opacity=".12"></polygon>
        <polyline points="${points}" fill="none" stroke="${color}"
                  stroke-width="1.6" stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"></polyline>
      </svg>`;
  }

  const TONE_COLOR = { up: "#d92d20", down: "#245eea", flat: "#98a2b3" };

  // =========================================================
  // 실시간 시세
  // =========================================================

  const liveMap = {};
  const failedProviders = new Set();
  let quoteBusy = false;
  let pollTick = 0;

  function setQuoteStatus(text) {
    const element = $("#quoteStatus");

    if (element) {
      element.textContent = text;
    }
  }

  async function quoteProxy(tickers) {
    const base = CONFIG.quoteProxy;

    if (!base || failedProviders.has("proxy") || !tickers.length) {
      return {};
    }

    try {
      const response = await fetchTimeout(
        `${base}${base.includes("?") ? "&" : "?"}symbols=${encodeURIComponent(tickers.join(","))}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      const out = {};

      Object.entries(isObject(json) ? json : {}).forEach(([ticker, quote]) => {
        if (number(quote?.price) > 0) {
          out[ticker] = { ...quote, source: "프록시" };
        }
      });

      return out;
    } catch (error) {
      failedProviders.add("proxy");
      return {};
    }
  }

  async function quoteFinnhub(tickers) {
    const key = CONFIG.finnhubKey;
    const targets = tickers.filter(
      ticker => !ticker.startsWith("^") && !ticker.endsWith("-USD")
    );

    if (!key || failedProviders.has("finnhub") || !targets.length) {
      return {};
    }

    const out = {};

    await pool(targets, 4, async ticker => {
      const response = await fetchTimeout(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker.replace("-", "."))}&token=${encodeURIComponent(key)}`
      );

      if (response.status === 401 || response.status === 403) {
        failedProviders.add("finnhub");
        throw new Error("Finnhub 키 오류");
      }

      if (!response.ok) {
        return;
      }

      const quote = await response.json();

      if (number(quote.c) > 0) {
        out[ticker] = {
          price: quote.c,
          change: number(quote.d),
          changePct: number(quote.dp),
          time: quote.t ? quote.t * 1000 : Date.now(),
          source: "Finnhub"
        };
      }
    });

    return out;
  }

  async function quoteYahoo(tickers) {
    const targets = tickers.filter(ticker => !ticker.endsWith("-USD"));

    if (failedProviders.has("yahoo") || !targets.length) {
      return {};
    }

    const out = {};
    let firstError = null;

    await pool(targets, 4, async ticker => {
      try {
        const response = await fetchTimeout(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const meta = (await response.json())?.chart?.result?.[0]?.meta;
        const price = number(meta?.regularMarketPrice);
        const previous = number(meta?.chartPreviousClose ?? meta?.previousClose);

        if (price !== null && price > 0) {
          out[ticker] = {
            price,
            change: previous ? price - previous : null,
            changePct: previous ? (price / previous - 1) * 100 : null,
            time: (meta.regularMarketTime || 0) * 1000 || Date.now(),
            source: "Yahoo"
          };
        }
      } catch (error) {
        firstError = firstError || error;
      }
    });

    // 브라우저 보안(CORS)에 막힌 경우 이번 접속에서는 다시 시도하지 않는다
    if (!Object.keys(out).length && firstError) {
      failedProviders.add("yahoo");
    }

    return out;
  }

  async function quoteCoins(tickers) {
    const targets = tickers.filter(ticker => ticker.endsWith("-USD"));

    if (!targets.length || failedProviders.has("coingecko")) {
      return {};
    }

    try {
      const response = await fetchTimeout(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1"
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const out = {};

      safeArray(await response.json()).forEach(coin => {
        const ticker = `${String(coin.symbol || "").toUpperCase()}-USD`;
        const price = number(coin.current_price);
        const pct = number(coin.price_change_percentage_24h);

        if (targets.includes(ticker) && price !== null && price > 0) {
          out[ticker] = {
            price,
            change: pct === null ? null : price - price / (1 + pct / 100),
            changePct: pct,
            time: Date.now(),
            source: "CoinGecko"
          };
        }
      });

      return out;
    } catch (error) {
      failedProviders.add("coingecko");
      return {};
    }
  }

  async function getQuotes(tickers) {
    const wanted = [...new Set(tickers)].filter(Boolean);
    const result = {};

    for (const provider of [quoteProxy, quoteFinnhub, quoteYahoo]) {
      const missing = wanted.filter(
        ticker => !result[ticker] && !ticker.endsWith("-USD")
      );

      if (!missing.length) {
        break;
      }

      Object.assign(result, await provider(missing));
    }

    Object.assign(result, await quoteCoins(wanted));

    return result;
  }

  function tickersForPage() {
    const page = App.getCurrentPage();

    if (page === "detail") {
      const ticker = App.getSelectedTicker();
      return ticker ? [ticker] : [];
    }

    if (page === "scanner") {
      return App.getSignals().map(item => item.ticker).slice(0, 25);
    }

    if (page === "universe") {
      return U.visible.slice(0, 25);
    }

    return [];
  }

  async function refreshQuotes() {
    if (quoteBusy) {
      return;
    }

    const tickers = tickersForPage();

    if (!tickers.length) {
      return;
    }

    quoteBusy = true;

    try {
      const quotes = await getQuotes(tickers);
      const got = Object.keys(quotes);

      if (got.length) {
        Object.assign(liveMap, quotes);
        applyLiveQuotes(quotes);

        if (App.getCurrentPage() === "universe") {
          renderUniverseList();
        }

        const sources = [...new Set(got.map(ticker => quotes[ticker].source))];
        const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });

        setQuoteStatus(`실시간 시세 · ${sources.join("/")} · ${time}`);
      } else {
        setQuoteStatus(
          "스캔 기준 시세 · 실시간 연결 안 됨 (config.js 설정 필요)"
        );
      }
    } finally {
      quoteBusy = false;
    }
  }

  function startPolling() {
    const seconds = Math.max(5, number(CONFIG.pollSeconds) || 15);

    setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      pollTick += 1;

      // 상세 화면은 매번, 목록 화면은 4번에 한 번만 (무료 한도 보호)
      if (App.getCurrentPage() === "detail" || pollTick % 4 === 0) {
        refreshQuotes();
      }
    }, seconds * 1000);
  }

  // =========================================================
  // 5. 전체 종목 페이지 (S&P 500 · 지수/ETF · 코인)
  // =========================================================

  const U = {
    items: [],
    loaded: false,
    error: "",
    search: "",
    kind: "all",
    sector: "all",
    sort: "cap",
    shown: 50,
    visible: [],
    ready: false
  };

  const KIND_LABEL = { stock: "S&P 500", fund: "지수·ETF", coin: "암호화폐" };

  function normalizeItem(raw) {
    return {
      ticker: String(raw.ticker || ""),
      display: String(raw.display || raw.ticker || ""),
      name: String(raw.name || raw.ticker || ""),
      kind: raw.kind === "coin" || raw.kind === "fund" ? raw.kind : "stock",
      sector: String(raw.sector || ""),
      price: number(raw.price),
      changePct: number(raw.change_pct),
      volume: number(raw.volume),
      marketCap: number(raw.market_cap),
      spark: safeArray(raw.spark).map(number).filter(value => value !== null)
    };
  }

  async function loadUniverse() {
    const json = await fetchJson("./data/universe.json");

    U.loaded = true;

    if (!isObject(json)) {
      U.items = [];
      U.error = "전체 종목 데이터가 아직 없습니다. Actions에서 'Daily Stock Scan'을 한 번 실행해 주세요.";
      return;
    }

    U.items = [...safeArray(json.stocks), ...safeArray(json.funds), ...safeArray(json.coins)]
      .filter(isObject)
      .map(normalizeItem)
      .filter(item => item.ticker);

    U.error = U.items.length ? "" : "표시할 종목이 없습니다.";
  }

  function currentChange(item) {
    return liveMap[item.ticker]?.changePct ?? item.changePct;
  }

  function universeFiltered(applyKind) {
    const query = U.search.trim().toLowerCase();

    return U.items.filter(item => {
      if (
        query &&
        !`${item.display} ${item.ticker} ${item.name}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }

      if (
        U.sector !== "all" &&
        !(item.kind === "stock" && sectorGroupLabel(item.sector) === U.sector)
      ) {
        return false;
      }

      return !applyKind || U.kind === "all" || item.kind === U.kind;
    });
  }

  const UNIVERSE_SORTS = {
    cap: (a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1),
    up: (a, b) => (currentChange(b) ?? -Infinity) - (currentChange(a) ?? -Infinity),
    down: (a, b) => (currentChange(a) ?? Infinity) - (currentChange(b) ?? Infinity),
    volume: (a, b) => (b.volume ?? -1) - (a.volume ?? -1),
    ticker: (a, b) => a.display.localeCompare(b.display)
  };

  function universeCard(item) {
    const live = liveMap[item.ticker];
    const price = live?.price ?? item.price;
    const pct = live?.changePct ?? item.changePct;
    const direction = tone(pct);

    const tags = item.kind === "stock"
      ? `<span class="sc-sector">S&amp;P 500</span><span class="x-tag-gray">${safe(item.sector)}</span>`
      : `<span class="sc-sector">${safe(item.kind === "coin" ? "암호화폐" : item.sector)}</span>`;

    return `
      <article class="panel signal signal-clickable sc-card"
        data-ticker="${safe(item.ticker)}" tabindex="0" role="button"
        aria-label="${safe(item.display)} 상세 정보 보기">
        <div class="sc-top">
          <div class="sc-logo">${safe(initial(item.display))}</div>
          <div class="sc-id">
            <div class="sc-id-row"><strong class="sc-ticker">${safe(item.display)}</strong></div>
            <span class="sc-name">${safe(item.name)}</span>
            <div class="x-tags">${tags}</div>
          </div>
          <div class="sc-spark-wrap">${spark(item.spark, TONE_COLOR[direction])}</div>
          <div class="sc-right">
            <b class="sc-price">${safe(priceUsd(price))}</b>
            <span class="sc-change x-${direction}">${
              pct === null ? "—" : `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${safe(Math.abs(pct).toFixed(2))}%`
            }</span>
          </div>
          <span class="sc-chevron" aria-hidden="true">›</span>
        </div>
      </article>`;
  }

  function miniCard(ticker) {
    const item = U.items.find(entry => entry.ticker === ticker);

    if (!item) {
      return "";
    }

    const live = liveMap[ticker];
    const pct = live?.changePct ?? item.changePct;
    const direction = tone(pct);

    return `
      <button type="button" class="x-mini" data-ticker="${safe(ticker)}">
        <span class="sc-logo">${safe(initial(item.display))}</span>
        <span class="x-mini-body">
          <b>${safe(item.display)}</b>
          <span>${safe(priceUsd(live?.price ?? item.price))}</span>
          <em class="x-${direction}">${pct === null ? "—" : `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${safe(Math.abs(pct).toFixed(2))}%`}</em>
        </span>
      </button>`;
  }

  function renderUniverseChips() {
    const base = universeFiltered(false);
    const count = kind => base.filter(item => item.kind === kind).length;

    const chip = (key, label, total) =>
      `<button type="button" class="sc-chip ${U.kind === key ? "active" : ""}" data-kind="${key}">${label} (${total})</button>`;

    $("#uChips").innerHTML =
      chip("all", "전체", base.length) +
      chip("stock", "S&P 500", count("stock")) +
      chip("fund", "지수상품", count("fund")) +
      chip("coin", "암호화폐", count("coin"));
  }

  function renderUniverseList() {
    const list = $("#uList");

    if (!list) {
      return;
    }

    if (!U.loaded) {
      list.innerHTML = '<div class="panel">불러오는 중…</div>';
      return;
    }

    if (U.error) {
      list.innerHTML = `<div class="panel">${safe(U.error)}</div>`;
      U.visible = [];
      return;
    }

    const filtered = universeFiltered(true).sort(UNIVERSE_SORTS[U.sort] || UNIVERSE_SORTS.cap);
    const shown = filtered.slice(0, U.shown);

    U.visible = shown.map(item => item.ticker);

    list.innerHTML = shown.length
      ? shown.map(universeCard).join("") +
        (filtered.length > shown.length
          ? `<button type="button" class="x-more" data-more="1">더 보기 (남은 ${filtered.length - shown.length}개)</button>`
          : "")
      : '<div class="panel">조건에 맞는 종목이 없습니다.</div>';
  }

  function renderUniverseAll() {
    renderUniverseChips();
    $("#uTop").innerHTML = ["^GSPC", "QQQ", "BTC-USD"].map(miniCard).join("");
    renderUniverseList();
  }

  function updateSectorOptions() {
    const select = $("#uSector");
    const labels = [...new Set(
      U.items.filter(item => item.kind === "stock").map(item => sectorGroupLabel(item.sector))
    )].sort((a, b) => a.localeCompare(b, "ko"));

    select.innerHTML =
      '<option value="all">전체 섹터</option>' +
      labels.map(label => `<option value="${safe(label)}">${safe(label)}</option>`).join("");

    select.value = labels.includes(U.sector) ? U.sector : "all";
    U.sector = select.value;
  }

  function buildUniverse() {
    const root = $("#universeRoot");

    root.innerHTML = `
      <h2 class="x-title">전체 종목 스캐너</h2>
      <p class="x-sub">S&amp;P 500, 주요 지수·ETF, 암호화폐 시총 상위 10개를 한눈에 확인하세요.</p>
      <div class="x-search">
        <span class="x-search-icon" aria-hidden="true">⌕</span>
        <input id="uSearch" type="search" placeholder="종목명 또는 티커 검색 (예: AAPL, Tesla)">
      </div>
      <div id="uChips" class="sc-chips"></div>
      <div class="x-sortrow">
        <span class="sc-sort-label">정렬 기준</span>
        <select id="uSort" aria-label="정렬 기준">
          <option value="cap">시가총액 높은 순</option>
          <option value="up">상승률 높은 순</option>
          <option value="down">하락률 높은 순</option>
          <option value="volume">거래량 많은 순</option>
          <option value="ticker">티커순</option>
        </select>
        <select id="uSector" aria-label="섹터"><option value="all">전체 섹터</option></select>
      </div>
      <div id="uTop" class="x-minis"></div>
      <div id="uList" class="x-list"></div>`;

    $("#uSearch").addEventListener("input", event => {
      U.search = event.target.value;
      U.shown = 50;
      renderUniverseChips();
      renderUniverseList();
    });

    $("#uSort").addEventListener("change", event => {
      U.sort = event.target.value;
      U.shown = 50;
      renderUniverseList();
    });

    $("#uSector").addEventListener("change", event => {
      U.sector = event.target.value;
      U.shown = 50;
      renderUniverseChips();
      renderUniverseList();
    });

    root.addEventListener("click", event => {
      const chip = event.target.closest("[data-kind]");

      if (chip) {
        U.kind = chip.dataset.kind;
        U.shown = 50;
        renderUniverseChips();
        renderUniverseList();
        return;
      }

      if (event.target.closest("[data-more]")) {
        U.shown += 50;
        renderUniverseList();
        return;
      }

      const card = event.target.closest("[data-ticker]");

      if (card) {
        openUniverseDetail(card.dataset.ticker);
      }
    });

    root.addEventListener("keydown", event => {
      const card = event.target.closest?.("[data-ticker]");

      if (card && event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openUniverseDetail(card.dataset.ticker);
      }
    });
  }

  function openUniverseDetail(ticker) {
    const item = U.items.find(entry => entry.ticker === ticker);

    if (!item) {
      return;
    }

    openDetailAny(item.ticker, {
      name: item.name,
      kind: item.kind,
      sector: item.kind === "stock" ? item.sector : item.kind === "coin" ? "암호화폐" : item.sector,
      index: KIND_LABEL[item.kind],
      marketCap: item.marketCap,
      price: liveMap[ticker]?.price ?? item.price
    });
  }

  async function ensureUniverse(force) {
    if (!U.loaded || force) {
      await loadUniverse();

      if (U.ready) {
        updateSectorOptions();
        renderUniverseAll();
      }
    }
  }

  // =========================================================
  // 6. 13F 기관 포트폴리오
  // =========================================================

  const F = {
    data: null,
    loaded: false,
    search: "",
    filter: "all",
    cik: null,
    quarter: 0,
    compare: true,
    view: "bar",
    showAll: false,
    ready: false
  };

  const PALETTE = [
    "#245eea", "#16845b", "#e8590c", "#8b5cf6", "#d92d20",
    "#0891b2", "#b54708", "#667085", "#db2777"
  ];

  async function loadFilings() {
    const json = await fetchJson("./data/13f.json");

    F.loaded = true;
    F.data = isObject(json) && Array.isArray(json.institutions)
      ? json.institutions.filter(item => isObject(item) && Array.isArray(item.quarters) && item.quarters.length)
      : [];
  }

  function filteredInstitutions() {
    const query = F.search.trim().toLowerCase();

    return (F.data || []).filter(inst => {
      if (!query) {
        return true;
      }

      const quarter = inst.quarters[0];
      const holdings = [...safeArray(quarter.holdings), ...safeArray(quarter.changes)];

      return (
        `${inst.name} ${inst.name_ko} ${inst.sec_name}`.toLowerCase().includes(query) ||
        holdings.some(row =>
          `${row.ticker || ""} ${row.name || ""}`.toLowerCase().includes(query)
        )
      );
    });
  }

  function knownTicker(ticker) {
    return Boolean(
      ticker &&
      (U.items.some(item => item.ticker === ticker) ||
        App.getSignals().some(item => item.ticker === ticker))
    );
  }

  function openHolding(ticker, name) {
    if (!knownTicker(ticker)) {
      return;
    }

    const item = U.items.find(entry => entry.ticker === ticker);

    openDetailAny(ticker, {
      name: item?.name || titleCase(name),
      kind: "stock",
      sector: item?.sector || "",
      index: "S&P 500",
      marketCap: item?.marketCap,
      price: item?.price
    });
  }

  function donut(rows) {
    const top = rows.slice(0, 8);
    const rest = Math.max(0, 100 - top.reduce((sum, row) => sum + row.weight, 0));
    const slices = top.map(row => ({ label: row.ticker || titleCase(row.name), weight: row.weight }));

    if (rest > 0.05) {
      slices.push({ label: "기타", weight: rest });
    }

    let offset = 0;

    const circles = slices.map((slice, index) => {
      const part = `<circle cx="21" cy="21" r="15.915" fill="transparent"
        stroke="${PALETTE[index % PALETTE.length]}" stroke-width="6"
        stroke-dasharray="${slice.weight.toFixed(3)} ${(100 - slice.weight).toFixed(3)}"
        stroke-dashoffset="${(25 - offset).toFixed(3)}"></circle>`;
      offset += slice.weight;
      return part;
    }).join("");

    const legend = slices.map((slice, index) => `
      <li><i style="background:${PALETTE[index % PALETTE.length]}"></i>
        <span>${safe(slice.label)}</span><b>${slice.weight.toFixed(1)}%</b></li>`
    ).join("");

    return `
      <div class="x-donut">
        <svg viewBox="0 0 42 42" role="img" aria-label="상위 보유 종목 비중 도넛 차트">
          <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#eef1f6" stroke-width="6"></circle>
          ${circles}
        </svg>
        <ul>${legend}</ul>
      </div>`;
  }

  function renderFilingsBody() {
    const body = $("#fBody");

    if (!body) {
      return;
    }

    if (!F.loaded) {
      body.innerHTML = '<div class="panel">불러오는 중…</div>';
      return;
    }

    if (!F.data || !F.data.length) {
      body.innerHTML = '<div class="panel">13F 데이터가 아직 없습니다. Actions에서 \'Weekly Filings\'를 한 번 실행해 주세요.</div>';
      return;
    }

    const list = filteredInstitutions();
    const inst = list.find(item => item.cik === F.cik) || list[0];

    if (!inst) {
      body.innerHTML = '<div class="panel">검색 결과가 없습니다.</div>';
      return;
    }

    F.cik = inst.cik;

    const quarter = inst.quarters[Math.min(F.quarter, inst.quarters.length - 1)];
    const hasPrev = Boolean(quarter.prev_total_value);
    const compare = F.compare && hasPrev;
    const counts = quarter.counts || {};

    const chip = (key, label, total) =>
      `<button type="button" class="sc-chip ${F.filter === key ? "active" : ""}" data-filter="${key}">${label} (${total ?? 0})</button>`;

    const picker = list.map(item => `
      <button type="button" class="x-inst ${item.cik === inst.cik ? "active" : ""}" data-cik="${safe(item.cik)}">${safe(item.name)}</button>`
    ).join("");

    const totalChange = hasPrev
      ? (quarter.total_value / quarter.prev_total_value - 1) * 100
      : null;

    const holdings = safeArray(quarter.holdings);
    const maxWeight = Math.max(0.0001, ...holdings.slice(0, 10).map(row => row.weight));

    const barRows = holdings.slice(0, 10).map((row, index) => {
      const clickable = knownTicker(row.ticker);

      return `
        <div class="x-hold ${clickable ? "clickable" : ""}" ${clickable ? `data-hold="${safe(row.ticker)}" data-name="${safe(row.name)}"` : ""}>
          <span class="x-rank">${index + 1}</span>
          <span class="sc-logo x-small">${safe(initial(row.ticker || row.name))}</span>
          <span class="x-hold-name"><b>${safe(row.ticker || "—")}</b><small>${safe(titleCase(row.name))}</small></span>
          <span class="x-bar"><i style="width:${(row.weight / maxWeight * 100).toFixed(1)}%"></i></span>
          <b class="x-weight">${row.weight.toFixed(1)}%</b>
          <span class="x-chev">${clickable ? "›" : ""}</span>
        </div>`;
    }).join("");

    const matches = row =>
      F.filter === "all" ? row.tags.length > 0 : row.tags.includes(F.filter);

    const changeRows = safeArray(quarter.changes).filter(matches);
    const visibleChanges = F.showAll ? changeRows : changeRows.slice(0, 5);

    const badge = row =>
      row.tags.includes("new")
        ? ["신규 편입", "new"]
        : row.tags.includes("shares_up")
          ? ["주식 수 증가", "shares"]
          : ["비중 증가", "weight"];

    const changeMarkup = visibleChanges.map((row, index) => {
      const [label, cls] = badge(row);
      const clickable = knownTicker(row.ticker);

      return `
        <div class="x-change ${clickable ? "clickable" : ""}" ${clickable ? `data-hold="${safe(row.ticker)}" data-name="${safe(row.name)}"` : ""}>
          <span class="x-rank">${index + 1}</span>
          <span class="sc-logo x-small">${safe(initial(row.ticker || row.name))}</span>
          <span class="x-hold-name"><b>${safe(row.ticker || "—")}</b><small>${safe(titleCase(row.name))}</small></span>
          <span class="x-pill ${cls}">${label}</span>
          <span class="x-delta"><small>주식 수 변화</small><b class="x-${tone(row.shares_change_pct)}">${
            row.tags.includes("new") ? "신규" : row.shares_change_pct === null ? "—" : safe(signed(row.shares_change_pct, 1))
          }</b></span>
          <span class="x-delta"><small>비중 변화</small><b class="x-${tone(row.weight_change_pp)}">${
            row.weight_change_pp === null ? "—" : safe(signed(row.weight_change_pp, 1, "%p"))
          }</b></span>
        </div>`;
    }).join("");

    const edgar = safeUrl(quarter.edgar_url);

    body.innerHTML = `
      <div class="sc-chips">
        ${chip("all", "전체", counts.all)}
        ${chip("new", "신규 편입", counts.new)}
        ${chip("shares_up", "주식 수 증가", counts.shares_up)}
        ${chip("weight_up", "비중 증가", counts.weight_up)}
      </div>
      <div class="x-picker">${picker}</div>

      <section class="x-card">
        <div class="x-inst-head">
          <span class="sc-logo x-big">${safe(initial(inst.name))}</span>
          <div class="x-inst-name">
            <b>${safe(inst.name)}</b>
            <small>${safe(inst.name_ko || "")}</small>
            <div class="x-tags"><span class="sc-sector">${safe(quarter.form)}</span><span class="x-tag-gray">${safe(inst.type)}</span></div>
          </div>
        </div>
        <div class="x-metrics">
          <div><small>공시 주식 평가액</small><b>${safe(compactUsd(quarter.total_value))}</b>
            ${compare && totalChange !== null ? `<em class="x-${tone(totalChange)}">${totalChange > 0 ? "▲" : totalChange < 0 ? "▼" : ""} ${safe(signed(totalChange, 1))} 전분기 대비</em>` : ""}</div>
          <div><small>보유 종목</small><b>${safe(fmt(quarter.positions, 0))}개</b>
            ${compare && quarter.prev_positions ? `<em class="x-flat">전분기 ${safe(fmt(quarter.prev_positions, 0))}개</em>` : ""}</div>
        </div>
        <div class="x-selects">
          <select id="fQuarter" aria-label="분기 선택">${inst.quarters.map((q, i) =>
            `<option value="${i}" ${i === F.quarter ? "selected" : ""}>${safe(q.quarter)}</option>`).join("")}</select>
          <select id="fCompare" aria-label="비교 방식">
            <option value="1" ${F.compare ? "selected" : ""}>직전 분기와 비교</option>
            <option value="0" ${F.compare ? "" : "selected"}>비교 안 함</option>
          </select>
        </div>
      </section>

      <section class="x-card">
        <div class="x-card-head">
          <h3>상위 보유 종목</h3>
          <div class="x-toggle">
            <button type="button" data-view="bar" class="${F.view === "bar" ? "active" : ""}">막대 그래프</button>
            <button type="button" data-view="donut" class="${F.view === "donut" ? "active" : ""}">도넛 그래프</button>
          </div>
        </div>
        ${F.view === "bar" ? barRows : donut(holdings)}
      </section>

      ${compare ? `
      <section class="x-card">
        <div class="x-card-head">
          <h3>최근 증가 종목</h3>
          ${changeRows.length > 5 ? `<button type="button" class="x-link" data-showall="1">${F.showAll ? "접기" : `전체 보기 (${changeRows.length})`}</button>` : ""}
        </div>
        ${changeMarkup || '<p class="x-empty">해당 조건의 종목이 없습니다.</p>'}
      </section>` : ""}

      <section class="x-card">
        <div class="x-card-head"><h3>공시 정보</h3></div>
        <dl class="x-dl">
          <div><dt>기준일</dt><dd>${safe(quarter.report_date)}</dd></div>
          <div><dt>제출일</dt><dd>${safe(quarter.filing_date)}</dd></div>
          <div><dt>정정 공시</dt><dd>${quarter.amended ? `있음 (${safe(quarter.amendment_date || "")})` : "없음"}</dd></div>
          <div><dt>원문</dt><dd>${edgar ? `<a href="${safe(edgar)}" target="_blank" rel="noopener noreferrer">SEC EDGAR 원문 보기 ↗</a>` : "—"}</dd></div>
        </dl>
        <p class="x-note">13F는 분기 종료 후 최대 45일 뒤에 공시되며 롱 포지션(미국 상장 주식 등)만 포함합니다. 투자 판단의 근거로 쓰기 전에 원문을 확인하세요.</p>
      </section>`;
  }

  function buildFilings() {
    const root = $("#filingsRoot");

    root.innerHTML = `
      <h2 class="x-title">13F 기관 포트폴리오</h2>
      <p class="x-sub">기관투자자의 13F 공시 기반 포트폴리오를 확인하세요.</p>
      <div class="x-search">
        <span class="x-search-icon" aria-hidden="true">⌕</span>
        <input id="fSearch" type="search" placeholder="기관명 또는 티커 검색 (예: Berkshire Hathaway)">
      </div>
      <div id="fBody"></div>`;

    $("#fSearch").addEventListener("input", event => {
      F.search = event.target.value;
      F.showAll = false;
      renderFilingsBody();
    });

    root.addEventListener("click", event => {
      const filter = event.target.closest("[data-filter]");
      const cik = event.target.closest("[data-cik]");
      const view = event.target.closest("[data-view]");
      const hold = event.target.closest("[data-hold]");

      if (filter) {
        F.filter = filter.dataset.filter;
        F.showAll = false;
      } else if (cik) {
        F.cik = cik.dataset.cik;
        F.quarter = 0;
        F.showAll = false;
      } else if (view) {
        F.view = view.dataset.view;
      } else if (event.target.closest("[data-showall]")) {
        F.showAll = !F.showAll;
      } else if (hold) {
        openHolding(hold.dataset.hold, hold.dataset.name);
        return;
      } else {
        return;
      }

      renderFilingsBody();
    });

    root.addEventListener("change", event => {
      if (event.target.id === "fQuarter") {
        F.quarter = Number(event.target.value) || 0;
      } else if (event.target.id === "fCompare") {
        F.compare = event.target.value === "1";
      } else {
        return;
      }

      renderFilingsBody();
    });
  }

  async function ensureFilings(force) {
    if (!F.loaded || force) {
      await loadFilings();

      if (F.ready) {
        renderFilingsBody();
      }
    }
  }

  // =========================================================
  // 7. 트럼프 따라가기 (OGE 278-T)
  // =========================================================

  const T = { data: null, loaded: false, bonds: false, buyAll: false, sellAll: false, ready: false };

  async function loadTrump() {
    const json = await fetchJson("./data/trump.json");

    T.loaded = true;
    T.data = isObject(json) ? json : null;
  }

  function amountText(row) {
    if (!row.amount_min) {
      return "금액 미확인";
    }

    const money = value => `$${Number(value).toLocaleString("en-US")}`;

    return row.amount_max
      ? `${money(row.amount_min)} ~ ${money(row.amount_max)}`
      : `${money(row.amount_min)}+`;
  }

  function trumpRow(row) {
    const url = safeUrl(row.source_url);
    const clickable = row.ticker && knownTicker(row.ticker);

    return `
      <div class="x-trade ${clickable || url ? "clickable" : ""}"
        ${clickable ? `data-hold="${safe(row.ticker)}" data-name="${safe(row.name)}"` : url ? `data-url="${safe(url)}"` : ""}>
        <span class="sc-logo">${safe(initial(row.ticker || row.name))}</span>
        <span class="x-hold-name"><b>${safe(row.ticker || titleCase(row.name).slice(0, 18))}</b><small>${safe(titleCase(row.name))}</small></span>
        <span class="x-trade-right">
          <small>${safe(row.date)}</small>
          <b>${safe(amountText(row))}</b>
        </span>
        <span class="x-pill ${row.type === "buy" ? "buy" : "sell"}">${row.type === "buy" ? "매수" : "매도"}</span>
      </div>`;
  }

  function renderTrump() {
    const root = $("#trumpRoot");

    if (!root) {
      return;
    }

    const data = T.data;
    const person = isObject(data?.person) ? data.person : { name: "Donald J. Trump", title: "미국 대통령" };
    const summary = isObject(data?.summary) ? data.summary : {};
    const search = safeUrl(data?.search_url) || "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index";

    const rows = safeArray(data?.transactions).filter(
      row => isObject(row) && (T.bonds || row.asset !== "bond")
    );

    const buys = rows.filter(row => row.type === "buy");
    const sells = rows.filter(row => row.type === "sell");

    const list = (items, all, key, label) => `
      <section class="x-card">
        <div class="x-card-head">
          <h3>${label}</h3>
          ${items.length > 5 ? `<button type="button" class="x-link" data-more="${key}">${all ? "접기" : `전체 보기 (${items.length})`}</button>` : ""}
        </div>
        ${items.length
          ? (all ? items.slice(0, 100) : items.slice(0, 5)).map(trumpRow).join("")
          : '<p class="x-empty">표시할 내역이 없습니다.</p>'}
      </section>`;

    root.innerHTML = `
      <h2 class="x-title">트럼프 따라가기</h2>
      <p class="x-sub">미국 정부윤리청(OGE) 공시를 기반으로 트럼프의 최근 주식 매수·매도 내역을 확인하세요.</p>

      <section class="x-card x-profile">
        <span class="sc-logo x-big">DT</span>
        <div class="x-inst-name">
          <b>${safe(person.name)}</b>
          <small>${safe(person.title)}</small>
          <div class="x-tags"><span class="sc-sector">OGE 278-T</span></div>
        </div>
        <a class="x-btn" href="${safe(search)}" target="_blank" rel="noopener noreferrer">공시 검색 ↗</a>
      </section>

      ${data ? `
      <div class="x-triple">
        <div class="x-stat"><small>최근 공시일</small><b>${safe(summary.latest_received || "—")}</b><em>(OGE 접수일)</em></div>
        <div class="x-stat"><small>최근 거래 수</small><b>${safe(fmt(summary.latest_trade_count ?? 0, 0))}건</b><em>(매수 ${safe(fmt(summary.latest_buy ?? 0, 0))} · 매도 ${safe(fmt(summary.latest_sell ?? 0, 0))})</em></div>
        <div class="x-stat"><small>총 신고 금액</small><b>${summary.amount_min_sum ? `$${Number(summary.amount_min_sum).toLocaleString("en-US")}+` : "미확인"}</b><em>(구간 하한 합계)</em></div>
      </div>

      <label class="x-check"><input type="checkbox" id="tBonds" ${T.bonds ? "checked" : ""}> 채권 포함</label>

      ${list(buys, T.buyAll, "buy", "최근 매수 내역")}
      ${list(sells, T.sellAll, "sell", "최근 매도 내역")}

      <p class="x-note">${safe(data.meta?.note || "")} 공시는 거래 후 최대 45일 뒤에 제출되어 실제 거래 시점과 차이가 있습니다. 투자 조언이 아닙니다.</p>
      ` : `<div class="panel">${T.loaded ? "트럼프 공시 데이터가 아직 없습니다. Actions에서 'Weekly Filings'를 한 번 실행해 주세요." : "불러오는 중…"}</div>`}`;
  }

  function buildTrump() {
    const root = $("#trumpRoot");

    root.addEventListener("click", event => {
      const more = event.target.closest("[data-more]");
      const hold = event.target.closest("[data-hold]");
      const link = event.target.closest("[data-url]");

      if (more) {
        if (more.dataset.more === "buy") {
          T.buyAll = !T.buyAll;
        } else {
          T.sellAll = !T.sellAll;
        }

        renderTrump();
      } else if (hold) {
        openHolding(hold.dataset.hold, hold.dataset.name);
      } else if (link && safeUrl(link.dataset.url)) {
        window.open(link.dataset.url, "_blank", "noopener");
      }
    });

    root.addEventListener("change", event => {
      if (event.target.id === "tBonds") {
        T.bonds = event.target.checked;
        renderTrump();
      }
    });
  }

  async function ensureTrump(force) {
    if (!T.loaded || force) {
      await loadTrump();

      if (T.ready) {
        renderTrump();
      }
    }
  }

  // =========================================================
  // 스타일
  // =========================================================

  function installStyles() {
    if ($("#extraStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "extraStyles";

    style.textContent = `
      .quote-status { display: block; color: #98a2b3; font-size: 10px; }
      .x-title { margin: 6px 2px 4px; font-size: 24px; font-weight: 800; letter-spacing: -.03em; }
      .x-sub { margin: 0 2px 14px; color: #667085; font-size: 13px; }
      .x-search { position: relative; margin-bottom: 12px; }
      .x-search input { padding: 13px 14px 13px 40px; border: 0; border-radius: 16px;
        background: #fff; box-shadow: 0 2px 8px rgba(16,24,40,.06); }
      .x-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
        color: #475467; font-size: 18px; pointer-events: none; }
      .x-sortrow { display: flex; align-items: center; gap: 8px; margin: 12px 0; }
      .x-sortrow select { flex: 1; min-width: 0; padding: 10px 11px; border-radius: 12px; }
      .x-minis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
      .x-mini { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 10px;
        border: 0; border-radius: 16px; background: #fff; text-align: left;
        box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 6px 18px rgba(16,24,40,.05); }
      .x-mini .sc-logo { flex: 0 0 34px; width: 34px; height: 34px; font-size: 15px; }
      .x-mini-body { display: flex; flex-direction: column; min-width: 0; font-size: 11px; line-height: 1.35; }
      .x-mini-body b { font-size: 12px; }
      .x-mini-body em { font-style: normal; font-weight: 700; }
      .x-list { display: grid; gap: 10px; }
      .x-list .sc-card { margin-bottom: 0; }
      .x-more { padding: 12px; border: 0; border-radius: 14px; background: #e6edff; color: #245eea; font-weight: 700; }
      .x-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
      .x-tags .sc-sector { margin-top: 0; }
      .x-tag-gray { padding: 2px 8px; border-radius: 999px; background: #f2f4f7; color: #475467; font-size: 11px; }
      .x-up { color: #d92d20; }
      .x-down { color: #245eea; }
      .x-flat { color: #667085; }
      .x-card { margin-bottom: 12px; padding: 14px; border-radius: 18px; background: #fff;
        box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 6px 18px rgba(16,24,40,.05); }
      .x-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .x-card-head h3 { margin: 0; font-size: 17px; }
      .x-link { border: 0; background: none; color: #245eea; font-size: 12px; font-weight: 700; }
      .x-picker { display: flex; gap: 6px; margin: 10px 0; overflow-x: auto; scrollbar-width: none; }
      .x-inst { flex: 0 0 auto; padding: 7px 12px; border: 0; border-radius: 999px; background: #fff;
        color: #475467; font-size: 12px; font-weight: 600; box-shadow: 0 1px 3px rgba(16,24,40,.08); }
      .x-inst.active { background: #182230; color: #fff; }
      .x-inst-head, .x-profile { display: flex; align-items: center; gap: 12px; }
      .x-inst-name { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .x-inst-name small { color: #667085; }
      .sc-logo.x-big { flex: 0 0 56px; width: 56px; height: 56px; font-size: 22px; }
      .sc-logo.x-small { flex: 0 0 30px; width: 30px; height: 30px; font-size: 13px; }
      .x-metrics { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; margin: 12px 0; }
      .x-metrics > div { padding: 10px; border-radius: 12px; background: #f6f8fb; }
      .x-metrics small { display: block; color: #667085; font-size: 11px; }
      .x-metrics b { display: block; font-size: 20px; letter-spacing: -.02em; }
      .x-metrics em { font-size: 11px; font-style: normal; font-weight: 700; }
      .x-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .x-selects select { padding: 10px 11px; border-radius: 12px; }
      .x-toggle { display: inline-flex; padding: 3px; border-radius: 999px; background: #eef1f6; }
      .x-toggle button { padding: 6px 10px; border: 0; border-radius: 999px; background: none; color: #667085; font-size: 12px; font-weight: 700; }
      .x-toggle button.active { background: #245eea; color: #fff; }
      .x-hold, .x-change, .x-trade { display: flex; align-items: center; gap: 8px; padding: 9px 0; border-top: 1px solid #f0f2f7; }
      .x-hold.clickable, .x-change.clickable, .x-trade.clickable { cursor: pointer; }
      .x-rank { width: 14px; color: #98a2b3; font-size: 12px; text-align: center; }
      .x-hold-name { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .x-hold-name b { font-size: 13px; }
      .x-hold-name small { overflow: hidden; color: #667085; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .x-bar { flex: 0 0 34%; height: 12px; border-radius: 3px; background: #eef1f6; }
      .x-bar i { display: block; height: 100%; border-radius: 3px; background: #245eea; }
      .x-weight { min-width: 42px; font-size: 13px; text-align: right; }
      .x-chev { width: 10px; color: #98a2b3; font-size: 18px; }
      .x-pill { flex-shrink: 0; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 800; white-space: nowrap; }
      .x-pill.new, .x-pill.buy { background: #dcf5e8; color: #16845b; }
      .x-pill.shares { background: #d9f2f0; color: #0f766e; }
      .x-pill.weight { background: #fef0c7; color: #b54708; }
      .x-pill.sell { background: #fee4e2; color: #d92d20; }
      .x-delta { display: flex; flex-direction: column; min-width: 46px; text-align: right; }
      .x-delta small { color: #98a2b3; font-size: 10px; }
      .x-delta b { font-size: 12px; }
      .x-empty { margin: 6px 0; color: #98a2b3; font-size: 13px; }
      .x-donut { display: flex; align-items: center; gap: 14px; }
      .x-donut svg { flex: 0 0 140px; width: 140px; height: 140px; }
      .x-donut ul { flex: 1; margin: 0; padding: 0; list-style: none; font-size: 12px; }
      .x-donut li { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
      .x-donut li i { width: 9px; height: 9px; border-radius: 3px; }
      .x-donut li span { flex: 1; }
      .x-dl { margin: 0; }
      .x-dl div { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid #f0f2f7; font-size: 13px; }
      .x-dl dt { color: #667085; }
      .x-dl dd { margin: 0; font-weight: 700; text-align: right; }
      .x-dl a { color: #245eea; }
      .x-note { margin: 10px 2px 0; color: #98a2b3; font-size: 11px; line-height: 1.6; }
      .x-btn { flex-shrink: 0; padding: 8px 12px; border-radius: 12px; background: #e6f1ff; color: #245eea; font-size: 12px; font-weight: 700; text-decoration: none; }
      .x-triple { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
      .x-stat { padding: 11px 10px; border-radius: 16px; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 6px 18px rgba(16,24,40,.05); }
      .x-stat small { display: block; color: #667085; font-size: 11px; }
      .x-stat b { display: block; margin: 2px 0; font-size: 14px; overflow-wrap: anywhere; }
      .x-stat em { color: #98a2b3; font-size: 10px; font-style: normal; }
      .x-check { display: inline-flex; align-items: center; gap: 6px; margin: 0 2px 10px; color: #475467; font-size: 12px; }
      .x-check input { width: auto; }
      .x-trade-right { display: flex; flex-direction: column; text-align: right; }
      .x-trade-right small { color: #667085; font-size: 11px; }
      .x-trade-right b { font-size: 11.5px; }
      @media (max-width: 380px) {
        .x-metrics b { font-size: 17px; }
        .x-bar { flex-basis: 24%; }
        .x-donut svg { flex-basis: 110px; width: 110px; height: 110px; }
      }
    `;

    document.head.appendChild(style);
  }

  // =========================================================
  // 초기화
  // =========================================================

  function init() {
    installStyles();

    if ($("#universeRoot")) {
      buildUniverse();
      U.ready = true;
    }

    if ($("#filingsRoot")) {
      buildFilings();
      F.ready = true;
    }

    if ($("#trumpRoot")) {
      buildTrump();
      T.ready = true;
    }

    App.onPage(name => {
      if (name === "universe") {
        ensureUniverse(false).then(refreshQuotes);
      } else if (name === "filings") {
        ensureUniverse(false);
        ensureFilings(false);
      } else if (name === "trump") {
        ensureUniverse(false).then(() => ensureTrump(false));
      } else if (name === "detail" || name === "scanner") {
        refreshQuotes();
      }
    });

    // 새로고침 버튼: 추가 데이터 다시 읽기 + 실시간 시세 갱신
    App.onRefresh(async () => {
      failedProviders.clear();

      await Promise.allSettled([
        ensureUniverse(true),
        ensureFilings(true),
        ensureTrump(true)
      ]);

      if (U.ready && U.loaded) {
        updateSectorOptions();
        renderUniverseAll();
      }

      await refreshQuotes();
    });

    if (U.ready) {
      renderUniverseList();
    }

    if (F.ready) {
      renderFilingsBody();
    }

    if (T.ready) {
      renderTrump();
    }

    setQuoteStatus("스캔 기준 시세");
    startPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
