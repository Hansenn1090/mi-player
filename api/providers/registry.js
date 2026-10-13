// api/providers/registry.js
const path = require('path');
const fs = require('fs');

// ─── Providers reales confirmados por el log de Render ───────────
const PROVIDER_FILES = [
    'unlimplay',
    'pelisplushd',
    'pelixplay',
    'poseidonhd2',
    'cineplus123',
];

const VER_ORDER = ['latino', 'español', 'castellano', 'subtitulado'];

// ─── Carga segura: si un provider falla, NO rompe el server ──────
function safeRequire(file) {
    try {
        const full = path.join(__dirname, file + '.js');
        if (!fs.existsSync(full)) {
            console.warn(`[registry] Skip (no existe): ${file}.js`);
            return null;
        }
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

// ─── Detecta qué función tiene el provider para resolver ─────────
function pickResolver(provider) {
    const candidates = ['resolve', 'extract', 'scrape', 'getServers', 'get', 'search'];
    for (const name of candidates) {
        if (typeof provider[name] === 'function') {
            return { fn: provider[name].bind(provider), name };
        }
    }
    return null;
}

async function getSourcesFromProviders(type, id) {
    const byLang = {};
    VER_ORDER.forEach(l => byLang[l] = {});

    for (const file of PROVIDER_FILES) {
        const provider = safeRequire(file);
        if (!provider) continue;

        const resolved = pickResolver(provider);
        if (!resolved) {
            console.warn(`[registry] Skip (sin función resolve/extract): ${file}`);
            continue;
        }

        const providerName = provider.name || file;

        for (const lang of VER_ORDER) {
            try {
                const result = await resolved.fn(id, type, lang);
                if (!result) continue;

                if (typeof result === 'string') {
                    byLang[lang][providerName] = result;
                } else if (Array.isArray(result)) {
                    result.forEach((url, i) => {
                        if (url) {
                            const key = i === 0 ? providerName : `${providerName}_${i + 1}`;
                            byLang[lang][key] = url;
                        }
                    });
                } else if (typeof result === 'object') {
                    Object.entries(result).forEach(([k, v]) => {
                        if (v && typeof v === 'string') byLang[lang][k] = v;
                    });
                }
            } catch (err) {
                console.warn(`[registry] ${file}/${lang}:`, err.message);
            }
        }
    }

    Object.keys(byLang).forEach(l => {
        if (!Object.keys(byLang[l]).length) delete byLang[l];
    });

    console.log('[registry] Idiomas con servidores:', Object.keys(byLang));
    return byLang;
}

module.exports = { getSourcesFromProviders, PROVIDER_FILES };
