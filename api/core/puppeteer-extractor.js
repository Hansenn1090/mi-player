const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function extractStream(embedUrl) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    let streamUrl = null;

    page.on('response', (response) => {
      const url = response.url();
      if (!streamUrl && (url.includes('.m3u8') || url.includes('master.txt'))) {
        streamUrl = url;
      }
    });

    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));

    // Buscar en el DOM si no se capturó en la red
    if (!streamUrl) {
      streamUrl = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const m = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        return m ? m[0] : null;
      });
    }

    await browser.close();
    browser = null;

    if (!streamUrl) return null;

    return {
      stream: streamUrl,
      kind: 'hls',
      referer: new URL(embedUrl).origin + '/',
    };
  } catch (e) {
    console.error('[puppeteer-extractor] Error:', e.message);
    if (browser) { try { await browser.close(); } catch (_) {} }
    return null;
  }
}

module.exports = { extractStream };
