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
try {
  extractorModule = require('./core/puppeteer-extractor');
  console.log('[init] extractor OK. Exports:', Object.keys(extractorModule));
} catch (e) { console.warn('[init] extractor:', e.message); }

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

// ==========================================
// RUTA PRINCIPAL DE SCRAPING (Aquí se unifican todos los proveedores)
// ==========================================
app.get('/api/servers', async (req, res) => {
  const { id, type = 'movie', season = '', episode = '' } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta ?id=' });

  let cached = null;
  try { cached = cache.get(id, type, season, episode); } catch (_) {}
  if (cached && cached._fresh) return res.json({ ...cached, source: 'cache' });

  try {
    console.log(`[api/servers] ${type}/${id} → scraping...`);
    const info = await getMediaInfo(id, type);
    
    // Aquí scrapeAll ejecuta Pelisplus, Pelispedia y Xpass
    const { servers, sources } = await scrapeAll(info, type);

    if (!servers || !Object.keys(servers).length) {
      if (cached) return res.json({ ...cached, source: 'snapshot' });
      return res.json({ servers: {}, meta: info || {}, sources: sources || {}, source: 'empty' });
    }

    const payload = {
      servers,
      meta: {
        tmdbId: id, type,
        title: info.title || '', year: info.year || '',
        poster: info.poster || '', backdrop: info.backdrop || '',
        overview: info.overview || '', runtime: info.runtime || 0,
        genres: info.genres || [], voteAverage: info.voteAverage || 0,
        scrapedAt: Date.now(),
      },
      sources,
    };
    try { cache.set(id, type, season, episode, payload); } catch (_) {}
    console.log('[api/servers] OK:', Object.keys(servers).map(l => `${l}:${Object.keys(servers[l] || {}).length}`).join(' '));
    res.json({ ...payload, source: 'fresh' });
  } catch (err) {
    console.error('[api/servers] Error:', err.message);
    if (cached) return res.json({ ...cached, source: 'snapshot-error' });
    res.json({ servers: {}, meta: { tmdbId: id, type, title: 'Error temporal' }, sources: {}, error: err.message, source: 'error' });
  }
});

// ==========================================
// RUTAS DE EXTRACCIÓN Y PROXY
// ==========================================
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

  if (typeof extractFn !== 'function') return res.json({ error: 'Extractor no disponible', kind: 'iframe' });

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

// Proxy HLS de respaldo (si Cloudflare Worker falla)
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || 'https://play.xpass.top/';
  if (!targetUrl) return res.status(400).send('Falta ?url=');
  try {
    const isM3u8 = /\.m3u8(\?|$)/i.test(targetUrl) || /master\.txt(\?|$)/i.test(targetUrl);
    const axios = require('axios');
    const response = await axios.get(targetUrl, {
      timeout: 20000,
      responseType: isM3u8 ? 'text' : 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer,
        'Origin': new URL(referer).origin,
        'Accept': '*/*',
      },
      maxRedirects: 5,
      validateStatus: s => s >= 200 && s < 400,
    });
    if (isM3u8 && typeof response.data === 'string') {
      let content = response.data;
      const baseUrl = new URL(targetUrl);
      const basePath = baseUrl.origin + baseUrl.pathname.replace(/\/[^\/]*$/, '/');
      content = content.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        let absoluteUrl;
        if (trimmed.startsWith('http')) absoluteUrl = trimmed;
        else if (trimmed.startsWith('//')) absoluteUrl = baseUrl.protocol + trimmed;
        else if (trimmed.startsWith('/')) absoluteUrl = baseUrl.origin + trimmed;
        else absoluteUrl = basePath + trimmed;
        return line.replace(trimmed, '/api/proxy?url=' + encodeURIComponent(absoluteUrl) + '&referer=' + encodeURIComponent(referer));
      }).join('\n');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(content);
    }
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('[proxy] Error:', err.message);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// ==========================================
// SERVIR EL PLAYER HTML
// ==========================================
function findPlayerHtml() {
  const c = [path.join(__dirname, '..', 'player.html'), path.join(__dirname, 'player.html'), path.join(process.cwd(), 'player.html')];
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

app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname)));

// Middleware 404 (SIEMPRE AL FINAL DE LAS RUTAS)
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.originalUrl }));

// ==========================================
// INICIO DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('===========================================');
  console.log('  mi-player listo');
  console.log('  Player:     http://localhost:' + PORT + '/');
  console.log('  Health:     http://localhost:' + PORT + '/api/health');
  console.log('  TMDB:       ' + (process.env.TMDB_API_KEY ? 'OK' : 'FALTA'));
  console.log('  Extractor:  ' + (extractorModule ? 'OK' : 'FALTA'));
  console.log('  Node:       ' + process.version);
  console.log('===========================================');
});
