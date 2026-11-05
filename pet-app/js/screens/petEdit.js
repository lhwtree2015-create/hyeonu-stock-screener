import { S, save, getPet, newPet, today, isValidDate, findAllergens, josa } from '../store.js';
import { petSVG, SPECIES, FURS, furLabel } from '../characters.js';
import { esc, topbar, on, onInput, modal, closeModal, toast, rerender, field, icon } from '../ui.js';

let draft = null; // 편집 중인 동물 (사본)
let draftFor = null; // 'new' 또는 동물 id
let step = 1;

function startDraft(key) {
  if (draftFor === key && draft) return;
  draftFor = key;
  if (key === 'new') {
    draft = newPet();
    step = S.pets.length ? 2 : 1;
  } else {
    const p = getPet(key);
    draft = p ? JSON.parse(JSON.stringify(p)) : null;
  }
}
export function clearDraft() {
  draft = null;
  draftFor = null;
}

// ---------- 캐릭터 고르기 ----------
function characterPicker(backHref, total, current, nextLabel) {
  const dogs = Object.entries(SPECIES).filter(([, v]) => v.kind === 'dog');
  const cats = Object.entries(SPECIES).filter(([, v]) => v.kind === 'cat');
  const tile = ([k, v]) =>
    `<button class="char-tile${draft.species === k ? ' on' : ''}" data-a="pickSpecies" data-k="${k}" aria-pressed="${draft.species === k}">${petSVG({ species: k, fur: draft.species === k ? draft.fur : v.fur }, { size: 64, mood: 'normal', label: v.label })}<span>${v.label}</span></button>`;
  return `<div class="screen">
${topbar('캐릭터 고르기', { back: backHref, right: total ? `<span class="sans small sub">${current} / ${total}</span>` : '' })}
<main class="content">
<div class="char-preview">${petSVG(draft, { size: 150, mood: 'sad' })}<p class="bubble static">주인아... 나로 정한 거냐...</p><div class="sans small sub">${SPECIES[draft.species].label} · ${furLabel(draft.fur)}</div></div>
<h2 class="section-label">강아지</h2><div class="char-grid">${dogs.map(tile).join('')}</div>
<h2 class="section-label">고양이</h2><div class="char-grid">${cats.map(tile).join('')}</div>
<h2 class="section-label">털색 (눌러서 바꿔요)</h2>
<div class="swatches" role="group" aria-label="털색">${FURS.map(
    ([k, label, hex]) => `<button class="swatch${draft.fur === k ? ' on' : ''}" data-a="pickFur" data-k="${k}" aria-label="${label}" aria-pressed="${draft.fur === k}"><span style="background:${hex}"></span>${label}</button>`,
  ).join('')}</div>
</main>
<div class="bottom-bar"><button class="btn btn-yellow full big" data-a="charNext">${nextLabel}</button></div>
</div>`;
}

// ---------- 신규 등록 흐름 ----------
export function renderNew() {
  startDraft('new');
  if (step === 1) {
    return `<div class="screen onboarding">
<main class="content center-col">
<div class="char-preview">${petSVG({ species: 'maltese', fur: 'white', costume: { suit: 'suit_banana' } }, { size: 170, mood: 'sad' })}</div>
<h1 class="hero-title">우리 아이의 일상</h1>
<p class="sans center-text">반려동물 캐릭터와 대화하듯 하루 기록을 남기고,<br>체중·접종 일정·병원 리포트까지 한 번에 챙겨요.</p>
<ul class="feature-list sans small">
<li>채팅으로 식사·물·배변·산책·특이사항 기록</li>
<li>예방접종·약 다음 날짜 자동 계산과 알림</li>
<li>변화 감지 병원 리포트 · 이미지로 공유</li>
<li>기록하면 코인! 집 꾸미기와 코스튬</li>
</ul>
<p class="sans xsmall sub center-text">모든 기록은 이 기기 안에만 저장돼요.</p>
</main>
<div class="bottom-bar"><button class="btn btn-yellow full big" data-a="newStep" data-s="2">시작하기</button></div>
</div>`;
  }
  const total = S.pets.length ? 2 : 3;
  if (step === 2) return characterPicker(S.pets.length ? '#/pets' : '#/new', total, total - 1, '다음: 이름 정하기');
  return `<div class="screen">
${topbar('이름과 기본 정보', { right: `<span class="sans small sub">${total} / ${total}</span>` })}
<main class="content">
<div class="row gap12 center"><button class="avatar big" data-a="newStep" data-s="2" aria-label="캐릭터 다시 고르기" style="width:84px;height:84px">${petSVG(draft, { size: 74 })}</button><p class="bubble static grow">이름 예쁘게 지어줘라... 부탁이다...</p></div>
${basicFields()}
</main>
<div class="bottom-bar row gap8"><button class="btn grow" data-a="newStep" data-s="2">이전</button><button class="btn btn-yellow grow2 big" data-a="saveNew">완료</button></div>
</div>`;
}

