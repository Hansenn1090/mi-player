// api/server.js
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ─── Imports seguros (si algo falla, no crashea) ────────────────
let getSourcesFromProviders = async () => ({});
try {
    ({ getSourcesFromProviders } = require('./providers/registry'));
    console.log('[server] registry cargado');
} catch (err) {
    console.error('[server] registry NO cargado:', err.message);
}

let tmdb = null;
try {
    tmdb = require('./core/tmdb');
    console.log('[server] tmdb cargado');
} catch (err) {
    console.warn('[server] core/tmdb NO cargado:', err.message);
}

let extractor = null;
try {
    extractor = require('./core/extractor');
    console.log('[server] extractor cargado');
} catch (err) {
    console.warn('[server] core/extractor NO cargado:', err.message);
}

// ─── Health check ────────────────────────────────────────────────
app.get('/', (_req, res) => res.send('OK'));

// ═════════════════════════════════════════════════════════════════
// /api/servers  → la ruta que usa tu player.html
// ═════════════════════════════════════════════════════════════════
app.get('/api/servers', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) {
        return res.status(400).json({ ok: false, error: 'Faltan parámetros id/type' });
    }

    try {
        // 1) Metadata desde TMDB
        let meta = null;
        if (tmdb) {
            try {
                const fn = tmdb.getMeta || tmdb.getDetails || tmdb.fetchMeta ||
                           tmdb.getMovie || tmdb.get;
                if (typeof fn === 'function') {
                    meta = await fn(id, type);
                } else {
                    console.warn('[server] tmdb no tiene función getMeta/getDetails/fetchMeta');
                }
            } catch (e) {
                console.warn('[server] TMDB falló:', e.message);
            }
        }

        // 2) Servidores desde los providers
        const servers = await getSourcesFromProviders(type, id);

        res.json({ ok: true, id, type, meta, servers });
    } catch (err) {
        console.error('[server] /api/servers:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// /api/extract  → extrae .m3u8 / .mp4 de un embed
// ═════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ ok: false, error: 'Falta url' });
    }

    try {
        if (!extractor) {
            return res.json({ error: 'Extractor no disponible' });
        }
        const fn = extractor.extract || extractor.extractStream ||
                   extractor.extractFromUrl || extractor.default;
        if (typeof fn !== 'function') {
            return res.json({ error: 'Extractor sin función extract' });
        }
        const result = await fn(url);
        if (!result || !result.stream) {
            return res.json({ error: 'No se pudo extraer' });
        }
        res.json({
            stream:  result.stream,
            kind:    result.kind    || 'hls',
            referer: result.referer || url,
        });
    } catch (err) {
        console.error('[server] /api/extract:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// /api/embed-links  → alias estilo PlayLatinSRC (POST)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en :${PORT}`));
