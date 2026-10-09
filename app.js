document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll("[data-page]");
  const pages = document.querySelectorAll("main .page");
  function showPage(name) {
    tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.page === name);
    });
    pages.forEach(page => {
      page.classList.toggle("active", page.id === `page-${name}`);
    });
  }
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      showPage(tab.dataset.page);
    });
  });
  const backButton = document.querySelector("#backScanner");
  if (backButton) {
    backButton.addEventListener("click", () => showPage("scanner"));
  }
  async function loadData() {
    const status = document.querySelector("#updated");
    const scannerStatus = document.querySelector("#scannerStatus");
    const signalList = document.querySelector("#signalList");
    const scanCount = document.querySelector("#scanCount");
    const macroMetrics = document.querySelector("#macroMetrics");
    const marketState = document.querySelector("#marketState");
    const historyList = document.querySelector("#historyList");
    let data;
    try {
      const response = await fetch(
        `./data/latest.json?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("최신 데이터 파일을 읽지 못했습니다.");
      data = await response.json();
      if (status) {
        status.textContent = "데이터 기준: " + (data.updated_at || "시각 미확인");
      }
      const macro = data.macro || {};
      if (marketState) {
        marketState.innerHTML = `
          <div class="state-title">시장 상태</div>
          <h3>${escapeHTML(macro.state || "분석 데이터 대기")}</h3>
          <p>${escapeHTML(macro.reason || "시장 지표가 아직 연결되지 않았습니다.")}</p>
        `;
      }
      if (macroMetrics && macro.values && Object.keys(macro.values).length) {
        macroMetrics.innerHTML = Object.entries(macro.values).map(([name, item]) => `
          <div class="metric">
            <span>${escapeHTML(name)}</span>
            <b>${escapeHTML(item?.value ?? "—")}</b>
            <small>${escapeHTML(item?.updated_at || "시각 미확인")}</small>
          </div>
        `).join("");
      }
      const signals = Array.isArray(data.signals) ? data.signals : [];
      if (scanCount) scanCount.textContent = `${signals.length}개 신호`;
      if (scannerStatus) {
        scannerStatus.textContent = signals.length
          ? `스캔 완료 · ${signals.length}개 신호 발견`
          : "스캔 완료 · 현재 표시할 신호가 없습니다.";
      }
      function renderSignals() {
        const query = (document.querySelector("#search")?.value || "").toLowerCase();
        const filter = document.querySelector("#signalFilter")?.value || "all";
        const sort = document.querySelector("#sort")?.value || "strength";
        const strength = { "패닉셀": 4, "급락": 3, "조정": 2, "단기조정": 1 };
        const filtered = signals.filter(item => {
          const matchesQuery = `${item.ticker || ""} ${item.name || ""}`.toLowerCase().includes(query);
          const matchesFilter = filter === "all" || item.signal === filter;
          return matchesQuery && matchesFilter;
        });
        filtered.sort((a, b) => {
          if (sort === "ticker") return (a.ticker || "").localeCompare(b.ticker || "");
          if (sort === "drop") return (a.drawdown ?? 0) - (b.drawdown ?? 0);
          return (strength[b.signal] || 0) - (strength[a.signal] || 0);
        });
        if (signalList) {
          signalList.innerHTML = filtered.length ? filtered.map(item => `
            <article class="panel signal" data-ticker="${escapeHTML(item.ticker || "")}">
              <strong>${escapeHTML(item.ticker || "")} ${escapeHTML(item.name || "")}</strong>
              <b>${escapeHTML(item.signal || "신호 미확인")}</b>
              <p>기준일 ${escapeHTML(item.date || "—")} · 종가 ${escapeHTML(item.close ?? "—")}</p>
              <button class="subtle detail-button" data-ticker="${escapeHTML(item.ticker || "")}">종목 상세 보기</button>
            </article>
          `).join("") : '<p class="notice">조건에 맞는 신호가 없습니다.</p>';
          signalList.querySelectorAll(".detail-button").forEach(button => {
            button.addEventListener("click", () => {
              const item = signals.find(s => s.ticker === button.dataset.ticker);
              const title = document.querySelector("#detailTitle");
              const body = document.querySelector("#detailBody");
              if (title) title.textContent = `${item?.ticker || ""} ${item?.name || ""}`;
              if (body) {
                body.textContent = item
                  ? `신호: ${item.signal || "—"} · 기준일: ${item.date || "—"} · 종가: ${item.close ?? "—"}. 상세 차트와 추가 지표는 별도 연결이 필요합니다.`
                  : "종목 정보를 찾을 수 없습니다.";
              }
              showPage("detail");
            });
          });
        }
      }
      renderSignals();
      ["search", "signalFilter", "sort"].forEach(id => {
        document.querySelector(`#${id}`)?.addEventListener("input", renderSignals);
        document.querySelector(`#${id}`)?.addEventListener("change", renderSignals);
      });
      try {
        const historyResponse = await fetch(
          `./data/signal_history.json?t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (historyResponse.ok) {
          const history = await historyResponse.json();
          const records = Array.isArray(history) ? history : [];
          if (historyList) {
            historyList.innerHTML = records.length
              ? records.slice().reverse().map(record => {
                  const items = Array.isArray(record.signals) ? record.signals : [];
                  return `<div class="history-row">
                    <strong>${escapeHTML(record.scan_date || "날짜 미확인")}</strong>
                    <p>${items.length
                      ? items.map(s => `${escapeHTML(s.ticker || "")} ${escapeHTML(s.signal || "")}`).join(" · ")
                      : "신호 없음"}</p>
                  </div>`;
                }).join("")
              : "아직 기록이 없습니다.";
          }
        }
      } catch (error) {
        if (historyList) historyList.textContent = "신호 이력을 불러오지 못했습니다.";
      }
      const summary = document.querySelector("#performanceSummary");
      if (summary) {
        summary.innerHTML = `
          <div class="metric"><span>저장된 신호</span><b>${signals.length}</b><small>최근 스캔 기준</small></div>
          <div class="metric"><span>성과 통계</span><b>계산 대기</b><small>5·10·20일 수익률 미연결</small></div>
        `;
      }
    } catch (error) {
      if (status) status.textContent = "데이터 연결 확인 필요";
      if (scannerStatus) scannerStatus.textContent = "데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.";
      if (signalList) signalList.innerHTML = '<p class="notice">최신 스캔 데이터를 읽지 못했습니다.</p>';
      console.error(error);
    }
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }
  loadData();
});
