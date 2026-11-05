// 캐릭터 멘트 (억울하지만 주인 좋아하는 말투)
import { S, cleanValue, isCat } from './store.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const LINES = {
  idle: [
    '어디 가냐고? 나도 몰라...',
    '나 오늘도 귀엽지? 대답해.',
    '간식 냄새 난다... 너지?',
    '주인아 나 심심해. 놀아줘.',
    '밥은 언제 주냐... 그냥 물어본 거야.',
    '쳐다보지 마라... 부끄럽다...',
    '오늘 기록은 했냐? 나 기다린다.',
    '주인아... 나 없으면 어쩔 뻔했냐.',
  ],
  cold: ['주인아... 바람 새서 입 돌아간다...', '이 집 바닥 너무 차갑다...', '벽 새로 할까...? 아니 그냥 그렇다고.'],
  warm: ['벽난로 최고다... 주인 최고다...', '따뜻하다... 이 집 좀 괜찮네.'],
  dirty: ['집이 좀... 더럽다... 청소 좀...', '먼지 때문에 재채기 나온다... 에취.'],
  night: ['5분만... 아니 5시간만...', '불 꺼라... 눈부시다...', '쿨... 쿨...'],
  morning: ['일어났냐? 밥 시간이다.', '좋은 아침... 아직 졸리다...'],
  fed: ['이걸 먹으라고? ...맛있네.', '한 그릇 더는 안 되냐?'],
  done: ['기록했네?! 나 칭찬해줘!!', '오늘도 잘 챙겨줬다... 고맙다...'],
  sick: ['어디 아픈 거 아니지...? 병원 가자...', '나 괜찮아... 근데 쓰다듬어줘...'],
  tap: ['왜 찌르냐...', '...한 번 더 해.', '거기 말고 턱 밑.', '헤헤... 아 아니다.'],
  banana: ['바나나 옷... 나 진심 이거 입어야 돼?'],
  walk: ['산책 가자! ...아니 그냥 그렇다고.', '오늘 산책 시간... 아니면 벽 새로 할까?'],
};
const CAT_LINES = {
  walk: ['사냥 놀이 해줘라... 심심하다냥.', '창밖 새 구경 시켜줘라.'],
  tap: ['손 치워라냥...', '...계속 해도 된다냥.'],
};

export function randomLine(pet, ctx = {}) {
  const h = new Date().getHours();
  const pool = [];
  const cat = pet && isCat(pet);
  if (h >= 23 || h < 6) return pick(LINES.night);
  if (h >= 6 && h < 9) pool.push(...LINES.morning);
  pool.push(...LINES.idle);
  if (!S.decor.wall && !S.decor.fireplace) pool.push(...LINES.cold, ...LINES.cold);
  if (S.decor.fireplace) pool.push(...LINES.warm);
  if (cleanValue() < 70) pool.push(...LINES.dirty, ...LINES.dirty);
  if (pet && pet.costume && pet.costume.suit === 'suit_banana') pool.push(...LINES.banana);
  pool.push(...(cat ? CAT_LINES.walk : LINES.walk));
  if (ctx.recordDone) pool.push(...LINES.done);
  return pick(pool);
}
export function tapLine(pet) {
  return pick(pet && isCat(pet) ? CAT_LINES.tap.concat(LINES.tap) : LINES.tap);
}
export const line = (key) => pick(LINES[key]);
