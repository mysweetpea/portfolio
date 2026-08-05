/* MySweetPea — Service Worker
   Minimal offline cache for the static site. Caches pages + assets on first
   visit so the site works offline and feels app-like for members. */

const CACHE = 'mysweetpea-v2';
const CORE = [
  '/',
  '/index.html',
  '/assets/css/fonts.css',
  '/assets/css/site.css',
  '/assets/js/site.js',
  '/assets/fonts/inter-var.woff2',
  '/assets/fonts/fraunces-var.woff2',
  '/logo.svg',
  '/logo-favicon.svg',
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
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});
