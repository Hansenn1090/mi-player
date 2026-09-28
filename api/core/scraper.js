const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(__dirname, '..', 'debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

const http = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  validateStatus: s => s >= 200 && s < 400,
  headers: {
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  },
});

function trySelectors($, list) {
  for (const sel of list) {
    try {
      const r = $(sel);
      if (r.length) return { sel, r };
    } catch {}
  }
  return null;
}

function dumpDebug(provider, html, reason) {
  const file = path.join(DEBUG_DIR, `${provider}_${reason}_${Date.now()}.html`);
  try { fs.writeFileSync(file, html); } catch {}
  console.warn(`[debug] ${provider} (${reason}) guardado en ${file}`);
}

// ─── Detectar tipo de servidor según la URL ────────────────────────
function detectServerType(url) {
  if (!url) return 'iframe';
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.(mp4|webm|mkv|mov|ts)(\?|$)/i.test(url)) return 'mp4';
  return 'iframe';
}

async function findDetailUrl(provider, base, title, type) {
  const searchUrl = provider.buildSearchUrl.call({ mirrors: [{ base }] }, null, type, title);
  const { data: html } = await http.get(searchUrl, {
    headers: { 'User-Agent': pickUA(), 'Referer': base + '/' },
  });

  const $ = cheerio.load(html);
  const linkSel = type === 'tv'
    ? (provider.selectors.tvLink || provider.selectors.movieLink)
    : provider.selectors.movieLink;

  const found = trySelectors($, linkSel);
  if (!found) { dumpDebug(provider.key, html, 'no_results'); return null; }

  let href = found.r.first().attr('href');
  if (!href) return null;
  if (href.startsWith('//')) href = 'https:' + href;
  else if (href.startsWith('/')) href = base + href;
  return href;
}

async function scrapeProvider(provider, info, type) {
  const t0 = Date.now();
  const result = { provider: provider.key, servers: [], error: null };

  const mirror = [...provider.mirrors].sort((a, b) => b.weight - a.weight)[0];
  const base = mirror.base;

  try {
    const detailUrl = await findDetailUrl(provider, base, info.title, type);
    if (!detailUrl) throw new Error('detail URL no encontrada');

    const { data: detailHtml } = await http.get(detailUrl, {
      headers: { 'User-Agent': pickUA(), 'Referer': base },
    });

    const $d = cheerio.load(detailHtml);
    const rawServers = provider.parseDetail($d);

    if (!rawServers.length) {
      dumpDebug(provider.key, detailHtml, 'no_servers');
      throw new Error('0 servidores en la pagina');
    }

    for (const srv of rawServers) {
      try {
        const url = await provider.resolveEmbed(srv, { http, pickUA, mirror });
        if (!url) continue;

        const serverType = detectServerType(url);

        result.servers.push({
          name: srv.name,
          lang: srv.lang || 'latino',
          url: url,
          type: serverType,
        });

        console.log(`  [${provider.key}] "${srv.name}" → ${serverType.toUpperCase()}`);

      } catch (e) {
        console.warn(`[${provider.key}] resolveEmbed: ${e.message}`);
      }
    }

    if (!result.servers.length) throw new Error('0 servidores resueltos');
    const hlsCount = result.servers.filter(s => s.type === 'hls' || s.type === 'mp4').length;
    const iframeCount = result.servers.length - hlsCount;
    console.log(`[${provider.key}] ✓ ${result.servers.length} servidores (${hlsCount} HLS/MP4, ${iframeCount} iframe) en ${Date.now() - t0}ms`);
  } catch (err) {
    result.error = err.message;
    console.warn(`[${provider.key}] ✗ ${err.message}`);
  }

  return result;
}

async function scrapeAll(info, type) {
  const registry = require('../providers/registry');
  const entries = Object.entries(registry).filter(([_, p]) => p.enabled);

  const results = await Promise.allSettled(
    entries.map(([_, p]) => scrapeProvider(p, info, type))
  );

  const byLang = { latino: {}, castellano: {}, subtitulado: {} };
  const sources = {};

  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const { provider, servers, error } = r.value;
    sources[provider] = { ok: !error, count: servers.length, error: error || null };

    servers.forEach(s => {
      if (!byLang[s.lang]) byLang[s.lang] = {};
      // Prefijar el nombre con [HLS] o [IFRAME] para que el player sepa cómo tratarlo
      const prefixedName = `[${s.type.toUpperCase()}] ${s.name}`;
      byLang[s.lang][prefixedName] = s.url;
    });
  });

  Object.keys(byLang).forEach(k => {
    if (!Object.keys(byLang[k]).length) delete byLang[k];
  });

  return { servers: byLang, sources };
}

module.exports = { scrapeAll, scrapeProvider };
