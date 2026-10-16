// api/providers/registry.js
'use strict';

const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════
// TMDB
// ══════════════════════════════════════════════════════════════════
let tmdb = null;
try {
  tmdb = require('../core/tmdb');
  console.log('[registry] ✅ tmdb cargado');
} catch (err) {
  console.warn('[registry] ⚠️ core/tmdb NO cargado:', err.message);
}

// ══════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════
const SKIP_PROVIDERS = new Set([
  'pelixplay',
  'multi',
  'cineplus123',
  'locopelis',
  'poseidonhd2',
  'pelisplushd',
  'cuevana',        // ← dominio cuevana.sc muerto (ENOTFOUND)
  'Cuevana',        // ← duplicado con mayúscula
  'cinemaos',       // ← no usado
]);

const MULTILANG_PROVIDERS = new Set([
  'cuevana3gs', 'cuevana3sc', 'cuevana3',
  'pelispediais', 'pelisplay',
  'lamovie', 'pelispledia',
]);

const PROVIDER_PRIORITY = [
  'pelispledia',
  'lamovie',
  'cuevana3gs',
  'cuevana3sc',     // ← NUEVO
  'cuevana3',
  'pelisplay',
  'pelispediais',
  'facilitoplay',
  'playlatinsrc',
  'unlimplay',
];

const KNOWN_LANGS = new Set([
  'latino', 'español', 'espanol', 'castellano',
  'subtitulado', 'sub', 'subtitle', 'subtitles',
  'english', 'ingles', 'original',
]);

const LANG_ALIASES = {
  'espanol':   'español',
  'castellano':'español',
  'sub':       'subtitulado',
  'subtitle':  'subtitulado',
  'subtitles': 'subtitulado',
  'ingles':    'english',
};

function canonicalLang(raw) {
  const l = String(raw || '').toLowerCase().trim();
  return LANG_ALIASES[l] || l;
}

