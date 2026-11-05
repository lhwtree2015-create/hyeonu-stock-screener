import { activePet, getPet, getRec, today, addDays, diffDays, shortDate, analyze, ageText, isValidDate, isCat } from '../store.js';
import { SPECIES } from '../characters.js';
import { esc, icon, nav, topbar, on, onInput, rerender, toast } from '../ui.js';

let range = 14; // 7 | 14 | 30 | 'custom'
let custom = { from: addDays(today(), -13), to: today() };

function period() {
  if (range === 'custom') return { ...custom };
  return { from: addDays(today(), -(range - 1)), to: today() };
}

function findings(p, a) {
  const out = [];
  const dates = (arr) => arr.map(shortDate).join(' · ');
  ['구토', '설사', '발작', '식욕부진', '절뚝거림', '기침', '기타'].forEach((k) => {
    const d = a.issueDates[k];
    if (d.length) out.push({ level: k === '발작' || d.length >= 3 ? 'bad' : 'warn', title: `${k} ${d.length}회`, sub: dates(d) });
  });
  if (a.waterMany) {
    const more = a.waterMany > a.prevWaterMany;
    out.push({ level: a.waterMany >= 3 && more ? 'warn' : 'info', title: `음수량 "많이" ${a.waterMany}일`, sub: more ? '이전 같은 기간보다 늘었어요' : `이전 같은 기간 ${a.prevWaterMany}일` });
  }
  if (a.mealLow.length) out.push({ level: a.mealLow.length >= 3 ? 'warn' : 'info', title: `식사 "적게/안 먹음" ${a.mealLow.length}일`, sub: dates(a.mealLow) });
  if (a.poopBad.length) out.push({ level: 'info', title: `배변 이상(묽음/변비) ${a.poopBad.length}일`, sub: dates(a.poopBad) });
  if (a.weight && a.weight.from !== a.weight.to) {
    const pct = a.weight.pct;
    out.push({ level: Math.abs(pct) >= 5 ? 'warn' : 'info', title: `체중 ${a.weight.from} → ${a.weight.to}kg (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`, sub: Math.abs(pct) >= 5 ? '짧은 기간 5% 이상 변화' : '' });
  } else if (a.weight) out.push({ level: 'info', title: `체중 ${a.weight.to}kg`, sub: '기간 내 변화 기록 없음' });
  if (a.walkDays) out.push({ level: 'info', title: `${isCat(p) ? '놀이' : '산책'} 평균 ${a.walkAvg}분`, sub: `${a.walkDays}일 기록` });
  if (a.kcalAvg) out.push({ level: 'info', title: `사료 섭취 평균 약 ${a.kcalAvg}kcal/일`, sub: 'g 입력한 날 기준' });
  return out;
}

function strip(p, from, to) {
  const n = diffDays(from, to) + 1;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(from, i);
    const r = getRec(p.id, d);
    const k = !r ? 'none' : (r.issues || []).length ? 'bad' : 'ok';
    cells.push(`<span class="strip-cell ${k}" title="${d}"></span>`);
  }
  return `<div class="strip" role="img" aria-label="날짜별 기록: 초록은 특이사항 없음, 빨강은 특이사항 있음, 회색은 기록 없음" style="grid-template-columns:repeat(${Math.min(n, 31)},1fr)">${cells.join('')}</div>
<div class="row between sans xsmall sub"><span>${shortDate(from)}</span><span class="row gap8"><span><i class="lg ok"></i>정상</span><span><i class="lg bad"></i>특이사항</span><span><i class="lg none"></i>기록 없음</span></span><span>${shortDate(to)}</span></div>`;
}

