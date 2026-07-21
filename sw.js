const CACHE_NAME = 'medrecebe-app-v25';
const APP_SHELL = [
  './',
  './index.html',
  './app.html',
  './landing.css?v=5',
  './styles.css?v=18',
  './cloud.js?v=8',
  './frame-guard.js?v=1',
  './reconciliation-pdf.js?v=2',
  './app.js?v=26',
  './data/institution-directory-rmsp.json?v=20260717',
  './legal.css?v=2',
  './termos.html',
  './privacidade.html',
  './cancelamento.html',
  './suporte.html',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const requestUrl = new URL(event.request.url);

  if (requestUrl.pathname.endsWith('/runtime-config.js')) {
    const canonicalConfig = new Request(new URL('./runtime-config.js', self.location).href);
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(canonicalConfig, copy));
          return response;
        })
        .catch(() => caches.match(canonicalConfig)),
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    const fallback = requestUrl.pathname.endsWith('/app.html') ? './app.html' : './index.html';
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(fallback, copy));
          return response;
        })
        .catch(() => caches.match(fallback)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
