// api/server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());

// ═════════════════════════════════════════════════════════════════
// STATIC — sirve player.html desde donde esté
// (tu Dockerfile hace: COPY api/ ./ y COPY player.html ./ → /app)
// ═════════════════════════════════════════════════════════════════
const staticDirs = [
    __dirname,                            // /app  ← tu caso
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
        // ─── 1) Metadata desde TMDB ───────────────────────────
        let meta = null;
        if (tmdb && typeof tmdb.getMediaInfo === 'function') {
            try {
                meta = await tmdb.getMediaInfo(id, type);
            } catch (e) {
                console.warn('[server] TMDB falló:', e.message);
            }
        }

        // ─── 2) Servidores desde los providers ────────────────
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
    const url = req.query.url;

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
