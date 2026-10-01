// ══════════════════════════════════════════════════════════════════════════
// puppeteer-extractor.js — v5 CON FILTRO DE ADS
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// CDNs de anuncios conocidos — IGNORAR cuando aparezcan
// ══════════════════════════════════════════════════════════════════════════
const AD_CDN_PATTERNS = [
  /tik\.1x2\.space/i,           // ⚠️ CDN de ads de Xpass (27 seg de publicidad)
  /adtng/i,
  /exoclick/i,
  /juicyads/i,
  /trafficjunky/i,
  /propellerads/i,
  /popads/i,
  /histats/i,
  /yandex\.ru\/metrika/i,
  /dtscout/i,
  /dtscdn/i,
  /tynt\.com/i,
];

function isAdUrl(url) {
  if (!url) return false;
  for (const pattern of AD_CDN_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

async function extractM3u8FromEmbed(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;

  const timeout = opts.timeout || 35000;
  let browser = null;
  const captured = [];

  try {
    console.log('[extract] Iniciando para:', embedUrl);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--single-process', '--no-zygote', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-extensions',
        '--disable-background-networking', '--mute-audio',
        '--window-size=1280,720',
      ],
      timeout: 20000,
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });

    await page.setRequestInterception(true);

    // ═══════════════════════════════════════════════════════════════════
    // INTERCEPTAR REQUESTS — FILTRO DE ADS + captura de m3u8 limpios
    // ═══════════════════════════════════════════════════════════════════
    page.on('request', (req) => {
      const url = req.url();

      // 1. Bloquear ads conocidos (nunca dejarlos pasar)
      if (isAdUrl(url)) {
        console.log('[extract] 🚫 Ad bloqueado:', url.slice(0, 80));
        req.abort();
        return;
      }

      // 2. Capturar m3u8 SOLO si NO es ad
      if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
        if (!isAdUrl(url)) {
          console.log('[extract] ✅ HLS limpio:', url.slice(0, 120));
          captured.push({ stream: url, kind: 'hls', referer: embedUrl });
        } else {
          console.log('[extract] ⚠️ HLS de ad IGNORADO:', url.slice(0, 80));
        }
      }

      // 3. Capturar mp4 SOLO si NO es ad
      if (/\.mp4(\?|$)/i.test(url) && !/\.ts(\?|$)/i.test(url)) {
        if (!isAdUrl(url)) {
          console.log('[extract] ✅ MP4 limpio:', url.slice(0, 120));
          captured.push({ stream: url, kind: 'mp4', referer: embedUrl });
        }
      }

      req.continue();
    });

    // Captura de JSON con m3u8 (sin capturar ads)
    page.on('response', async (res) => {
      try {
        const url = res.url();
        if (isAdUrl(url)) return;

        const ct = (res.headers()['content-type'] || '').toLowerCase();

        if (/\/data\/(movie|tv|episode)\//i.test(url) || /application\/json/i.test(ct)) {
          const text = await res.text();
          const m3u8Match = text.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
          if (m3u8Match && !isAdUrl(m3u8Match[0])) {
            console.log('[extract] ✅ HLS en JSON:', m3u8Match[0].slice(0, 120));
            captured.push({ stream: m3u8Match[0], kind: 'hls', referer: embedUrl });
          }
        }

        if (/application\/x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct)) {
          if (!isAdUrl(url)) {
            captured.push({ stream: url, kind: 'hls', referer: embedUrl });
          }
        }
      } catch (_) {}
    });

    try {
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout });
    } catch (e) {
      console.warn('[extract] Nav:', e.message);
    }

    await new Promise(r => setTimeout(r, 2000));

    // Auto-click en botón play
    if (captured.length === 0) {
      console.log('[extract] Auto-click...');
      const sels = ['button.play-button', '.play-button', '.vjs-big-play-button',
                    '.jw-icon-display', '.jw-display-icon-container',
                    '[class*="play"]', '[id*="play"]', 'video', '.player-container'];
      for (const sel of sels) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click({ delay: 50 }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));
            if (captured.length > 0) break;
          }
        } catch (_) {}
      }
    }

    // Esperar hasta 15 seg a que llegue el m3u8 limpio
    const start = Date.now();
    while (captured.length === 0 && Date.now() - start < 15000) {
      await new Promise(r => setTimeout(r, 500));
    }

    // Fallback: buscar en DOM
    if (captured.length === 0) {
      try {
        const found = await page.evaluate(() => {
          const r = [];
          for (const v of document.querySelectorAll('video')) {
            if (v.src && !v.src.startsWith('blob:')) r.push({ url: v.src, kind: 'mp4' });
            if (v.currentSrc && !v.currentSrc.startsWith('blob:')) r.push({ url: v.currentSrc, kind: 'mp4' });
          }
          for (const s of document.querySelectorAll('source')) {
            if (s.src) r.push({ url: s.src, kind: 'mp4' });
          }
          return r;
        });
        for (const item of found) {
          if (!isAdUrl(item.url)) {
            captured.push({ stream: item.url, kind: item.kind, referer: embedUrl });
          }
        }
      } catch (_) {}
    }

    if (captured.length > 0) {
      const best = captured.find(c => c.kind === 'hls') || captured[0];
      console.log('[extract] 🎬 Stream final:', best.kind, '->', best.stream.slice(0, 100));
      return best;
    }

    console.log('[extract] ❌ Sin stream (todo lo capturado era ad)');
    return null;

  } catch (err) {
    console.error('[extract] Error:', err.message);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

module.exports = {
  extractM3u8FromEmbed,
  extractM3u8: extractM3u8FromEmbed,
  extractStream: extractM3u8FromEmbed,
  extract: extractM3u8FromEmbed,
  default: extractM3u8FromEmbed,
};

console.log('[extract] v5 cargado — filtro de ads activado');