function basicFields() {
  return `${field('이름', `<input name="name" data-i="draft" value="${esc(draft.name)}" placeholder="예: 초코" maxlength="12" autocomplete="off">`)}
${field('품종', `<input name="breed" data-i="draft" value="${esc(draft.breed)}" placeholder="예: 말티즈">`)}
<div class="row gap8">${field('생일 (모르면 대략)', `<input type="date" name="birthday" data-i="draft" value="${esc(draft.birthday)}" max="${today()}">`)}${field('만난 날', `<input type="date" name="metDate" data-i="draft" value="${esc(draft.metDate)}" max="${today()}">`)}</div>
<div class="row gap8 center wrap"><span class="sans small sub">성별</span>
<span class="seg-group">${['M', 'F'].map((v) => `<button class="seg pill-seg${draft.sex === v ? ' on' : ''}" data-a="draftSet" data-f="sex" data-v="${v}" aria-pressed="${draft.sex === v}">${v === 'M' ? '남' : '여'}</button>`).join('')}</span>
<span class="seg-group">${[true, false].map((v) => `<button class="seg pill-seg${draft.neutered === v ? ' on' : ''}" data-a="draftSet" data-f="neutered" data-v="${v}" aria-pressed="${draft.neutered === v}">중성화 ${v ? 'O' : 'X'}</button>`).join('')}</span></div>`;
}

function validate() {
  if (!draft.name.trim()) {
    toast('이름을 입력해 주세요');
    return false;
  }
  if (draft.birthday && !isValidDate(draft.birthday)) {
    toast('생일 날짜를 확인해 주세요');
    return false;
  }
  return true;
}

// ---------- 정보 수정 ----------
export function renderCharacter(id) {
  startDraft(id);
  if (!draft) return null;
  return characterPicker(`#/pet/${id}/edit`, 0, 0, '이 캐릭터로 할래');
}

