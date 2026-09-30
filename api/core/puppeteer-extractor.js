// ══════════════════════════════════════════════════════════════════════════
// puppeteer-extractor.js — v2 con auto-click en botones de play
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function extractM3u8(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;

  const timeout = opts.timeout || 30000;
  let browser = null;
  let captured = null;

  try {
    console.log('[extract] Iniciando para:', embedUrl);

    browser = await puppeteer.launch({
      headless: 'new',
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
        '--mute-audio',
        '--window-size=1280,720',
      ],
      timeout: 20000,
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    });

    // ─── Interceptar TODO (no bloquear nada, porque a veces el m3u8 depende de recursos) ───
    // Solo bloqueamos anuncios muy conocidos para acelerar
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();

      // Capturar streams
      if (!captured) {
        if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
          captured = { stream: url, kind: 'hls', referer: embedUrl };
          console.log('[extract] ✅ HLS capturado:', url.slice(0, 100));
        } else if (/\.mp4(\?|$)/i.test(url)) {
          captured = { stream: url, kind: 'mp4', referer: embedUrl };
          console.log('[extract] ✅ MP4 capturado:', url.slice(0, 100));
        }
      }

      // Bloquear solo ads MUY pesados (no tocar el resto)
      if (/doubleclick|googlesyndication|google-analytics|popads\.net|propellerads|exoclick/i.test(url)) {
        req.abort();
        return;
      }

      req.continue();
    });

    // Captura por Content-Type
    page.on('response', async (res) => {
      if (captured) return;
      try {
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        const url = res.url();
        if (/application\/x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct)) {
          captured = { stream: url, kind: 'hls', referer: embedUrl };
          console.log('[extract] ✅ HLS por CT:', url.slice(0, 100));
        }
      } catch (_) {}
    });

    // ─── Navegar ──────────────────────────────────────────────────────
    console.log('[extract] Navegando...');
    try {
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: timeout });
    } catch (e) {
      console.warn('[extract] Nav timeout (continuando):', e.message);
    }

    // Esperar 2 seg a que cargue el DOM
    await new Promise(r => setTimeout(r, 2000));

    // ─── AUTO-CLICK en botones de play (VOE, StreamWish, etc.) ──────
    if (!captured) {
      console.log('[extract] Intentando auto-click en play...');

      const clickSelectors = [
        // VOE
        'button.play-button', '.play-button', '.vjs-big-play-button',
        '[class*="play"]', '[id*="play"]',
        // StreamWish / FileLions
        '.jw-icon-display', '.jw-display-icon-container',
        // Genéricos
        'video', '.player-container', '.video-player',
        'button[aria-label*="play" i]', 'button[title*="play" i]',
      ];

      for (const sel of clickSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click({ delay: 50 }).catch(() => {});
            console.log('[extract] Click en:', sel);
            await new Promise(r => setTimeout(r, 1500));
            if (captured) break;
          }
        } catch (_) {}
      }

      // Click en coordenadas del centro (por si hay un overlay invisible)
      if (!captured) {
        try {
          const vp = page.viewport();
          await page.mouse.click(vp.width / 2, vp.height / 2);
          console.log('[extract] Click en el centro');
          await new Promise(r => setTimeout(r, 1500));
        } catch (_) {}
      }
    }

    // ─── Esperar más por si captura ──────────────────────────────────
    const waitStart = Date.now();
    while (!captured && Date.now() - waitStart < 12000) {
      await new Promise(r => setTimeout(r, 500));
    }

    // ─── Último intento: buscar en el DOM y en scripts ──────────────
    if (!captured) {
      console.log('[extract] Buscando en DOM/JS...');
      try {
        const found = await page.evaluate(() => {
          // <video>
          for (const v of document.querySelectorAll('video')) {
            if (v.src && /\.(m3u8|mp4)/i.test(v.src)) return v.src;
            if (v.currentSrc && /\.(m3u8|mp4)/i.test(v.currentSrc)) return v.currentSrc;
          }
          for (const s of document.querySelectorAll('source')) {
            if (s.src && /\.(m3u8|mp4)/i.test(s.src)) return s.src;
          }
          // window globals
          for (const g of ['sources', 'videoSources', 'playlist', 'hlsUrl', 'm3u8', 'file', 'source']) {
            const val = window[g];
            if (typeof val === 'string' && /\.(m3u8|mp4)/i.test(val)) return val;
            if (Array.isArray(val) && val[0]) {
              const f = val[0].file || val[0].src || val[0].url || val[0];
              if (typeof f === 'string' && /\.(m3u8|mp4)/i.test(f)) return f;
            }
          }
          // Regex en scripts inline (buscando .m3u8)
          const scripts = document.querySelectorAll('script');
          for (const s of scripts) {
            const txt = s.textContent || '';
            const m = txt.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
            if (m) return m[0];
            // Buscar base64 con m3u8
            const b64 = txt.match(/["']([A-Za-z0-9+/=]{80,})["']/);
            if (b64) {
              try {
                const dec = atob(b64[1]);
                const m2 = dec.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
                if (m2) return m2[0];
              } catch (_) {}
            }
          }
          // Regex en HTML completo
          const m3 = document.documentElement.innerHTML.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/i);
          if (m3) return m3[0];
          return null;
        });

        if (found) {
          const kind = /\.m3u8/i.test(found) ? 'hls' : 'mp4';
          captured = { stream: found, kind, referer: embedUrl };
          console.log('[extract] ✅ Encontrado:', found.slice(0, 100));
        }
      } catch (e) {
        console.warn('[extract] Error DOM:', e.message);
      }
    }

    if (captured) {
      console.log('[extract] 🎬 OK:', captured.kind, '->', captured.stream.slice(0, 100));
      return captured;
    }

    console.log('[extract] ❌ Sin stream de:', embedUrl);
    return null;

  } catch (err) {
    console.error('[extract] Error:', err.message);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

module.exports = {
  extractM3u8,
  extractStream: extractM3u8,
  extract: extractM3u8,
  default: extractM3u8,
};

console.log('[extract] v2 cargado — auto-click habilitado');
