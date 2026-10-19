// api/server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // Necesario para el proxy
const app = express();

app.use(express.json());

// ═════════════════════════════════════════════════════════════════
// STATIC — sirve player.html desde donde esté
// ═════════════════════════════════════════════════════════════════
const staticDirs = [
    __dirname,
    path.join(__dirname, 'public'),
    path.join(__dirname, '..'),
];
let servedFrom = null;
for (const dir of staticDirs) {
    try {
        if (fs.existsSync(path.join(dir, 'player.html'))) {
            app.use(express.static(dir));
            servedFrom = dir;
            console.log(`[server] ✅ Estáticos desde: ${dir}`);
            break;
        }
    } catch (_) {}
}
if (!servedFrom) {
    console.warn('[server] ⚠️ No encontré player.html en:', staticDirs);
}

// ═════════════════════════════════════════════════════════════════
// IMPORTS SEGUROS
// ═════════════════════════════════════════════════════════════════
let getSourcesFromProviders = async () => ({});
try {
    ({ getSourcesFromProviders } = require('./providers/registry'));
    console.log('[server] ✅ registry cargado');
} catch (err) {
    console.error('[server] ❌ registry NO cargado:', err.message);
}

let tmdb = null;
try {
    tmdb = require('./core/tmdb');
    console.log('[server] ✅ tmdb cargado');
} catch (err) {
    console.warn('[server] ⚠️ core/tmdb NO cargado:', err.message);
}

let extractor = null;
try {
    extractor = require('./core/extractor');
    console.log('[server] ✅ extractor cargado');
} catch (err) {
    console.warn('[server] ⚠️ core/extractor NO cargado:', err.message);
}

// ═════════════════════════════════════════════════════════════════
// HEALTH CHECKS
// ═════════════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
    res.status(200).json({ ok: true, uptime: process.uptime(), ts: Date.now() });
});

app.get('/', (_req, res) => res.send('OK'));

// ═════════════════════════════════════════════════════════════════
// GET /api/servers  →  la ruta que usa player.html
// ═════════════════════════════════════════════════════════════════
app.get('/api/servers', async (req, res) => {
    const { id, type } = req.query;

    if (!id || !type) {
        return res.status(400).json({ ok: false, error: 'Faltan parámetros id/type' });
    }

    try {
        let meta = null;
        if (tmdb && typeof tmdb.getMediaInfo === 'function') {
            try {
                meta = await tmdb.getMediaInfo(id, type);
            } catch (e) {
                console.warn('[server] TMDB falló:', e.message);
            }
        }

        const servers = await getSourcesFromProviders(type, id);

        res.json({ ok: true, id, type, meta, servers });
    } catch (err) {
        console.error('[server] /api/servers:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// GET /api/extract?url=...  →  extrae .m3u8 / .mp4 de un embed
// ═════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
    const { url, referer } = req.query; // Recibimos el referer desde el frontend

    if (!url) {
        return res.status(400).json({ error: 'Falta parámetro url' });
    }

    try {
        if (!extractor) {
            return res.json({ error: 'Extractor no disponible' });
        }

        const fn = extractor.extractStream
                || extractor.extract
                || extractor.extractFromUrl
                || extractor.getStream
                || extractor.default;

        if (typeof fn !== 'function') {
            return res.json({ error: 'Extractor sin función extract' });
        }

        // Pasamos el referer al extractor (si tu función lo soporta como segundo parámetro)
        const result = await fn(url, { referer: referer || url });

        if (!result || !result.stream) {
            return res.json({ error: 'No se pudo extraer el stream' });
        }

        res.json({
            stream:  result.stream,
            kind:    result.kind    || 'hls',
            referer: result.referer || referer || url // Devolvemos el referer
        });
    } catch (err) {
        console.error('[server] /api/extract:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// GET /api/proxy  →  RUTA CRÍTICA RECUPERADA E INTEGRADA
// ═════════════════════════════════════════════════════════════════
app.get('/api/proxy', async (req, res) => {
    const urlDestino = req.query.url;
    const refererDestino = req.query.referer || 'https://vimeos.net/';
    
    if (!urlDestino) return res.status(400).send('Falta el parámetro URL');

    try {
        const isM3U8 = urlDestino.includes('.m3u8') || urlDestino.includes('.txt');
        
        const response = await axios({
            method: 'get',
            url: urlDestino,
            responseType: 'arraybuffer', // Siempre arraybuffer
            maxRedirects: 0,             // CRÍTICO: No perder headers en redirecciones
            validateStatus: (status) => status >= 200 && status < 400,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Referer': refererDestino,
                'Origin': 'https://vimeos.net',
                'Accept': '*/*'
            }
        });

        // Manejo manual de redirecciones para mantener el Referer
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const redirectUrl = response.headers.location;
            return res.redirect(`/api/proxy?url=${encodeURIComponent(redirectUrl)}&referer=${encodeURIComponent(refererDestino)}`);
        }

        if (isM3U8) {
            let contenidoM3U8 = Buffer.from(response.data).toString('utf8');
            
            const urlObj = new URL(urlDestino);
            const baseUrl = urlObj.href.substring(0, urlObj.href.lastIndexOf('/') + 1);
            const miProxy = `${req.protocol}://${req.get('host')}/api/proxy`;

            // Reescribir segmentos y llaves
            contenidoM3U8 = contenidoM3U8.replace(/URI="([^"]+)"/g, (match, p1) => {
                try {
                    const urlAbsoluta = new URL(p1, baseUrl).href;
                    return `URI="${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}"`;
                } catch (e) { return match; }
            });

            contenidoM3U8 = contenidoM3U8.split('\n').map(line => {
                const cleanLine = line.trim(); 
                if (cleanLine && !cleanLine.startsWith('#')) {
                    try {
                        const urlAbsoluta = new URL(cleanLine, baseUrl).href;
                        return `${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}`;
                    } catch (e) { return cleanLine; }
                }
                return cleanLine;
            }).join('\n');

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(contenidoM3U8);
        } else {
            res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(Buffer.from(response.data));
        }
    } catch (error) {
        console.error(`[Proxy Error] URL: ${urlDestino.substring(0, 50)}... | Status:`, error.response ? error.response.status : error.message);
        res.status(500).send('Error interno del proxy');
    }
});

// ═════════════════════════════════════════════════════════════════
// POST /api/embed-links  →  alias estilo PlayLatinSRC
// ═════════════════════════════════════════════════════════════════
app.post('/api/embed-links', async (req, res) => {
    const { type, id } = req.body || {};

    if (!type || !id) {
        return res.status(400).json({ ok: false, error: 'Faltan type/id' });
    }

    try {
        const servers = await getSourcesFromProviders(type, id);
        res.json({ ok: true, id, type, servers });
    } catch (err) {
        console.error('[server] /api/embed-links:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// PROTECCIÓN ANTI-CRASH
// ═════════════════════════════════════════════════════════════════
process.on('unhandledRejection', (reason) => {
    console.error('[server] ⚠️ UnhandledRejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('[server] ⚠️ UncaughtException:', err?.message || err);
});

process.on('SIGTERM', () => {
    console.log('[server] SIGTERM recibido, cerrando...');
    process.exit(0);
});

// ═════════════════════════════════════════════════════════════════
// ARRANQUE
// ═════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[server] Servidor escuchando en puerto ${PORT}`);
    console.log(`[server] TMDB_API_KEY ${process.env.TMDB_API_KEY ? 'presente ✅' : 'ausente ❌'}`);
});
