// ══════════════════════════════════════════════════════════════════════════
// puppeteer-extractor.js — v7
//   • Browser compartido (no lanza Chrome por cada request)
//   • Cola de extracción (1 a la vez)
//   • Filtro de ads reales
//   • Prioriza master.m3u8 sobre index-*.m3u8
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// FILTRO DE ADS
// ⚠️ NO incluir tik.1x2.space — es el CDN real de Xpass
// ══════════════════════════════════════════════════════════════════════════
const AD_CDN_PATTERNS = [
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
  /doubleclick/i,
  /googlesyndication/i,
  /google-analytics/i,
];

function isAdUrl(url) {
  if (!url) return false;
  for (const pattern of AD_CDN_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
// BROWSER COMPARTIDO
// ══════════════════════════════════════════════════════════════════════════
let _browser = null;
let _browserLaunching = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  if (_browserLaunching) return _browserLaunching;

  console.log('[extract] 🚀 Lanzando Chromium...');

  _browserLaunching = puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
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
    console.log('[extract] ✅ Chromium listo');

    _browser.on('disconnected', () => {
      console.log('[extract] ⚠️ Chromium desconectado — se relanzará');
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
// COLA DE EXTRACCIÓN
// ══════════════════════════════════════════════════════════════════════════
let _extractionQueue = Promise.resolve();

async function extractM3u8FromEmbed(embedUrl, opts = {}) {
  const result = _extractionQueue.then(() => _doExtract(embedUrl, opts).catch(e => {
    console.error('[extract] Error:', e.message);
    return null;
  }));
  _extractionQueue = result.then(() => {}).catch(() => {});
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN
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

      // Bloquear ads/trackers reales
      if (isAdUrl(url)) {
        console.log('[extract] 🚫 Ad bloqueado:', url.slice(0, 80));
        req.abort();
        return;
      }

      // Capturar HLS con prioridad
      if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
        if (/\/master\.m3u8/i.test(url) || /master\.txt/i.test(url)) {
          console.log('[extract] ✅ HLS master:', url.slice(0, 100));
          captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority: 1 });
        } else if (/\/index-[^\/]*\.m3u8/i.test(url)) {
          console.log('[extract] ⚠️ HLS index (posible ad):', url.slice(0, 80));
          captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority: 3 });
        } else {
          console.log('[extract] ✅ HLS:', url.slice(0, 100));
          captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority: 2 });
        }
      }

      // Capturar MP4
      if (/\.mp4(\?|$)/i.test(url) && !/\.ts(\?|$)/i.test(url)) {
        console.log('[extract] ✅ MP4:', url.slice(0, 100));
        captured.push({ stream: url, kind: 'mp4', referer: embedUrl, priority: 2 });
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
            const u = m3u8Match[0];
            const priority = /\/master\.m3u8/i.test(u) ? 1 : (/\/index-/.test(u) ? 3 : 2);
            console.log('[extract] ✅ HLS en JSON (p' + priority + '):', u.slice(0, 100));
            captured.push({ stream: u, kind: 'hls', referer: embedUrl, priority });
          }
        }

        if (/application\/x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct)) {
          if (!isAdUrl(url)) {
            const priority = /\/master\.m3u8/i.test(url) ? 1 : 2;
            captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority });
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

    // Esperar master.m3u8 (prioridad 1) o timeout
    const start = Date.now();
    while (Date.now() - start < 18000) {
      if (captured.some(c => c.priority === 1)) break;
      if (captured.length > 0 && Date.now() - start > 8000) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (captured.length > 0) {
      captured.sort((a, b) => a.priority - b.priority);
      const best = captured[0];
      console.log('[extract] 🎬 Stream final (p' + best.priority + '):', best.kind, '->', best.stream.slice(0, 100));
      return { stream: best.stream, kind: best.kind, referer: best.referer };
    }

    console.log('[extract] ❌ Sin stream');
    return null;

  } catch (err) {
    console.error('[extract] Error general:', err.message);
    return null;
  } finally {
    if (page) { try { await page.close(); } catch (_) {} }
  }
}

module.exports = {
  extractM3u8FromEmbed,
  extractM3u8: extractM3u8FromEmbed,
  extractStream: extractM3u8FromEmbed,
  extract: extractM3u8FromEmbed,
  default: extractM3u8FromEmbed,
};

console.log('[extract] v7 cargado — browser compartido + filtro ads + master priority');
