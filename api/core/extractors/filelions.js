// api/core/extractors/filelions.js
'use strict';

const puppeteer = require('puppeteer');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// Singleton: reutiliza el navegador entre requests para no saturar Render
// ══════════════════════════════════════════════════════════════════════════
let _browser = null;
let _idleTimer = null;
const IDLE_TIMEOUT = 60 * 1000; // cierra el browser si nadie lo usa en 60s

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
      '--disable-web-security',
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

  let browser = null;
  let page = null;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // ─── Anti-detección ────────────────────────────────────────────
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    });

    // Ocultar navigator.webdriver (Cloudflare lo chequea)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    });

    // ─── Intercepción de red: capturamos el m3u8 cuando el player lo pida ───
    let m3u8Captured = null;
    page.on('response', (response) => {
      const url = response.url();
      if (!m3u8Captured && /\.m3u8/i.test(url)) {
        m3u8Captured = url;
        console.log('[filelions] 📡 m3u8 detectado en red:', url.slice(0, 130));
      }
    });

    // También interceptar peticiones (por si es un POST o el URL viene codificado)
    page.on('request', (request) => {
      const url = request.url();
      if (!m3u8Captured && /\.m3u8/i.test(url)) {
        m3u8Captured = url;
        console.log('[filelions] 📡 m3u8 detectado en request:', url.slice(0, 130));
      }
    });

    // ─── Navegar y esperar a que Cloudflare resuelva ───
    console.log('[filelions] Navegando...');
    await page.goto(embedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Esperar a que el challenge se resuelva (Cloudflare tarda 5-10s)
    // Estrategia: esperar a que aparezca un elemento del player o timeout
    try {
      await page.waitForFunction(
        () => {
          const html = document.documentElement.innerHTML;
          // Si ya no está el texto del challenge, salimos
          return !/just a moment|checking your browser|cf-browser-verification/i.test(html);
        },
        { timeout: 15000, polling: 500 }
      );
      console.log('[filelions] Challenge resuelto');
    } catch (_) {
      console.warn('[filelions] Timeout esperando challenge — continuando igual');
    }

    // ─── Esperar el m3u8 (hasta 10s) ───
    const waitStart = Date.now();
    while (!m3u8Captured && Date.now() - waitStart < 10000) {
      await new Promise(r => setTimeout(r, 300));
    }

    // ─── Fallback 1: buscar en el DOM ───
    if (!m3u8Captured) {
      m3u8Captured = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const normalized = html.replace(/\\\//g, '/');
        const patterns = [
          /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i,
          /["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
          /["']src["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        ];
        for (const re of patterns) {
          const m = normalized.match(re);
          if (m) return m[1] || m[0];
        }
        return null;
      });

      if (m3u8Captured) {
        console.log('[filelions] 📄 m3u8 en DOM:', m3u8Captured.slice(0, 130));
      }
    }

    // ─── Fallback 2: buscar en todos los scripts de la página ───
    if (!m3u8Captured) {
      m3u8Captured = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const content = s.textContent || '';
          const normalized = content.replace(/\\\//g, '/');
          const m = normalized.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
          if (m) return m[0];
        }
        return null;
      });

      if (m3u8Captured) {
        console.log('[filelions] 📜 m3u8 en script:', m3u8Captured.slice(0, 130));
      }
    }

    // ─── Fallback 3: mp4 directo ───
    if (!m3u8Captured) {
      const mp4 = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const m = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
        return m ? m[0] : null;
      });
      if (mp4) {
        console.log('[filelions] ✅ MP4:', mp4.slice(0, 130));
        await page.close().catch(() => {});
        scheduleIdleClose();
        return { stream: mp4, kind: 'mp4', referer: embedUrl };
      }
    }

    // ─── Cleanup de la página (no del browser) ───
    await page.close().catch(() => {});
    scheduleIdleClose();

    if (!m3u8Captured) {
      console.warn('[filelions] ❌ No se encontró m3u8 ni mp4');
      return null;
    }

    console.log('[filelions] ✅ HLS:', m3u8Captured.slice(0, 130));
    return {
      stream: m3u8Captured,
      kind: 'hls',
      referer: embedUrl,
    };

  } catch (err) {
    console.warn('[filelions] Error:', err.message);
    if (page) await page.close().catch(() => {});
    scheduleIdleClose();
    return null;
  }
}

module.exports = { extractFileLions };
