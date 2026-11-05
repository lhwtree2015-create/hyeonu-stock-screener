import { S, save, activePet, SHOP, shopItem } from '../store.js';
import { petSVG } from '../characters.js';
import { sceneSVG } from './home.js';
import { esc, nav, coinPill, on, modal, closeModal, toast, rerender } from '../ui.js';

let tab = 'decor';
let preview = null; // 미리보기 중인 코스튬 id

function weekPick() {
  const week = Math.floor(Date.now() / (7 * 86400000));
  const pool = SHOP.filter((i) => !S.inventory.includes(i.id));
  return pool.length ? pool[week % pool.length] : null;
}

function itemThumb(it) {
  const p = activePet();
  if (it.cat === 'costume') return petSVG(p, { size: 56, mood: 'normal', preview: { [it.slot]: it.id } });
  const pics = {
    wall_windproof: '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="4" y="4" width="40" height="40" rx="6" fill="#F4DCC6" stroke="#3B2A1A" stroke-width="3"/><circle cx="16" cy="16" r="4" fill="#E9B9A0"/><circle cx="32" cy="32" r="4" fill="#BFDDF0"/><circle cx="32" cy="16" r="4" fill="#BFDDF0"/><circle cx="16" cy="32" r="4" fill="#E9B9A0"/></svg>',
    floor_wood: '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="4" y="4" width="40" height="40" rx="6" fill="#C98E55" stroke="#3B2A1A" stroke-width="3"/><path d="M6 16H42M6 28H42M6 38H42M20 4V16M30 16V28M16 28V38" stroke="#A8703F" stroke-width="2.5"/></svg>',
    fireplace: '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="6" y="8" width="36" height="36" fill="#B5583A" stroke="#3B2A1A" stroke-width="3"/><rect x="14" y="20" width="20" height="24" rx="3" fill="#2B1D12"/><path d="M24 42 Q16 34 22 26 Q23 32 26 29 Q31 34 28 42Z" fill="#F2C94C" stroke="#E07B2A" stroke-width="1.5"/></svg>',
    cushion: '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><ellipse cx="24" cy="30" rx="20" ry="9" fill="#E88A9A" stroke="#3B2A1A" stroke-width="3"/><ellipse cx="24" cy="27" rx="14" ry="4" fill="#F3B3BE"/></svg>',
  };
  return pics[it.id] || '';
}

function equipped(it) {
  const p = activePet();
  if (it.cat === 'decor') return S.decor[it.slot] === it.id;
  return p.costume && p.costume[it.slot] === it.id;
}

