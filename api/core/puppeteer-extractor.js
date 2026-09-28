const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

let browserInstance = null;
let browserIdleTimer = null;

async function getBrowser() {
  if (browserInstance) {
    clearTimeout(browserIdleTimer);
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  return browserInstance;
}

// Cierra el browser si no se usa en 5 min (para no consumir RAM)
function scheduleBrowserClose() {
  clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(async () => {
    if (browserInstance) {
      try { await browserInstance.close(); } catch(e){}
      browserInstance = null;
    }
  }, 5 * 60 * 1000);
}

/**
 * Extrae el .m3u8 real de un embed.
 * Abre la URL en un navegador headless, espera que el player cargue,
 * intercepta el request del .m3u8 y lo devuelve.
 */
async function extractM3u8FromEmbed(embedUrl, timeoutMs = 25000) {
  console.log(`[Puppeteer] Extrayendo: ${embedUrl}`);
  const browser = await getBrowser();
  const page = await browser.newPage();

  // User agent real
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 720 });

  let m3u8Url = null;
  let resolveExtraction;
  const extractionPromise = new Promise(r => { resolveExtraction = r; });

  // 🎯 INTERCEPTAR requests para capturar el .m3u8
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (/\.m3u8(\?|$)/i.test(url) && !m3u8Url) {
      console.log(`[Puppeteer] 🎯 .m3u8 capturado: ${url.substring(0, 100)}`);
      m3u8Url = url;
      resolveExtraction(url);
    }
    // Bloquear publicidad mientras carga
    if (/doubleclick|googlesyndication|popads|popcash|propellerads|adsterra|exoclick|servetraff|taboola|outbrain|mgid|revcontent|clickadu|vidoomy|onclickads/i.test(url)) {
      req.abort();
      return;
    }
    // Bloquear imágenes y fuentes para ir más rápido
    if (req.resourceType() === 'image' || req.resourceType() === 'font') {
      req.abort();
      return;
    }
    req.continue();
  });

  try {
    // Abrir el embed
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Esperar a que aparezca el .m3u8 (con timeout)
    await Promise.race([
      extractionPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout extrayendo m3u8')), timeoutMs)),
    ]);

    // Esperar 1 segundo extra por si hay redirects
    if (!m3u8Url) {
      await new Promise(r => setTimeout(r, 2000));
    }

    return m3u8Url;
  } catch (err) {
    console.warn(`[Puppeteer] Error: ${err.message}`);
    // Intento fallback: buscar el .m3u8 en el HTML final
    try {
      const html = await page.content();
      const match = html.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
      if (match) {
        console.log(`[Puppeteer] ✅ .m3u8 encontrado en HTML: ${match[1].substring(0, 80)}`);
        return match[1];
      }
    } catch(e) {}
    return null;
  } finally {
    try { await page.close(); } catch(e){}
    scheduleBrowserClose();
  }
}

module.exports = { extractM3u8FromEmbed };
