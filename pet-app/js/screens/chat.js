import { S, save, getPet, activePet, getRec, ensureRec, rewardOnce, today, korDate, isSenior, isCat, findAllergens, josa, isValidDate } from '../store.js';
import { petSVG } from '../characters.js';
import { line } from '../lines.js';
import { esc, icon, on, rerender, toast } from '../ui.js';

const ISSUE_OPTS = ['구토', '설사', '발작', '식욕부진', '절뚝거림', '기침', '멀쩡함', '기타'];

// 질문 정의
const STEP = {
  meal: {
    label: '식사',
    ask: () => '밥은 먹었냐? 얼마나 먹었는지 말해봐',
    opts: ['안 먹음', '적게', '보통', '많이'],
    has: (r) => !!r.meal,
    apply(r, v) {
      r.meal = { ...(r.meal || {}), amount: v };
      return { coin: ['meal', 2], react: { '안 먹음': '입맛이 없다... 걱정되냐?', 적게: '조금만 먹고 싶은 날도 있는 거다.', 보통: line('fed'), 많이: '배 터지겠다... 근데 행복하다.' }[v] };
    },
  },
  mealGram: {
    label: '식사량',
    sub: true,
    when: (p, r) => r.meal && r.meal.amount !== '안 먹음' && Number(p.food && p.food.kcalPerKg) > 0,
    ask: (p) => `사료 몇 g 줬냐? 알면 숫자로 써줘. (${esc(p.food.name || '주력 사료')})`,
    opts: ['모름'],
    input: { type: 'number', placeholder: '예: 60', unit: 'g' },
    has: (r) => r.meal && r.meal.gramsAsked,
    apply(r, v, p) {
      r.meal.gramsAsked = true;
      const g = Number(v);
      if (v === '모름' || !(g > 0)) return { react: '괜찮다. 다음엔 알려줘라.' };
      const kcal = Math.round((g * Number(p.food.kcalPerKg)) / 1000);
      r.meal.grams = g;
      r.meal.kcal = kcal;
      return { sys: `자동 계산 · ${g}g × ${(Number(p.food.kcalPerKg) / 1000).toFixed(2)}kcal = 약 ${kcal}kcal`, react: '숫자까지 세주다니... 감동이다.' };
    },
  },
  snack: {
    label: '간식',
    sub: true,
    when: (p) => (p.allergens || []).length > 0,
    ask: (p) => `간식이나 다른 거 먹은 거 있냐? 나 ${esc(p.allergens.join(', '))} 안 되는 거 알지?`,
    opts: ['없음'],
    input: { type: 'text', placeholder: '예: 닭가슴살 육포' },
    has: (r) => r.meal && r.meal.snackAsked,
    apply(r, v, p) {
      r.meal = r.meal || {};
      r.meal.snackAsked = true;
      if (v === '없음') return { react: '좋다. 깔끔하게 사료만 먹었다.' };
      r.meal.snack = v;
      const hit = findAllergens(v, p.allergens);
      if (hit.length) {
        r.meal.allergyWarn = hit;
        return { warn: `주의 · ${hit.join(', ')} 알레르기 성분이 들어있을 수 있어요. 가려움, 구토, 설사가 있는지 지켜봐 주세요.`, react: '그거... 나 먹으면 안 되는 거 아니냐...?' };
      }
      return { react: '맛있었다. 또 줘라.' };
    },
  },
  water: {
    label: '음수량',
    ask: () => '물은 얼마나 마셨냐?',
    opts: ['적게', '보통', '많이'],
    has: (r) => r.water != null,
    apply(r, v) {
      r.water = v;
      return { coin: ['water', 2], react: v === '많이' ? '목이 많이 말랐다... 며칠 계속되면 병원에 말해줘.' : v === '적게' ? '물 좀 더 챙겨줘라...' : '촉촉하다.' };
    },
  },
  poop: {
    label: '배변',
    ask: () => '응가는? 중요하다 이거.',
    opts: ['정상', '묽음', '설사', '변비', '안 함'],
    has: (r) => r.poop != null,
    apply(r, v) {
      r.poop = v;
      return { coin: ['poop', 2], react: v === '정상' ? '훌륭한 응가였다.' : v === '안 함' ? '오늘은 쉬는 날이다.' : '배가 좀... 이상하다...' };
    },
  },
  walk: {
    label: '산책',
    labelCat: '놀이',
    ask: (p) => (isCat(p) ? '오늘 나랑 놀아줬냐? 몇 분 놀았는지 말해봐.' : '산책은 갔다 왔냐? 억울하다 진짜...'),
    opts: ['안 함', '10분', '20분', '30분', '1시간'],
    input: { type: 'number', placeholder: '분 단위 직접 입력', unit: '분' },
    has: (r) => r.walk != null,
    apply(r, v, p) {
      let m = v === '안 함' ? 0 : v === '1시간' ? 60 : parseInt(v, 10);
      if (!(m >= 0)) m = 0;
      m = Math.min(m, 600);
      r.walk = m;
      const word = isCat(p) ? '놀이' : '산책';
      if (!m) return { react: isCat(p) ? '심심했다... 내일은 놀아줘라.' : '억울하다 진짜... 내일은 꼭 가자.' };
      return { coin: ['walk', 5], sys: `자동 기록 · ${word} ${m}분 · +5 코인`, react: isCat(p) ? '사냥 성공이다. 또 하자.' : '바람 좋았다. 또 가자.' };
    },
  },
  joint: {
    label: '관절',
    senior: true,
    ask: () => '계단 오르거나 점프할 때 힘들어 보였냐?',
    opts: ['괜찮음', '조금', '많이'],
    has: (r) => r.joint != null,
    apply(r, v) {
      r.joint = v;
      return { coin: ['joint', 1], react: v === '괜찮음' ? '나 아직 쌩쌩하다.' : '살살 다뤄줘라... 나이 먹었다...' };
    },
  },
  cognitive: {
    label: '인지',
    senior: true,
    ask: () => '밤에 헤매거나 멍하니 서 있던 적 있냐?',
    opts: ['없음', '가끔', '자주'],
    has: (r) => r.cognitive != null,
    apply(r, v) {
      r.cognitive = v;
      return { coin: ['cognitive', 1], react: v === '없음' ? '정신 멀쩡하다.' : '가끔 깜빡한다... 옆에 있어줘.' };
    },
  },
  issues: {
    label: '특이사항',
    multi: true,
    ask: () => '마지막이다. 특이사항 있냐? 해당되는 거 다 눌러봐',
    opts: ISSUE_OPTS,
    input: { type: 'text', placeholder: '특이사항 직접 입력 (선택)' },
    has: (r) => r.issues != null,
    apply(r, v) {
      const list = (Array.isArray(v) ? v : []).filter((x) => x !== '멀쩡함');
      r.issues = list;
      const res = { coin: ['issues', 2] };
      if (list.includes('발작')) {
        res.warn = '발작이 있었다면 바로 동물병원에 연락해 주세요. 시간과 지속 시간을 메모해 두면 진료에 도움이 돼요.';
      }
      res.react = list.length ? line('sick') : '나 멀쩡하다! 걱정 마라.';
      return res;
    },
  },
};

