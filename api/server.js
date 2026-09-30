// ══════════════════════════════════════════════════════════════════════════
// mi-player — API + Player
// CommonJS (require) — NO usar import/export
// ══════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ── Imports internos ──────────────────────────────────────────────────────
let scrapeAll, getMediaInfo, cache;

try {
  ({ scrapeAll } = require('./core/scraper'));
} catch (e) {
  console.error('[init] No se pudo cargar core/scraper.js:', e.message);
  scrapeAll = async () => ({ servers: {}, sources: [] });
}

try {
  ({ getMediaInfo } = require('./core/tmdb'));
} catch (e) {
  console.error('[init] No se pudo cargar core/tmdb.js:', e.message);
  getMediaInfo = async (id) => ({ tmdbId: id, title: 'Sin info' });
}

try {
  cache = require('./core/cache');
  // Asegurar que cache tenga get/set
  if (typeof cache.get !== 'function') cache.get = () => null;
  if (typeof cache.set !== 'function') cache.set = () => {};
} catch (e) {
  console.error('[init] No se pudo cargar core/cache.js:', e.message);
  cache = { get: () => null, set: () => {} };
}

// Extractor de Puppeteer — requerido en top level, no dentro del handler
let extractorModule = null;
try {
  extractorModule = require('./core/puppeteer-extractor');
} catch (e) {
  console.warn('[init] puppeteer-extractor.js no disponible:', e.message);
}

// ══════════════════════════════════════════════════════════════════════════
// App
// ══════════════════════════════════════════════════════════════════════════
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Logging básico
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`[${req.method}] ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ══════════════════════════════════════════════════════════════════════════
// 1. HEALTH
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    tmdb: !!process.env.TMDB_API_KEY,
    extractor: !!extractorModule,
    time: new Date().toISOString(),
    node: process.version,
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. /api/servers — Scraper + TMDB
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/servers', async (req, res) => {
  const { id, type = 'movie', season = '', episode = '' } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Falta ?id=<tmdbId>' });
  }

  // Cache
  let cached = null;
  try { cached = cache.get(id, type, season, episode); } catch (_) {}

  if (cached && cached._fresh) {
    console.log(`[api/servers] ${type}/${id} → cache`);
    return res.json({ ...cached, source: 'cache' });
  }

  try {
    console.log(`[api/servers] ${type}/${id} → scraping...`);

    const info = await getMediaInfo(id, type);
    const { servers, sources } = await scrapeAll(info, type);

    if (!servers || !Object.keys(servers).length) {
      if (cached) return res.json({ ...cached, source: 'snapshot' });
      return res.json({
        servers: {},
        meta: info || {},
        sources: sources || [],
        source: 'empty',
      });
    }

    const payload = {
      servers,
      meta: {
        tmdbId: id,
        type,
        title:       info.title       || '',
        year:        info.year        || '',
        poster:      info.poster      || '',
        backdrop:    info.backdrop    || '',
        overview:    info.overview    || '',
        runtime:     info.runtime     || 0,
        genres:      info.genres      || [],
        voteAverage: info.voteAverage || 0,
        scrapedAt:   Date.now(),
      },
      sources,
    };

    try { cache.set(id, type, season, episode, payload); } catch (_) {}

    console.log('[api/servers] OK:');
    Object.keys(servers).forEach(lang => {
      console.log(`  ${lang}: ${Object.keys(servers[lang]).length} servidores`);
    });

    res.json({ ...payload, source: 'fresh' });
  } catch (err) {
    console.error('[api/servers] Error:', err.message);
    if (cached) return res.json({ ...cached, source: 'snapshot-error' });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. /api/extract — Puppeteer extractor
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'Falta ?url=<embedUrl>', kind: 'iframe' });
  }

  if (!extractorModule) {
    return res.json({ error: 'Extractor no cargado', kind: 'iframe' });
  }

  // Detectar el nombre de la función exportada
  const extractFn =
    (typeof extractorModule === 'function' ? extractorModule : null) ||
    extractorModule.extractM3u8 ||
    extractorModule.extractStream ||
    extractorModule.extract ||
    extractorModule.resolveEmbed ||
    extractorModule.default;

  if (typeof extractFn !== 'function') {
    console.warn('[api/extract] Función no encontrada en puppeteer-extractor.js');
    console.warn('[api/extract] Exports disponibles:', Object.keys(extractorModule));
    return res.json({ error: 'Extractor no disponible', kind: 'iframe' });
  }

  try {
    console.log('[api/extract] Extrayendo:', url);
    const result = await extractFn(url);

    if (!result || !result.stream) {
      console.log('[api/extract] Sin stream para:', url);
      return res.json({ error: 'Sin stream extraíble', kind: 'iframe' });
    }

    console.log('[api/extract] OK:', result.kind, result.stream.slice(0, 80) + '...');
    res.json({
      stream:  result.stream,
      kind:    result.kind || 'hls',
      referer: result.referer || url,
    });
  } catch (e) {
    console.error('[api/extract] Error:', e.message);
    res.json({ error: e.message, kind: 'iframe' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. /api/tmdb — Proxy opcional para TMDB (así la key no sale al navegador)
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/tmdb', async (req, res) => {
  const { id, type = 'movie', lang = 'es-ES' } = req.query;
  const key = process.env.TMDB_API_KEY;

  if (!id) return res.status(400).json({ error: 'Falta ?id=' });
  if (!key) return res.status(500).json({ error: 'TMDB_API_KEY no configurada' });

  try {
    const axios = require('axios');
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${key}&language=${lang}`;
    const r = await axios.get(url, { timeout: 10000 });
    res.json(r.data);
  } catch (e) {
    console.error('[api/tmdb] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 5. SERVIR EL PLAYER (múltiples ubicaciones posibles)
// ══════════════════════════════════════════════════════════════════════════
function findPlayerHtml() {
  const candidates = [
    path.join(__dirname, '..', 'player.html'),   // /player.html (raíz del repo)
    path.join(__dirname, 'player.html'),          // /api/player.html
    path.join(process.cwd(), 'player.html'),      // cwd
    path.join(process.cwd(), '..', 'player.html'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

app.get('/', (req, res) => {
  const p = findPlayerHtml();
  if (!p) return res.status(404).send('<h1>player.html no encontrado</h1>');
  res.sendFile(p);
});

app.get('/player.html', (req, res) => {
  const p = findPlayerHtml();
  if (!p) return res.status(404).send('<h1>player.html no encontrado</h1>');
  res.sendFile(p);
});

// Servir estáticos (CSS, JS, imágenes)
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname)));

// ══════════════════════════════════════════════════════════════════════════
// 6. 404 Catch-all
// ══════════════════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. ARRANQUE
// ══════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ mi-player listo                                        ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Player:      http://localhost:${PORT}/                     ║`);
  console.log(`║  Health:      http://localhost:${PORT}/api/health           ║`);
  console.log(`║  Servers:     http://localhost:${PORT}/api/servers?id=X     ║`);
  console.log(`║  Extract:     http://localhost:${PORT}/api/extract?url=X    ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  TMDB_KEY:    ${process.env.TMDB_API_KEY ? '✅ configurada' : '❌ FALTA'}`);
  console.log(`║  Extractor:   ${extractorModule ? '✅ cargado' : '❌ no disponible'}`);
  console.log(`║  Node:        ${process.version}`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});

// Cierre limpio
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM recibido, cerrando...');
  server.close(() => process.exit(0));
});
