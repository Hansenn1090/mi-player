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
// ══════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════
const PROVIDER_PRIORITY = [
  'pelispledia',
  'lamovie',
  'cuevana3gs',     // ← NUEVO
  'cuevana3',
  'cuevana',
  'pelisplay',
  'pelispediais',
  'facilitoplay',
  'playlatinsrc',
  'unlimplay',
];

const MULTILANG_PROVIDERS = new Set([
  'cuevana3gs', 'cuevana3', 'cuevana',
  'pelispediais', 'pelisplay',
  'lamovie', 'pelispledia',
]);

const LANG_ALIASES = {
  'espanol': 'castellano',
  'español': 'castellano',
  'sub': 'subtitulado',
  'subtitle': 'subtitulado',
  'subtitles': 'subtitulado',
  'ingles': 'english',
};

function canonicalLang(raw) {
  const l = (raw || '').toLowerCase().trim();
  return LANG_ALIASES[l] || l;
}

// ══════════════════════════════════════════════════════════════════
// NORMALIZACIÓN (ahora acepta string Y objeto {url,referer,server})
// ══════════════════════════════════════════════════════════════════
function coerceEntry(entry, srvName, providerName) {
  if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
    return { url: entry.url, referer: entry.referer || null, server: entry.server || srvName || providerName };
  }
  if (typeof entry === 'string') {
    return { url: entry, referer: null, server: srvName || providerName };
  }
  return null;
}

function normalizeResult(result, providerName, byLang, forceLang = null) {
  if (!result) return;

  // String plano
  if (typeof result === 'string') {
    const lang = canonicalLang(forceLang || 'latino');
    if (!byLang[lang]) byLang[lang] = {};
    byLang[lang][providerName] = { url: result, referer: null, server: providerName };
    return;
  }

  // Array de strings
  if (Array.isArray(result)) {
    result.forEach((url, i) => {
      const e = coerceEntry(url, `${providerName}_${i + 1}`, providerName);
      if (!e) return;
      const lang = canonicalLang(forceLang || 'latino');
      if (!byLang[lang]) byLang[lang] = {};
      const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
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

      if (typeof servers === 'string' || (servers && typeof servers === 'object' && servers.url)) {
        const e = coerceEntry(servers, providerName, providerName);
        if (e) byLang[lang][providerName] = e;
      } else if (Array.isArray(servers)) {
        servers.forEach((srv, i) => {
          const e = coerceEntry(srv, `${providerName}_${i + 1}`, providerName);
          if (!e) return;
          const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
          byLang[lang][key] = e;
        });
      } else if (servers && typeof servers === 'object') {
        for (const [srvName, entry] of Object.entries(servers)) {
          const e = coerceEntry(entry, srvName, providerName);
          if (e) byLang[lang][srvName] = e;
        }
      }
    }
  } else {
    const lang = canonicalLang(forceLang || 'latino');
    if (!byLang[lang]) byLang[lang] = {};
    for (const [srvName, entry] of Object.entries(result)) {
      const e = coerceEntry(entry, srvName, providerName);
      if (e) byLang[lang][srvName] = e;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// LOOP PRINCIPAL — ahora con fast-path multi-idioma
// ══════════════════════════════════════════════════════════════════
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
      const result = await withTimeout(fn(id, type, 'latino'), 6000, file);
      normalizeResult(result, providerName, byLang, 'latino');
      console.log(`[registry] ✅ ${file} OK`);
    } else if (isMulti) {
      // Una sola llamada devuelve todos los idiomas
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