function stepKeys(p) {
  const q = S.settings.questions;
  const keys = ['meal', 'mealGram', 'snack'];
  if (q.water) keys.push('water');
  if (q.poop) keys.push('poop');
  if (q.walk) keys.push('walk');
  if (isSenior(p)) keys.push('joint', 'cognitive');
  keys.push('issues');
  return keys;
}
function activeSteps(p, r) {
  return stepKeys(p).filter((k) => !STEP[k].when || STEP[k].when(p, r));
}
function mainSteps(p) {
  return stepKeys(p).filter((k) => !STEP[k].sub);
}

let C = null; // 채팅 상태

function start(petId, date, restart) {
  const p = getPet(petId) || activePet();
  const r = getRec(p.id, date) || {};
  C = { petId: p.id, date, log: [], sel: [], restart: !!restart };
  const isToday = date === today();
  const answered = mainSteps(p).filter((k) => STEP[k].has(r));
  if (!restart && answered.length) {
    C.log.push({ who: 'pet', text: r.done ? `${isToday ? '오늘' : korDate(date)} 기록 이미 다 했다. 고칠 거 있냐?` : '아까 하던 얘기 마저 하자.' });
  } else {
    C.log.push({ who: 'pet', text: isToday ? `왔냐 주인아. 오늘 ${josa(p.name, '은/는')} 어땠는지 들어봐라.` : `${korDate(date)} 얘기 하는 거냐? 기억 안 나지만 말해봐.` });
  }
  if (restart) C.answered = new Set();
  else C.answered = new Set(activeSteps(p, r).filter((k) => STEP[k].has(r)));
  ask();
}

