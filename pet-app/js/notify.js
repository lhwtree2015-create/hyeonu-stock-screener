// 휴대폰 알림: 앱을 열었을 때 새로 생긴 알림을 시스템 알림으로 보여줘요.
// (서버가 없어서 앱이 완전히 닫혀 있을 때 보내는 푸시는 지원하지 않아요)
import { S, save, computeNotis } from './store.js';

export async function enableSystemNotifications() {
  if (!('Notification' in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    // 지금 있는 알림은 '이미 보낸 것'으로 처리해서 한꺼번에 울리지 않게 해요
    S.shownNotis = computeNotis().map((n) => n.id);
    save();
  }
  return perm === 'granted';
}

export async function pushNewNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const shown = new Set(S.shownNotis || []);
  const fresh = computeNotis().filter((n) => !shown.has(n.id) && !S.readNotis.includes(n.id));
  if (!fresh.length) return;
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  for (const n of fresh.slice(0, 3)) {
    const opt = { body: n.body, tag: n.id, icon: 'icons/icon-192.png', data: { link: n.link } };
    try {
      if (reg) await reg.showNotification(n.title, opt);
      else new Notification(n.title, opt);
    } catch (e) {
      /* 일부 브라우저는 지원하지 않아요 */
    }
  }
  fresh.forEach((n) => shown.add(n.id));
  S.shownNotis = [...shown].slice(-500);
  save();
}
