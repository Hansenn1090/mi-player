// api/providers/registry.js
const path = require('path');
const fs = require('fs');

// ─── TMDB (para obtener título/año antes de llamar a los providers) ───
let tmdb = null;
try {
    tmdb = require('../core/tmdb');
    console.log('[registry] ✅ tmdb cargado');
} catch (err) {
    console.warn('[registry] ⚠️ core/tmdb NO cargado:', err.message);
}

// ─── Auto-descubre TODOS los .js de /providers excepto este ──────
const PROVIDER_FILES = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.js') && f !== 'registry.js')
    .map(f => f.replace(/\.js$/, ''));

// Idiomas que reconocemos como claves dentro de un resultado
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
        console.log(`[registry] ✅ ${file} cargado`);
        return mod;
    } catch (err) {
        console.warn(`[registry] ❌ Error cargando ${file}:`, err.message);
        return null;
    }
}

// ─── Detecta la función correcta del provider ────────────────────
// Prioridad: search > scrapeX > resolve > extract > scrape > getServers
function pickResolver(provider) {
    // 1) search explícita
    if (typeof provider.search === 'function') return provider.search.bind(provider);

    // 2) Función que empiece con "scrape"
    for (const key of Object.keys(provider)) {
        if (/^scrape/i.test(key) && typeof provider[key] === 'function') {
            return provider[key].bind(provider);
        }
    }

    // 3) Nombres clásicos
    const fallbacks = ['resolve', 'extract', 'scrape', 'getServers', 'get'];
    for (const name of fallbacks) {
        if (typeof provider[name] === 'function') return provider[name].bind(provider);
    }

    return null;
}

// ─── Normaliza el resultado de un provider a { lang: { serverName: url } } ─
function normalizeResult(result, providerName, byLang) {
    if (!result) return;

    // String suelto → latino
    if (typeof result === 'string') {
        byLang.latino[providerName] = result;
        return;
    }

    // Array → latino con índices
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

    // ¿Es un objeto con idiomas como claves?
    const keys = Object.keys(result);
    const hasLangKeys = keys.some(k => KNOWN_LANGS.has(k.toLowerCase()));

    if (hasLangKeys) {
        // { latino: { StreamWish: url, FileLions: url }, español: {...} }
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
        // { StreamWish: url, FileLions: url } → asignar a latino
        for (const [srvName, url] of Object.entries(result)) {
            if (url && typeof url === 'string') {
                byLang.latino[srvName] = url;
            }
        }
    }
}

// ═════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═════════════════════════════════════════════════════════════════
async function getSourcesFromProviders(type, id) {
    const byLang = {
        latino: {}, español: {}, castellano: {}, subtitulado: {},
    };

    // 1) Obtener metadata de TMDB → título y año
    let title = '', year = '';
    if (tmdb && typeof tmdb.getMediaInfo === 'function') {
        try {
            const meta = await tmdb.getMediaInfo(id, type);
            title = meta.title || '';
            year = String(meta.year || '');
            console.log(`[registry] TMDB: "${title}" (${year})`);
        } catch (e) {
            console.warn('[registry] TMDB falló:', e.message);
        }
    }

    if (!title) {
        console.warn('[registry] Sin título de TMDB, no se puede buscar en providers');
        return {};
    }

    // 2) Llamar a cada provider con la firma real (title, year, id, type)
    for (const file of PROVIDER_FILES) {
        const provider = safeRequire(file);
        if (!provider) continue;

        const fn = pickResolver(provider);
        if (!fn) {
            console.warn(`[registry] Skip (sin función search/scrape/resolve): ${file}`);
            continue;
        }

        const providerName = provider.name || file;

        try {
            console.log(`[registry] ▶ ${file}(${title}, ${year}, ${id}, ${type})`);
            const result = await fn(title, year, id, type);
            normalizeResult(result, providerName, byLang);
        } catch (err) {
            console.warn(`[registry] ❌ ${file}:`, err.message);
        }
    }

    // 3) Limpiar idiomas vacíos
    Object.keys(byLang).forEach(l => {
        if (!Object.keys(byLang[l]).length) delete byLang[l];
    });

    console.log('[registry] Resultado final:', JSON.stringify(byLang).slice(0, 500));
    return byLang;
}

module.exports = { getSourcesFromProviders, PROVIDER_FILES };
