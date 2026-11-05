import { S, save, activePet, getPet, getRec, today, fmt, korDate, addDays, healthItems, HEALTH_TYPES, analyze, uid, isValidDate, isCat } from '../store.js';
import { esc, icon, nav, topbar, on, modal, closeModal, toast, rerender, formData, field } from '../ui.js';

let ym = null; // 'YYYY-MM'
let sel = null; // 선택 날짜

const EVENT_TYPES = ['병원', '주사', '약', '미용', '기타'];

export function reportSignals(petId, days = 14) {
  const t = today();
  const a = analyze(petId, addDays(t, -(days - 1)), t);
  const s = [];
  ['구토', '설사', '발작', '식욕부진', '절뚝거림', '기침'].forEach((k) => {
    if (a.issueDates[k].length) s.push(`${k} ${a.issueDates[k].length}회`);
  });
  if (a.waterMany >= 3) s.push(`음수량 많음 ${a.waterMany}일`);
  if (a.mealLow.length >= 2) s.push(`식사 적음 ${a.mealLow.length}일`);
  return s;
}

function dayMarks(p, d, dueMap) {
  const r = getRec(p.id, d);
  const out = [];
  if (r) {
    if (r.meal) out.push(['밥', r.meal.amount === '안 먹음' || r.meal.amount === '적게' ? 'warn' : 'ok']);
    if (r.walk > 0) out.push([isCat(p) ? '놀이' : '산책', 'ok']);
    (r.issues || []).forEach((k) => out.push([k, 'bad']));
  }
  S.events.filter((e) => e.petId === p.id && e.date === d).forEach((e) => out.push([e.type || '일정', 'evt']));
  HEALTH_TYPES.forEach((h) => {
    if (p.health && p.health[h.key] && p.health[h.key].last === d) out.push([h.label, 'evt']);
  });
  (dueMap[d] || []).forEach((h) => out.push([`${h.label} 예정`, 'due']));
  return out;
}

export function render(params) {
  const p = (params.get('pet') && getPet(params.get('pet'))) || activePet();
  const t = today();
  if (!ym) ym = t.slice(0, 7);
  if (!sel) sel = t;
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startWd = first.getDay();
  const daysIn = new Date(y, m, 0).getDate();
  const dueMap = {};
  healthItems(p).forEach((h) => (dueMap[h.next] = [...(dueMap[h.next] || []), h]));

  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span class="cal-cell empty" aria-hidden="true"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const ds = fmt(new Date(y, m - 1, d));
    const marks = dayMarks(p, ds, dueMap);
    const wd = (startWd + d - 1) % 7;
    const shown = marks.slice(0, 2);
    cells += `<button class="cal-cell${ds === sel ? ' sel' : ''}${ds === t ? ' today' : ''}${wd === 0 ? ' sun' : ''}${ds > t ? ' future' : ''}" data-a="calPick" data-d="${ds}" aria-label="${korDate(ds)}${marks.length ? ': ' + marks.map((x) => x[0]).join(', ') : ''}" aria-pressed="${ds === sel}">
<span class="num">${d}</span>${shown.map(([l, k]) => `<span class="mk ${k}">${esc(l)}</span>`).join('')}${marks.length > 2 ? `<span class="mk more">+${marks.length - 2}</span>` : ''}</button>`;
  }

  const sig = reportSignals(p.id);
  const r = getRec(p.id, sel) || null;
  const evs = S.events.filter((e) => e.petId === p.id && e.date === sel).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const healthDone = HEALTH_TYPES.filter((h) => p.health && p.health[h.key] && p.health[h.key].last === sel);
  const due = dueMap[sel] || [];
  const row = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const meal = r && r.meal ? `${esc(r.meal.amount)}${r.meal.kcal ? ` · ${r.meal.kcal}kcal` : ''}${r.meal.snack ? ` · 간식: ${esc(r.meal.snack)}` : ''}${r.meal.allergyWarn ? ' <span class="tag red">알레르기 주의</span>' : ''}` : '-';
  const detail = `<section class="card">
<div class="row between center"><h2 class="card-title">${korDate(sel)} 기록</h2>${sel <= t ? `<a class="btn sm" href="#/chat?pet=${p.id}&date=${sel}">${r ? '채팅 보기' : '기록하기'}</a>` : ''}</div>
${r ? row('식사', meal) + row('음수량', esc(r.water || '-')) + row('배변', esc(r.poop || '-')) + row(isCat(p) ? '놀이' : '산책', r.walk != null ? (r.walk ? `${r.walk}분` : '안 함') : '-') + (r.joint ? row('관절', esc(r.joint)) : '') + (r.cognitive ? row('인지', esc(r.cognitive)) : '') + row('특이사항', r.issues && r.issues.length ? `<span class="bad-text">${esc(r.issues.join(', '))}</span>` : r.issues ? '없음' : '-') + (r.note ? row('메모', esc(r.note)) : '') : `<p class="sans small sub">${sel > t ? '아직 오지 않은 날이에요.' : '이 날은 기록이 없어요.'}</p>`}
${evs.length || healthDone.length || due.length ? `<div class="divider-top">${evs.map((e) => `<div class="kv"><span class="k">일정</span><span class="v grow">${esc(e.type)} · ${esc(e.title)}${e.time ? ` ${esc(e.time)}` : ''}</span><button class="icon-btn sm" data-a="delEvent" data-id="${e.id}" aria-label="${esc(e.title)} 일정 삭제">${icon('trash', 16)}</button></div>`).join('')}${healthDone.map((h) => row('완료', esc(h.name))).join('')}${due.map((h) => row('예정', `${esc(h.name)} 권장일`)).join('')}</div>` : ''}
</section>`;

  const multi = S.pets.length > 1;
  return `<div class="screen">
${topbar(`<span class="row center gap6"><button class="icon-btn sm" data-a="calMonth" data-n="-1" aria-label="이전 달">‹</button>${y}년 ${m}월<button class="icon-btn sm" data-a="calMonth" data-n="1" aria-label="다음 달">›</button></span>`, { right: `<button class="btn btn-primary sm" data-a="addEvent" data-pet="${p.id}">+ 일정</button>` })}
<main class="content">
<div class="row between center">${multi ? `<button class="pet-chip" data-a="calSwitchPet">${esc(p.name)} ▾</button>` : `<span class="pet-chip static">${esc(p.name)}</span>`}${ym !== t.slice(0, 7) ? `<button class="link-btn" data-a="calToday">오늘로</button>` : ''}</div>
<a class="banner${sig.length ? ' alert' : ''}" href="#/report?pet=${p.id}"><span class="grow"><span class="block">병원 리포트 공유</span><span class="sans xsmall">${sig.length ? `변화 감지 · 최근 2주 ${esc(sig.slice(0, 2).join(', '))}` : '최근 2주 특이사항이 없어요'}</span></span><span>리포트 ›</span></a>
<div class="cal" role="grid" aria-label="${y}년 ${m}월 달력">
<div class="cal-head" aria-hidden="true">${['일', '월', '화', '수', '목', '금', '토'].map((w) => `<span>${w}</span>`).join('')}</div>
<div class="cal-body">${cells}</div>
</div>
${detail}
</main>
${nav('calendar')}
</div>`;
}

