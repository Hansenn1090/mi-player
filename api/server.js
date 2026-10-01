require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

let scrapeAll, getMediaInfo, cache;
try { ({ scrapeAll } = require('./core/scraper')); } catch (e) { scrapeAll = async () => ({ servers: {}, sources: {} }); }
try { ({ getMediaInfo } = require('./core/tmdb')); } catch (e) { getMediaInfo = async (id) => ({ tmdbId: id, title: 'Sin info' }); }
try { cache = require('./core/cache'); } catch (e) { cache = { get: () => null, set: () => {} }; }

let extractorModule = null;
try { extractorModule = require('./core/puppeteer-extractor'); } catch (e) {}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => console.log(`[${req.method}] ${req.originalUrl} → ${res.statusCode} (${Date.now() - t0}ms)`));
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), tmdb: !!process.env.TMDB_API_KEY, extractor: !!extractorModule, node: process.version });
});

// ⚠️ /api/servers NUNCA devuelve 500
app.get('/api/servers', async (req, res) => {
  const { id, type = 'movie', season = '', episode = '' } = req.query;

  if (!id) {
    return res.json({ servers: {}, meta: {}, sources: {}, error: 'Falta ?id=' });
  }

  let cached = null;
  try { cached = cache.get(id, type, season, episode); } catch (_) {}
  if (cached && cached._fresh) return res.json({ ...cached, source: 'cache' });

  try {
    console.log(`[api/servers] ${type}/${id} → scraping...`);

    const info = await getMediaInfo(id, type);

    // ⚠️ info SIEMPRE tiene title (nunca null)
    let scrapeResult = { servers: {}, sources: {} };
    try {
      scrapeResult = await scrapeAll(info, type);
    } catch (e) {
      console.warn('[api/servers] scrapeAll error:', e.message);
    }

    const { servers = {}, sources = {} } = scrapeResult;

    const payload = {
      servers: servers || {},
      meta: {
        tmdbId: id, type,
        title: info.title || '',
        year: info.year || '',
        poster: info.poster || '',
        backdrop: info.backdrop || '',
        overview: info.overview || '',
        runtime: info.runtime || 0,
        genres: info.genres || [],
        voteAverage: info.voteAverage || 0,
      },
      sources: sources || {},
    };

    try { cache.set(id, type, season, episode, payload); } catch (_) {}

    console.log('[api/servers] OK:', Object.keys(payload.servers).map(l => `${l}:${Object.keys(payload.servers[l] || {}).length}`).join(' '));

    res.json({ ...payload, source: 'fresh' });
  } catch (err) {
    console.error('[api/servers] Error:', err.message);
    // ⚠️ Aunque falle, devolvemos 200 con error para que el player no crashee
    res.json({
      servers: {},
      meta: { tmdbId: id, type, title: 'Error temporal' },
      sources: {},
      error: err.message,
      source: 'error',
    });
  }
});

app.get('/api/extract', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta ?url=', kind: 'iframe' });
  if (!extractorModule) return res.json({ error: 'Extractor no cargado', kind: 'iframe' });

  const extractFn =
    (typeof extractorModule === 'function' ? extractorModule : null) ||
    extractorModule.extractM3u8FromEmbed ||
    extractorModule.extractM3u8 ||
    extractorModule.extractStream ||
    extractorModule.extract ||
    extractorModule.default;

  if (typeof extractFn !== 'function') {
    return res.json({ error: 'Extractor no disponible', kind: 'iframe' });
  }

  try {
    console.log('[api/extract] Extrayendo:', url);
    const result = await extractFn(url);
    if (!result || !result.stream) return res.json({ error: 'Sin stream', kind: 'iframe' });
    console.log('[api/extract] OK:', result.kind);
    res.json({ stream: result.stream, kind: result.kind || 'hls', referer: result.referer || url });
  } catch (e) {
    console.error('[api/extract]', e.message);
    res.json({ error: e.message, kind: 'iframe' });
  }
});

function findPlayerHtml() {
  const c = [path.join(__dirname, '..', 'player.html'), path.join(__dirname, 'player.html')];
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return null;
}
app.get('/', (req, res) => {
  const p = findPlayerHtml();
  if (!p) return res.status(404).send('player.html no encontrado');
  res.sendFile(p);
});
app.get('/player.html', (req, res) => {
  const p = findPlayerHtml();
  if (!p) return res.status(404).send('player.html no encontrado');
  res.sendFile(p);
});

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.originalUrl }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('===========================================');
  console.log('  mi-player listo');
  console.log('  TMDB:       ' + (process.env.TMDB_API_KEY ? 'OK' : 'FALTA'));
  console.log('  Extractor:  ' + (extractorModule ? 'OK' : 'FALTA'));
  console.log('  Node:       ' + process.version);
  console.log('===========================================');
});
