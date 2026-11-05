import { S, save, activePet, ageText, daysTogether, cleanValue, doClean, getRec, today, josa } from '../store.js';
import { petSVG, SPECIES } from '../characters.js';
import { randomLine, tapLine } from '../lines.js';
import { esc, icon, nav, coinPill, bellButton, on, modal, closeModal, toast, rerender } from '../ui.js';

const INK = '#3B2A1A';

export function sceneSVG() {
  const wall = S.decor.wall;
  const floor = S.decor.floor;
  const fire = S.decor.fireplace;
  const ground = floor
    ? `<rect x="0" y="262" width="390" height="200" fill="#C98E55"/><g stroke="#A8703F" stroke-width="2">${[290, 320, 352, 388, 428].map((y) => `<path d="M0 ${y}H390"/>`).join('')}</g>`
    : `<rect x="0" y="262" width="390" height="200" fill="#CDB48C"/>`;
  const wallFill = wall ? 'url(#wp)' : 'url(#planks)';
  const holes = wall
    ? `<rect x="236" y="150" width="54" height="54" fill="#BFE3F7" stroke="${INK}" stroke-width="3"/><path d="M263 150V204M236 177H290" stroke="${INK}" stroke-width="3"/>`
    : `<rect x="236" y="150" width="54" height="54" fill="#2B1D12" stroke="${INK}" stroke-width="3"/><path d="M240 156 l10 12 M282 160 l-8 10" stroke="#6E5539" stroke-width="3"/><ellipse cx="191" cy="81" rx="15" ry="11" fill="#2B1D12"/>`;
  const wind = wall || fire ? '' : `<g class="wind" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M310 120 Q346 110 382 122M316 134 Q350 126 376 136"/></g>`;
  const fireplace = fire
    ? `<g><rect x="172" y="214" width="54" height="74" fill="#B5583A" stroke="${INK}" stroke-width="3"/><path d="M172 232H226M172 250H226M172 268H226M190 214V232M208 232V250M190 250V268M208 268V288" stroke="#8C3F27" stroke-width="2"/><rect x="182" y="244" width="34" height="44" rx="4" fill="#2B1D12" stroke="${INK}" stroke-width="3"/>
<path class="flame" d="M199 286 Q186 272 196 258 Q198 268 203 262 Q212 272 208 286Z" fill="#F2C94C" stroke="#E07B2A" stroke-width="2"/></g>`
    : '';
  return `<svg class="scene-svg" viewBox="0 0 390 460" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
<pattern id="planks" width="29" height="10" patternUnits="userSpaceOnUse"><rect width="29" height="10" fill="#8F7452"/><rect x="26" width="3" height="10" fill="#6E5539"/></pattern>
<pattern id="wp" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#F4DCC6"/><circle cx="6" cy="6" r="3" fill="#E9B9A0"/><circle cx="18" cy="18" r="3" fill="#BFDDF0"/></pattern>
</defs>
<ellipse cx="60" cy="40" rx="42" ry="14" fill="#fff" opacity=".85"/><ellipse cx="320" cy="76" rx="48" ry="15" fill="#fff" opacity=".85"/>
${ground}<path d="M0 262H390" stroke="${INK}" stroke-width="3"/>
<polygon points="195,24 344,124 46,124" fill="#6E543B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<rect x="64" y="118" width="262" height="170" fill="${wallFill}" stroke="${INK}" stroke-width="3"/>
<rect x="90" y="160" width="66" height="128" fill="#2B1D12" stroke="${INK}" stroke-width="3"/>
${holes}${fireplace}${wind}
<polygon points="110,402 330,402 300,350 140,350" fill="#A8977E" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M300 300 h64 q0 26 -32 26 q-32 0 -32 -26z" fill="#9AA3A8" stroke="${INK}" stroke-width="3"/><path d="M306 304h52" stroke="#7CC4F0" stroke-width="5" stroke-linecap="round"/>
${S.decor.cushion ? `<ellipse cx="195" cy="392" rx="66" ry="16" fill="#E88A9A" stroke="${INK}" stroke-width="3"/><ellipse cx="195" cy="388" rx="50" ry="9" fill="#F3B3BE"/>` : ''}
</svg>`;
}

function dirtSpots(c) {
  if (c >= 90) return '';
  const n = c < 40 ? 6 : c < 70 ? 4 : 2;
  const spots = [
    [40, 82],
    [300, 70],
    [120, 92],
    [250, 90],
    [70, 60],
    [330, 94],
  ];
  return spots
    .slice(0, n)
    .map(([x, b]) => `<span class="dirt" style="left:${x}px;bottom:${b}px" aria-hidden="true"></span>`)
    .join('');
}

let motionTimer = null;
let lineTimer = null;
let mood = 'sad';
let currentLine = '';

function timeMood() {
  const h = new Date().getHours();
  return h >= 23 || h < 6 ? 'sleep' : 'sad';
}

