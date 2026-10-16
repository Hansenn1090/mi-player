// api/core/extractors/filelions.js
'use strict';

const puppeteer = require('puppeteer');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// Singleton del navegador (reutiliza entre requests)
// ══════════════════════════════════════════════════════════════════════════
let _browser = null;
let _idleTimer = null;
const IDLE_TIMEOUT = 60 * 1000;

async function getBrowser() {
  if (_browser && _browser.isConnected()) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    return _browser;
  }

  console.log('[filelions] Lanzando Chromium...');
  _browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--lang=es-ES,es',
      '--user-agent=' + UA,
    ],
  });
  console.log('[filelions] ✅ Chromium listo');
  return _browser;
}

function scheduleIdleClose() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    if (_browser) {
      try { await _browser.close(); } catch (_) {}
      _browser = null;
      console.log('[filelions] 💤 Chromium cerrado por idle');
    }
  }, IDLE_TIMEOUT);
}

// ══════════════════════════════════════════════════════════════════════════
// Extractor principal
// ══════════════════════════════════════════════════════════════════════════
async function extractFileLions(embedUrl) {
  if (!embedUrl) return null;

  console.log('[filelions] Extrayendo (Puppeteer):', embedUrl.slice(0, 90));

  let page = null;
  let m3u8Captured = null;
  let mp4Captured = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // ─── Anti-detección ──────────────────────────────────────────
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    });

    // ─── Intercepción de red ─────────────────────────────────────
    page.on('response', (response) => {
      const url = response.url();
      if (!m3u8Captured && /\.m3u8(\?|$)/i.test(url)) {
        m3u8Captured = url;
        console.log('[filelions] 📡 m3u8 (response):', url.slice(0, 130));
      }
      if (!mp4Captured && /\.mp4(\?|$)/i.test(url)) {
        mp4Captured = url;
        console.log('[filelions] 📡 mp4 (response):', url.slice(0, 130));
      }
    });

    page.on('request', (request) => {
      const url = request.url();
      if (!m3u8Captured && /\.m3u8(\?|$)/i.test(url)) {
        m3u8Captured = url;
        console.log('[filelions] 📡 m3u8 (request):', url.slice(0, 130));
      }
    });

    // ─── Navegar ─────────────────────────────────────────────────
    console.log('[filelions] Navegando...');
    await page.goto(embedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // ─── Esperar a que Cloudflare resuelva ───────────────────────
    try {
      await page.waitForFunction(
        () => {
          const html = document.documentElement.innerHTML;
          return !/just a moment|checking your browser|cf-browser-verification|cf-challenge/i.test(html);
        },
        { timeout: 15000, polling: 500 }
      );
      console.log('[filelions] Challenge resuelto');
    } catch (_) {
      console.warn('[filelions] Timeout esperando challenge — continuando');
    }

    // ─── Esperar el m3u8 hasta 15s ───────────────────────────────
    const start = Date.now();
    while (!m3u8Captured && !mp4Captured && Date.now() - start < 15000) {
      await new Promise(r => setTimeout(r, 300));
    }

    // ─── Fallback: parsear el packer desde el DOM ────────────────
    if (!m3u8Captured && !mp4Captured) {
      console.log('[filelions] Buscando en scripts del DOM...');

      const found = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));

        for (const s of scripts) {
          const txt = s.textContent || '';
          if (!txt.includes('eval(function(p,a,c,k,e,d)')) continue;

          try {
            // Extraer el payload del packer
            const m = txt.match(
              /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/
            );
            if (!m) continue;

            const packed = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
            const base = parseInt(m[2], 10);
            const count = parseInt(m[3], 10);
            const tokens = m[4].split('|');

            // Unpack estilo Dean Edwards
            let unpacked = packed;
            let c = count;
            while (c--) {
              if (tokens[c]) {
                unpacked = unpacked.split(
                  new RegExp('\\b' + c.toString(base) + '\\b', 'g')
                ).join(tokens[c]);
              }
            }

            // Buscar m3u8
            const m3u8 = unpacked.replace(/\\\//g, '/')
              .match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
            if (m3u8) return { type: 'm3u8', url: m3u8[0] };

            // Fallback a mp4
            const mp4 = unpacked.replace(/\\\//g, '/')
              .match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
            if (mp4) return { type: 'mp4', url: mp4[0] };
          } catch (e) { /* continuar */ }
        }

        // Buscar directo en el HTML
        const html = document.documentElement.innerHTML.replace(/\\\//g, '/');
        const m3u8 = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
        if (m3u8) return { type: 'm3u8', url: m3u8[0] };

        const mp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
        if (mp4) return { type: 'mp4', url: mp4[0] };

        return null;
      });

      if (found) {
        if (found.type === 'm3u8') m3u8Captured = found.url;
        else mp4Captured = found.url;
        console.log(`[filelions] 📄 ${found.type} en DOM:`, found.url.slice(0, 130));
      }
    }

    // ─── Cerrar página (no el browser) ────────────────────────────
    await page.close().catch(() => {});
    scheduleIdleClose();

    if (m3u8Captured) {
      console.log('[filelions] ✅ HLS:', m3u8Captured.slice(0, 130));
      return { stream: m3u8Captured, kind: 'hls', referer: embedUrl };
    }
    if (mp4Captured) {
      console.log('[filelions] ✅ MP4:', mp4Captured.slice(0, 130));
      return { stream: mp4Captured, kind: 'mp4', referer: embedUrl };
    }

    console.warn('[filelions] ❌ No se encontró stream');
    return null;

  } catch (err) {
    console.warn('[filelions] Error:', err.message);
    if (page) await page.close().catch(() => {});
    scheduleIdleClose();
    return null;
  }
}

module.exports = { extractFileLions };
