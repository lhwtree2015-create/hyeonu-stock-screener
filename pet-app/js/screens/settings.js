import { S, save, exportJSON, replaceAll, resetAll, activePet } from '../store.js';
import { esc, nav, topbar, on, onInput, modal, closeModal, toast, rerender, toggle } from '../ui.js';
import { enableSystemNotifications } from '../notify.js';

export function render() {
  const s = S.settings;
  const p = activePet();
  const sys = 'Notification' in window ? Notification.permission : 'unsupported';
  const row = (label, control, sub = '') => `<div class="set-row"><span class="grow"><span class="block">${label}</span>${sub ? `<span class="sans xsmall sub">${sub}</span>` : ''}</span>${control}</div>`;
  const link = (label, a, sub = '') => `<button class="set-row" data-a="${a}"><span class="grow"><span class="block">${label}</span>${sub ? `<span class="sans xsmall sub">${sub}</span>` : ''}</span><span aria-hidden="true">›</span></button>`;
  const q = s.questions;
  return `<div class="screen">
${topbar('설정', { back: '#/home' })}
<main class="content">
<h2 class="section-label">데이터</h2>
<section class="card flush">
${link('데이터 백업 (파일로 저장)', 'backup', '기록은 이 기기에만 저장돼요. 기기를 바꾸기 전에 백업하세요')}
${link('백업 파일 불러오기', 'restore')}
</section>

<h2 class="section-label">알림</h2>
<section class="card flush">
${row('식사 · 산책 기록 알림', toggle('notifyRecord', s.notifyRecord, '식사 산책 알림', 'data-i="setting"'))}
${row('예방접종 · 약 일정 알림', toggle('notifySchedule', s.notifySchedule, '일정 알림', 'data-i="setting"'))}
${row('집 청결 알림 (오래 접속 안 할 때)', toggle('notifyClean', s.notifyClean, '청결 알림', 'data-i="setting"'))}
${sys === 'unsupported' ? row('휴대폰 알림', '<span class="sans xsmall sub">홈 화면에 추가한 뒤 사용할 수 있어요</span>') : sys === 'granted' ? row('휴대폰 알림', '<span class="pill green">켜짐</span>', '앱을 열 때 새 알림을 휴대폰 알림으로도 보내요') : link('휴대폰 알림 켜기', 'enableNoti', sys === 'denied' ? '브라우저 설정에서 알림이 차단돼 있어요' : '앱을 열 때 새 알림을 휴대폰 알림으로도 보내요')}
</section>

<h2 class="section-label">기록</h2>
<section class="card flush">
${row('물 마신 양 질문', toggle('water', q.water, '음수량 질문', 'data-i="question"'))}
${row('배변 질문', toggle('poop', q.poop, '배변 질문', 'data-i="question"'))}
${row('산책 · 놀이 질문', toggle('walk', q.walk, '산책 질문', 'data-i="question"'))}
${p ? link('노령 모드 · 주력 사료 설정', 'goPet', `${esc(p.name)} 상세 화면에서 바꿀 수 있어요`) : ''}
</section>

<h2 class="section-label">캐릭터</h2>
<section class="card flush">
${row('랜덤 대사 빈도', `<span class="seg-group">${[['low', '적게'], ['normal', '보통'], ['high', '많이']].map(([v, l]) => `<button class="seg${s.lineFreq === v ? ' on' : ''}" data-a="lineFreq" data-v="${v}" aria-pressed="${s.lineFreq === v}">${l}</button>`).join('')}</span>`)}
</section>

<h2 class="section-label">정보</h2>
<section class="card flush">
${link('개인정보 · 이용 안내', 'privacy')}
${link('모든 데이터 지우기', 'reset')}
${row('버전', '<span class="sans small sub">1.0.0 (가제)</span>')}
</section>
</main>
${nav('')}
</div>`;
}

on({
  backup() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pet-diary-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('백업 파일을 저장했어요');
  },
  restore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (!data || !Array.isArray(data.pets)) throw new Error('형식 오류');
        modal(
          `<h2 class="sheet-title">백업을 불러올까요?</h2><p class="sans">지금 기기에 있는 기록은 백업 파일 내용으로 바뀌어요. (동물 ${data.pets.length}마리)</p>
<div class="sheet-actions"><button class="btn" data-a="closeModal">취소</button><button class="btn btn-yellow" data-a="confirmRestore">불러오기</button></div>`,
          { label: '백업 불러오기' },
        );
        pending = data;
      } catch (e) {
        toast('백업 파일을 읽지 못했어요');
      }
    };
    input.click();
  },
  confirmRestore() {
    if (pending) replaceAll(pending);
    pending = null;
    closeModal();
    toast('백업을 불러왔어요');
    location.hash = '#/home';
    rerender();
  },
  async enableNoti() {
    const ok = await enableSystemNotifications();
    toast(ok ? '휴대폰 알림을 켰어요' : '알림 권한이 허용되지 않았어요');
    rerender();
  },
  goPet() {
    const p = activePet();
    location.hash = `#/pet/${p.id}`;
  },
  lineFreq(el) {
    S.settings.lineFreq = el.dataset.v;
    save();
    rerender();
  },
  privacy() {
    modal(
      `<h2 class="sheet-title">개인정보 · 이용 안내</h2>
<div class="sans small stack">
<p>이 앱은 회원가입이나 서버 없이 동작해요. 입력한 반려동물 정보와 기록은 이 기기의 브라우저 저장소에만 저장되며 외부로 전송되지 않아요.</p>
<p>리포트를 공유하거나 이미지로 저장할 때만 사용자가 선택한 앱으로 내용이 전달돼요.</p>
<p>브라우저 데이터를 지우거나 앱을 삭제하면 기록이 사라질 수 있으니 설정 › 데이터 백업을 이용해 주세요.</p>
<p>건강 리포트와 칼로리 계산은 보호자 기록을 바탕으로 한 참고 자료이며 수의사의 진단을 대신하지 않아요.</p>
</div>
<div class="sheet-actions"><button class="btn btn-yellow" data-a="closeModal">확인</button></div>`,
      { label: '이용 안내' },
    );
  },
  reset() {
    modal(
      `<h2 class="sheet-title">모든 데이터를 지울까요?</h2><p class="sans">동물 정보, 기록, 코인, 구매한 아이템이 모두 지워지고 되돌릴 수 없어요.</p>
<div class="sheet-actions"><button class="btn" data-a="closeModal">취소</button><button class="btn danger" data-a="confirmReset">모두 지우기</button></div>`,
      { label: '데이터 지우기' },
    );
  },
  confirmReset() {
    resetAll();
    closeModal();
    location.hash = '#/new';
    rerender();
  },
});

let pending = null;

onInput({
  setting(el) {
    S.settings[el.name] = el.checked;
    save();
  },
  question(el) {
    S.settings.questions[el.name] = el.checked;
    save();
  },
});