export function render() {
  const p = activePet();
  const r = p ? getRec(p.id, today()) || {} : {};
  const c = cleanValue();
  const done = ['meal', 'water', 'poop', 'walk', 'issues'].filter((k) => r[k] != null).length;
  mood = timeMood();
  currentLine = currentLine || randomLine(p, { recordDone: r.done });
  const multi = S.pets.length > 1;
  const idx = S.pets.findIndex((x) => x.id === (p && p.id));
  const order = ['첫째', '둘째', '셋째', '넷째', '다섯째'];
  const together = daysTogether(p);
  const sub = r.done
    ? `오늘 기록 완료! 내일 또 얘기하자`
    : done
      ? `오늘 기록 ${done}/5 · 이어서 알려줘`
      : `${josa(p.name, '이/가')} 오늘 밥 얘기가 하고 싶대요`;
  return `<div class="screen home">
<div class="home-top"><span>${coinPill()}</span><span class="row gap8">${bellButton()}<a href="#/settings" class="icon-btn" aria-label="설정">${icon('gear', 26)}</a></span></div>
<div class="home-title">
<button class="pet-switch" data-a="switchPet" aria-label="동물 바꾸기">${esc(p.name)}${multi ? ` (${order[idx] || idx + 1 + '번째'}) ▾` : ''}</button>
<div class="sans small sub">${esc(p.breed || SPECIES[p.species].label)} · ${ageText(p)}${together ? ` · 함께한 지 ${together}일 째` : ''}</div>
</div>
<div class="scene" id="scene">
${sceneSVG()}
${dirtSpots(c)}
<div class="bubble" id="bubble" aria-live="polite">${esc(currentLine)}</div>
<button class="char ${mood === 'sleep' ? 'sit' : 'walk'}" id="char" data-a="tapChar" aria-label="${esc(p.name)} 쓰다듬기"><span class="bob">${petSVG(p, { size: 104, mood })}</span></button>
${c < 90 ? `<button class="clean-btn" data-a="clean">${icon('broom', 20)} 청소하기 · 청결 ${c}%</button>` : ''}
</div>
<a class="chat-card" href="#/chat?pet=${p.id}">
<span class="avatar" style="width:44px;height:44px">${petSVG(p, { size: 40, mood: 'sad' })}</span>
<span class="grow"><span class="chat-card-title">${esc(josa(p.name, '과/와'))} 대화하기</span><span class="sans small sub block">${esc(sub)}</span></span>
<span class="round-go" aria-hidden="true">›</span>
</a>
${nav('home')}
</div>`;
}

export function mount() {
  const p = activePet();
  clearInterval(motionTimer);
  clearInterval(lineTimer);
  const ch = document.getElementById('char');
  if (!ch) return;
  // 걷기/앉기 자동 전환
  motionTimer = setInterval(() => {
    const el = document.getElementById('char');
    if (!el) return clearInterval(motionTimer);
    if (timeMood() === 'sleep') return;
    const walking = el.classList.contains('walk');
    el.classList.toggle('walk', !walking);
    el.classList.toggle('sit', walking);
  }, 9000);
  const freq = { low: 25000, normal: 12000, high: 6000 }[S.settings.lineFreq] || 12000;
  lineTimer = setInterval(() => {
    const b = document.getElementById('bubble');
    if (!b) return clearInterval(lineTimer);
    currentLine = randomLine(p);
    b.textContent = currentLine;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }, freq);
}

export function unmount() {
  clearInterval(motionTimer);
  clearInterval(lineTimer);
}

on({
  tapChar() {
    const p = activePet();
    const el = document.getElementById('char');
    const b = document.getElementById('bubble');
    if (!el || !b) return;
    el.querySelector('.bob').innerHTML = petSVG(p, { size: 104, mood: 'happy' });
    el.classList.add('jump');
    currentLine = tapLine(p);
    b.textContent = currentLine;
    setTimeout(() => {
      const e2 = document.getElementById('char');
      if (!e2) return;
      e2.classList.remove('jump');
      e2.querySelector('.bob').innerHTML = petSVG(p, { size: 104, mood: timeMood() });
    }, 1600);
  },
  clean() {
    const { bonus } = doClean();
    currentLine = '오... 깨끗하다. 고맙다 주인아...';
    toast(bonus ? `청소 완료! +${bonus} 코인` : '청소 완료!');
    rerender();
  },
  switchPet() {
    if (S.pets.length < 2) {
      modal(
        `<h2 class="sheet-title">동물이 한 마리예요</h2><p class="sans">나의 동물 탭에서 다른 아이를 추가할 수 있어요.</p>
<div class="sheet-actions"><button class="btn" data-a="closeModal">닫기</button><a class="btn btn-primary" href="#/pet/new" data-a="closeModal">+ 동물 추가</a></div>`,
        { label: '동물 바꾸기' },
      );
      return;
    }
    modal(
      `<h2 class="sheet-title">누구랑 놀까?</h2><div class="list">${S.pets
        .map(
          (x) =>
            `<button class="list-row" data-a="pickPet" data-id="${x.id}"><span class="avatar" style="width:44px;height:44px">${petSVG(x, { size: 40, mood: 'normal' })}</span><span class="grow">${esc(x.name)}</span>${x.id === S.activePetId ? '<span class="pill blue">지금</span>' : ''}</button>`,
        )
        .join('')}</div><div class="sheet-actions"><button class="btn" data-a="closeModal">닫기</button></div>`,
      { label: '동물 바꾸기' },
    );
  },
  pickPet(el) {
    S.activePetId = el.dataset.id;
    save();
    currentLine = '';
    closeModal();
    rerender();
  },
});

