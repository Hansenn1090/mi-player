// ══════════════════════════════════════════════════════════════════════════
// providers/unlimplay.js — v2 con Puppeteer (evita Cloudflare 403)
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// Browser compartido (se reutiliza entre todas las llamadas)
// ══════════════════════════════════════════════════════════════════════════
let _browser = null;
let _launching = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  if (_launching) return _launching;

  console.log('[unlimplay] 🚀 Lanzando Chromium...');
  _launching = puppeteer.launch({
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
      '--mute-audio',
      '--no-first-run',
      '--window-size=1280,720',
    ],
    timeout: 60000,
  });

  try {
    _browser = await _launching;
    _launching = null;
    console.log('[unlimplay] ✅ Chromium listo');
    _browser.on('disconnected', () => { _browser = null; });
    return _browser;
  } catch (e) {
    _launching = null;
    _browser = null;
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Scraper principal
// ══════════════════════════════════════════════════════════════════════════
async function scrapeUnlimplay(tmdbId, type = 'movie') {
  const found = {};
  if (!tmdbId) return found;

  const url = `https://unlimplay.com/f/embed/${type}/${tmdbId}`;
  let page = null;

  try {
    console.log('[unlimplay] Puppeteer para:', url);

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    // Bloquear ads pesados
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/doubleclick|googlesyndication|google-analytics|popads|propellerads|exoclick|histats|yandex\.ru\/metrika/i.test(u)) {
        req.abort(); return;
      }
      req.continue();
    });

    // Navegar
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.warn('[unlimplay] Nav:', e.message);
    }

    // Esperar a que cargue el JS de Cloudflare
    await new Promise(r => setTimeout(r, 3000));

    // Obtener el HTML
    const html = await page.content();
    if (!html || typeof html !== 'string') return found;

    // ═══════════════════════════════════════════════════════════════════
    // Buscar finalizePlayer({...})
    // ═══════════════════════════════════════════════════════════════════
    const regex1 = /finalizePlayer\s*\(\s*(\{[\s\S]*?\})\s*\)/;
    const match1 = html.match(regex1);

    if (match1 && match1[1]) {
      try {
        const data = JSON.parse(match1[1]);
        console.log('[unlimplay] JSON con', Object.keys(data).length, 'idiomas');
        for (const lang of Object.keys(data)) {
          if (!found[lang]) found[lang] = {};
          Object.assign(found[lang], data[lang]);
        }
        if (Object.keys(found).length > 0) {
          console.log('[unlimplay] ✅', Object.entries(found).map(([l, s]) => `${l}:${Object.keys(s).length}`).join(' '));
          return found;
        }
      } catch (e) {
        console.warn('[unlimplay] JSON parse error:', e.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Fallback: buscar URLs de servidores con regex
    // ═══════════════════════════════════════════════════════════════════
    const serversRegex = /"(streamwish|filelions|voe|vidhide|doodstream|fastream|vidmoly|uqload|vidspeed|filemoon|streamtape|mixdrop|pelixplay)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
    let m, count = 0;
    while ((m = serversRegex.exec(html)) !== null) {
      if (!found.latino) found.latino = {};
      if (!found.latino[m[1].toLowerCase()]) {
        found.latino[m[1].toLowerCase()] = m[2];
        count++;
      }
    }
    if (count > 0) {
      console.log('[unlimplay] ✅', count, 'servidores por regex');
    } else {
      console.log('[unlimplay] Sin servidores para TMDB', tmdbId);
    }

    return found;

  } catch (e) {
    console.error('[unlimplay] Error:', e.message);
    return found;
  } finally {
    if (page) { try { await page.close(); } catch (_) {} }
  }
}

module.exports = { scrapeUnlimplay };
console.log('[unlimplay] Provider v2 cargado — Puppeteer');
