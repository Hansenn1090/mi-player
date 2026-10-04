const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 10000;

// ═══ CONFIGURACIÓN DEL PROXY (CRÍTICO) ═══
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

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

    // Para segmentos .ts o .mp4
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

// ═══ ENDPOINTS DE LA API ═══
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// Importar tus scrapers desde la carpeta API/proveedores
const pelisPedia  = require('./providers/pelispedia');
const pelixplay   = require('./providers/pelixplay');
const cineplus123 = require('./providers/cineplus123');
const poseidonhd2 = require('./providers/poseidonhd2');
const unlimplay   = require('./providers/unlimplay');
const { searchAllProviders } = require('./providers/registry');
const { getTmdbInfo } = require('./centro/tmdb');

app.get('/api/servers', async (req, res) => {
  const { id, type } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  
  try {
    const meta = await getTmdbInfo(id, type || 'movie');
    const servers = await scrapePelisPedia(meta.title, meta.year);
    
    // Filtrar solo los servidores que queremos
    const allowed = ['streamwish', 'vidmoly', 'filelions', 'vidhide'];
    const filtered = { latino: {}, subtitulado: {} };
    
    for (const lang in servers) {
      for (const srv in servers[lang]) {
        const baseName = srv.toLowerCase().replace(/[\s_-]+\d+$/, '');
        if (allowed.includes(baseName)) {
          filtered[lang][srv] = servers[lang][srv];
        }
      }
    }
    
    res.json({ servers: filtered, meta, _source: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/extract', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta url' });
  
  try {
    // Aquí va tu lógica de extracción (puppeteer-extractor.js)
    const { extractStream } = require('./centro/puppeteer-extractor');
    const result = await extractStream(url);
    if (!result || !result.stream) return res.status(404).json({ error: 'No extraído' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🎬 Backend escuchando en puerto ${PORT}`));
