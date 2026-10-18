// api/providers/registry.js
'use strict';

const fs = require('fs');

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
  'cuevana',
  'Cuevana',       
  'cinemaos',      
  'cuevana3',      
]);

const DIRECT_PROVIDERS = new Set([
  'unlimplay',
  'playlatinsrc',
  'facilitoplay',
]);

const MULTILANG_PROVIDERS = new Set([
  'cinehax',       
  'cuevana3gs',    
  'cuevana3sc',    
  'pelispediais', 
  'pelisplay',
  'lamovie',
]);

const PROVIDER_PRIORITY = [
  'cinehax',       
  'cuevana3gs',    
  'pelispedia',
  'lamovie',
  'cuevana3sc',
  'pelisplay',
  'pelispediais',
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

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════
function safeRequire(file) {
  try {
    const mod = require('./' + file);
    if (!mod || typeof mod !== 'object') return null;
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
// NORMALIZACIÓN
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

  if (typeof result === 'string') {
    const lang = canonicalLang(forceLang || 'latino');
    if (!byLang[lang]) byLang[lang] = {};
    byLang[lang][providerName] = { url: result, referer: null, server: providerName };
    return;
  }

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

  if (hasLangKeys) {
    for (const [rawLang, servers] of Object.entries(result)) {
      const lang = canonicalLang(rawLang);
      if (!byLang[lang]) byLang[lang] = {};

      if (typeof servers === 'string' || (servers && typeof servers === 'object' && typeof servers.url === 'string')) {
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

  const lang = canonicalLang(forceLang || 'latino');
  if (!byLang[lang]) byLang[lang] = {};
  for (const [srvName, entry] of Object.entries(result)) {
    const e = coerceEntry(entry, srvName, providerName);
    if (e) byLang[lang][srvName] = e;
  }
}

// ══════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════════════
async function getSourcesFromProviders(type, id) {
  const byLang = { latino: {}, 'español': {}, subtitulado: {} };
  const t0 = Date.now();

  let title = '', year = '';
  if (tmdb && typeof tmdb.getMediaInfo === 'function') {
    try {
      const meta = await withTimeout(tmdb.getMediaInfo(id, type), 6000, 'tmdb');
      title = meta.title || meta.original_title || '';
      year = String(meta.year || '');
      console.log(`[registry] TMDB: "${title}" (${year})`);
    } catch (e) {
      console.warn('[registry] TMDB falló:', e.message);
    }
  }

  if (!title) {
    console.warn('[registry] Sin título de TMDB. Se intentará buscar con ID si es compatible.');
  }

  for (const file of PROVIDER_FILES) {
    const provider = safeRequire(file);
    if (!provider) continue;

    const fn = pickResolver(provider);
    if (!fn) continue;

    const providerName = provider.name || file;
    const isDirect = DIRECT_PROVIDERS.has(file);
    const isMulti = MULTILANG_PROVIDERS.has(file);

    try {
      if (isDirect) {
        console.log(`[registry] ▶ ${file} (DIRECTO)`);
        const result = await withTimeout(fn(id, type, 'latino'), 8000, file);
        normalizeResult(result, providerName, byLang, 'latino');
      } else if (isMulti) {
        console.log(`[registry] ▶ ${file} (multi-idioma)`);
        const result = await withTimeout(
          fn(title, year, id, type, 'latino'),
          15000,
          file
        );
        normalizeResult(result, providerName, byLang);
      } else {
        const LANGS = ['latino', 'castellano', 'subtitulado'];
        for (const lang of LANGS) {
          try {
            console.log(`[registry] ▶ ${file} (${lang})`);
            const result = await withTimeout(
              fn(title, year, id, type, lang),
              8000,
              `${file}/${lang}`
            );
            normalizeResult(result, providerName, byLang, lang);
          } catch (langErr) {
            console.warn(`[registry] ⚠️ ${file}/${lang}:`, langErr.message);
          }
        }
      }
    } catch (err) {
      console.warn(`[registry] ❌ ${file}:`, err.message);
    }
  }

  for (const l of Object.keys(byLang)) {
    if (!Object.keys(byLang[l]).length) delete byLang[l];
  }

  const elapsed = Date.now() - t0;
  const total = Object.values(byLang).reduce((s, l) => s + Object.keys(l).length, 0);
  console.log(`[registry] ⏱️ ${elapsed}ms — ${total} servidores totales`);

  return byLang;
}

module.exports = {
  getSourcesFromProviders,
  PROVIDER_FILES,
  DIRECT_PROVIDERS,
  MULTILANG_PROVIDERS,
  PROVIDER_PRIORITY,
};
