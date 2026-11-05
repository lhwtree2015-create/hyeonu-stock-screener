import { S, computeNotis, markRead, today, addDays, korDate } from '../store.js';
import { esc, nav, topbar, on, rerender } from '../ui.js';

const TAG_CLASS = { 식사: 'yellow', 산책: 'green', 일정: 'blue', 리포트: 'red', 청결: 'gray', 보상: 'yellow' };

export function render() {
  const list = computeNotis();
  const t = today();
  const groups = [
    ['오늘', (n) => n.when === t],
    ['어제', (n) => n.when === addDays(t, -1)],
    ['이번 주', (n) => n.when < addDays(t, -1) && n.when >= addDays(t, -7)],
    ['이전', (n) => n.when < addDays(t, -7)],
  ];
  const body = groups
    .map(([label, fn]) => {
      const items = list.filter(fn);
      if (!items.length) return '';
      return `<h2 class="section-label">${label}</h2>${items
        .map((n) => {
          const unread = !S.readNotis.includes(n.id);
          return `<a class="noti${unread ? ' unread' : ''}" href="${n.link}" data-a="openNoti" data-id="${esc(n.id)}">
${unread ? '<span class="dot" aria-label="읽지 않음"></span>' : '<span class="dot-space"></span>'}
<span class="grow"><span class="row gap6 center"><span class="tag ${TAG_CLASS[n.tag] || 'gray'}">${esc(n.tag)}</span><span>${esc(n.title)}</span></span><span class="sans small sub block">${esc(n.body)}</span></span>
<span class="sans xsmall sub">${n.when === t ? '' : korDate(n.when, false)}</span></a>`;
        })
        .join('')}`;
    })
    .join('');
  return `<div class="screen">
${topbar('알림', { back: '#/home', right: list.length ? `<button class="btn sm" data-a="readAll">모두 읽음</button>` : '' })}
<main class="content">${body || '<p class="sans sub empty">새 알림이 없어요. 오늘도 잘 챙기고 있어요!</p>'}
<p class="sans xsmall sub">알림 종류는 설정에서 켜고 끌 수 있어요.</p></main>
${nav('')}
</div>`;
}

on({
  openNoti(el) {
    markRead([el.dataset.id]);
    location.hash = el.getAttribute('href');
  },
  readAll() {
    markRead(computeNotis().map((n) => n.id));
    rerender();
  },
});