export function renderEdit(id) {
  startDraft(id);
  if (!draft) return null;
  const hit = findAllergens(draft.food.ingredients, draft.allergens);
  const chip = (t, kind) => `<span class="tag red removable">${esc(t)}${kind === 'allergens' ? ' 알레르기' : ''}<button data-a="removeChip" data-kind="${kind}" data-v="${esc(t)}" aria-label="${esc(t)} 삭제">×</button></span>`;
  return `<div class="screen">
${topbar(`${esc(draft.name || '이름 없음')} 정보 수정`, { back: `#/pet/${id}` })}
<main class="content">
<div class="row gap12 center"><a class="avatar big" href="#/pet/${id}/character" aria-label="캐릭터 바꾸기" style="width:84px;height:84px">${petSVG(draft, { size: 74 })}</a><div class="sans small sub">캐릭터를 누르면<br>종류와 털색을 바꿀 수 있어요</div></div>
${basicFields()}
<div><span class="field-label">질환 (홈 기록·리포트에 표시돼요)</span><div class="row wrap gap6">${draft.conditions.map((t) => chip(t, 'conditions')).join('')}<button class="btn xs" data-a="addChip" data-kind="conditions">+ 추가</button></div></div>
<div><span class="field-label">알레르기 성분 (식사 기록에서 경고돼요)</span><div class="row wrap gap6">${draft.allergens.map((t) => chip(t, 'allergens')).join('')}<button class="btn xs" data-a="addChip" data-kind="allergens">+ 추가</button></div></div>
<section class="card stack">
<h2 class="card-title">주력 사료</h2>
${field('사료 이름', `<input name="food.name" data-i="draft" value="${esc(draft.food.name)}" placeholder="예: [브랜드] 연어 그레인프리 성견용">`)}
${field('칼로리 (kcal/kg · 사료 포장지 참고)', `<input name="food.kcalPerKg" data-i="draft" inputmode="numeric" value="${esc(draft.food.kcalPerKg)}" placeholder="예: 3650">`)}
${field('원재료 (쉼표로 구분)', `<input name="food.ingredients" data-i="draft" data-live="1" value="${esc(draft.food.ingredients)}" placeholder="예: 연어, 고구마, 완두, 연어오일">`)}
<div id="foodcheck">${foodCheck(hit)}</div>
</section>
<button class="btn danger full" data-a="deletePet">${icon('trash', 18)} ${esc(draft.name)} 삭제</button>
</main>
<div class="bottom-bar row gap8"><a class="btn grow" href="#/pet/${id}" data-a="cancelEdit">취소</a><button class="btn btn-yellow grow2 big" data-a="saveEdit">저장</button></div>
</div>`;
}

function foodCheck(hit) {
  if (!draft.food.ingredients) return '';
  if (!draft.allergens.length) return `<div class="note sans small">원재료를 저장해 두면 알레르기 성분을 추가했을 때 자동으로 확인해요.</div>`;
  if (hit.length) return `<div class="note red sans small" role="alert">${esc(hit.join(', '))} 성분이 들어있을 수 있어요. ${esc(josa(draft.name, '이/가'))} 먹으면 안 되는 성분이에요.</div>`;
  const kcal = Number(draft.food.kcalPerKg);
  return `<div class="note green sans small">${esc(draft.allergens.join(', '))} 성분 없음 · ${esc(draft.name)} 알레르기 안전${kcal > 0 ? `<br>식사 기록 시 칼로리를 계산해요 (1g당 ${(kcal / 1000).toFixed(2)}kcal)` : ''}</div>`;
}

on({
  newStep(el) {
    if (step === 3) syncInputs();
    step = Number(el.dataset.s);
    rerender();
  },
  pickSpecies(el) {
    const k = el.dataset.k;
    draft.species = k;
    draft.fur = SPECIES[k].fur;
    if (!draft.breed || Object.values(SPECIES).some((s) => s.label === draft.breed)) draft.breed = SPECIES[k].kind === 'dog' ? SPECIES[k].label : '코리안숏헤어';
    rerender();
  },
  pickFur(el) {
    draft.fur = el.dataset.k;
    rerender();
  },
  charNext() {
    if (draftFor === 'new') {
      step = 3;
      rerender();
    } else {
      location.hash = `#/pet/${draftFor}/edit`;
    }
  },
  draftSet(el) {
    syncInputs();
    const f = el.dataset.f;
    draft[f] = f === 'neutered' ? el.dataset.v === 'true' : el.dataset.v;
    rerender();
  },
  saveNew() {
    syncInputs();
    if (!validate()) return;
    draft.name = draft.name.trim();
    S.pets.push(draft);
    S.activePetId = draft.id;
    save();
    const name = draft.name;
    clearDraft();
    toast(`${josa(name, '이/가')} 우리 집에 왔어요!`);
    location.hash = '#/home';
  },
  addChip(el) {
    syncInputs();
    const kind = el.dataset.kind;
    const presets = kind === 'allergens' ? ['닭고기', '소고기', '돼지고기', '연어', '밀', '우유', '달걀', '오리'] : ['슬개골 탈구', '피부염', '심장병', '신장병', '당뇨', '외이염'];
    modal(
      `<h2 class="sheet-title">${kind === 'allergens' ? '알레르기 성분 추가' : '질환 추가'}</h2>
<div class="row wrap gap6">${presets
        .filter((x) => !draft[kind].includes(x))
        .map((x) => `<button class="opt" data-a="chipPreset" data-kind="${kind}" data-v="${x}">${x}</button>`)
        .join('')}</div>
<form data-a-submit="chipCustom" data-kind="${kind}" class="stack">${field('직접 입력', `<input name="v" maxlength="20" placeholder="${kind === 'allergens' ? '예: 칠면조' : '예: 관절염'}">`)}
<div class="sheet-actions"><button type="button" class="btn" data-a="closeModal">닫기</button><button class="btn btn-yellow">추가</button></div></form>`,
      { label: '항목 추가' },
    );
  },
  chipPreset(el) {
    addChipValue(el.dataset.kind, el.dataset.v);
  },
  chipCustom(form) {
    const v = form.querySelector('input').value.trim().replace(/\s*알레르기$/, '');
    if (v) addChipValue(form.dataset.kind, v);
  },
  removeChip(el) {
    syncInputs();
    const kind = el.dataset.kind;
    draft[kind] = draft[kind].filter((x) => x !== el.dataset.v);
    rerender();
  },
  saveEdit() {
    syncInputs();
    if (!validate()) return;
    draft.name = draft.name.trim();
    const i = S.pets.findIndex((p) => p.id === draftFor);
    if (i >= 0) S.pets[i] = draft;
    save();
    const id = draftFor;
    clearDraft();
    toast('저장했어요');
    location.hash = `#/pet/${id}`;
  },
  cancelEdit(el) {
    clearDraft();
    location.hash = el.getAttribute('href');
  },
  deletePet() {
    modal(
      `<h2 class="sheet-title">${esc(draft.name)}의 정보를 삭제할까요?</h2><p class="sans">기록, 체중, 일정이 모두 지워지고 되돌릴 수 없어요.</p>
<div class="sheet-actions"><button class="btn" data-a="closeModal">취소</button><button class="btn danger" data-a="confirmDeletePet">삭제</button></div>`,
      { label: '삭제 확인' },
    );
  },
  confirmDeletePet() {
    const id = draftFor;
    S.pets = S.pets.filter((p) => p.id !== id);
    delete S.records[id];
    S.events = S.events.filter((e) => e.petId !== id);
    if (S.activePetId === id) S.activePetId = S.pets[0] ? S.pets[0].id : null;
    save();
    clearDraft();
    closeModal();
    toast('삭제했어요');
    location.hash = S.pets.length ? '#/pets' : '#/new';
  },
});

function addChipValue(kind, v) {
  if (!draft[kind].includes(v)) draft[kind].push(v);
  closeModal();
  rerender();
}

function syncInputs() {
  document.querySelectorAll('[data-i="draft"]').forEach((el) => setDraftField(el.name, el.value));
}
function setDraftField(name, value) {
  if (name.startsWith('food.')) draft.food[name.slice(5)] = value;
  else draft[name] = value;
}

onInput({
  draft(el) {
    if (!draft) return;
    setDraftField(el.name, el.value);
    if (el.dataset.live) {
      const box = document.getElementById('foodcheck');
      if (box) box.innerHTML = foodCheck(findAllergens(draft.food.ingredients, draft.allergens));
    }
  },
});