export function render(params) {
  const p = (params.get('pet') && getPet(params.get('pet'))) || activePet();
  const { from, to } = period();
  const a = analyze(p.id, from, to);
  const f = findings(p, a);
  const allergy = (p.allergens || []).length ? ` · 알레르기: ${p.allergens.join(', ')}` : '';
  const cond = (p.conditions || []).length ? ` · 질환: ${p.conditions.join(', ')}` : '';
  const segs = [
    [7, '1주'],
    [14, '2주'],
    [30, '1개월'],
    ['custom', '직접'],
  ];
  return `<div class="screen">
${topbar('병원 리포트', { back: '#/calendar', right: `<button class="btn sm" data-a="shareReport">공유</button>` })}
<main class="content">
<div class="row gap6 center wrap" role="group" aria-label="기간"><span class="sans small sub">기간</span>${segs
    .map(([v, l]) => `<button class="seg${range === v ? ' on' : ''}" data-a="setRange" data-v="${v}" aria-pressed="${range === v}">${l}</button>`)
    .join('')}</div>
${range === 'custom' ? `<div class="row gap8"><label class="field"><span class="field-label">시작</span><input type="date" data-i="rangeFrom" value="${custom.from}" max="${today()}"></label><label class="field"><span class="field-label">끝</span><input type="date" data-i="rangeTo" value="${custom.to}" max="${today()}"></label></div>` : ''}
<article class="card report" id="report-card">
<h2 class="report-title">${esc(p.name)} 건강 리포트</h2>
<div class="sans small sub">${shortDate(from)} ~ ${shortDate(to)} (${a.days}일, 기록 ${a.recorded}일) · ${esc(p.breed || SPECIES[p.species].label)} ${ageText(p)} ${p.sex === 'F' ? '여' : '남'}${p.neutered ? '(중성화)' : ''}${esc(allergy)}${esc(cond)}</div>
<h3 class="section-label">변화 감지</h3>
${f.length ? `<ul class="findings">${f.map((x) => `<li class="${x.level}"><span class="block">${esc(x.title)}</span>${x.sub ? `<span class="sans xsmall sub">${esc(x.sub)}</span>` : ''}</li>`).join('')}</ul>` : `<p class="sans small sub">이 기간에 기록이 없어요. 홈에서 채팅으로 기록해 주세요.</p>`}
${strip(p, from, to)}
<p class="disclaimer sans xsmall">보호자 기록 기반 참고 자료예요. 진단이 아니며, 증상이 계속되면 병원 상담을 권해요.</p>
</article>
<div class="row gap8"><button class="btn grow" data-a="saveReportImage">${icon('img', 18)} 이미지로 저장</button><button class="btn btn-yellow grow" data-a="shareReport">${icon('share', 18)} 카톡 등으로 공유</button></div>
</main>
${nav('calendar')}
</div>`;
}

export function reportText() {
  const card = document.getElementById('report-card');
  if (!card) return '';
  const lines = [card.querySelector('.report-title').textContent, card.querySelector('.sub').textContent, '', '[변화 감지]'];
  card.querySelectorAll('.findings li').forEach((li) => lines.push('- ' + [...li.querySelectorAll('span')].map((s) => s.textContent).filter(Boolean).join(' / ')));
  lines.push('', '※ 보호자 기록 기반 참고 자료이며 진단이 아닙니다.');
  return lines.join('\n');
}

function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => res(window.html2canvas);
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function reportBlob() {
  const h2c = await loadHtml2canvas();
  const canvas = await h2c(document.getElementById('report-card'), { backgroundColor: '#FFF8E7', scale: 2 });
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

on({
  setRange(el) {
    range = el.dataset.v === 'custom' ? 'custom' : Number(el.dataset.v);
    rerender();
  },
  async saveReportImage() {
    toast('이미지를 만드는 중...');
    try {
      const blob = await reportBlob();
      const file = new File([blob], 'health-report.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '건강 리포트' });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'health-report.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('이미지를 저장했어요');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('이미지를 만들지 못했어요. 화면 캡처를 이용해 주세요');
    }
  },
  async shareReport() {
    const text = reportText();
    try {
      if (navigator.share) {
        await navigator.share({ title: '건강 리포트', text });
      } else {
        await navigator.clipboard.writeText(text);
        toast('리포트 내용을 복사했어요. 카카오톡에 붙여넣기 하세요');
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('공유하지 못했어요');
    }
  },
});

onInput({
  rangeFrom(el) {
    if (!isValidDate(el.value)) return;
    custom.from = el.value;
    if (custom.from > custom.to) custom.to = custom.from;
    rerender();
  },
  rangeTo(el) {
    if (!isValidDate(el.value)) return;
    custom.to = el.value;
    if (custom.to < custom.from) custom.from = custom.to;
    rerender();
  },
});