function currentKey() {
  const p = getPet(C.petId);
  const r = getRec(C.petId, C.date) || {};
  return activeSteps(p, r).find((k) => !C.answered.has(k)) || null;
}

function ask() {
  const p = getPet(C.petId);
  const k = currentKey();
  if (!k) {
    finish();
    return;
  }
  C.log.push({ who: 'pet', text: STEP[k].ask(p), key: k });
}

function finish() {
  const r = ensureRec(C.petId, C.date);
  const wasDone = r.done;
  r.done = true;
  let bonus = 0;
  if (C.date === today() && !wasDone) bonus = rewardOnce(r, 'done', 10);
  save();
  const sick = (r.issues || []).length > 0;
  C.log.push({ who: 'pet', text: sick ? line('sick') : line('done'), final: true });
  if (bonus) C.log.push({ who: 'sys', text: `오늘 기록 완료 보너스 · +${bonus} 코인` });
  C.finished = true;
  C.sick = sick;
}

function answer(value, display) {
  const p = getPet(C.petId);
  const k = currentKey();
  if (!k) return;
  const r = ensureRec(C.petId, C.date);
  C.log.push({ who: 'me', text: display ?? (Array.isArray(value) ? value.join(', ') || '멀쩡함' : String(value)) });
  const res = STEP[k].apply(r, value, p) || {};
  C.answered.add(k);
  if (res.coin && C.date === today()) {
    const got = rewardOnce(r, res.coin[0], res.coin[1]);
    if (got && !res.sys) C.log.push({ who: 'sys', text: `${STEP[k].label} 기록 · +${got} 코인` });
  }
  if (res.sys) C.log.push({ who: 'sys', text: res.sys });
  if (res.warn) C.log.push({ who: 'warn', text: res.warn });
  if (res.react) C.log.push({ who: 'pet', text: res.react });
  save();
  C.sel = [];
  ask();
  rerender();
}

