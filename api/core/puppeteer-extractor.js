// ══════════════════════════════════════════════════════════════════════════
// puppeteer-extractor.js — v4 SIN stealth (más estable en Render Free)
// ══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function extractM3u8FromEmbed(embedUrl, opts = {}) {
  if (!embedUrl || !/^https?:\/\//i.test(embedUrl)) return null;

  const timeout = opts.timeout || 35000;
  let browser = null;
  const captured = [];
  let bestStream = null;

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

      if (/\.m3u8(\?|$)/i.test(url) || /master\.txt(\?|$)/i.test(url)) {
        console.log('[extract] HLS:', url.slice(0, 120));
        captured.push({ stream: url, kind: 'hls', referer: embedUrl });
      } else if (/\.mp4(\?|$)/i.test(url) && !/\.ts(\?|$)/i.test(url)) {
        console.log('[extract] MP4:', url.slice(0, 120));
        captured.push({ stream: url, kind: 'mp4', referer: embedUrl });
      }

      if (/doubleclick|googlesyndication|google-analytics|popads|propellerads|exoclick|histats|yandex|dtscout|tynt|mamshirt|tagivi|createlouisville/i.test(url)) {
        req.abort();
        return;
      }

      req.continue();
    });

    page.on('response', async (res) => {
      try {
        const url = res.url();
        const ct = (res.headers()['content-type'] || '').toLowerCase();

        if (/\/data\/(movie|tv|episode)\//i.test(url) || /application\/json/i.test(ct)) {
          const text = await res.text();
          const m3u8Match = text.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
          if (m3u8Match) {
            console.log('[extract] m3u8 en JSON:', m3u8Match[0].slice(0, 120));
            captured.push({ stream: m3u8Match[0], kind: 'hls', referer: embedUrl });
          }
        }

        if (/application\/x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct)) {
          captured.push({ stream: url, kind: 'hls', referer: embedUrl });
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

    if (captured.length === 0) {
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
            await new Promise(r => setTimeout(r, 1200));
            if (captured.length > 0) break;
          }
        } catch (_) {}
      }
    }

    const start = Date.now();
    while (captured.length === 0 && Date.now() - start < 12000) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (captured.length === 0) {
      console.log('[extract] Buscando en DOM...');
      try {
        const found = await page.evaluate(() => {
          const results = [];
          for (const v of document.querySelectorAll('video')) {
            if (v.src && !v.src.startsWith('blob:')) results.push({ url: v.src, kind: 'mp4' });
            if (v.currentSrc && !v.currentSrc.startsWith('blob:')) results.push({ url: v.currentSrc, kind: 'mp4' });
          }
          for (const s of document.querySelectorAll('source')) {
            if (s.src) results.push({ url: s.src, kind: 'mp4' });
          }
          const html = document.documentElement.innerHTML;
          const matches = html.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*/gi) || [];
          for (const m of matches) results.push({ url: m, kind: /\.m3u8/i.test(m) ? 'hls' : 'mp4' });
          return results;
        });

        for (const item of found) {
          captured.push({ stream: item.url, kind: item.kind, referer: embedUrl });
        }
      } catch (e) {
        console.warn('[extract] DOM error:', e.message);
      }
    }

    if (captured.length > 0) {
      bestStream = captured.find(c => c.kind === 'hls') || captured[0];
      console.log('[extract] ✅ Stream:', bestStream.kind, '->', bestStream.stream.slice(0, 120));
      return bestStream;
    }

    console.log('[extract] ❌ Sin stream');
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

console.log('[extract] v4 cargado — sin stealth, más estable');
