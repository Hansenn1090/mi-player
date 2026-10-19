// api/core/puppeteer-extractor.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const os = require('os');
const path = require('path');

// 🔥 ACTIVAMOS EL MODO INVISIBLE
puppeteer.use(StealthPlugin());

let _browserPromise = null;
let _userDataDir = null;

function getBrowser() {
    if (_browserPromise) return _browserPromise;

    _browserPromise = (async () => {
        _userDataDir = path.join(
            os.tmpdir(),
            'puppeteer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        );

        console.log('[Puppeteer] Lanzando Chromium Stealth...');
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
        if (browser && browser.isConnected()) await browser.close();
    } catch (e) {
        console.warn('[Puppeteer] Error al cerrar:', e.message);
    } finally {
        _browserPromise = null;
    }
}

process.on('SIGTERM', closeBrowser);
process.on('SIGINT', closeBrowser);
process.on('exit', () => { closeBrowser().catch(() => {}); });

function withTimeout(promise, ms, label = 'op') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)
        ),
    ]);
}

async function extractStream(url) {
    if (!url || !url.startsWith('http')) return null;

    console.log('[Puppeteer] Extrayendo:', url);
    let page = null;

    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });
        await page.setViewport({ width: 1280, height: 720 });

        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(25000);

        let captured = null;
        let finalUrl = url;

        page.on('request', (req) => {
            if (captured) return;
            const reqUrl = req.url();
            if (/\.m3u8(\?|$)/i.test(reqUrl)) {
                captured = { url: reqUrl, kind: 'hls' };
                console.log('[Puppeteer] 📡 m3u8 (request):', reqUrl.slice(0, 130));
            } else if (/\.mp4(\?|$)/i.test(reqUrl)) {
                captured = { url: reqUrl, kind: 'mp4' };
                console.log('[Puppeteer] 📡 mp4 (request):', reqUrl.slice(0, 130));
            }
        });

        page.on('response', (res) => {
            if (captured) return;
            const resUrl = res.url();
            const ct = (res.headers()['content-type'] || '').toLowerCase();
            if (/\.m3u8(\?|$)/i.test(resUrl) || /mpegurl/i.test(ct)) {
                captured = { url: resUrl, kind: 'hls' };
                console.log('[Puppeteer] 📡 m3u8 (response):', resUrl.slice(0, 130));
            }
        });

        page.on('popup', (p) => p.close().catch(() => {}));

        try {
            await withTimeout(
                page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }),
                22000, 'page.goto'
            );
            finalUrl = page.url();
            console.log('[Puppeteer] URL final:', finalUrl);
        } catch (e) {
            console.warn('[Puppeteer] goto falló:', e.message);
        }

        const start = Date.now();
        while (!captured && Date.now() - start < 12000) {
            await new Promise(r => setTimeout(r, 300));
        }

        if (!captured) {
            console.log('[Puppeteer] Sin stream, intentando click en play...');
            const frames = page.frames();
            for (const frame of frames) {
                try {
                    await withTimeout(
                        frame.evaluate(() => {
                            const selectors = ['.play-button', '.vjs-big-play-button', 'button[aria-label*="play" i]', 'video'];
                            for (const sel of selectors) {
                                const el = document.querySelector(sel);
                                if (el) {
                                    if (el.tagName === 'VIDEO') { el.play?.(); el.muted = true; }
                                    else if (typeof el.click === 'function') { el.click(); }
                                    return sel;
                                }
                            }
                        }), 3000, 'click-play'
                    ).catch(() => {});
                } catch (_) {}
            }
            const start2 = Date.now();
            while (!captured && Date.now() - start2 < 8000) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        if (captured) {
            console.log(`[Puppeteer] ✅ ${captured.kind.toUpperCase()}:`, captured.url.slice(0, 130));

            let referer = url;
            try { referer = new URL(finalUrl).origin + '/'; } catch (_) {}

            // 🔥 EXTRAEMOS COOKIES
            let cookieString = '';
            try {
                const cookies = await page.cookies();
                cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                console.log(`[Puppeteer] 🍪 Cookies capturadas: ${cookies.length}`);
            } catch (err) {}

            // 🔥 NUEVO: DESCARGAMOS EL TEXTO DEL M3U8 USANDO EL NAVEGADOR (Evita el 403 de axios)
            let m3u8Content = null;
            if (captured.kind === 'hls') {
                try {
                    m3u8Content = await page.evaluate(async (m3u8Url) => {
                        const res = await fetch(m3u8Url);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return await res.text();
                    }, captured.url);
                    console.log('[Puppeteer] 📄 Contenido M3U8 obtenido, longitud:', m3u8Content.length);
                } catch (e) {
                    console.warn('[Puppeteer] ⚠️ Falló la descarga del M3U8 en el navegador:', e.message);
                }
            }

            return {
                stream: captured.url,
                kind: captured.kind,
                referer,
                cookie: cookieString,
                m3u8Content: m3u8Content // <--- Enviamos el texto del M3U8
            };
        }

        return null;
    } catch (err) {
        console.warn('[Puppeteer] Error:', err.message);
        return null;
    } finally {
        if (page) { try { await page.close(); } catch (_) {} }
    }
}

module.exports = { extractStream, closeBrowser };