on({
  calMonth(el) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.n), 1);
    ym = fmt(d).slice(0, 7);
    rerender();
  },
  calToday() {
    ym = today().slice(0, 7);
    sel = today();
    rerender();
  },
  calPick(el) {
    sel = el.dataset.d;
    rerender();
  },
  calSwitchPet() {
    const i = S.pets.findIndex((x) => x.id === (activePet() && activePet().id));
    S.activePetId = S.pets[(i + 1) % S.pets.length].id;
    save();
    rerender();
  },
  addEvent(el) {
    const p = getPet(el.dataset.pet);
    modal(
      `<h2 class="sheet-title">${esc(p.name)} 일정 추가</h2>
<form data-a-submit="saveEvent" data-pet="${p.id}" class="stack">
${field('종류', `<select name="type">${EVENT_TYPES.map((x) => `<option>${x}</option>`).join('')}</select>`)}
${field('내용', `<input name="title" placeholder="예: 동물병원 정기검진" maxlength="30" required>`)}
<div class="row gap8">${field('날짜', `<input type="date" name="date" value="${sel || today()}" required>`)}${field('시간 (선택)', `<input type="time" name="time">`)}</div>
<div class="sheet-actions"><button type="button" class="btn" data-a="closeModal">취소</button><button class="btn btn-yellow">저장</button></div>
</form>`,
      { label: '일정 추가' },
    );
  },
  saveEvent(form) {
    const d = formData(form);
    if (!d.title) return toast('내용을 입력해 주세요');
    if (!isValidDate(d.date)) return toast('날짜를 확인해 주세요');
    S.events.push({ id: uid(), petId: form.dataset.pet, date: d.date, time: d.time, title: d.title, type: d.type });
    save();
    sel = d.date;
    ym = d.date.slice(0, 7);
    closeModal();
    toast('일정을 추가했어요');
    rerender();
  },
  delEvent(el) {
    S.events = S.events.filter((e) => e.id !== el.dataset.id);
    save();
    rerender();
  },
});