export function render(params) {
  const petId = params.get('pet') || (activePet() && activePet().id);
  let date = params.get('date') || today();
  if (!isValidDate(date) || date > today()) date = today();
  if (!C || C.petId !== petId || C.date !== date) start(petId, date);
  const p = getPet(C.petId);
  const r = getRec(C.petId, C.date) || {};
  const ms = mainSteps(p);
  const doneCount = ms.filter((k) => STEP[k].has(r)).length;
  const k = C.finished ? null : currentKey();
  const st = k ? STEP[k] : null;

  const chips = ms
    .map((key) => {
      const label = key === 'walk' && isCat(p) ? STEP[key].labelCat : STEP[key].label;
      const ok = STEP[key].has(r);
      return `<span class="step${ok ? ' ok' : ''}${key === k ? ' now' : ''}">${label}${ok ? ' ✓' : ''}</span>`;
    })
    .join('');

  const msgs = C.log
    .map((m) => {
      if (m.who === 'pet') return `<div class="msg pet"><span class="avatar" style="width:40px;height:40px">${petSVG(p, { size: 36, mood: m.final && !C.sick ? 'happy' : 'sad' })}</span><p class="b">${esc(m.text)}</p></div>`;
      if (m.who === 'me') return `<div class="msg me"><p class="b">${esc(m.text)}</p></div>`;
      if (m.who === 'warn') return `<div class="msg-sys warn" role="alert">${esc(m.text)}</div>`;
      return `<div class="msg-sys">${esc(m.text)}</div>`;
    })
    .join('');

  let controls = '';
  if (st) {
    const opts = st.opts
      .map((o) => {
        if (st.multi) {
          const on = C.sel.includes(o);
          return `<button class="opt${on ? ' on' : ''}" data-a="chatToggle" data-v="${esc(o)}" aria-pressed="${on}">${esc(o)}</button>`;
        }
        return `<button class="opt" data-a="chatAnswer" data-v="${esc(o)}">${esc(o)}</button>`;
      })
      .join('');
    const multiDone = st.multi ? `<button class="btn btn-primary full" data-a="chatMultiDone">선택 완료</button>` : '';
    const input = st.input
      ? `<form class="chat-input" data-a-submit="chatText"><input name="t" type="${st.input.type === 'number' ? 'text' : 'text'}" ${st.input.type === 'number' ? 'inputmode="numeric" pattern="[0-9]*"' : ''} placeholder="${esc(st.input.placeholder)}" aria-label="${esc(st.input.placeholder)}" autocomplete="off"><button class="send" aria-label="보내기">${icon('send', 22)}</button></form>`
      : '';
    controls = `<div class="opts">${opts}</div>${multiDone}${input}`;
  } else {
    controls = `<div class="row gap8">${C.sick ? `<a class="btn grow" href="#/report?pet=${p.id}">병원 리포트 보기</a>` : ''}<a class="btn btn-yellow grow" href="#/home">홈으로</a></div>
<button class="link-btn" data-a="chatRestart">처음부터 다시 기록하기</button>`;
  }

  return `<div class="screen chat">
<header class="topbar"><a class="icon-btn" href="#/home" aria-label="닫기">${icon('close', 22)}</a><h1 class="topbar-title">${esc(p.name)} · ${C.date === today() ? '오늘' : korDate(C.date)} 기록 (${doneCount}/${ms.length})</h1></header>
<div class="steps" aria-label="기록 진행">${chips}</div>
<div class="chat-log" id="chatlog">${msgs}</div>
<div class="chat-controls">${controls}</div>
</div>`;
}

export function mount() {
  const log = document.getElementById('chatlog');
  if (log) log.scrollTop = log.scrollHeight;
}

export function resetChat() {
  C = null;
}

on({
  chatAnswer(el) {
    answer(el.dataset.v);
  },
  chatToggle(el) {
    const v = el.dataset.v;
    if (v === '멀쩡함') C.sel = C.sel.includes(v) ? [] : ['멀쩡함'];
    else {
      C.sel = C.sel.filter((x) => x !== '멀쩡함');
      C.sel = C.sel.includes(v) ? C.sel.filter((x) => x !== v) : [...C.sel, v];
    }
    rerender();
  },
  chatMultiDone() {
    const input = document.querySelector('.chat-input input');
    const note = input ? input.value.trim() : '';
    const r = ensureRec(C.petId, C.date);
    let sel = [...C.sel];
    if (note) {
      r.note = note;
      if (!sel.includes('기타') && !sel.length) sel.push('기타');
    }
    if (!sel.length) sel = ['멀쩡함'];
    answer(sel, sel.join(', ') + (note ? ` · ${note}` : ''));
  },
  chatRestart() {
    start(C.petId, C.date, true);
    C.finished = false;
    rerender();
  },
});

on({
  chatText(form) {
    const v = form.querySelector('input').value.trim();
    if (!v) return;
    const k = currentKey();
    if (!k) return;
    if (STEP[k].multi) {
      // 특이사항 입력칸은 '선택 완료'와 같이 처리
      document.querySelector('[data-a="chatMultiDone"]').click();
      return;
    }
    if (STEP[k].input.type === 'number' && !(Number(v) > 0)) {
      toast('숫자로 입력해 주세요');
      return;
    }
    answer(v, STEP[k].input.unit ? `${v}${STEP[k].input.unit}` : v);
  },
});
