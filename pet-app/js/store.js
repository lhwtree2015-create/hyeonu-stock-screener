// 앱 데이터 저장소 (휴대폰 브라우저 localStorage에 저장)
const KEY = 'choco-diary-v1';

// ---------- 날짜 도우미 ----------
export function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function parse(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const today = () => fmt(new Date());
export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}
/** b - a (일) */
export function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function korDate(s, withWeekday = true) {
  const d = parse(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일` + (withWeekday ? ` (${WD[d.getDay()]})` : '');
}
export function shortDate(s) {
  const d = parse(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parse(s));
}
/** 받침에 맞는 조사: josa('초코','이/가') → '초코가' */
export function josa(word, pair) {
  const w = String(word || '');
  const [a, b] = pair.split('/');
  const c = w.charCodeAt(w.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return w + b;
  const jong = (c - 0xac00) % 28;
  if (pair === '으로/로' && jong === 8) return w + b;
  return w + (jong ? a : b);
}
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// ---------- 기본 데이터 ----------
export const HEALTH_TYPES = [
  { key: 'heartworm', name: '심장사상충 약', days: 30, label: '약' },
  { key: 'vaccine', name: '종합백신', days: 365, label: '주사' },
  { key: 'rabies', name: '광견병 접종', days: 365, label: '주사' },
  { key: 'checkup', name: '건강검진', days: 365, label: '병원' },
  { key: 'deworm', name: '내부 구충제', days: 90, label: '약' },
  { key: 'flea', name: '외부 기생충 약', days: 30, label: '약' },
  { key: 'scaling', name: '스케일링', days: 365, label: '병원' },
];

export const ISSUES = ['구토', '설사', '발작', '식욕부진', '절뚝거림', '기침', '기타'];

export const SHOP = [
  { id: 'wall_windproof', cat: 'decor', slot: 'wall', name: '바람막이 벽지', price: 80, desc: '바람 새는 판자벽을 막아줘요' },
  { id: 'floor_wood', cat: 'decor', slot: 'floor', name: '새로운 바닥', price: 150, desc: '차가운 흙바닥 안녕' },
  { id: 'fireplace', cat: 'decor', slot: 'fireplace', name: '아늑한 벽난로', price: 300, desc: '추운 판자집이 따뜻해져요' },
  { id: 'cushion', cat: 'decor', slot: 'cushion', name: '폭신한 방석', price: 60, desc: '앉으면 기분이 좋아져요' },
  { id: 'suit_banana', cat: 'costume', slot: 'suit', name: '바나나 수트', price: 300, desc: '전설의 그 옷' },
  { id: 'hat_angry', cat: 'costume', slot: 'hat', name: '앵그리 캡', price: 250, desc: '화난 거 아님. 원래 이럼' },
  { id: 'glasses_heart', cat: 'costume', slot: 'glasses', name: '하트 안경', price: 200, desc: '세상이 다 사랑스러워 보여요' },
  { id: 'hat_party', cat: 'costume', slot: 'hat', name: '파티 고깔', price: 120, desc: '생일 아니어도 씀' },
  { id: 'suit_frog', cat: 'costume', slot: 'suit', name: '개구리 우비', price: 220, desc: '비 오는 날 산책용' },
];
export const shopItem = (id) => SHOP.find((i) => i.id === id);

function defaults() {
  return {
    v: 1,
    coins: 100,
    pets: [],
    activePetId: null,
    records: {}, // records[petId][YYYY-MM-DD] = {...}
    events: [], // {id, petId, date, time, title, type}
    inventory: [],
    decor: { wall: null, floor: null, fireplace: null, cushion: null },
    clean: { value: 100, at: Date.now() },
    settings: {
      notifyRecord: true,
      notifySchedule: true,
      notifyClean: true,
      lineFreq: 'normal',
      questions: { water: true, poop: true, walk: true, issues: true },
    },
    readNotis: [],
    shownNotis: [],
    rewards: [], // {id, title, body, at}
    createdAt: Date.now(),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = JSON.parse(raw);
    const base = defaults();
    return {
      ...base,
      ...d,
      decor: { ...base.decor, ...(d.decor || {}) },
      clean: { ...base.clean, ...(d.clean || {}) },
      settings: {
        ...base.settings,
        ...(d.settings || {}),
        questions: { ...base.settings.questions, ...((d.settings || {}).questions || {}) },
      },
    };
  } catch (e) {
    console.warn('데이터를 불러오지 못했어요', e);
    return defaults();
  }
}

export let S = load();
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    console.warn('저장 실패', e);
  }
}
export function replaceAll(data) {
  const base = defaults();
  S = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  save();
}
export function resetAll() {
  S = defaults();
  save();
}
export function exportJSON() {
  return JSON.stringify(S, null, 2);
}

// ---------- 동물 ----------
export function activePet() {
  return S.pets.find((p) => p.id === S.activePetId) || S.pets[0] || null;
}
export const getPet = (id) => S.pets.find((p) => p.id === id) || null;

export function newPet(partial = {}) {
  return {
    id: uid(),
    name: '',
    species: 'maltese',
    fur: 'white',
    breed: '말티즈',
    birthday: '',
    metDate: today(),
    sex: 'M',
    neutered: true,
    conditions: [], // 질환
    allergens: [], // 알레르기 성분 (예: 닭고기)
    food: { name: '', kcalPerKg: '', ingredients: '' },
    senior: 'auto', // 'auto' | true | false
    weights: [], // {date, kg}
    health: {}, // key -> {last}
    costume: { hat: null, glasses: null, suit: null },
    ...partial,
  };
}

export function petAge(p) {
  if (!isValidDate(p.birthday)) return null;
  const b = parse(p.birthday);
  const n = new Date();
  let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) months -= 1;
  return Math.max(0, months);
}
export function ageText(p) {
  const m = petAge(p);
  if (m == null) return '나이 미입력';
  if (m < 12) return `${m}개월`;
  return `${Math.floor(m / 12)}살`;
}
export function daysTogether(p) {
  if (!isValidDate(p.metDate)) return null;
  return diffDays(p.metDate, today()) + 1;
}
export function isCat(p) {
  return ['cheese', 'black', 'calico'].includes(p.species);
}
export function isSenior(p) {
  if (p.senior === true || p.senior === false) return p.senior;
  const m = petAge(p);
  if (m == null) return false;
  return m >= (isCat(p) ? 120 : 84); // 고양이 10살, 강아지 7살
}
export function latestWeight(p) {
  const w = [...(p.weights || [])].sort((a, b) => a.date.localeCompare(b.date));
  return w[w.length - 1] || null;
}

export function healthItems(p) {
  const t = today();
  return HEALTH_TYPES.filter((h) => p.health && p.health[h.key] && isValidDate(p.health[h.key].last))
    .map((h) => {
      const last = p.health[h.key].last;
      const days = Number(p.health[h.key].days) || h.days;
      const next = addDays(last, days);
      return { ...h, days, last, next, dday: diffDays(t, next) };
    })
    .sort((a, b) => a.dday - b.dday);
}
export function ddayText(d) {
  if (d === 0) return 'D-DAY';
  return d > 0 ? `D-${d}` : `D+${-d}`;
}

// ---------- 기록 ----------
export function getRec(petId, date) {
  return (S.records[petId] && S.records[petId][date]) || null;
}
export function ensureRec(petId, date) {
  S.records[petId] = S.records[petId] || {};
  S.records[petId][date] = S.records[petId][date] || { coins: {} };
  S.records[petId][date].coins = S.records[petId][date].coins || {};
  return S.records[petId][date];
}
/** 오늘 기록 항목 하나당 한 번만 코인 지급 */
export function rewardOnce(rec, key, amount) {
  if (rec.coins[key]) return 0;
  rec.coins[key] = amount;
  S.coins += amount;
  return amount;
}

export function addReward(title, body) {
  S.rewards.unshift({ id: 'rw-' + uid(), title, body, at: Date.now() });
  S.rewards = S.rewards.slice(0, 50);
}

// ---------- 집 청결 ----------
const DECAY_PER_HOUR = 0.6; // 하루 약 14%씩 더러워져요
export function cleanValue() {
  const hours = (Date.now() - S.clean.at) / 3600000;
  return Math.max(0, Math.round(S.clean.value - hours * DECAY_PER_HOUR));
}
export function doClean() {
  const before = cleanValue();
  let bonus = 0;
  if (before < 70) bonus = 20;
  else if (before < 90) bonus = 5;
  S.clean = { value: 100, at: Date.now() };
  if (bonus) {
    S.coins += bonus;
    addReward(before < 70 ? '복귀 보상이 도착했어요' : '청소 보상', `청소 완료 · +${bonus} 코인`);
  }
  save();
  return { before, bonus };
}

// ---------- 리포트 분석 ----------
export function analyze(petId, from, to) {
  const days = diffDays(from, to) + 1;
  const list = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const r = getRec(petId, d);
    if (r) list.push({ date: d, r });
  }
  const issueDates = {};
  ISSUES.forEach((k) => (issueDates[k] = []));
  let waterMany = 0;
  const mealLow = [];
  const walks = [];
  let kcalSum = 0;
  let kcalDays = 0;
  const poopBad = [];
  list.forEach(({ date, r }) => {
    (r.issues || []).forEach((k) => issueDates[k] && issueDates[k].push(date));
    if (r.poop === '설사' && !(r.issues || []).includes('설사')) issueDates['설사'].push(date);
    if (r.water === '많이') waterMany++;
    if (r.meal && (r.meal.amount === '적게' || r.meal.amount === '안 먹음')) mealLow.push(date);
    if (typeof r.walk === 'number' && r.walk > 0) walks.push(r.walk);
    if (r.meal && r.meal.kcal) {
      kcalSum += r.meal.kcal;
      kcalDays++;
    }
    if (r.poop && ['묽음', '변비'].includes(r.poop)) poopBad.push(date);
  });
  // 이전 같은 기간 음수량 비교
  let prevWaterMany = 0;
  for (let i = 1; i <= days; i++) {
    const r = getRec(petId, addDays(from, -i));
    if (r && r.water === '많이') prevWaterMany++;
  }
  const p = getPet(petId);
  const ws = [...((p && p.weights) || [])].sort((a, b) => a.date.localeCompare(b.date));
  const before = [...ws].filter((w) => w.date <= from).pop() || ws.find((w) => w.date >= from && w.date <= to);
  const after = [...ws].filter((w) => w.date <= to).pop();
  let weight = null;
  if (before && after && before !== after) {
    weight = { from: before.kg, to: after.kg, pct: ((after.kg - before.kg) / before.kg) * 100 };
  } else if (after) {
    weight = { from: after.kg, to: after.kg, pct: 0 };
  }
  return {
    days,
    recorded: list.length,
    issueDates,
    waterMany,
    prevWaterMany,
    mealLow,
    poopBad,
    walkAvg: walks.length ? Math.round(walks.reduce((a, b) => a + b, 0) / walks.length) : 0,
    walkDays: walks.length,
    kcalAvg: kcalDays ? Math.round(kcalSum / kcalDays) : 0,
    weight,
  };
}

/** 알레르기 성분이 문장에 들어있는지 확인 */
const ALLERGEN_ALIASES = {
  닭고기: ['닭', '치킨', 'chicken'],
  소고기: ['소고기', '쇠고기', '비프', 'beef'],
  돼지고기: ['돼지', '포크', 'pork'],
  연어: ['연어', 'salmon'],
  밀: ['밀', '글루텐', 'wheat'],
  우유: ['우유', '유제품', '치즈', 'milk'],
  달걀: ['달걀', '계란', 'egg'],
  오리: ['오리', 'duck'],
  양고기: ['양고기', '램', 'lamb'],
};
export function findAllergens(text, allergens) {
  const t = String(text || '').toLowerCase();
  if (!t) return [];
  return (allergens || []).filter((a) => {
    const key = a.replace(/\s*알레르기\s*/g, '').trim();
    const words = ALLERGEN_ALIASES[key] || [key.replace(/고기$/, '') || key, key];
    return words.some((w) => w && t.includes(w.toLowerCase()));
  });
}

// ---------- 알림 계산 ----------
export function computeNotis() {
  const out = [];
  const t = today();
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  S.pets.forEach((p) => {
    const r = getRec(p.id, t) || {};
    if (S.settings.notifyRecord) {
      if (!r.meal && hour >= 8)
        out.push({ id: `meal-${p.id}-${t}`, tag: '식사', title: `${josa(p.name, '이/가')} 배고파해요`, body: '오늘 밥 기록이 아직 없어요. 알려줘!', when: t, link: `#/chat?pet=${p.id}` });
      if (!isCat(p) && S.settings.questions.walk && r.walk == null && hour >= 17.5)
        out.push({ id: `walk-${p.id}-${t}`, tag: '산책', title: '산책 갈 시간이야...', body: `${p.name}의 오늘 산책 기록이 아직 없어요.`, when: t, link: `#/chat?pet=${p.id}` });
    }
    if (S.settings.notifySchedule) {
      healthItems(p).forEach((h) => {
        if (h.dday <= 3)
          out.push({
            id: `health-${p.id}-${h.key}-${h.next}`,
            tag: '일정',
            title: `${h.name} ${ddayText(h.dday)}`,
            body: h.dday < 0 ? `${p.name}의 ${h.name} 예정일이 ${-h.dday}일 지났어요.` : `${p.name}의 ${h.name} 예정일이 ${korDate(h.next, false)}이에요.`,
            when: t,
            link: `#/pet/${p.id}`,
          });
      });
    }
    // 주간 리포트 (최근 7일 이상 신호)
    const a = analyze(p.id, addDays(t, -6), t);
    const signals = [];
    if (a.issueDates['구토'].length >= 2) signals.push(`구토 ${a.issueDates['구토'].length}회`);
    if (a.issueDates['설사'].length >= 2) signals.push(`설사 ${a.issueDates['설사'].length}회`);
    if (a.issueDates['발작'].length >= 1) signals.push(`발작 ${a.issueDates['발작'].length}회`);
    if (a.waterMany >= 3 && a.waterMany > a.prevWaterMany) signals.push('음수량 증가');
    if (a.mealLow.length >= 3) signals.push('식욕 감소');
    if (signals.length)
      out.push({ id: `report-${p.id}-${addDays(t, -((new Date().getDay() + 6) % 7))}`, tag: '리포트', title: `${p.name} 주간 특이사항`, body: `${signals.join(', ')}이(가) 감지됐어요. 병원 상담을 권해요.`, when: t, link: `#/report?pet=${p.id}` });
  });
  if (S.settings.notifySchedule) {
    S.events.forEach((e) => {
      const d = diffDays(t, e.date);
      if (d === 0 || d === 1) {
        const p = getPet(e.petId);
        out.push({ id: `event-${e.id}`, tag: '일정', title: `${d === 0 ? '오늘' : '내일'} ${e.title}`, body: `${p ? p.name + ' · ' : ''}${korDate(e.date)} ${e.time || ''}`.trim(), when: t, link: '#/calendar' });
      }
    });
  }
  if (S.settings.notifyClean) {
    const c = cleanValue();
    if (c < 70) out.push({ id: `clean-${t}`, tag: '청결', title: '집이 조금 더러워졌어요', body: `청결 ${c}% · 홈에서 청소하면 보너스 코인!`, when: t, link: '#/home' });
  }
  S.rewards.forEach((rw) => out.push({ id: rw.id, tag: '보상', title: rw.title, body: rw.body, when: fmt(new Date(rw.at)), link: '#/shop' }));
  return out;
}
export function unreadCount() {
  return computeNotis().filter((n) => !S.readNotis.includes(n.id)).length;
}
export function markRead(ids) {
  const set = new Set(S.readNotis);
  ids.forEach((i) => set.add(i));
  S.readNotis = [...set].slice(-500);
  save();
}
