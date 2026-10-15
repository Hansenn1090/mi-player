// api/providers/registry.js
const path = require('path');
const fs = require('fs');

// ─── TMDB ────────────────────────────────────────────────────────
let tmdb = null;
try {
  tmdb = require('../core/tmdb');
  console.log('[registry] ✅ tmdb cargado');
} catch (err) {
  console.warn('[registry] ⚠️ core/tmdb NO cargado:', err.message);
}

// ─── Providers DESHABILITADOS (solo los que tienen problemas técnicos reales) ───
// pelixplay:      Puppeteer crashea en Render free tier
// multi:          Timeout excesivo (48s)
// cineplus123:    Cloudflare 403 permanente
// locopelis:      Doble base64 + cifrado AES
// poseidonhd2:    Hosts con anti-bot (requiere Puppeteer)
const SKIP_PROVIDERS = new Set([
  'pelixplay',
  'multi',
  'cineplus123',
  'locopelis',
  'poseidonhd2',
]);

// ─── Providers DIRECTOS (solo necesitan el ID) ───────────────────
const DIRECT_PROVIDERS = new Set(['unlimplay', 'playlatinsrc', 'facilitoplay']);

// ─── ORDEN DE PRIORIDAD ──────────────────────────────────────────
const PROVIDER_PRIORITY = [
  'pelispledia',      // 1º → Vimeos (HLS control total)
  'lamovie',          // 2º → Vimeos server-side (HLS control total)
  'cuevana3',         // 3º → hosts variados
  'cuevana',          // 4º → base64 (Vimeos + hosts variados)
  'pelisplay',        // 5º → hosts base64 (Nupload, VOE)
  'pelispediais',     // 6º → 3 opciones Lat/Cast/Sub
  'facilitoplay',     // 7º → iframe multi-idioma
  'playlatinsrc',     // 8º → iframe multi-idioma
  'unlimplay',        // último → iframe multi-idioma
];

// ─── Auto-descubre + ORDENA por prioridad ────────────────────────
const PROVIDER_FILES = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'registry.js')
  .map(f => f.replace(/\.js$/, ''))
  .filter(f => !SKIP_PROVIDERS.has(f))
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

const KNOWN_LANGS = new Set([
  'latino', 'español', 'espanol', 'castellano',
  'subtitulado', 'sub', 'subtitle', 'subtitles',
  'english', 'ingles', 'original',
]);

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
  const fallbacks = ['resolve', 'extract', 'scrape', 'getServers', 'get'];
  for (const name of fallbacks) {
    if (typeof provider[name] === 'function') return provider[name].bind(provider);
  }
  return null;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)
    )
  ]);
}

function normalizeResult(result, providerName, byLang, forceLang = null) {
  if (!result) return;

  if (typeof result === 'string') {
    const lang = forceLang || 'latino';
    if (!byLang[lang]) byLang[lang] = {};
    byLang[lang][providerName] = result;
    return;
  }

  if (Array.isArray(result)) {
    result.forEach((url, i) => {
      if (url && typeof url === 'string') {
        const lang = forceLang || 'latino';
        if (!byLang[lang]) byLang[lang] = {};
        const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
        byLang[lang][key] = url;
      }
    });
    return;
  }

  if (typeof result !== 'object') return;

  const keys = Object.keys(result);
  const hasLangKeys = keys.some(k => KNOWN_LANGS.has(k.toLowerCase()));

  if (hasLangKeys) {
    for (const [lang, servers] of Object.entries(result)) {
      const langKey = lang.toLowerCase();
      if (!byLang[langKey]) byLang[langKey] = {};

      if (typeof servers === 'string') {
        byLang[langKey][providerName] = servers;
      } else if (Array.isArray(servers)) {
        servers.forEach((url, i) => {
          if (url && typeof url === 'string') {
            const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
            byLang[langKey][key] = url;
          }
        });
      } else if (servers && typeof servers === 'object') {
        for (const [srvName, url] of Object.entries(servers)) {
          if (url && typeof url === 'string') {
            byLang[langKey][srvName] = url;
          }
        }
      }
    }
  } else {
    const lang = forceLang || 'latino';
    if (!byLang[lang]) byLang[lang] = {};
    for (const [srvName, url] of Object.entries(result)) {
      if (url && typeof url === 'string') {
        byLang[lang][srvName] = url;
      }
    }
  }
}

async function getSourcesFromProviders(type, id) {
  const byLang = { latino: {}, español: {}, castellano: {}, subtitulado: {} };
  const t0 = Date.now();

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
    console.warn('[registry] Sin título de TMDB');
    return {};
  }

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

    try {
      if (isDirect) {
        console.log(`[registry] ▶ ${file} (DIRECTO)`);
        const result = await withTimeout(fn(id, type, 'latino'), 6000, file);
        normalizeResult(result, providerName, byLang, 'latino');
        console.log(`[registry] ✅ ${file} OK`);
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
            normalizeResult(result, providerName, byLang);
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

  Object.keys(byLang).forEach(l => {
    if (!Object.keys(byLang[l]).length) delete byLang[l];
  });

  const elapsed = Date.now() - t0;
  const total = Object.values(byLang).reduce((sum, l) => sum + Object.keys(l).length, 0);
  console.log(`[registry] ⏱️ ${elapsed}ms — ${total} servidores totales`);
  console.log('[registry] Resultado:', JSON.stringify(byLang).slice(0, 600));
  return byLang;
}

module.exports = { getSourcesFromProviders, PROVIDER_FILES, DIRECT_PROVIDERS };