export function render() {
  const p = activePet();
  const items = SHOP.filter((i) => i.cat === tab);
  const rec = weekPick();
  const list = items
    .map((it) => {
      const owned = S.inventory.includes(it.id);
      const on = equipped(it);
      const prev = preview === it.id;
      let btn;
      if (owned) btn = `<button class="btn sm${on ? ' btn-primary' : ''}" data-a="equip" data-id="${it.id}" aria-pressed="${on}">${on ? (it.cat === 'decor' ? '사용 중' : '착용 중') : it.cat === 'decor' ? '사용하기' : '입히기'}</button>`;
      else btn = `<button class="btn sm btn-yellow" data-a="buy" data-id="${it.id}">구매</button>`;
      return `<div class="shop-item${prev ? ' previewing' : ''}">
<button class="thumb" ${it.cat === 'costume' ? `data-a="preview" data-id="${it.id}" aria-label="${esc(it.name)} 미리 입어보기" aria-pressed="${prev}"` : 'tabindex="-1" aria-hidden="true"'}>${itemThumb(it)}</button>
<div class="grow"><div>${esc(it.name)}</div><div class="sans xsmall sub">${esc(it.desc)}</div><div class="price">${owned ? '보유 완료' : `${it.price}코인`}</div></div>
${btn}</div>`;
    })
    .join('');

  const top =
    tab === 'decor'
      ? `<div class="shop-scene">${sceneSVG()}<div class="shop-scene-char">${petSVG(p, { size: 70, mood: S.decor.fireplace ? 'happy' : 'sad' })}</div></div>`
      : `<div class="shop-preview"><div class="pv">${petSVG(p, { size: 130, mood: preview ? 'happy' : 'normal', preview: preview ? { [shopItem(preview).slot]: preview } : {} })}</div>${preview ? `<span class="pill blue">미리보기 중 (아직 구매 전)</span>` : `<span class="sans xsmall sub">코스튬 그림을 누르면 미리 입어볼 수 있어요</span>`}</div>`;

  return `<div class="screen">
<header class="topbar"><h1 class="topbar-title">상점</h1><span class="grow"></span>${coinPill()}</header>
<div class="tabs" role="tablist">
<button role="tab" class="tab${tab === 'decor' ? ' on' : ''}" aria-selected="${tab === 'decor'}" data-a="shopTab" data-t="decor">집 꾸미기</button>
<button role="tab" class="tab${tab === 'costume' ? ' on' : ''}" aria-selected="${tab === 'costume'}" data-a="shopTab" data-t="costume">밈 코스튬</button>
</div>
<main class="content">
${top}
<div class="shop-list">${list}</div>
${tab === 'costume' ? `<p class="sans xsmall sub">미리 입어보고 마음에 들면 구매하세요. 부위(모자, 안경, 옷)마다 1개만 착용돼요.</p>` : ''}
${rec ? `<section class="card row gap12 center"><span class="thumb">${itemThumb(rec)}</span><div class="grow"><div class="sans xsmall sub">이번 주 추천</div><div>${esc(rec.name)}</div><div class="sans xsmall sub">${esc(rec.desc)}</div></div><button class="btn sm" data-a="goRec" data-id="${rec.id}">보기</button></section>` : ''}
<p class="sans xsmall sub">코인은 채팅으로 기록하면 모여요 · 항목당 +2, 산책 +5, 하루 완료 +10</p>
</main>
${nav('shop')}
</div>`;
}

on({
  shopTab(el) {
    tab = el.dataset.t;
    preview = null;
    rerender();
  },
  preview(el) {
    preview = preview === el.dataset.id ? null : el.dataset.id;
    rerender();
  },
  goRec(el) {
    const it = shopItem(el.dataset.id);
    tab = it.cat;
    preview = it.cat === 'costume' ? it.id : null;
    rerender();
  },
  buy(el) {
    const it = shopItem(el.dataset.id);
    if (it.cat === 'costume') preview = it.id;
    const enough = S.coins >= it.price;
    modal(
      `<h2 class="sheet-title">${esc(it.name)}을(를) 구매할까요?</h2>
<p class="sans">${it.price}코인을 사용해요</p>
<p class="sans ${enough ? '' : 'bad-text'}">잔액 ${S.coins} → ${enough ? S.coins - it.price : '부족'}코인</p>
${enough ? '' : '<p class="sans small sub">채팅으로 오늘 기록을 하면 코인이 모여요.</p>'}
<div class="sheet-actions"><button class="btn" data-a="closeModal">취소</button>${enough ? `<button class="btn btn-yellow" data-a="confirmBuy" data-id="${it.id}">구매하기</button>` : ''}</div>`,
      { label: '구매 확인' },
    );
    rerender();
  },
  confirmBuy(el) {
    const it = shopItem(el.dataset.id);
    if (S.coins < it.price || S.inventory.includes(it.id)) return closeModal();
    S.coins -= it.price;
    S.inventory.push(it.id);
    applyItem(it, true);
    preview = null;
    save();
    closeModal();
    toast(`${it.name} 구매 완료!`);
    rerender();
  },
  equip(el) {
    const it = shopItem(el.dataset.id);
    applyItem(it, !equipped(it));
    save();
    rerender();
  },
});

function applyItem(it, onOff) {
  if (it.cat === 'decor') S.decor[it.slot] = onOff ? it.id : null;
  else {
    const p = activePet();
    p.costume = p.costume || {};
    p.costume[it.slot] = onOff ? it.id : null;
  }
}
