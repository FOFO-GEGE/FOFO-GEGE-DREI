const CACHE_NAME = 'mirroir-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './store.js',
  './ui.js',
  './screens.js',
  './style.css',
  './manifest.json',
  './vendor/supabase.js',
  './config.js',
  './fonts/inter-400.woff2',
  './fonts/inter-600.woff2',
  './fonts/inter-700.woff2',
  './fonts/fraunces-600.woff2',
  './fonts/fraunces-700.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // This SW sits at the site root, so its scope also covers the sibling
  // KazaJob app. Leave KazaJob's requests to its own service worker so this
  // app's shell can never be served in its place.
  if (new URL(event.request.url).pathname.includes('/kazajob/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html#/today');
    })
  );
});
