import { S, save, getPet, ageText, daysTogether, isSenior, isCat, latestWeight, healthItems, HEALTH_TYPES, ddayText, today, addDays, isValidDate, findAllergens, shortDate } from '../store.js';
import { petSVG, SPECIES } from '../characters.js';
import { esc, icon, nav, topbar, on, onInput, modal, closeModal, toast, rerender, formData, field, toggle } from '../ui.js';

const sexText = (p) => (p.sex === 'F' ? '여' : '남');
const ddayClass = (d) => (d <= 3 ? 'red' : d <= 30 ? 'blue' : 'gray');

function sparkline(p) {
  const ws = [...(p.weights || [])].sort((a, b) => a.date.localeCompare(b.date)).filter((w) => w.date >= addDays(today(), -92));
  if (ws.length < 2) return '';
  const min = Math.min(...ws.map((w) => w.kg));
  const max = Math.max(...ws.map((w) => w.kg));
  const span = max - min || 1;
  const pts = ws.map((w, i) => `${4 + (i * 140) / (ws.length - 1)},${6 + (1 - (w.kg - min) / span) * 34}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg viewBox="0 0 150 46" width="150" height="46" role="img" aria-label="최근 3개월 체중 변화 그래프"><polyline points="${pts.join(' ')}" fill="none" stroke="#2F7D5B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="#2F7D5B"/></svg>`;
}

export function trendText(p, months = 3) {
  const ws = [...(p.weights || [])].sort((a, b) => a.date.localeCompare(b.date)).filter((w) => w.date >= addDays(today(), -Math.round(months * 30.5)));
  if (ws.length < 2) return '';
  const d = ws[ws.length - 1].kg - ws[0].kg;
  if (Math.abs(d) < 0.05) return '유지 중';
  return d < 0 ? `${Math.abs(d).toFixed(1)}kg 감소 · 다이어트 순항 중!` : `${d.toFixed(1)}kg 증가`;
}

export function tags(p) {
  const list = [...(p.conditions || []), ...(p.allergens || []).map((a) => `${a} 알레르기`)];
  return list.map((t) => `<span class="tag red">${esc(t)}</span>`).join('');
}

// ---------- 목록 ----------
export function renderList() {
  const cards = S.pets
    .map((p) => {
      const lw = latestWeight(p);
      const h = healthItems(p)[0];
      const tg = tags(p);
      return `<article class="card pet-card">
<div class="row gap12 center">
<span class="avatar" style="width:72px;height:72px">${petSVG(p, { size: 62 })}</span>
<div class="grow"><h2 class="pet-name">${esc(p.name)}</h2><div class="small sub">${esc(p.breed || SPECIES[p.species].label)} / ${ageText(p)} / ${sexText(p)}</div></div>
<a class="icon-btn" href="#/pet/${p.id}/edit" aria-label="${esc(p.name)} 정보 수정">${icon('edit', 20)}</a>
</div>
<div class="row wrap gap6 center"><span class="sans small sub">알림</span>${tg || '<span class="sans small sub">없음</span>'}</div>
${lw ? `<div class="row gap10 center divider-top">${sparkline(p)}<div class="green-text">${lw.kg}kg${trendText(p) ? `<br>(${esc(trendText(p))})` : ''}</div></div>` : `<div class="divider-top sans small sub">체중 기록이 아직 없어요</div>`}
<div class="row between center">${h ? `<span class="pill ${ddayClass(h.dday)}">${esc(h.name)} ${ddayText(h.dday)}</span>` : '<span class="sans small sub">예정된 접종·약이 없어요</span>'}<a class="more" href="#/pet/${p.id}">상세 보기 ›</a></div>
</article>`;
    })
    .join('');
  return `<div class="screen">
${topbar('나의 동물', { right: `<a class="btn btn-primary sm" href="#/pet/new">+ 추가</a>` })}
<main class="content">${cards}</main>
${nav('pets')}
</div>`;
}

// ---------- 상세 ----------
let period = 3;

function weightChart(p) {
  const from = addDays(today(), -Math.round(period * 30.5));
  const ws = [...(p.weights || [])].sort((a, b) => a.date.localeCompare(b.date)).filter((w) => w.date >= from);
  if (!ws.length) return `<p class="sans small sub empty">이 기간에 체중 기록이 없어요. 아래 버튼으로 등록해 주세요.</p>`;
  const W = 320;
  const H = 110;
  const L = 40;
  const R = 12;
  const T = 10;
  const B = 22;
  let min = Math.min(...ws.map((w) => w.kg));
  let max = Math.max(...ws.map((w) => w.kg));
  if (max - min < 0.4) {
    min -= 0.2;
    max += 0.2;
  }
  const t0 = new Date(from).getTime();
  const t1 = new Date(today()).getTime();
  const x = (d) => L + ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (kg) => T + (1 - (kg - min) / (max - min)) * (H - T - B);
  const mid = (min + max) / 2;
  const grid = [max, mid, min].map((v) => `<path d="M${L} ${y(v)}H${W - R}"/>`).join('');
  const labels = [max, mid, min].map((v) => `<text x="0" y="${y(v) + 4}">${v.toFixed(1)}kg</text>`).join('');
  const ticks = [0, 1 / 3, 2 / 3, 1]
    .map((f) => {
      const d = addDays(from, Math.round(f * (Math.round(period * 30.5))));
      return `<text x="${Math.min(W - 30, L + f * (W - L - R) - 8)}" y="${H - 4}">${shortDate(d)}</text>`;
    })
    .join('');
  const pts = ws.map((w) => `${x(w.date).toFixed(1)},${y(w.kg).toFixed(1)}`).join(' ');
  const last = ws[ws.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="최근 ${period}개월 체중 변화: ${ws[0].kg}kg에서 ${last.kg}kg">
<g stroke="#E0D3BA" stroke-width="1.5" stroke-dasharray="4 4">${grid}</g>
<g font-size="11" fill="#6B5744" font-family="Noto Sans KR,sans-serif">${labels}${ticks}</g>
${ws.length > 1 ? `<polyline points="${pts}" fill="none" stroke="#2F7D5B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
${ws.map((w) => `<circle cx="${x(w.date).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="${w === last ? 5 : 3}" fill="#2F7D5B"/>`).join('')}
</svg>`;
}

export function dailyKcal(p) {
  const lw = latestWeight(p);
  if (!lw) return null;
  const rer = 70 * Math.pow(lw.kg, 0.75);
  const cat = isCat(p);
  const senior = isSenior(p);
  let f = cat ? (p.neutered ? 1.2 : 1.4) : p.neutered ? 1.6 : 1.8;
  if (senior) f = cat ? 1.1 : 1.4;
  return Math.round((rer * f) / 10) * 10;
}

export function renderDetail(id) {
  const p = getPet(id);
  if (!p) return null;
  const together = daysTogether(p);
  const lw = latestWeight(p);
  const hs = healthItems(p);
  const kcal = dailyKcal(p);
  const foodHit = findAllergens(p.food && p.food.ingredients, p.allergens);
  const tr = trendText(p, period);
  const seniorLabel = isCat(p) ? '노령묘 모드' : '노령견 모드';
  return `<div class="screen">
${topbar(esc(p.name), { back: '#/pets', right: `<a class="icon-btn" href="#/pet/${p.id}/edit" aria-label="${esc(p.name)} 정보 수정">${icon('edit', 20)}</a>` })}
<main class="content">
<div class="row gap12 center"><span class="avatar" style="width:56px;height:56px">${petSVG(p, { size: 48 })}</span>
<div><div>${esc(p.breed || SPECIES[p.species].label)} / ${ageText(p)} / ${sexText(p)}${p.neutered ? ' · 중성화' : ''}</div><div class="sans small sub">${together ? `함께한 지 ${together}일 째` : ''}</div></div></div>
${tags(p) ? `<div class="row wrap gap6">${tags(p)}</div>` : ''}

<section class="card row between center">
<div><h2 class="card-title">${seniorLabel}</h2><div class="sans xsmall sub">관절, 인지 변화 질문이 채팅에 추가돼요${p.senior === 'auto' ? ' · 지금은 나이에 맞춰 자동' : ''}</div></div>
${toggle('senior', isSenior(p), seniorLabel, `data-i="toggleSenior" data-id="${p.id}"`)}
</section>

<section class="card">
<div class="row between center"><h2 class="card-title">체중 변화</h2><button class="btn btn-primary sm" data-a="addWeight" data-id="${p.id}">+ 체중 등록</button></div>
<div class="row gap6 center wrap period" role="group" aria-label="기간(개월)"><span class="sans small sub">기간(개월)</span>${[1, 3, 6, 12, 24, 36]
    .map((m) => `<button class="seg${m === period ? ' on' : ''}" data-a="setPeriod" data-m="${m}" aria-pressed="${m === period}">${m}</button>`)
    .join('')}</div>
${weightChart(p)}
${lw ? `<div class="row between center"><span class="green-text">${lw.kg}kg${tr ? ` (${esc(tr)})` : ''}</span><button class="link-btn" data-a="weightList" data-id="${p.id}">기록 관리</button></div>` : ''}
</section>

<section class="card">
<div class="row between center"><h2 class="card-title">건강검진 · 접종</h2><button class="btn sm" data-a="addHealth" data-id="${p.id}">+ 날짜 입력</button></div>
<div class="sans xsmall sub">마지막 날짜를 넣으면 다음 권장일과 알림이 자동 계산돼요</div>
${hs.length
    ? hs
        .map(
          (h) => `<button class="health-row" data-a="addHealth" data-id="${p.id}" data-k="${h.key}"><span class="grow"><span class="block">${esc(h.name)}</span><span class="sans xsmall sub">마지막 ${h.last} → 다음 ${h.next}</span></span><span class="pill ${ddayClass(h.dday)}">${ddayText(h.dday)}</span></button>`,
        )
        .join('')
    : `<p class="sans small sub empty">아직 입력된 날짜가 없어요.</p>`}
</section>

<section class="card">
<div class="row between center"><span class="sans small sub">주력 사료</span><a class="link-btn" href="#/pet/${p.id}/edit">변경</a></div>
<div>${p.food && p.food.name ? esc(p.food.name) : '아직 설정하지 않았어요'}</div>
<div class="row wrap gap6 center" style="margin-top:4px">
${kcal ? `<span class="sans small">하루 권장 약 ${kcal}kcal (참고용)</span>` : '<span class="sans small sub">체중을 등록하면 하루 권장 칼로리를 계산해요</span>'}
${p.food && p.food.ingredients && (p.allergens || []).length ? (foodHit.length ? `<span class="tag red">${esc(foodHit.join(', '))} 성분 주의</span>` : `<span class="tag green">${esc(p.allergens.join(', '))} 성분 없음</span>`) : ''}
</div>
</section>
</main>
${nav('pets')}
</div>`;
}

on({
  setPeriod(el) {
    period = Number(el.dataset.m);
    rerender();
  },
  addWeight(el) {
    const p = getPet(el.dataset.id);
    const lw = latestWeight(p);
    modal(
      `<h2 class="sheet-title">${esc(p.name)} 체중 등록</h2>
<form data-a-submit="saveWeight" data-id="${p.id}" class="stack">
${field('날짜', `<input type="date" name="date" value="${today()}" max="${today()}" required>`)}
${field('체중 (kg)', `<input name="kg" inputmode="decimal" placeholder="예: 4.2" value="${lw ? lw.kg : ''}" required>`)}
<div class="sheet-actions"><button type="button" class="btn" data-a="closeModal">취소</button><button class="btn btn-yellow">저장</button></div>
</form>`,
      { label: '체중 등록' },
    );
  },
  saveWeight(form) {
    const p = getPet(form.dataset.id);
    const d = formData(form);
    const kg = Math.round(parseFloat(String(d.kg).replace(',', '.')) * 100) / 100;
    if (!(kg > 0 && kg < 150)) return toast('체중을 올바르게 입력해 주세요');
    if (!isValidDate(d.date)) return toast('날짜를 확인해 주세요');
    p.weights = (p.weights || []).filter((w) => w.date !== d.date);
    p.weights.push({ date: d.date, kg });
    save();
    closeModal();
    toast('체중을 기록했어요');
    rerender();
  },
  weightList(el) {
    const p = getPet(el.dataset.id);
    const ws = [...p.weights].sort((a, b) => b.date.localeCompare(a.date));
    modal(
      `<h2 class="sheet-title">체중 기록</h2><div class="list scroll">${ws
        .map((w) => `<div class="list-row"><span class="grow">${w.date}</span><span>${w.kg}kg</span><button class="icon-btn sm" data-a="delWeight" data-id="${p.id}" data-date="${w.date}" aria-label="${w.date} 기록 삭제">${icon('trash', 18)}</button></div>`)
        .join('')}</div><div class="sheet-actions"><button class="btn" data-a="closeModal">닫기</button></div>`,
      { label: '체중 기록' },
    );
  },
  delWeight(el) {
    const p = getPet(el.dataset.id);
    p.weights = p.weights.filter((w) => w.date !== el.dataset.date);
    save();
    el.closest('.list-row').remove();
    rerender();
  },
  addHealth(el) {
    const p = getPet(el.dataset.id);
    const k = el.dataset.k || '';
    const cur = k && p.health[k];
    const opts = HEALTH_TYPES.map((h) => `<option value="${h.key}" ${h.key === k ? 'selected' : ''}>${h.name} (${h.days >= 365 ? Math.round(h.days / 365) + '년' : h.days + '일'}마다)</option>`).join('');
    modal(
      `<h2 class="sheet-title">${k ? '날짜 수정' : '마지막 날짜 입력'}</h2>
<form data-a-submit="saveHealth" data-id="${p.id}" class="stack">
${field('항목', `<select name="key" ${k ? 'disabled' : ''}>${opts}</select>${k ? `<input type="hidden" name="key" value="${k}">` : ''}`)}
${field('마지막으로 한 날', `<input type="date" name="last" value="${cur ? cur.last : today()}" max="${today()}" required>`)}
${field('주기(일) · 비워두면 권장 주기', `<input name="days" inputmode="numeric" placeholder="예: 30" value="${cur && cur.days ? cur.days : ''}">`)}
<div class="sheet-actions">${k ? `<button type="button" class="btn danger" data-a="delHealth" data-id="${p.id}" data-k="${k}">삭제</button>` : `<button type="button" class="btn" data-a="closeModal">취소</button>`}<button class="btn btn-yellow">저장</button></div>
</form>`,
      { label: '건강 일정' },
    );
  },
  saveHealth(form) {
    const p = getPet(form.dataset.id);
    const keyEl = form.querySelector('input[type=hidden][name=key]') || form.querySelector('select[name=key]');
    const d = formData(form);
    if (!isValidDate(d.last)) return toast('날짜를 확인해 주세요');
    const days = parseInt(d.days, 10);
    p.health = p.health || {};
    p.health[keyEl.value] = { last: d.last, ...(days > 0 ? { days } : {}) };
    save();
    closeModal();
    toast('다음 권장일을 계산했어요');
    rerender();
  },
  delHealth(el) {
    const p = getPet(el.dataset.id);
    delete p.health[el.dataset.k];
    save();
    closeModal();
    rerender();
  },
});

onInput({
  toggleSenior(el) {
    const p = getPet(el.dataset.id);
    p.senior = el.checked;
    save();
    toast(el.checked ? '채팅에 관절·인지 질문이 추가돼요' : '노령 모드를 껐어요');
    rerender();
  },
});

