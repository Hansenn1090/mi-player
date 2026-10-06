const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const AD_CDN_PATTERNS = [
  /adtng/i, /exoclick/i, /juicyads/i, /trafficjunky/i, /propellerads/i,
  /popads/i, /histats/i, /yandex\.ru\/metrika/i, /dtscout/i, /dtscdn/i,
  /tynt\.com/i, /mamshirt/i, /tagivi/i, /createlouisville/i,
  /doubleclick/i, /googlesyndication/i, /google-analytics/i,
];
function isAdUrl(url) {
  if (!url) return false;
  for (const p of AD_CDN_PATTERNS) if (p.test(url)) return true;
  return false;
}

let _browser = null, _launching = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  if (_launching) return _launching;
  console.log('[extract] 🚀 Lanzando Chromium...');
  _launching = puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-zygote','--disable-gpu','--disable-software-rasterizer','--disable-extensions','--disable-background-networking','--mute-audio','--no-first-run','--window-size=1280,720'],
    timeout: 60000,
  });
  try {
    _browser = await _launching; _launching = null;
    console.log('[extract] ✅ Chromium listo');
    _browser.on('disconnected', () => { _browser = null; });
    return _browser;
  } catch (e) { _launching = null; _browser = null; throw e; }
}

let _queue = Promise.resolve();
async function extractM3u8FromEmbed(embedUrl, opts = {}) {
  const result = _queue.then(() => _doExtract(embedUrl, opts).catch(e => { console.error(e.message); return null; }));
  _queue = result.then(() => {}).catch(() => {});
  return result;
}

async function _doExtract(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;
  const timeout = opts.timeout || 40000;
  let page = null;
  const captured = [];

  try {
    console.log('[extract] Iniciando:', embedUrl);
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();
      if (isAdUrl(url)) { req.abort(); return; }
      if (/\.mp4(\?|$)/i.test(url) && !/\.ts(\?|$)/i.test(url)) {
        console.log('[extract] ✅ MP4:', url.slice(0, 100));
        captured.push({ stream: url, kind: 'mp4', referer: embedUrl, priority: 1 });
      } else if (/\/master\.m3u8/i.test(url) || /master\.txt/i.test(url)) {
        console.log('[extract] ✅ HLS master:', url.slice(0, 100));
        captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority: 2 });
      } else if (/\.m3u8(\?|$)/i.test(url)) {
        captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority: 3 });
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
          const mp4Match = text.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/i);
          if (mp4Match && !isAdUrl(mp4Match[0])) {
            captured.push({ stream: mp4Match[0], kind: 'mp4', referer: embedUrl, priority: 1 });
          }
          const m3u8Match = text.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
          if (m3u8Match && !isAdUrl(m3u8Match[0])) {
            const p = /master\.m3u8/i.test(m3u8Match[0]) ? 2 : 3;
            captured.push({ stream: m3u8Match[0], kind: 'hls', referer: embedUrl, priority: p });
          }
        }
        if (/application\/x-mpegurl/i.test(ct) && !isAdUrl(url)) {
          captured.push({ stream: url, kind: 'hls', referer: embedUrl, priority: 3 });
        }
      } catch (_) {}
    });

    try { await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout }); } catch (e) { console.warn('[extract] Nav:', e.message); }
    await new Promise(r => setTimeout(r, 2500));

    // Buscar botón de descarga
    if (!captured.some(c => c.kind === 'mp4')) {
      const downloadSels = ['a[href*="/download"]', 'a[download]', 'a[href*="?download"]', 'button[class*="download"]', '[class*="download"]'];
      for (const sel of downloadSels) {
        try {
          const el = await page.$(sel);
          if (el) {
            const href = await page.evaluate(e => e.href, el);
            if (href && /\.mp4/i.test(href)) {
              captured.push({ stream: href, kind: 'mp4', referer: embedUrl, priority: 1 });
              break;
            }
          }
        } catch (_) {}
      }
    }

    // Auto-click en play
    if (captured.length === 0) {
      const playSels = ['button.play-button', '.play-button', '.vjs-big-play-button', '.jw-icon-display', '[class*="play"]', 'video'];
      for (const sel of playSels) {
        try {
          const el = await page.$(sel);
          if (el) { await el.click({ delay: 50 }).catch(() => {}); await new Promise(r => setTimeout(r, 1500)); if (captured.length > 0) break; }
        } catch (_) {}
      }
    }

    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (captured.some(c => c.priority === 1)) break;
      if (captured.some(c => c.priority === 2) && Date.now() - start > 10000) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (captured.length === 0) {
      try {
        const found = await page.evaluate(() => {
          const r = [];
          const html = document.documentElement.innerHTML;
          const mp4s = html.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/gi) || [];
          for (const u of mp4s) r.push({ url: u, kind: 'mp4' });
          const m3u8s = html.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi) || [];
          for (const u of m3u8s) r.push({ url: u, kind: 'hls' });
          return r;
        });
        for (const item of found) {
          if (!isAdUrl(item.url)) {
            captured.push({ stream: item.url, kind: item.kind, referer: embedUrl, priority: item.kind === 'mp4' ? 1 : 3 });
          }
        }
      } catch (_) {}
    }

    if (captured.length > 0) {
      captured.sort((a, b) => a.priority - b.priority);
      const best = captured[0];
      console.log('[extract] 🎬 Final (p' + best.priority + '):', best.kind, '->', best.stream.slice(0, 100));
      return { stream: best.stream, kind: best.kind, referer: best.referer };
    }
    console.log('[extract] ❌ Sin stream');
    return null;
  } catch (err) {
    console.error('[extract] Error:', err.message);
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
console.log('[extract] v8 cargado');
