// ================= Takvimim — Service Worker =================
// Bu dosya index.html ile aynı klasörde durmalı. GitHub Pages proje sayfası
// olarak yayınlandığında (kullanici.github.io/repo-adi/) göreli yollar
// otomatik doğru çalışır.

// Sürüm numarasını her önemli güncellemede artır (örn: 'v4', 'v5'...).
// Bu, eski önbelleğin temizlenip yeni dosyaların indirilmesini sağlar.
const CACHE_VERSION = 'v4';
const CACHE_NAME = 'takvimim-' + CACHE_VERSION;

// Uygulama kabuğu: ilk yüklemede önbelleğe alınacak dosyalar.
// Yol, service-worker.js'in bulunduğu klasöre göre görecelidir.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

// ---- Kurulum: uygulama kabuğunu önbelleğe al ----
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll bir tanesi bile başarısız olursa tamamı iptal olur;
      // bu yüzden dosyaları tek tek, hataları yutarak ekliyoruz.
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.log('Önbelleğe alınamadı:', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ---- Aktifleşme: eski sürüm önbelleklerini temizle ----
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key.indexOf('takvimim-') === 0 && key !== CACHE_NAME;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ---- İstekleri yakala ----
// Sayfa gezinmeleri (navigation): önce ağ, olmazsa önbellekteki index.html.
// { cache: 'reload' } ÖNEMLİ: bu olmadan tarayıcının kendi HTTP önbelleği
// devreye girip, service worker "ağdan alıyorum" dese bile hâlâ eski bir
// yanıt döndürebiliyor — CACHE_VERSION'ı artırmak bu durumda tek başına
// yetmiyor. Bu ayar sunucudan her zaman taze bir yanıt istenmesini garanti
// eder. Böylece internet varken her zaman en güncel sürüm gösterilir;
// internet yokken de uygulama açılabilir (gerçek bir uygulama gibi çalışır).
// Diğer statik dosyalar: önce önbellek, arka planda ağdan güncelle
// (stale-while-revalidate) — hızlı açılış için.
self.addEventListener('fetch', function (event) {
  const req = event.request;

  // Sadece GET isteklerini ele al; POST vb. istekleri olduğu gibi geçir.
  if (req.method !== 'GET') { return; }

  // Farklı origin'lere giden istekleri (varsa harici kaynaklar) servis
  // çalışanı dışında bırak, tarayıcının normal davranışına bırak.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }

  const isNavigation = req.mode === 'navigate' ||
    (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') !== -1);

  if (isNavigation) {
    event.respondWith(
      fetch(req, { cache: 'reload' }).then(function (response) {
        // Başarılı ağ yanıtını önbelleğe yaz (bir sonraki çevrimdışı açılış için).
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
        return response;
      }).catch(function () {
        // Ağ yoksa önbellekten dön; o da yoksa index.html'e düş.
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Statik dosyalar için cache-first, arka planda güncelle (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then(function (cached) {
      const networkFetch = fetch(req).then(function (response) {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
        }
        return response;
      }).catch(function () {
        return cached;
      });
      return cached || networkFetch;
    })
  );
});
