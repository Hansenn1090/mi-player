const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 10000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ═══ PROXY (CRÍTICO para reproducir sin errores CORS) ═══
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || targetUrl;
  if (!targetUrl) return res.status(400).send('Falta url');

  try {
    const parsedReferer = new URL(referer);
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': referer,
        'Origin': parsedReferer.origin,
        'Accept': '*/*',
        'Range': req.headers.range || 'bytes=0-',
      },
    });

    if (!response.ok) return res.status(response.status).send('Error upstream');

    const contentType = response.headers.get('content-type') || '';
    const urlLower = targetUrl.toLowerCase();
    const isM3u8 = urlLower.includes('.m3u8') || urlLower.includes('master.txt') || contentType.includes('mpegurl');

    if (isM3u8) {
      const text = await response.text();
      const baseUrl = new URL(targetUrl);
      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
            try {
              const abs = new URL(uri, baseUrl).href;
              return `URI="/api/proxy?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
            } catch { return `URI="${uri}"`; }
          });
        }
        try {
          const abs = new URL(trimmed, baseUrl).href;
          return `/api/proxy?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}`;
        } catch { return line; }
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(rewritten);
    }

    res.setHeader('Content-Type', contentType || 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
    if (response.headers.get('content-range')) {
      res.setHeader('Content-Range', response.headers.get('content-range'));
      res.status(206);
    }
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[proxy] Error:', err.message);
    res.status(500).send('Error proxy: ' + err.message);
  }
});

// ═══ HEALTH ═══
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ═══ IMPORTS (rutas correctas según tu repo) ═══
const { searchAllProviders } = require('./providers/registry');
const { getTmdbInfo } = require('./core/tmdb');

// ═══ /api/servers ═══
app.get('/api/servers', async (req, res) => {
  const { id, type } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });

  try {
    const meta = await getTmdbInfo(id, type || 'movie');
    const servers = await searchAllProviders(meta.title, meta.year, id, type || 'movie');
    res.json({ servers, meta, _source: 'live' });
  } catch (err) {
    console.error('[servers] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ /api/extract ═══
app.get('/api/extract', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta url' });

  try {
    const { extractStream } = require('./core/puppeteer-extractor');
    const result = await extractStream(url);
    if (!result || !result.stream) return res.status(404).json({ error: 'No extraído' });
    res.json(result);
  } catch (err) {
    console.error('[extract] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ START ═══
app.listen(PORT, () => console.log(`🎬 Backend escuchando en puerto ${PORT}`));
