// api/core/scraper.js
'use strict';

// ══════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════
const LANG_ALIASES = {
  'latino': 'latino', 'lat': 'latino',
  'espanol': 'español', 'español': 'español', 'castellano': 'español',
  'sub': 'subtitulado', 'subtitles': 'subtitulado', 'subtitulado': 'subtitulado',
};

function canonicalLang(raw) {
  const l = String(raw || '').toLowerCase().trim();
  return LANG_ALIASES[l] || l;
}

function dummyFn() { return Promise.resolve({}); }

function safeRequire(path, preferredName) {
  try {
    const mod = require(path);
    const fn = mod[preferredName] || mod.default
             || Object.values(mod).find(v => typeof v === 'function');
    return typeof fn === 'function' ? fn : dummyFn;
  } catch (e) {
    // FIX: Ahora avisa en los logs si un archivo falla al cargar (ej. por error de sintaxis)
    console.warn(`[scraper] ❌ Error cargando ${path}:`, e.message);
    return dummyFn;
  }
}

// Providers activos (nombres reales de archivo y función EXACTA)
const PROVIDERS = [
  { name: 'cuevana3gs',   fn: safeRequire('../providers/cuevana3gs',   'scrapeCuevana3Gs') }, // <--- Corregida la G y S
  { name: 'lamovie',      fn: safeRequire('../providers/lamovie',      'scrapeLaMovie') },
  { name: 'cuevana3sc',   fn: safeRequire('../providers/cuevana3sc',   'scrapeCuevana3Sc') },
  { name: 'pelispediais', fn: safeRequire('../providers/pelispediais', 'scrapePelispediaIs') }, // <--- Corregida la I y S
  { name: 'playlatinsrc', fn: safeRequire('../providers/playlatinsrc', 'scrapePlaylatinsrc') },
  { name: 'unlimplay',    fn: safeRequire('../providers/unlimplay',    'scrapeUnlimplay') },
];

// Providers que aceptan (title, year, tmdbId, type, lang)
// Directos reciben (tmdbId, type, lang)
const DIRECT = new Set(['unlimplay', 'playlatinsrc', 'facilitoplay']);

// ══════════════════════════════════════════════════════════════════
// NORMALIZACIÓN
// ══════════════════════════════════════════════════════════════════
function coerceEntry(entry, srvName, providerName) {
  if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
    return { url: entry.url, referer: entry.referer || null, server: entry.server || srvName };
  }
  if (typeof entry === 'string') {
    return { url: entry, referer: null, server: srvName || providerName };
  }
  return null;
}

function mergeInto(servers, data, providerName) {
  if (!data || typeof data !== 'object') return 0;
  let count = 0;

  for (const [rawLang, srvMap] of Object.entries(data)) {
    const lang = canonicalLang(rawLang);
    if (!servers[lang]) servers[lang] = {};

    if (typeof srvMap === 'string') {
      const e = coerceEntry(srvMap, providerName, providerName);
      if (e) { servers[lang][providerName] = e; count++; }
    } else if (Array.isArray(srvMap)) {
      srvMap.forEach((s, i) => {
        const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
        const e = coerceEntry(s, key, providerName);
        if (e) { servers[lang][key] = e; count++; }
      });
    } else if (srvMap && typeof srvMap === 'object') {
      for (const [srvName, entry] of Object.entries(srvMap)) {
        const e = coerceEntry(entry, srvName, providerName);
        if (e) { servers[lang][srvName] = e; count++; }
      }
    }
  }
  return count;
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, 'español': {}, subtitulado: {} };
  const sources = {};

  const tmdbId = String((info && info.tmdbId) || '');
  const title  = (info && info.title) || '';
  const year   = (info && info.year) || '';
  const isSeries = type === 'tv' || type === 'series';

  console.log(`[scraper] "${title}" (${year}) [${type}] en ${PROVIDERS.length} providers`);

  const tasks = PROVIDERS.map(async (p) => {
    const t0 = Date.now();
    try {
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Timeout 12s')), 12000));
      let data;
      if (DIRECT.has(p.name)) {
        data = await Promise.race([p.fn(tmdbId, type, 'latino'), timeout]);
      } else {
        data = await Promise.race([
          p.fn(title, year, tmdbId, isSeries ? 'tv' : 'movie', 'latino'),
          timeout,
        ]);
      }
      return { name: p.name, data, ms: Date.now() - t0 };
    } catch (err) {
      return { name: p.name, error: err.message, ms: Date.now() - t0 };
    }
  });

  const results = await Promise.allSettled(tasks);

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { name, data, error, ms } = r.value;

    if (error) {
      console.warn(`[scraper] ❌ ${name} (${ms}ms): ${error}`);
      sources[name] = { ok: false, error };
      continue;
    }

    const count = mergeInto(servers, data, name);
    sources[name] = { ok: true, count };
    console.log(`[scraper] ${count > 0 ? '✅' : '➖'} ${name} (${ms}ms): ${count} servers`);
  }

  // ── Fallback Xpass ──
  const totalReal = Object.keys(servers.latino).length + Object.keys(servers['español']).length;
  if (tmdbId && totalReal === 0) {
    servers.latino['Xpass'] = {
      url: `https://play.xpass.top/e/${isSeries ? 'tv' : 'movie'}/${tmdbId}`,
      referer: null,
      server: 'xpass',
    };
    servers.subtitulado['Xpass EN'] = {
      url: `https://play.xpass.top/e/${isSeries ? 'tv' : 'movie'}/${tmdbId}`,
      referer: null,
      server: 'xpass',
    };
    sources.xpass = { ok: true, count: 2 };
    console.log('[scraper] ⚠️ Sin resultados reales → fallback Xpass');
  }

  const summary = Object.entries(servers)
    .map(([l, m]) => `${l}:${Object.keys(m).length}`)
    .join(' | ');
  console.log(`[scraper] Total → ${summary}`);
  return { servers, sources };
}

module.exports = { scrapeAll };
