const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');

async function extractStream(url) {
  console.log('[Puppeteer] Iniciando extracción para:', url);
  
  // Crear un directorio de perfil único para evitar el error SingletonLock
  const userDataDir = path.join(os.tmpdir(), 'puppeteer_' + Date.now() + '_' + Math.random().toString(36).substring(7));

  const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir: userDataDir, // 👈 Soluciona el error de bloqueo
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Ayuda en entornos con poca memoria
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let m3u8Url = null;

    page.on('request', (request) => {
      const reqUrl = request.url();
      if (reqUrl.includes('.m3u8') && !m3u8Url) {
        console.log('[Puppeteer] ¡Stream encontrado!:', reqUrl);
        m3u8Url = reqUrl;
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 8000)); // Esperar a que cargue el reproductor

    // Si no se encontró, buscar en iframes y hacer clic en Play
    if (!m3u8Url) {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame.url().includes('xpass') || frame.url().includes('player')) {
          try {
            await frame.evaluate(() => {
              const playBtn = document.querySelector('.play-button, .vjs-big-play-button, button');
              if (playBtn) playBtn.click();
            });
          } catch (e) {}
        }
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    await browser.close();

    if (m3u8Url) {
      return { stream: m3u8Url, kind: 'hls', referer: url };
    } else {
      console.log('[Puppeteer] No se encontró el stream.');
      return null;
    }

  } catch (error) {
    console.error('[Puppeteer] Error:', error.message);
    await browser.close();
    return null;
  }
}

module.exports = { extractStream };
