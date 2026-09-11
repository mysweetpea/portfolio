/* MySweetPea — Service Worker
   Stale-while-revalidate caching for static assets, network-first for HTML.
   Bumped to v9 — updates propagate automatically without hard-refresh. */

const CACHE = 'mysweetpea-v29';
const CORE = [
  '/',
  '/index.html',
  '/assets/css/fonts.css',
  '/assets/css/site.css',
  '/assets/css/premium.css',
  '/assets/js/site.js',
  '/assets/js/premium.js',
  '/assets/fonts/inter-var.woff2',
  '/assets/fonts/fraunces-var.woff2',
  '/assets/screenshots/vaultwarden.webp',
  '/assets/screenshots/element.webp',
  '/assets/screenshots/affine.webp',
  '/assets/screenshots/koalasync.webp',
  '/assets/screenshots/jellyfin.webp',
  '/assets/screenshots/seerr.webp',
  '/assets/screenshots/nextcloud.webp',
  '/assets/screenshots/immich.webp',
  '/assets/screenshots/openwebui.webp',
  '/logo.svg',
  '/logo-favicon.svg',
  '/og-card.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Network-first for HTML (so nav/footer/content stay fresh), cache fallback.
  if (req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(req).then((res) => res.clone().text()).then((body) => {
        if (!body.includes('mysweetpea')) return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        const res = new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate for static assets: serve cache immediately,
  // fetch fresh in background, update cache. No more stuck v7!
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});