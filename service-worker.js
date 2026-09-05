// Takvimim - Service Worker
// Uygulamayı "Ana Ekrana Ekle" ile açıldığında çevrimdışı da çalışır hale
// getirmek için temel bir cache-first stratejisi uygular.

const CACHE_VERSION = 'takvimim-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Cache-first: önce önbellekten sun, yoksa ağdan al ve önbelleğe ekle.
// Google Fonts gibi harici istekler de fırsat buldukça önbelleklenir,
// böylece çevrimdışıyken de son görülen yazı tipiyle açılır.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Ağ da yoksa ve bu bir sayfa gezinmesiyse ana sayfaya düş.
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
