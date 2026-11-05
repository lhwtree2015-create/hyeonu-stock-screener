import { S, save } from './store.js';
import { actions, inputs, setRerender } from './ui.js';
import * as home from './screens/home.js';
import * as chat from './screens/chat.js';
import * as pets from './screens/pets.js';
import * as petEdit from './screens/petEdit.js';
import * as calendar from './screens/calendar.js';
import * as report from './screens/report.js';
import * as shop from './screens/shop.js';
import * as notifications from './screens/notifications.js';
import * as settings from './screens/settings.js';
import { pushNewNotifications } from './notify.js';

const app = document.getElementById('app');
let prevKey = '';

function resolve() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  const noPets = S.pets.length === 0;

  if (noPets && !['new', 'settings'].includes(parts[0])) return { redirect: '#/new' };
  if (parts[0] === 'pet' && parts[1] === 'new') {
    petEdit.clearDraft();
    return { redirect: '#/new' };
  }
  switch (parts[0]) {
    case 'home':
      return { key: 'home', html: home.render(), mod: home };
    case 'new':
      return { key: 'new', html: petEdit.renderNew() };
    case 'chat':
      return { key: 'chat', html: chat.render(params), mod: chat };
    case 'pets':
      return { key: 'pets', html: pets.renderList() };
    case 'pet': {
      const id = parts[1];
      const html = parts[2] === 'edit' ? petEdit.renderEdit(id) : parts[2] === 'character' ? petEdit.renderCharacter(id) : pets.renderDetail(id);
      if (!html) return { redirect: '#/pets' };
      return { key: `pet-${parts[2] || 'detail'}`, html };
    }
    case 'calendar':
      return { key: 'calendar', html: calendar.render(params) };
    case 'report':
      return { key: 'report', html: report.render(params) };
    case 'shop':
      return { key: 'shop', html: shop.render() };
    case 'notifications':
      return { key: 'notifications', html: notifications.render() };
    case 'settings':
      return { key: 'settings', html: settings.render() };
    default:
      return { redirect: '#/home' };
  }
}

let currentMod = null;

function render(isRerender = false) {
  const key0 = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  // 화면을 떠날 때 정리
  if (!isRerender) {
    if (!key0.startsWith('chat')) chat.resetChat();
    if (!key0.startsWith('pet/') && key0 !== 'new') petEdit.clearDraft();
    else if (key0.startsWith('pet/') && !/\/(edit|character)$/.test(key0)) petEdit.clearDraft();
  }
  const r = resolve();
  if (r.redirect) {
    if (location.hash !== r.redirect) location.replace(r.redirect);
    else app.innerHTML = '';
    return;
  }
  const scroller = app.querySelector('.content, .chat-log');
  const keepScroll = isRerender && r.key === prevKey && scroller ? scroller.scrollTop : 0;
  if (currentMod && currentMod.unmount && (!isRerender || r.mod !== currentMod)) currentMod.unmount();
  app.innerHTML = r.html;
  currentMod = r.mod || null;
  if (r.mod && r.mod.mount) r.mod.mount();
  const sc = app.querySelector('.content');
  if (sc && keepScroll) sc.scrollTop = keepScroll;
  if (!isRerender) {
    window.scrollTo(0, 0);
    const h = app.querySelector('h1');
    if (h && prevKey) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }
  prevKey = r.key;
}

setRerender(() => render(true));
window.addEventListener('hashchange', () => render(false));

// 클릭 위임
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = actions[el.dataset.a];
  if (!fn) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  fn(el, e);
});
// 폼 제출 위임
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-a-submit]');
  if (!form) return;
  e.preventDefault();
  const fn = actions[form.dataset.aSubmit];
  if (fn) fn(form, e);
});
// 입력 위임
function handleInput(e) {
  const el = e.target.closest('[data-i]');
  if (!el) return;
  const live = el.type !== 'checkbox' && el.type !== 'date' && el.tagName !== 'SELECT';
  if ((e.type === 'input') !== live) return;
  const fn = inputs[el.dataset.i];
  if (fn) fn(el, e);
}
document.addEventListener('input', handleInput);
document.addEventListener('change', handleInput);

// 다른 탭/백그라운드에서 돌아오면 다시 그리기 (D-day, 청결도 갱신)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render(true);
    pushNewNotifications();
  }
});

render(false);
save();
pushNewNotifications();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
