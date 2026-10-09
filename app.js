(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  let signals = [];
  const strength = {
    "패닉셀": 4,
    "급락": 3,
    "조정": 2,
    "단기조정": 1
  };
  function safe(value) {
    return String(value ?? "—").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }
  function showPage(name) {
    $$(".tabs [data-page]").forEach((button) => {
      const active = button.dataset.page === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $$(".page").forEach((page) => {
      page.classList.toggle("active", page.id === "page-" + name);
    });
    window.scrollTo(0, 0);
  }
  function renderSignals() {
    const query = ($("#search").value || "").trim().toLowerCase();
    const filter = $("#signalFilter").value;
    const sort = $("#sort").value;
    const filtered = signals.filter((item) => {
      const matchesSearch =
        `${item.ticker || ""} ${item.name || ""}`
          .toLowerCase()
          .includes(query);
      const matchesSignal =
        filter === "all" || item.signal === filter;
      return matchesSearch && matchesSignal;
    });
    filtered.sort((a, b) => {
      if (sort === "ticker") {
        return String(a.ticker || "").localeCompare(
          String(b.ticker || "")
        );
      }
      if (sort === "drop") {
        return Number(a.drawdown ?? 0) - Number(b.drawdown ?? 0);
      }
      return (strength[b.signal] || 0) -
             (strength[a.signal] || 0);
    });
    $("#scanCount").textContent = `${filtered.length}개 신호`;
    if (filtered.length === 0) {
      $("#signalList").innerHTML =
        '<div class="panel">조건에 맞는 신호가 없습니다.</div>';
      return;
    }
    $("#signalList").innerHTML = filtered.map((item) => `
      <article class="panel signal">
        <strong>${safe(item.ticker)} ${safe(item.name)}</strong>
        <b>${safe(item.signal)}</b>
        <p>
          기준일 ${safe(item.date)}
          · 종가 ${safe(item.close)}
          ${item.drawdown != null
            ? ` · 고점 대비 ${safe(item.drawdown)}%`
            : ""}
        </p>
        <button
          type="button"
          class="subtle detail-button"
          data-ticker="${safe(item.ticker)}">
          종목 상세 보기
        </button>
      </article>
    `).join("");
    $$("#signalList .detail-button").forEach((button) => {
      button.addEventListener("click", () => {
        const item = signals.find(
          (signal) => String(signal.ticker) === button.dataset.ticker
        );
        if (!item) return;
        $("#detailTitle").textContent =
          `${item.ticker || ""} ${item.name || ""}`;
        $("#detailBody").innerHTML = `
          <div class="grid">
            <article class="metric">
              <span>매수 신호</span>
              <b>${safe(item.signal)}</b>
            </article>
            <article class="metric">
              <span>기준일</span>
              <b>${safe(item.date)}</b>
            </article>
            <article class="metric">
              <span>종가</span>
              <b>${safe(item.close)}</b>
            </article>
            <article class="metric">
              <span>고점 대비 하락률</span>
              <b>${item.drawdown == null
                ? "—"
                : safe(item.drawdown) + "%"}</b>
            </article>
          </div>
          <p class="muted">
            현재 연결된 스캔 데이터 기준입니다.
            캔들 차트와 추가 지표는 아직 구현되지 않았습니다.
          </p>
        `;
        showPage("detail");
      });
    });
  }
  function renderMacro(data) {
    const macro = data.macro || {};
    $("#marketState").innerHTML = `
      <div class="state-title">시장 상태</div>
      <h3>${safe(macro.state || "분석 데이터 대기")}</h3>
      <p>${safe(macro.reason || "시장 지표 연결 대기 중입니다.")}</p>
    `;
    const values = macro.values || {};
    const entries = Object.entries(values);
    if (entries.length > 0) {
      $("#macroMetrics").innerHTML = entries.map(([name, item]) => `
        <article class="metric">
          <span>${safe(name)}</span>
          <b>${safe(
            item && typeof item === "object"
              ? item.value
              : item
          )}</b>
          <small>${safe(
            item && typeof item === "object"
              ? item.updated_at
              : "시각 미확인"
          )}</small>
        </article>
      `).join("");
    }
  }
  async function loadHistory() {
    const target = $("#historyList");
    try {
      const response = await fetch(
        `./data/signal_history.json?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("이력 파일 없음");
      const raw = await response.json();
      const records = Array.isArray(raw)
        ? raw
        : Array.isArray(raw.records)
          ? raw.records
          : [];
      if (records.length === 0) {
        target.textContent = "아직 기록이 없습니다.";
        return;
      }
      target.innerHTML = records.slice().reverse().map((record) => {
        const items = Array.isArray(record.signals)
          ? record.signals
          : [];
        const description = items.length
          ? items.map((item) =>
              `${safe(item.ticker)} ${safe(item.signal)}`
            ).join(" · ")
          : "신호 없음";
        return `
          <div class="history-row">
            <strong>${safe(record.scan_date || record.date)}</strong>
            <p>${description}</p>
          </div>
        `;
      }).join("");
    } catch (error) {
      target.textContent = "신호 이력을 불러오지 못했습니다.";
    }
  }
  async function loadData() {
    $("#scannerStatus").textContent = "최신 스캔 데이터 불러오는 중";
    try {
      const response = await fetch(
        `./data/latest.json?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("최신 데이터 파일 없음");
      const data = await response.json();
      $("#updated").textContent =
        "데이터 기준: " + (data.updated_at || "시각 미확인");
      signals = Array.isArray(data.signals) ? data.signals : [];
      renderMacro(data);
      $("#scannerStatus").textContent =
        `스캔 데이터 연결 완료 · ${signals.length}개 신호`;
      renderSignals();
      $("#performanceSummary").innerHTML = `
        <article class="metric">
          <span>최근 스캔 신호</span>
          <b>${signals.length}</b>
          <small>최신 기록 기준</small>
        </article>
        <article class="metric">
          <span>5·10·20일 성과</span>
          <b>계산 대기</b>
          <small>수익률 통계 미구현</small>
        </article>
      `;
    } catch (error) {
      $("#updated").textContent = "데이터 연결 실패";
      $("#scannerStatus").textContent =
        "데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.";
      $("#signalList").innerHTML =
        '<div class="panel">최신 스캔 데이터를 읽을 수 없습니다.</div>';
      console.error("데이터 로드 오류:", error);
    }
    await loadHistory();
  }
  document.addEventListener("DOMContentLoaded", () => {
    $$(".tabs [data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        showPage(button.dataset.page);
      });
    });
    $("#backScanner").addEventListener("click", () => {
      showPage("scanner");
    });
    ["search", "signalFilter", "sort"].forEach((id) => {
      $("#" + id).addEventListener("input", renderSignals);
      $("#" + id).addEventListener("change", renderSignals);
    });
    showPage("macro");
    loadData();
  });
})();
