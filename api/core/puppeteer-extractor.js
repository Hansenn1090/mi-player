const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function extractM3u8FromEmbed(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;

  const timeout = opts.timeout || 30000;
  let browser = null;
  let captured = null;

  try {
    console.log('[extract] Iniciando para:', embedUrl);

    browser = await puppeteer.launch({
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
        '--mute-audio',
        '--window-size=1280,720',
      ],
      timeout: 20000,
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });

    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();
      if (!captured) {
        if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
          captured = { stream: url, kind: 'hls', referer: embedUrl };
          console.log('[extract] HLS:', url.slice(0, 100));
        } else if (/\.mp4(\?|$)/i.test(url)) {
          captured = { stream: url, kind: 'mp4', referer: embedUrl };
          console.log('[extract] MP4:', url.slice(0, 100));
        }
      }
      if (/doubleclick|googlesyndication|google-analytics|popads|propellerads|exoclick/i.test(url)) {
        req.abort(); return;
      }
      req.continue();
    });

    page.on('response', async (res) => {
      if (captured) return;
      try {
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        const url = res.url();
        if (/application\/x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct)) {
          captured = { stream: url, kind: 'hls', referer: embedUrl };
          console.log('[extract] HLS por CT:', url.slice(0, 100));
        }
      } catch (_) {}
    });

    console.log('[extract] Navegando...');
    try {
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout });
    } catch (e) {
      console.warn('[extract] Nav timeout:', e.message);
    }

    await new Promise(r => setTimeout(r, 2000));

    if (!captured) {
      console.log('[extract] Auto-click en play...');
      const selectors = [
        'button.play-button', '.play-button', '.vjs-big-play-button',
        '.jw-icon-display', '.jw-display-icon-container',
        '[class*="play"]', '[id*="play"]', 'video', '.player-container',
      ];
      for (const sel of selectors) {
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
      if (!captured) {
        try {
          const vp = page.viewport();
          await page.mouse.click(vp.width / 2, vp.height / 2);
          console.log('[extract] Click centro');
          await new Promise(r => setTimeout(r, 1500));
        } catch (_) {}
      }
    }

    const start = Date.now();
    while (!captured && Date.now() - start < 12000) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (!captured) {
      console.log('[extract] Buscando en DOM...');
      try {
        const found = await page.evaluate(() => {
          for (const v of document.querySelectorAll('video')) {
            if (v.src && /\.(m3u8|mp4)/i.test(v.src)) return v.src;
            if (v.currentSrc && /\.(m3u8|mp4)/i.test(v.currentSrc)) return v.currentSrc;
          }
          for (const s of document.querySelectorAll('source')) {
            if (s.src && /\.(m3u8|mp4)/i.test(s.src)) return s.src;
          }
          for (const g of ['sources', 'videoSources', 'playlist', 'hlsUrl', 'm3u8', 'file', 'source']) {
            const val = window[g];
            if (typeof val === 'string' && /\.(m3u8|mp4)/i.test(val)) return val;
            if (Array.isArray(val) && val[0]) {
              const f = val[0].file || val[0].src || val[0].url || val[0];
              if (typeof f === 'string' && /\.(m3u8|mp4)/i.test(f)) return f;
            }
          }
          const html = document.documentElement.innerHTML;
          const m = html.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/i);
          return m ? m[0] : null;
        });
        if (found) {
          const kind = /\.m3u8/i.test(found) ? 'hls' : 'mp4';
          captured = { stream: found, kind, referer: embedUrl };
          console.log('[extract] Encontrado:', found.slice(0, 100));
        }
      } catch (e) {
        console.warn('[extract] DOM error:', e.message);
      }
    }

    if (captured) {
      console.log('[extract] OK:', captured.kind, '->', captured.stream.slice(0, 100));
      return captured;
    }
    console.log('[extract] Sin stream');
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

console.log('[extract] Cargado — extractM3u8FromEmbed');
