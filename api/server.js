require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeAll } = require('./core/scraper');
const { getMediaInfo } = require('./core/tmdb');
const cache = require('./core/cache');

const app = express();
app.use(cors());
app.use(express.json());

// ══════════════════════════════════════════════════════════════════════════
// 1. ENDPOINT PRINCIPAL: /api/servers
//    Recibe un TMDB ID y devuelve los servidores scrapeados + meta de TMDB
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/servers', async (req, res) => {
  const { id, type = 'movie', season = '', episode = '' } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta ?id=<tmdbId>' });

  const cached = cache.get(id, type, season, episode);
  if (cached && cached._fresh) {
    console.log(`[api] ${type}/${id} -> cache`);
    return res.json({ ...cached, source: 'cache' });
  }

  try {
    console.log(`[api] ${type}/${id} -> scraping...`);
    const info = await getMediaInfo(id, type);
    const { servers, sources } = await scrapeAll(info, type);

    if (!Object.keys(servers).length) {
      if (cached) return res.json({ ...cached, source: 'snapshot' });
      return res.json({ servers: {}, meta: { info }, sources, source: 'empty' });
    }

    const payload = {
      servers,
      meta: {
        tmdbId: id, type,
        title: info.title, year: info.year,
        poster: info.poster, backdrop: info.backdrop,
        overview: info.overview, runtime: info.runtime,
        genres: info.genres, voteAverage: info.voteAverage,
        scrapedAt: Date.now(),
      },
      sources,
    };
    cache.set(id, type, season, episode, payload);
    console.log('[api] OK - servidores:');
    Object.keys(servers).forEach(lang => {
      console.log(`  ${lang}: ${Object.keys(servers[lang]).length}`);
    });
    res.json({ ...payload, source: 'fresh' });
  } catch (err) {
    console.error('[api]', err.message);
    if (cached) return res.json({ ...cached, source: 'snapshot-error' });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 2. ENDPOINT: /api/extract
//    Recibe una URL de embed y devuelve el stream limpio (m3u8/mp4)
//    Usa puppeteer-extractor.js para renderizar el embed y capturar la red
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta ?url=', kind: 'iframe' });

  try {
    const extractor = require('./core/puppeteer-extractor');

    // Probar varios nombres de función exportada por si cambia
    const extractFn =
      extractor.extractM3u8 ||
      extractor.extractStream ||
      extractor.extract ||
      extractor.default ||
      (typeof extractor === 'function' ? extractor : null);

    if (typeof extractFn !== 'function') {
      console.warn('[api/extract] No se encontró función exportada en puppeteer-extractor.js');
      return res.json({ error: 'Extractor no disponible', kind: 'iframe' });
    }

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
// 3. ENDPOINT: /api/health
//    Devuelve el estado del servidor
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    tmdb: !!process.env.TMDB_API_KEY,
    time: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. SERVIR EL PLAYER EN LA RAÍZ
//    Cuando el usuario abre https://mi-player.onrender.com/
//    → se sirve el player.html que está en la raíz del repo
// ══════════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'player.html'));
});

// Alias: /player.html también funciona
app.get('/player.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'player.html'));
});

// ══════════════════════════════════════════════════════════════════════════
// 5. INICIAR SERVIDOR
// ══════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ mi-player listo:`);
  console.log(`   Player:      http://localhost:${PORT}/`);
  console.log(`   API:         http://localhost:${PORT}/api/servers?id=734253&type=movie`);
  console.log(`   Extractor:   http://localhost:${PORT}/api/extract?url=<embed_url>`);
  console.log(`   Health:      http://localhost:${PORT}/api/health\n`);
});
