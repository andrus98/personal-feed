// Service worker minimo: serve a rendere la PWA installabile e a farla aprire
// senza rete. Non fa caching furbo dei dati — quelli li gestisce data.js, e un
// service worker che si mette in mezzo agli articoli produce solo feed che
// mostrano ieri senza dirtelo.

const CACHE = 'personal-feed-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sources.json',
  './css/app.css',
  './js/app.js',
  './js/card.js',
  './js/config.js',
  './js/data.js',
  './js/icons.js',
  './js/screen-archive.js',
  './js/screen-feed.js',
  './js/search.js',
  './js/store.js',
  './js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Gli articoli arrivano da raw.githubusercontent: fuori dalla nostra origine
  // e sempre dalla rete, altrimenti il refresh smetterebbe di refreshare.
  if (url.origin !== self.location.origin) return;

  // Rete per prima, cache come rete di scorta: cosi' un aggiornamento dell'app
  // arriva alla prima apertura online, invece di restare bloccato in cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
