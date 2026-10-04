const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Variable global para evitar múltiples Puppeteers
let extractionInProgress = false;

async function extractStream(embedUrl) {
  // Si ya hay una extracción en curso, esperamos
  if (extractionInProgress) {
    console.log('[extractor] Esperando a que termine otra extracción...');
    let attempts = 0;
    while (extractionInProgress && attempts < 30) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
    if (extractionInProgress) {
      console.warn('[extractor] Timeout esperando extracción previa');
      return null;
    }
  }

  extractionInProgress = true;
  let browser = null;

  try {
    console.log('[extractor] Abriendo:', embedUrl.slice(0, 80));

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
        '--single-process',   // CRÍTICO: ahorra mucha RAM
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--window-size=800,600',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    // Bloquear imágenes y fuentes para ahorrar RAM y ancho de banda
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    let streamUrl = null;
    page.on('response', (response) => {
      const url = response.url();
      if (!streamUrl && (url.includes('.m3u8') || url.includes('master.txt'))) {
        streamUrl = url;
      }
    });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 5000));

    // Fallback: buscar en el DOM
    if (!streamUrl) {
      streamUrl = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const m = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        return m ? m[0] : null;
      });
    }

    // Cerrar inmediatamente (liberar RAM)
    await browser.close();
    browser = null;

    if (!streamUrl) return null;

    console.log('[extractor] OK:', streamUrl.slice(0, 80));
    return {
      stream: streamUrl,
      kind: 'hls',
      referer: new URL(embedUrl).origin + '/',
    };
  } catch (e) {
    console.error('[extractor] Error:', e.message);
    if (browser) { try { await browser.close(); } catch (_) {} }
    return null;
  } finally {
    extractionInProgress = false; // Siempre liberar el bloqueo
  }
}

module.exports = { extractStream };
