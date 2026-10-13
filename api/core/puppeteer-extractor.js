// api/core/puppeteer-extractor.js
const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');

// ═════════════════════════════════════════════════════════════════
// POOL DE NAVEGADOR — reutiliza una sola instancia de Chromium
// ═════════════════════════════════════════════════════════════════
let _browserPromise = null;
let _userDataDir = null;

function getBrowser() {
    if (_browserPromise) return _browserPromise;

    _browserPromise = (async () => {
        _userDataDir = path.join(
            os.tmpdir(),
            'puppeteer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        );

        console.log('[Puppeteer] Lanzando Chromium...');
        const browser = await puppeteer.launch({
            headless: 'new',
            userDataDir: _userDataDir,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--window-size=1280,720',
            ],
            timeout: 30000,
        });

        console.log('[Puppeteer] ✅ Chromium listo');
        return browser;
    })();

    return _browserPromise;
}

async function closeBrowser() {
    if (!_browserPromise) return;
    try {
        const browser = await _browserPromise;
        if (browser && browser.isConnected()) {
            await browser.close();
        }
    } catch (e) {
        console.warn('[Puppeteer] Error al cerrar:', e.message);
    } finally {
        _browserPromise = null;
    }
}

process.on('SIGTERM', closeBrowser);
process.on('SIGINT', closeBrowser);
process.on('exit', () => { closeBrowser().catch(() => {}); });

// ═════════════════════════════════════════════════════════════════
// TIMEOUT HELPER
// ═════════════════════════════════════════════════════════════════
function withTimeout(promise, ms, label = 'op') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)
        ),
    ]);
}

// ═════════════════════════════════════════════════════════════════
// EXTRACCIÓN PRINCIPAL
// ═════════════════════════════════════════════════════════════════
async function extractStream(url) {
    if (!url || !url.startsWith('http')) return null;

    console.log('[Puppeteer] Extrayendo:', url);
    let page = null;

    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Bloquear imágenes, fuentes y media para ahorrar RAM
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const type = request.resourceType();
            if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
                return request.abort();
            }
            request.continue().catch(() => {});
        });

        page.on('popup', (p) => p.close().catch(() => {}));

        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(25000);

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        let m3u8Url = null;

        page.on('response', (response) => {
            const ct = response.headers()['content-type'] || '';
            const rUrl = response.url();
            if (!m3u8Url && (rUrl.includes('.m3u8') || ct.includes('mpegurl'))) {
                m3u8Url = rUrl;
            }
        });

        await withTimeout(
            page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }),
            22000,
            'page.goto'
        );

        await new Promise(r => setTimeout(r, 4000));

        // Si aún no hay stream, intentar clic en botones de play
        if (!m3u8Url) {
            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const fUrl = frame.url();
                    if (/xpass|player|embed|video/i.test(fUrl)) {
                        await withTimeout(
                            frame.evaluate(() => {
                                const selectors = [
                                    '.play-button', '.vjs-big-play-button',
                                    'button[aria-label*="play" i]',
                                    '.jw-display-icon-container',
                                    'button',
                                ];
                                for (const sel of selectors) {
                                    const el = document.querySelector(sel);
                                    if (el) { el.click(); return; }
                                }
                            }),
                            3000,
                            'click-play'
                        ).catch(() => {});
                    }
                } catch (_) {}
            }
            await new Promise(r => setTimeout(r, 4000));
        }

        if (m3u8Url) {
            console.log('[Puppeteer] ✅ Stream:', m3u8Url.slice(0, 100));
            return { stream: m3u8Url, kind: 'hls', referer: url };
        }

        console.log('[Puppeteer] ⚠️ No se encontró m3u8');
        return null;

    } catch (err) {
        console.warn('[Puppeteer] Error:', err.message);
        return null;
    } finally {
        if (page) {
            try { await page.close(); } catch (_) {}
        }
    }
}

module.exports = { extractStream, closeBrowser };
