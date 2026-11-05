// 공통 화면 조각과 도우미
import { S, unreadCount } from './store.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  home: '<path d="M3 11 12 3l9 8v9h-6v-6H9v6H3z"/>',
  paw: '<circle cx="6" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="18" cy="10" r="2"/><path d="M12 12c-3 0-5 3-5 5 0 2 2 2.5 5 1.5 3 1 5 .5 5-1.5 0-2-2-5-5-5z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  shop: '<path d="M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0"/>',
  bell: '<path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-width="4" stroke-dasharray="3 3.1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  broom: '<path d="M14 3l-4 9M6 13h8l2 8H4z"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  img: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
};
export function icon(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function nav(active) {
  const items = [
    ['home', '#/home', 'home', '홈'],
    ['pets', '#/pets', 'paw', '나의 동물'],
    ['calendar', '#/calendar', 'cal', '캘린더'],
    ['shop', '#/shop', 'shop', '상점'],
  ];
  return `<nav class="nav" aria-label="주요 메뉴">${items
    .map(([k, href, ic, label]) => `<a href="${href}" class="nav-item${k === active ? ' on' : ''}"${k === active ? ' aria-current="page"' : ''}>${icon(ic, 26)}${label}</a>`)
    .join('')}</nav>`;
}

export function topbar(title, { back, right = '' } = {}) {
  const b = back ? `<button class="icon-btn" data-a="back" data-to="${esc(back)}" aria-label="뒤로">‹</button>` : '';
  return `<header class="topbar">${b}<h1 class="topbar-title">${title}</h1><span class="grow"></span>${right}</header>`;
}

export function coinPill() {
  return `<span class="coin-pill"><span class="coin" aria-hidden="true"></span><span class="sr">코인</span>${S.coins}</span>`;
}

export function bellButton() {
  const n = unreadCount();
  return `<a href="#/notifications" class="icon-btn" aria-label="알림 내역${n ? ` (읽지 않은 알림 ${n}개)` : ''}">${icon('bell', 26)}${n ? '<span class="dot" aria-hidden="true"></span>' : ''}</a>`;
}

// ---------- 액션(클릭) 등록 ----------
export const actions = {};
export const inputs = {};
export function on(map) {
  Object.assign(actions, map);
}
export function onInput(map) {
  Object.assign(inputs, map);
}

let rerenderFn = () => {};
export function setRerender(fn) {
  rerenderFn = fn;
}
export const rerender = () => rerenderFn();

// ---------- 모달 ----------
let lastFocus = null;
export function modal(html, { label = '대화상자' } = {}) {
  const root = document.getElementById('modal-root');
  lastFocus = document.activeElement;
  root.innerHTML = `<div class="backdrop" data-a="closeModalBackdrop"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div></div>`;
  const first = root.querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 30);
}
export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
on({
  closeModal,
  closeModalBackdrop(el, e) {
    if (e.target === el) closeModal();
  },
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('#modal-root .sheet')) closeModal();
});

export function formData(container) {
  const out = {};
  container.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.value.trim();
  });
  return out;
}

// ---------- 토스트 ----------
let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function field(label, input) {
  return `<label class="field"><span class="field-label">${label}</span>${input}</label>`;
}
export function toggle(name, checked, label, extra = '') {
  return `<label class="switch"><input type="checkbox" role="switch" name="${name}" ${checked ? 'checked' : ''} aria-label="${esc(label)}" ${extra}><span class="track" aria-hidden="true"></span></label>`;
}
