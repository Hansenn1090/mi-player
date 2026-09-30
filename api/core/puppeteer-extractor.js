// ══════════════════════════════════════════════════════════════════════════
// puppeteer-extractor.js
// Extrae el stream limpio (m3u8/mp4) de un embed usando Puppeteer
// Intercepta requests de red y captura la URL del video real
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Activar stealth para evitar detección de bots
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Extrae el stream real de un embed
 * @param {string} embedUrl - URL del embed (ej: https://voe.sx/e/abc123)
 * @param {object} opts - Opciones opcionales
 * @returns {Promise<{stream: string, kind: string, referer: string}|null>}
 */
async function extractM3u8(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) {
    console.warn('[extract] URL inválida:', embedUrl);
    return null;
  }

  const timeout = opts.timeout || 25000;
  let browser = null;
  let captured = null;

  try {
    console.log('[extract] Iniciando Puppeteer para:', embedUrl);

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--window-size=1280,720',
      ],
      timeout: 20000,
    });

    const page = await browser.newPage();

    // Ajustes para reducir consumo y evitar detección
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    // Bloquear recursos innecesarios para acelerar y reducir RAM
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();
      const type = req.resourceType();

      // ─── Capturar m3u8/mp4 ────────────────────────────────────────
      if (!captured) {
        if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
          captured = { stream: url, kind: 'hls', referer: embedUrl };
          console.log('[extract] ✅ HLS capturado:', url.slice(0, 100));
        } else if (/\.mp4(\?|$)/i.test(url)) {
          captured = { stream: url, kind: 'mp4', referer: embedUrl };
          console.log('[extract] ✅ MP4 capturado:', url.slice(0, 100));
        }
      }

      // ─── Bloquear recursos pesados (imágenes, fuentes, CSS) ──────
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
        return;
      }

      // ─── Bloquear dominios de tracking/ad comúnmente pesados ─────
      if (/doubleclick|googlesyndication|google-analytics|googletagmanager|adservice|adnxs|amazon-adsystem|outbrain|taboola|popads|propellerads|exoclick|juicyads|trafficjunky/i.test(url)) {
        req.abort();
        return;
      }

      req.continue();
    });

    // También interceptar respuestas por Content-Type (por si la URL no tiene extensión)
    page.on('response', async (res) => {
      if (captured) return;
      try {
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        const url = res.url();
        if (/application\/x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct)) {
          captured = { stream: url, kind: 'hls', referer: embedUrl };
          console.log('[extract] ✅ HLS por Content-Type:', url.slice(0, 100));
        } else if (/video\/mp4/i.test(ct) && !captured) {
          captured = { stream: url, kind: 'mp4', referer: embedUrl };
          console.log('[extract] ✅ MP4 por Content-Type:', url.slice(0, 100));
        }
      } catch (_) {}
    });

    // ─── Navegar al embed ─────────────────────────────────────────────
    console.log('[extract] Navegando a:', embedUrl);
    try {
      await page.goto(embedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeout,
      });
    } catch (navErr) {
      console.warn('[extract] Error de navegación (continuando):', navErr.message);
    }

    // ─── Esperar a que aparezca el stream ────────────────────────────
    // Ir chequeando cada 500ms hasta 12 seg (o hasta capturar)
    const waitStart = Date.now();
    while (!captured && Date.now() - waitStart < 12000) {
      await new Promise(r => setTimeout(r, 500));
    }

    // ─── Si no capturamos nada, buscar en el DOM ─────────────────────
    if (!captured) {
      console.log('[extract] Buscando en el DOM...');
      try {
        const domStream = await page.evaluate(() => {
          // 1. <video src>
          const vids = document.querySelectorAll('video');
          for (const v of vids) {
            if (v.src && /\.(m3u8|mp4)/i.test(v.src)) return v.src;
            if (v.currentSrc && /\.(m3u8|mp4)/i.test(v.currentSrc)) return v.currentSrc;
          }
          // 2. <source src>
          const sources = document.querySelectorAll('source');
          for (const s of sources) {
            if (s.src && /\.(m3u8|mp4)/i.test(s.src)) return s.src;
          }
          // 3. Variables globales comunes
          const globals = ['sources', 'videoSources', 'playlist', 'hlsUrl', 'm3u8', 'file'];
          for (const g of globals) {
            const val = window[g];
            if (typeof val === 'string' && /\.(m3u8|mp4)/i.test(val)) return val;
            if (Array.isArray(val) && val[0]) {
              const f = val[0].file || val[0].src || val[0].url || val[0];
              if (typeof f === 'string' && /\.(m3u8|mp4)/i.test(f)) return f;
            }
          }
          // 4. Regex en el HTML
          const html = document.documentElement.innerHTML;
          const m = html.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/i);
          if (m) return m[0];
          return null;
        });

        if (domStream) {
          const kind = /\.m3u8/i.test(domStream) ? 'hls' : 'mp4';
          captured = { stream: domStream, kind, referer: embedUrl };
          console.log('[extract] ✅ Capturado desde DOM:', domStream.slice(0, 100));
        }
      } catch (e) {
        console.warn('[extract] Error buscando en DOM:', e.message);
      }
    }

    // ─── Último intento: esperar 3 seg más por si tarda ──────────────
    if (!captured) {
      console.log('[extract] Esperando 3 seg más...');
      await new Promise(r => setTimeout(r, 3000));
    }

    if (captured) {
      console.log('[extract] 🎬 Stream extraído:', captured.kind, '->', captured.stream.slice(0, 100));
      return captured;
    }

    console.log('[extract] ❌ No se pudo extraer stream de:', embedUrl);
    return null;

  } catch (err) {
    console.error('[extract] Error general:', err.message);
    return null;

  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

// ─── Exportar ─────────────────────────────────────────────────────────────
// Se exportan varios nombres por compatibilidad con el server.js
module.exports = {
  extractM3u8,
  extractStream: extractM3u8,
  extract: extractM3u8,
  default: extractM3u8,
};

console.log('[extract] Módulo cargado — funciones: extractM3u8, extractStream, extract');
