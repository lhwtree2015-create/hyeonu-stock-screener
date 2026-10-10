  function renderDetail(item) {
    const rows = getPriceRows(item.ticker);
    const last = rows.at(-1);
    const prev = rows.at(-2);
    const ma20 = movingAverage(rows, 20);
    const ma50 = movingAverage(rows, 50);
    const ma200 = movingAverage(rows, 200);
    const rsi = calculateRSI(rows);
    const i = rows.length - 1;
    const memo = buildObservationMemo(rows, rsi, ma20, ma50, ma200);
    const price = last?.close ?? num(item.close);

    const last60 = rows.slice(-60);
    const last20 = rows.slice(-20);
    const high60 = last60.length ? Math.max(...last60.map(r => r.high)) : null;
    const low20 = last20.length ? Math.min(...last20.map(r => r.low)) : null;

    const drop60 = high60 && price != null ? (price / high60 - 1) * 100 : null;
    const rebound20 = low20 && price != null ? (price / low20 - 1) * 100 : null;
    const dailyChange = last && prev && prev.close ? (last.close / prev.close - 1) * 100 : null;
    const dailyAmount = last && prev ? last.close - prev.close : null;

    const rsiChange = rsi[i] != null && rsi[Math.max(0, i - 5)] != null
      ? rsi[i] - rsi[Math.max(0, i - 5)]
      : null;

    const gap = ma => ma[i] && price != null ? (price / ma[i] - 1) * 100 : null;
    const gap20 = gap(ma20);
    const gap50 = gap(ma50);
    const gap200 = gap(ma200);

    const avgVol20 = last20.reduce((sum, r) => sum + (r.volume || 0), 0) / Math.max(1, last20.length);
    const volRatio = avgVol20 > 0 && last ? last.volume / avgVol20 : null;

    const pct = v => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
    const tone = v => v == null || v === 0 ? "neutral" : v > 0 ? "positive" : "negative";

    const metric = (label, value, cls = "") => `
      <article class="detail-stat">
        <span>${safe(label)}</span>
        <b class="${cls}">${safe(value)}</b>
      </article>`;

    $("#detailBody").innerHTML = `
      <div class="detail-back-row">
        <button type="button" id="detailBackInline" class="detail-back">← 목록으로 돌아가기</button>
        <button type="button" class="favorite-star" aria-label="즐겨찾기">☆</button>
      </div>

      <section class="detail-identity">
        <div class="detail-logo">${safe((item.ticker || "?").slice(0, 1))}</div>
        <div class="detail-company">
          <h2>${safe(item.ticker)}</h2>
          <p>${safe(item.name || item.ticker)}</p>
        </div>
        <div class="detail-tags">
          <span>Technology</span>
          <span>나스닥-100</span>
        </div>
      </section>

      <section class="detail-price-row">
        <div class="detail-price-main">
          <div class="detail-price-line">
            <strong>${price == null ? "—" : "$" + fmt(price)}</strong>
            <span class="detail-change ${tone(dailyChange)}">
              ${dailyAmount == null ? "" : (dailyAmount > 0 ? "+" : "") + fmt(dailyAmount)}
              ${dailyChange == null ? "" : "(" + pct(dailyChange) + ")"}
            </span>
          </div>
          <p>${safe(last?.date || "기준일 미확인")} · USD</p>
        </div>
        <div class="detail-signal-box">
          <small>신호</small>
          <strong>${safe(item.signal || "관찰")}</strong>
        </div>
      </section>

      <section class="panel detail-chart-panel">
        <div class="detail-chart-top">
          <div class="period-tabs" role="group" aria-label="차트 기간">
            <button type="button" data-period="30">1개월</button>
            <button type="button" data-period="90" class="active">3개월</button>
            <button type="button" data-period="180">6개월</button>
            <button type="button" data-period="365">1년</button>
          </div>
          <div class="chart-legend">
            <span class="ma20-label">■ MA20</span>
            <span class="ma50-label">■ MA50</span>
            <span class="ma200-label">■ MA200</span>
          </div>
        </div>
        <div id="chartMessage" class="muted chart-message"></div>
        <div class="detail-canvas-wrap">
          <canvas id="priceChart" aria-label="캔들스틱 및 거래량 차트"></canvas>
        </div>
      </section>

      <section class="detail-stats-grid">
        ${metric("60일 고점 대비", pct(drop60), tone(drop60))}
        ${metric("RSI (14)", fmt(rsi[i], 1), "rsi-tone")}
        ${metric("RSI 5일 변화", pct(rsiChange), tone(rsiChange))}
        ${metric("20일 저점 대비", pct(rebound20), tone(rebound20))}
        ${metric("MA20 대비", pct(gap20), tone(gap20))}
        ${metric("MA50 대비", pct(gap50), tone(gap50))}
        ${metric("MA200 대비", pct(gap200), tone(gap200))}
        ${metric("거래량 / 20일 평균", volRatio == null ? "—" : volRatio.toFixed(2) + "배", volRatio > 1.2 ? "positive" : "")}
        ${metric("시가총액", "—", "muted-stat")}
      </section>

      <section class="observation-card">
        <div class="observation-heading">
          <span class="observation-icon">▤</span>
          <div><h3>관찰 메모</h3></div>
          <span class="observation-date">${safe(last?.date || "기준일 미확인")} 기준</span>
        </div>

        <p class="observation-body">
          <strong>${safe(memo.headline)}</strong><br>
          ${safe(memo.body)}
        </p>

        <div class="observation-points">
          <div class="observation-point good">
            <span>⬆ 긍정 요인</span>
            <p>${safe(memo.positive)}</p>
          </div>
          <div class="observation-point caution">
            <span>⬇ 주의 요인</span>
            <p>${safe(memo.caution)}</p>
          </div>
          <div class="observation-point watch">
            <span>◎ 관찰 포인트</span>
            <p>${safe(memo.watch)}</p>
          </div>
        </div>

        <div class="reference-links">
          <a href="https://finance.yahoo.com/quote/${encodeURIComponent(item.ticker)}/" target="_blank" rel="noopener noreferrer">애널리스트 참고 정보 ↗</a>
          <a href="https://news.google.com/search?q=${encodeURIComponent(item.ticker + " stock")}" target="_blank" rel="noopener noreferrer">관련 뉴스 검색 ↗</a>
        </div>
      </section>
    `;

    $("#detailBackInline").addEventListener("click", () => showPage("scanner"));

    $$(".period-tabs [data-period]").forEach(button => {
      button.addEventListener("click", () => {
        chartPeriod = Number(button.dataset.period) || 90;
        $$(".period-tabs [data-period]").forEach(b => {
          b.classList.toggle("active", b === button);
        });
        drawStockChart();
      });
    });

    requestAnimationFrame(drawStockChart);
  }
