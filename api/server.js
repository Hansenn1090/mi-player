// api/server.js
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ═════════════════════════════════════════════════════════════════
// IMPORTS SEGUROS — si un módulo falla, el server arranca igual
// ═════════════════════════════════════════════════════════════════

// Registry (proveedores)
let getSourcesFromProviders = async () => ({});
try {
    ({ getSourcesFromProviders } = require('./providers/registry'));
    console.log('[server] ✅ registry cargado');
} catch (err) {
    console.error('[server] ❌ registry NO cargado:', err.message);
}

// TMDB (metadata)
let tmdb = null;
try {
    tmdb = require('./core/tmdb');
    console.log('[server] ✅ tmdb cargado');
} catch (err) {
    console.warn('[server] ⚠️ core/tmdb NO cargado:', err.message);
}

// Extractor (HLS/MP4)
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

// Render usa /api/health según tu render.yaml
app.get('/api/health', (_req, res) => {
    res.status(200).json({
        ok: true,
        uptime: process.uptime(),
        ts: Date.now()
    });
});

// Health check raíz
app.get('/', (_req, res) => res.send('OK'));

// ═════════════════════════════════════════════════════════════════
// GET /api/servers  →  la ruta que usa tu player.html
// Devuelve: { ok, id, type, meta, servers: { latino:{...}, español:{...} } }
// ═════════════════════════════════════════════════════════════════
app.get('/api/servers', async (req, res) => {
    const { id, type } = req.query;

    if (!id || !type) {
        return res.status(400).json({ ok: false, error: 'Faltan parámetros id/type' });
    }

    try {
        // ─── 1) Metadata desde TMDB ───────────────────────────
        let meta = null;
        if (tmdb) {
            try {
                // Busca la función correcta de forma defensiva
                const fn = tmdb.getMeta
                        || tmdb.getDetails
                        || tmdb.fetchMeta
                        || tmdb.getMovie
                        || tmdb.getInfo
                        || tmdb.get;

                if (typeof fn === 'function') {
                    meta = await fn(id, type);
                } else {
                    console.warn('[server] tmdb no expone getMeta/getDetails/fetchMeta');
                }
            } catch (e) {
                console.warn('[server] TMDB falló:', e.message);
            }
        }

        // ─── 2) Servidores desde los providers ────────────────
        const servers = await getSourcesFromProviders(type, id);

        res.json({
            ok: true,
            id,
            type,
            meta,
            servers
        });
    } catch (err) {
        console.error('[server] /api/servers:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// GET /api/extract?url=...  →  extrae .m3u8 / .mp4 de un embed
// Devuelve: { stream, kind, referer }
// ═════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: 'Falta parámetro url' });
    }

    try {
        if (!extractor) {
            return res.json({ error: 'Extractor no disponible' });
        }

        // Busca la función correcta de forma defensiva
        const fn = extractor.extract
                || extractor.extractStream
                || extractor.extractFromUrl
                || extractor.getStream
                || extractor.default;

        if (typeof fn !== 'function') {
            return res.json({ error: 'Extractor sin función extract' });
        }

        const result = await fn(url);

        if (!result || !result.stream) {
            return res.json({ error: 'No se pudo extraer el stream' });
        }

        res.json({
            stream:  result.stream,
            kind:    result.kind    || 'hls',
            referer: result.referer || url
        });
    } catch (err) {
        console.error('[server] /api/extract:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═════════════════════════════════════════════════════════════════
// POST /api/embed-links  →  alias estilo PlayLatinSRC
// Body: { type, id }
// Devuelve: { ok, id, type, servers }
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
// ARRANQUE
// ═════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[server] Servidor escuchando en puerto ${PORT}`);
    console.log(`[server] TMDB_API_KEY ${process.env.TMDB_API_KEY ? 'presente ✅' : 'ausente ❌'}`);
});
