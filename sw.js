// Kasse-motor-generalisering: generisk cache-navn/asset-navngivning i
// stedet for "brokkekassen"-specifikt, jf. samme princip som manifest.json —
// PWA-installationen er ÉN identitet der dækker alle temaer/kasse-typer.
const CACHE = 'kassen-v1';
const FILES = ['./', './index.html', './manifest.json', './icon.svg', './gsap.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache live data
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE).then(c => c.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; });
      }))
    );
    return;
  }
  // App-skallen skal altid tjekke netværket først, så en ny deployment vises
  // med det samme — ellers sidder installerede PWA'er (hjemmeskærm-ikon) fast
  // på en gammel cachet version, indtil cachen tilfældigvis udløber.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached)));
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { /* ignore malformed payload */ }
  const title = data.title || 'Kassen';
  const options = {
    body: data.body || 'Der er sket noget nyt!',
    icon: 'icon.svg',
    badge: 'icon.svg',
    data: { url: data.url || './' },
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    (self.navigator && self.navigator.setAppBadge) ? self.navigator.setAppBadge(1).catch(()=>{}) : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
