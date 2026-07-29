const CACHE_NAME = 'kazajob-v2';
// Relative paths: on a GitHub Pages *project* site the app is served from
// /<repo>/, so absolute '/index.html' would point at the domain root instead.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap'
];

// Install — cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // This SW's scope covers the whole site, including the sibling MIRROIR app.
  // Leave MIRROIR's requests alone so its own service worker handles them and
  // this app's shell can never be served in its place.
  if (new URL(event.request.url).pathname.includes('/mirroir/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response and cache it
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
  );
});
