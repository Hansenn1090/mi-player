const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const BASE = 'https://pelixplay.app';

// ══════════════════════════════════════════════════════════════════════
// Este provider:
// 1. Abre el embed de pelixplay
// 2. Lee el <select> de servidores
// 3. Filtra solo StreamWish, Vidmoly, FileLions
// 4. Extrae el HLS real de cada uno
// 5. Devuelve { latino: { StreamWish: 'm3u8', Vidmoly: 'm3u8', ... } }
// ══════════════════════════════════════════════════════════════════════
async function scrapePelixplay(title, year, tmdbId, type) {
  const found = { latino: {}, subtitulado: {} };
  if (!tmdbId) {
    console.log('[pelixplay] Sin tmdbId, saltando');
    return found;
  }

  console.log('[pelixplay] Abriendo embed con Puppeteer, tmdbId:', tmdbId);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 720 });

    // Escuchar todas las peticiones .m3u8 que se carguen en la página
    const capturedStreams = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('.m3u8') || url.includes('master.txt')) {
        capturedStreams.push({ url, ts: Date.now() });
      }
    });

    const embedUrl = `${BASE}/embed/embed-final.html?id=${tmdbId}`;
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Esperar a que el embed cargue la lista de servidores
    await new Promise(r => setTimeout(r, 7000));

    // Leer todos los servidores del <select> y los idiomas
    const servers = await page.evaluate(() => {
      const list = [];
      const select = document.getElementById('server-select');
      if (select) {
        Array.from(select.options).forEach(opt => {
          list.push({ value: opt.value, label: opt.textContent.trim() });
        });
      }
      return list;
    });

    console.log('[pelixplay] Servidores detectados:', servers.map(s => s.value).join(', '));

    // Filtrar solo los permitidos
    const ALLOWED = ['streamwish', 'vidmoly', 'filelions', 'vidhide'];
    const validServers = servers.filter(s => {
      const base = normalizeName(s.value);
      return base && ALLOWED.includes(base.toLowerCase());
    });

    console.log('[pelixplay] Servidores válidos:', validServers.map(s => s.value).join(', '));

    // Para cada servidor válido: hacer clic y capturar el HLS
    for (const srv of validServers) {
      try {
        console.log(`[pelixplay] Extrayendo: ${srv.value}`);

        // Limpiar capturas previas y hacer clic en el servidor
        capturedStreams.length = 0;

        await page.evaluate((value) => {
          const select = document.getElementById('server-select');
          if (!select) return;
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }, srv.value);

        // Esperar a que se cargue el HLS (máx 12 s)
        const startTime = Date.now();
        while (capturedStreams.length === 0 && Date.now() - startTime < 12000) {
          await new Promise(r => setTimeout(r, 500));
        }

        if (capturedStreams.length > 0) {
          const hlsUrl = capturedStreams[0].url;
          const name = normalizeName(srv.value) || srv.value;
          found.latino[name] = hlsUrl;
          console.log(`[pelixplay] OK latino/${name}: ${hlsUrl.slice(0, 80)}`);
        } else {
          console.log(`[pelixplay] Sin HLS para ${srv.value}`);
        }
      } catch (err) {
        console.warn(`[pelixplay] Error extrayendo ${srv.value}:`, err.message);
      }
    }

    await browser.close();
    browser = null;

    return found;
  } catch (e) {
    console.warn('[pelixplay] Error:', e.message);
    if (browser) { try { await browser.close(); } catch (_) {} }
    return found;
  }
}

function normalizeName(name) {
  const base = String(name).toLowerCase().replace(/[\s_-]+\d+$/, '');
  if (['streamwish', 'hglink', 'flaswish', 'wishfast', 'awish', 'embedwish'].includes(base)) return 'StreamWish';
  if (['vidmoly'].includes(base)) return 'Vidmoly';
  if (['filelions', 'vidhide', 'vidhidepro', 'minochinos', 'callistanise'].includes(base)) return 'FileLions';
  return null;
}

module.exports = {
  scrapePelixplay,
  search: async (title, year, tmdbId, type) => scrapePelixplay(title, year, tmdbId, type)
};

console.log('[pelixplay] Provider cargado (Puppeteer + HLS capture)');
