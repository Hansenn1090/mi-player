require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scrapeAll } = require('./core/scraper');
const { getMediaInfo } = require('./core/tmdb');
const cache = require('./core/cache');

const app = express();
app.use(cors());
app.use(express.json());

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
    console.log(`[api] OK - servidores:`);
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), tmdb: !!process.env.TMDB_API_KEY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nAPI lista en http://localhost:${PORT}`);
  console.log(`Prueba: http://localhost:${PORT}/api/servers?id=550&type=movie\n`);
});