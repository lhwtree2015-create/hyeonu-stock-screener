// 오프라인에서도 열리도록 앱 파일을 캐시해요
const CACHE = 'choco-diary-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/characters.js',
  './js/lines.js',
  './js/notify.js',
  './js/screens/home.js',
  './js/screens/chat.js',
  './js/screens/pets.js',
  './js/screens/petEdit.js',
  './js/screens/calendar.js',
  './js/screens/report.js',
  './js/screens/shop.js',
  './js/screens/notifications.js',
  './js/screens/settings.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 앱 파일: 네트워크 우선(업데이트 바로 반영), 실패하면 캐시 / 글꼴: 캐시 우선
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
    );
  } else if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#/home';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(new URL('./' + link, self.registration.scope).href);
          return c.focus();
        }
      }
      return self.clients.openWindow('./' + link);
    }),
  );
});
