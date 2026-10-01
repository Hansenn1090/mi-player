// ══════════════════════════════════════════════════════════════════════════
// puppeteer-extractor.js — v6
//   • Browser compartido (no lanza Chrome por cada request)
//   • Cola de extracción (1 a la vez, evita OOM)
//   • Auto-reconnect si el browser crashea
//   • Filtro de ads
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// FILTRO DE ADS
// ══════════════════════════════════════════════════════════════════════════
const AD_CDN_PATTERNS = [
  /tik\.1x2\.space/i,
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
  /mamshirt/i,
  /tagivi/i,
  /createlouisville/i,
];

function isAdUrl(url) {
  if (!url) return false;
  for (const pattern of AD_CDN_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
// BROWSER COMPARTIDO — se lanza UNA vez y se reutiliza
// ══════════════════════════════════════════════════════════════════════════
let _browser = null;
let _browserLaunching = null;

async function getBrowser() {
  // Si ya existe y está conectado, devolverlo
  if (_browser && _browser.isConnected()) return _browser;

  // Si está en proceso de lanzamiento, esperar
  if (_browserLaunching) return _browserLaunching;

  console.log('[extract] 🚀 Lanzando Chromium (una sola vez)...');

  _browserLaunching = puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--mute-audio',
      '--no-first-run',
      '--window-size=1280,720',
    ],
    timeout: 60000,
  });

  try {
    _browser = await _browserLaunching;
    _browserLaunching = null;

    console.log('[extract] ✅ Chromium listo (se reutilizará)');

    // Si el browser se desconecta, resetear para relanzar en el siguiente request
    _browser.on('disconnected', () => {
      console.log('[extract] ⚠️ Chromium desconectado — se relanzará en el próximo request');
      _browser = null;
    });

    return _browser;
  } catch (e) {
    _browserLaunching = null;
    _browser = null;
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// COLA DE EXTRACCIÓN — 1 extracción a la vez
// ══════════════════════════════════════════════════════════════════════════
let _extractionQueue = Promise.resolve();

async function extractM3u8FromEmbed(embedUrl, opts = {}) {
  // Encolar la extracción para que no corran en paralelo
  const result = _extractionQueue.then(() => _doExtract(embedUrl, opts).catch(e => {
    console.error('[extract] Error en _doExtract:', e.message);
    return null;
  }));
  // La cola avanza incluso si falla
  _extractionQueue = result.then(() => {}).catch(() => {});
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN REAL
// ══════════════════════════════════════════════════════════════════════════
async function _doExtract(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;

  const timeout = opts.timeout || 35000;
  let page = null;
  const captured = [];

  try {
    console.log('[extract] Iniciando para:', embedUrl);

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });

    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();

      // Bloquear ads
      if (isAdUrl(url)) {
        console.log('[extract] 🚫 Ad bloqueado:', url.slice(0, 80));
        req.abort();
        return;
      }

      // Capturar m3u8 limpio
      if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
        console.log('[extract] ✅ HLS limpio:', url.slice(0, 120));
        captured.push({ stream: url, kind: 'hls', referer: embedUrl });
      }

      // Capturar mp4 limpio
      if (/\.mp4(\?|$)/i.test(url) && !/\.ts(\?|$)/i.test(url)) {
        console.log('[extract] ✅ MP4 limpio:', url.slice(0, 120));
        captured.push({ stream: url, kind: 'mp4', referer: embedUrl });
      }

      req.continue();
    });

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

    // Auto-click en play
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

    // Esperar a que llegue el m3u8 limpio
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
    console.error('[extract] Error general:', err.message);
    return null;
  } finally {
    // Cerrar SOLO la página (no el browser)
    if (page) {
      try { await page.close(); } catch (_) {}
    }
  }
}

module.exports = {
  extractM3u8FromEmbed,
  extractM3u8: extractM3u8FromEmbed,
  extractStream: extractM3u8FromEmbed,
  extract: extractM3u8FromEmbed,
  default: extractM3u8FromEmbed,
};

console.log('[extract] v6 cargado — browser compartido + cola + filtro ads');
