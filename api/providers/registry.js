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

// ─── Providers DESHABILITADOS temporalmente ──────────────────────
// pelixplay usa Puppeteer con stealth y crashea el contenedor
// (512MB de RAM en free tier no alcanza). Lo re-habilitamos cuando
// lo arreglemos.
const SKIP_PROVIDERS = new Set(['pelixplay']);

// ─── Auto-descubre .js de /providers excepto este ───────────────
const PROVIDER_FILES = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.js') && f !== 'registry.js')
    .map(f => f.replace(/\.js$/, ''))
    .filter(f => !SKIP_PROVIDERS.has(f));

console.log('[registry] Providers activos:', PROVIDER_FILES.join(', '));

const KNOWN_LANGS = new Set([
    'latino', 'español', 'espanol', 'castellano',
    'subtitulado', 'sub', 'subtitle', 'subtitles',
    'english', 'ingles', 'original',
]);

// ─── Carga segura ────────────────────────────────────────────────
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

// ─── Timeout por provider ────────────────────────────────────────
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout ${ms}ms en ${label}`)), ms)
        )
    ]);
}

function normalizeResult(result, providerName, byLang) {
    if (!result) return;

    if (typeof result === 'string') {
        byLang.latino[providerName] = result;
        return;
    }

    if (Array.isArray(result)) {
        result.forEach((url, i) => {
            if (url && typeof url === 'string') {
                const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
                byLang.latino[key] = url;
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
        for (const [srvName, url] of Object.entries(result)) {
            if (url && typeof url === 'string') {
                byLang.latino[srvName] = url;
            }
        }
    }
}

async function getSourcesFromProviders(type, id) {
    const byLang = {
        latino: {}, español: {}, castellano: {}, subtitulado: {},
    };

    // 1) TMDB → título y año
    let title = '', year = '';
    if (tmdb && typeof tmdb.getMediaInfo === 'function') {
        try {
            const meta = await withTimeout(tmdb.getMediaInfo(id, type), 8000, 'tmdb');
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

    // 2) Cada provider — SECUENCIAL y con timeout de 12s
    for (const file of PROVIDER_FILES) {
        const provider = safeRequire(file);
        if (!provider) continue;

        const fn = pickResolver(provider);
        if (!fn) {
            console.warn(`[registry] Skip (sin resolver): ${file}`);
            continue;
        }

        const providerName = provider.name || file;

        try {
            console.log(`[registry] ▶ ${file}`);
            const result = await withTimeout(
                fn(title, year, id, type),
                12000,
                file
            );
            normalizeResult(result, providerName, byLang);
            console.log(`[registry] ✅ ${file} OK`);
        } catch (err) {
            console.warn(`[registry] ❌ ${file}:`, err.message);
        }
    }

    Object.keys(byLang).forEach(l => {
        if (!Object.keys(byLang[l]).length) delete byLang[l];
    });

    console.log('[registry] Resultado:', JSON.stringify(byLang).slice(0, 400));
    return byLang;
}

module.exports = { getSourcesFromProviders, PROVIDER_FILES };
