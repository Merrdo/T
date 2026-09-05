// Takvimim - Service Worker
// Uygulamayı "Ana Ekrana Ekle" ile açıldığında çevrimdışı da çalışır hale
// getirmek için network-first (önce ağ, olmazsa önbellek) stratejisi uygular.
// Böylece GitHub'a her yeni sürüm yüklendiğinde kullanıcı hep güncel içeriği görür;
// internet yoksa en son önbelleklenen sürüm gösterilir.

const CACHE_VERSION = 'takvimim-v4'; // Her önemli güncellemede bu numarayı artırın (v4, v5, ...)
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

// Network-first: önce ağdan al ve önbelleğe yaz; ağ başarısız olursa
// (offline) önbellekten sun. Böylece siteye her girişte en güncel dosyalar
// gösterilir, sadece internet yokken önbelleğe düşülür.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Ağ da yok, önbellekte de yoksa ve bu bir sayfa gezinmesiyse ana sayfaya düş.
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