// ══════════════════════════════════════════════════════════════════
// AUTO-DISCOVERY
// ══════════════════════════════════════════════════════════════════
const PROVIDER_FILES = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'registry.js')
  .map(f => f.replace(/\.js$/, ''))
  .filter(f => !SKIP_PROVIDERS.has(f))
  .filter(f => !f.startsWith('_'))
  .sort((a, b) => {
    const ia = PROVIDER_PRIORITY.indexOf(a);
    const ib = PROVIDER_PRIORITY.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

console.log('[registry] Providers activos (en orden):', PROVIDER_FILES.join(' → '));
console.log('[registry] Providers directos:', Array.from(DIRECT_PROVIDERS).join(', '));
console.log('[registry] Providers multi-idioma:', Array.from(MULTILANG_PROVIDERS).join(', '));

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════
function safeRequire(file) {
  try {
    const mod = require('./' + file);
    if (!mod || typeof mod !== 'object') {
      console.warn(`[registry] Skip (no exporta objeto): ${file}`);
      return null;
    }
    return mod;
  } catch (err) {
    console.warn(`[registry] ❌ Error cargando ${file}:`, err.message);
    return null;
  }
}

function pickResolver(provider) {
  if (typeof provider.search === 'function') return provider.search.bind(provider);
  for (const key of Object.keys(provider)) {
    if (/^scrape/i.test(key) && typeof provider[key] === 'function') {
      return provider[key].bind(provider);
    }
  }
  for (const name of ['resolve', 'extract', 'scrape', 'getServers', 'get']) {
    if (typeof provider[name] === 'function') return provider[name].bind(provider);
  }
  return null;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout ${ms}ms en ${label}`)), ms)
    ),
  ]);
}

// ══════════════════════════════════════════════════════════════════
// NORMALIZACIÓN — acepta string Y { url, referer, server }
// ══════════════════════════════════════════════════════════════════
function coerceEntry(entry, srvName, providerName) {
  if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
    return {
      url: entry.url,
      referer: entry.referer || null,
      server: entry.server || srvName || providerName,
    };
  }
  if (typeof entry === 'string') {
    return { url: entry, referer: null, server: srvName || providerName };
  }
  return null;
}

function normalizeResult(result, providerName, byLang, forceLang = null) {
  if (!result) return;

  // ── String plano ─────────────────────────────────────────────
  if (typeof result === 'string') {
    const lang = canonicalLang(forceLang || 'latino');
    if (!byLang[lang]) byLang[lang] = {};
    byLang[lang][providerName] = { url: result, referer: null, server: providerName };
    return;
  }

  // ── Array ────────────────────────────────────────────────────
  if (Array.isArray(result)) {
    result.forEach((item, i) => {
      const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
      const e = coerceEntry(item, key, providerName);
      if (!e) return;
      const lang = canonicalLang(forceLang || 'latino');
      if (!byLang[lang]) byLang[lang] = {};
      byLang[lang][key] = e;
    });
    return;
  }

  if (typeof result !== 'object') return;

  const keys = Object.keys(result);
  const hasLangKeys = keys.some(k => KNOWN_LANGS.has(k.toLowerCase()));

  // ── Objeto con idiomas: { latino: {...}, castellano: {...} } ─
  if (hasLangKeys) {
    for (const [rawLang, servers] of Object.entries(result)) {
      const lang = canonicalLang(rawLang);
      if (!byLang[lang]) byLang[lang] = {};

      // servers puede ser string, {url}, array, u objeto {srvName: url}
      if (typeof servers === 'string'
          || (servers && typeof servers === 'object' && typeof servers.url === 'string')) {
        const e = coerceEntry(servers, providerName, providerName);
        if (e) byLang[lang][providerName] = e;
      } else if (Array.isArray(servers)) {
        servers.forEach((srv, i) => {
          const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
          const e = coerceEntry(srv, key, providerName);
          if (e) byLang[lang][key] = e;
        });
      } else if (servers && typeof servers === 'object') {
        for (const [srvName, entry] of Object.entries(servers)) {
          const e = coerceEntry(entry, srvName, providerName);
          if (e) byLang[lang][srvName] = e;
        }
      }
    }
    return;
  }

  // ── Objeto plano sin idiomas: { srvName: url } ───────────────
  const lang = canonicalLang(forceLang || 'latino');
  if (!byLang[lang]) byLang[lang] = {};
  for (const [srvName, entry] of Object.entries(result)) {
    const e = coerceEntry(entry, srvName, providerName);
    if (e) byLang[lang][srvName] = e;
  }
}

// ══════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL (async, aquí SÍ se permite await)
// ══════════════════════════════════════════════════════════════════
async function getSourcesFromProviders(type, id) {
  const byLang = { latino: {}, 'español': {}, subtitulado: {} };
  const t0 = Date.now();

  // 1) Resolver título/año vía TMDB
  let title = '', year = '';
  if (tmdb && typeof tmdb.getMediaInfo === 'function') {
    try {
      const meta = await withTimeout(tmdb.getMediaInfo(id, type), 6000, 'tmdb');
      title = meta.title || '';
      year = String(meta.year || '');
      console.log(`[registry] TMDB: "${title}" (${year})`);
    } catch (e) {
      console.warn('[registry] TMDB falló:', e.message);
    }
  }

  if (!title) {
    console.warn('[registry] Sin título de TMDB, abortando');
    return {};
  }

  // 2) Loop secuencial sobre providers (con fast-path multi-idioma)
  for (const file of PROVIDER_FILES) {
    const provider = safeRequire(file);
    if (!provider) continue;

    const fn = pickResolver(provider);
    if (!fn) {
      console.warn(`[registry] Skip (sin resolver): ${file}`);
      continue;
    }

    const providerName = provider.name || file;
    const isDirect = DIRECT_PROVIDERS.has(file);
    const isMulti = MULTILANG_PROVIDERS.has(file);

    try {
      if (isDirect) {
        console.log(`[registry] ▶ ${file} (DIRECTO)`);
        const result = await withTimeout(fn(id, type, 'latino'), 8000, file);
        normalizeResult(result, providerName, byLang, 'latino');
        console.log(`[registry] ✅ ${file} OK`);
      } else if (isMulti) {
        console.log(`[registry] ▶ ${file} (multi-idioma)`);
        const result = await withTimeout(
          fn(title, year, id, type, 'latino'),
          12000,
          file
        );
        normalizeResult(result, providerName, byLang);
        if (result) console.log(`[registry] ✅ ${file} OK`);
      } else {
        const LANGS = ['latino', 'castellano', 'subtitulado'];
        let anyOk = false;
        for (const lang of LANGS) {
          try {
            console.log(`[registry] ▶ ${file} (${lang})`);
            const result = await withTimeout(
              fn(title, year, id, type, lang),
              8000,
              `${file}/${lang}`
            );
            if (result) anyOk = true;
            normalizeResult(result, providerName, byLang, lang);
          } catch (langErr) {
            console.warn(`[registry] ⚠️ ${file}/${lang}:`, langErr.message);
          }
        }
        if (anyOk) console.log(`[registry] ✅ ${file} OK`);
      }
    } catch (err) {
      console.warn(`[registry] ❌ ${file}:`, err.message);
    }
  }

  // 3) Limpieza de buckets vacíos
  for (const l of Object.keys(byLang)) {
    if (!Object.keys(byLang[l]).length) delete byLang[l];
  }

  const elapsed = Date.now() - t0;
  const total = Object.values(byLang).reduce((s, l) => s + Object.keys(l).length, 0);
  console.log(`[registry] ⏱️ ${elapsed}ms — ${total} servidores totales`);
  console.log('[registry] Resultado:', JSON.stringify(byLang).slice(0, 600));

  return byLang;
}

// ══════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════
module.exports = {
  getSourcesFromProviders,
  PROVIDER_FILES,
  DIRECT_PROVIDERS,
  MULTILANG_PROVIDERS,
  PROVIDER_PRIORITY,
};
