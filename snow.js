/* ============================================================
   Kar Yağışı Animasyonu — snow.js
   - 3 katmanlı (uzak/orta/yakın) parallax kar taneleri
   - Büyük taneler gerçek kar tanesi (6 kollu) şekli, küçükler
     yumuşak/bulanık noktalar olarak render edilir (önceden
     çizilmiş "sprite"lar üzerinden — performanslı).
   - Rüzgar: yumuşak salınım + ara sıra esinti (gust).
   - Birikme: kar taneleri ekranın altına ulaştığında zeminde
     gerçekçi, düzensiz bir kar yığını oluşturarak "dolma" efekti
     verir. Yığın belli bir üst sınıra ulaşınca, taşan kar yanlara
     doğru yayılır (spillover) — böylece zemin doğal biçimde
     dolar ve sonsuza kadar büyüyüp arayüzü kaplamaz.
   - prefers-reduced-motion desteklenir; sekme gizliyken animasyon
     durur (performans/pil tasarrufu).
   ============================================================ */
(function () {
  'use strict';

  const canvas = document.getElementById('snowCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });

  // ---------------- Ayarlar ----------------
  const CONFIG = {
    bucketWidth: 10,          // zemin "kova" genişliği (px)
    maxPileRatio: 0.20,       // ekran yüksekliğine oran olarak azami yığın
    maxPileAbsolute: 150,     // mutlak azami yığın yüksekliği (px)
    pileUnevenness: 0.28,     // yığının üst sınırındaki doğal dalgalanma
    flakeAreaDivisor: 15000,  // tane sayısı = alan / bu değer
    maxFlakes: 220,
    layers: [
      { weight: 0.45, speedMin: 0.28, speedMax: 0.55, rMin: 0.9, rMax: 1.9, alphaMin: 0.25, alphaMax: 0.45, sway: 0.35, star: false },
      { weight: 0.35, speedMin: 0.55, speedMax: 1.05, rMin: 1.7, rMax: 3.0, alphaMin: 0.45, alphaMax: 0.7,  sway: 0.7,  star: false },
      { weight: 0.20, speedMin: 0.95, speedMax: 1.65, rMin: 2.6, rMax: 4.6, alphaMin: 0.7,  alphaMax: 0.95, sway: 1.1,  star: true  }
    ]
  };

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0;
  let flakes = [];
  let buckets = [];       // her kovadaki mevcut kar yüksekliği
  let bucketCaps = [];    // her kovanın kendine özgü azami yüksekliği (doğal dalgalanma)
  let animId = null;
  let lastTime = 0;

  // Rüzgar durumu
  let windBase = 0;
  let windTime = 0;
  let gustTimer = randRange(3000, 8000);
  let gustStrength = 0;

  function randRange(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  // ---------------- Sprite üretimi (önceden çizilmiş kar taneleri) ----------------
  const spriteCache = new Map();

  function getDotSprite(radius, alpha) {
    const key = 'dot_' + radius.toFixed(1) + '_' + alpha.toFixed(2);
    if (spriteCache.has(key)) return spriteCache.get(key);

    const pad = radius * 1.6;
    const size = Math.max(2, Math.ceil((radius + pad) * 2));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cx = c.getContext('2d');
    const cxr = size / 2;
    const grad = cx.createRadialGradient(cxr, cxr, 0, cxr, cxr, cxr);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.75})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(cxr, cxr, cxr, 0, Math.PI * 2);
    cx.fill();

    spriteCache.set(key, c);
    return c;
  }

  function getStarSprite(radius, alpha) {
    const key = 'star_' + radius.toFixed(1) + '_' + alpha.toFixed(2);
    if (spriteCache.has(key)) return spriteCache.get(key);

    const size = Math.ceil(radius * 3.0);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cx = c.getContext('2d');
    const cxr = size / 2;
    cx.translate(cxr, cxr);

    // Hafif dış parıltı
    const glow = cx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.4);
    glow.addColorStop(0, `rgba(255,255,255,${alpha * 0.35})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = glow;
    cx.beginPath();
    cx.arc(0, 0, radius * 1.4, 0, Math.PI * 2);
    cx.fill();

    cx.strokeStyle = `rgba(255,255,255,${alpha})`;
    cx.fillStyle = `rgba(255,255,255,${alpha})`;
    cx.lineWidth = Math.max(0.6, radius * 0.14);
    cx.lineCap = 'round';

    for (let i = 0; i < 6; i++) {
      cx.save();
      cx.rotate((i * Math.PI) / 3);
      cx.beginPath();
      cx.moveTo(0, 0);
      cx.lineTo(0, -radius);
      cx.stroke();
      cx.beginPath();
      cx.moveTo(0, -radius * 0.5);
      cx.lineTo(radius * 0.28, -radius * 0.72);
      cx.moveTo(0, -radius * 0.5);
      cx.lineTo(-radius * 0.28, -radius * 0.72);
      cx.stroke();
      cx.restore();
    }

    cx.beginPath();
    cx.arc(0, 0, Math.max(0.6, radius * 0.16), 0, Math.PI * 2);
    cx.fill();

    spriteCache.set(key, c);
    return c;
  }

  function pickLayer() {
    const r = Math.random();
    let acc = 0;
    for (const layer of CONFIG.layers) {
      acc += layer.weight;
      if (r <= acc) return layer;
    }
    return CONFIG.layers[CONFIG.layers.length - 1];
  }

  function makeFlake(fromTop) {
    const layer = pickLayer();
    const r = randRange(layer.rMin, layer.rMax);
    const alpha = randRange(layer.alphaMin, layer.alphaMax);
    const sprite = layer.star ? getStarSprite(r, alpha) : getDotSprite(r, alpha);
    return {
      x: Math.random() * width,
      y: fromTop ? -20 - Math.random() * height * 0.4 : Math.random() * height,
      r: r,
      speedY: randRange(layer.speedMin, layer.speedMax),
      sway: layer.sway,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: randRange(0.006, 0.018),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * (layer.star ? 0.01 : 0.004),
      sprite: sprite,
      isStar: layer.star,
      landing: false,
      landProgress: 0
    };
  }

  function flakeTarget() {
    const area = width * height;
    return clamp(Math.round(area / CONFIG.flakeAreaDivisor), 40, CONFIG.maxFlakes);
  }

  // ---------------- Zemin / birikme yönetimi ----------------
  function rebuildBuckets() {
    const count = Math.max(2, Math.ceil(width / CONFIG.bucketWidth) + 1);
    const oldBuckets = buckets;
    const oldLen = oldBuckets.length;
    buckets = new Array(count);
    bucketCaps = new Array(count);

    const baseCap = Math.min(CONFIG.maxPileAbsolute, height * CONFIG.maxPileRatio);

    for (let i = 0; i < count; i++) {
      // Doğal, pürüzsüz bir "gürültü" için birkaç sinüs dalgasının toplamı
      const t = i / count;
      const noise =
        Math.sin(t * Math.PI * 5.3 + 1.7) * 0.5 +
        Math.sin(t * Math.PI * 11.1 + 0.4) * 0.3 +
        Math.sin(t * Math.PI * 21.0 + 3.1) * 0.2;
      const capVariance = 1 - CONFIG.pileUnevenness / 2 + (noise * 0.5 + 0.5) * CONFIG.pileUnevenness;
      bucketCaps[i] = Math.max(6, baseCap * capVariance);

      if (oldLen > 1) {
        const srcIdx = clamp(Math.round((i / (count - 1)) * (oldLen - 1)), 0, oldLen - 1);
        buckets[i] = clamp(oldBuckets[srcIdx] || 0, 0, bucketCaps[i]);
      } else {
        buckets[i] = 0;
      }
    }
  }

  function pileHeightAt(x) {
    const idx = clamp(Math.floor(x / CONFIG.bucketWidth), 0, buckets.length - 1);
    return buckets[idx];
  }

  function addToBucket(idx, amount, depth) {
    if (amount <= 0.0005 || idx < 0 || idx >= buckets.length) return;
    if (depth === undefined) depth = 0;
    if (depth > buckets.length + 2) return;

    const cap = bucketCaps[idx];
    const space = cap - buckets[idx];

    if (space <= 0.001) {
      const li = idx - 1, ri = idx + 1;
      let target = -1;
      const liValid = li >= 0, riValid = ri < buckets.length;
      if (liValid && riValid) target = buckets[li] <= buckets[ri] ? li : ri;
      else if (liValid) target = li;
      else if (riValid) target = ri;
      if (target !== -1) addToBucket(target, amount, depth + 1);
      return;
    }

    if (amount <= space) {
      buckets[idx] += amount;
    } else {
      buckets[idx] = cap;
      const overflow = amount - space;
      const li = idx - 1, ri = idx + 1;
      let target = -1;
      const liValid = li >= 0, riValid = ri < buckets.length;
      if (liValid && riValid) target = buckets[li] <= buckets[ri] ? li : ri;
      else if (liValid) target = li;
      else if (riValid) target = ri;
      if (target !== -1) addToBucket(target, overflow, depth + 1);
    }
  }

  function depositSnow(x, r) {
    const centerIdx = clamp(Math.floor(x / CONFIG.bucketWidth), 0, buckets.length - 1);
    const amount = r * 0.55;
    addToBucket(centerIdx, amount * 0.5);
    addToBucket(centerIdx - 1, amount * 0.27);
    addToBucket(centerIdx + 1, amount * 0.27);
  }

  function drawPile() {
    if (buckets.length < 2) return;
    const bw = CONFIG.bucketWidth;

    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height - buckets[0]);

    for (let i = 0; i < buckets.length - 1; i++) {
      const x0 = i * bw + bw / 2;
      const y0 = height - buckets[i];
      const x1 = (i + 1) * bw + bw / 2;
      const y1 = height - buckets[i + 1];
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2;
      ctx.quadraticCurveTo(x0, y0, xm, ym);
    }

    const lastY = height - buckets[buckets.length - 1];
    ctx.lineTo(width, lastY);
    ctx.lineTo(width, height);
    ctx.closePath();

    const maxCap = Math.min(CONFIG.maxPileAbsolute, height * CONFIG.maxPileRatio);
    const grad = ctx.createLinearGradient(0, height - maxCap, 0, height);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(240,246,255,0.92)');
    grad.addColorStop(1, 'rgba(214,228,247,0.88)');
    ctx.fillStyle = grad;
    ctx.fill();

    // İnce, parlak üst kenar çizgisi (kar yığınının kabarık görünmesi için)
    ctx.beginPath();
    ctx.moveTo(0, height - buckets[0]);
    for (let i = 0; i < buckets.length - 1; i++) {
      const x0 = i * bw + bw / 2;
      const y0 = height - buckets[i];
      const x1 = (i + 1) * bw + bw / 2;
      const y1 = height - buckets[i + 1];
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2;
      ctx.quadraticCurveTo(x0, y0, xm, ym);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // ---------------- Boyutlandırma ----------------
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    rebuildBuckets();

    const target = flakeTarget();
    if (flakes.length < target) {
      while (flakes.length < target) flakes.push(makeFlake(true));
    } else if (flakes.length > target) {
      flakes.length = target;
    }
  }

  // ---------------- Animasyon döngüsü ----------------
  function step(time) {
    if (!lastTime) lastTime = time;
    const dtMs = Math.min(42, time - lastTime);
    lastTime = time;
    const factor = dtMs / 16.67;

    // Rüzgar: yumuşak taban salınımı + ara sıra esinti
    windTime += dtMs;
    gustTimer -= dtMs;
    if (gustTimer <= 0) {
      gustStrength = randRange(0.6, 1.6) * (Math.random() < 0.5 ? -1 : 1);
      gustTimer = randRange(4000, 9000);
    }
    gustStrength *= 0.985; // esinti zamanla söner
    windBase = Math.sin(windTime * 0.00035) * 0.5 + gustStrength * 0.4;

    ctx.clearRect(0, 0, width, height);

    // Önce birikmiş kar yığınını çiz (düşen tanelerin arkasında/altında)
    drawPile();

    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];

      f.swayPhase += f.swaySpeed * factor;
      f.rotation += f.rotSpeed * factor;

      const swayX = Math.sin(f.swayPhase) * f.sway;
      f.x += (windBase + swayX * 0.5) * factor;
      f.y += f.speedY * factor;

      if (f.x > width + 12) f.x = -12;
      if (f.x < -12) f.x = width + 12;

      const groundY = height - pileHeightAt(f.x);

      if (f.y + f.r * 0.4 >= groundY) {
        // Zemine ulaştı: karı zemine bırak ve tekrar yukarıdan başlat
        depositSnow(f.x, f.r);
        flakes[i] = makeFlake(true);
        continue;
      }

      const sprite = f.sprite;
      const sw = sprite.width, sh = sprite.height;
      ctx.save();
      ctx.translate(f.x, f.y);
      if (f.isStar) ctx.rotate(f.rotation);
      ctx.drawImage(sprite, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    animId = requestAnimationFrame(step);
  }

  function start() {
    if (animId || reduceMotion) return;
    lastTime = 0;
    animId = requestAnimationFrame(step);
  }

  function stop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function renderStaticFrame() {
    // prefers-reduced-motion: tek kare, hareketsiz ama gerçekçi bir sahne
    ctx.clearRect(0, 0, width, height);
    drawPile();
    for (let i = 0; i < Math.min(flakes.length, 60); i++) {
      const f = flakes[i];
      const sprite = f.sprite;
      const sw = sprite.width, sh = sprite.height;
      ctx.save();
      ctx.translate(f.x, f.y);
      if (f.isStar) ctx.rotate(f.rotation);
      ctx.drawImage(sprite, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
  }

  // ---------------- Başlat ----------------
  resize();

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (!reduceMotion) start();
  });

  if (reduceMotion) {
    renderStaticFrame();
  } else {
    start();
  }
})();
