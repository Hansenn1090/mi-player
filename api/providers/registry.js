// api/providers/registry.js
const path = require('path');
const fs = require('fs');

// ─── Lista los providers que TENGAS en la carpeta ────────────────
// (Ajusta si alguno se llama distinto en tu repo)
const PROVIDER_FILES = [
    'unlimplay',
    'pelisplushd',
    'pelixplay',
    'poseidonhd2',
    'cineplus123',
    'cinemaos',
    'multi',
    // 'pelisphd',   // ← descomenta si existe con ese nombre
];

const VER_ORDER = ['latino', 'español', 'castellano', 'subtitulado'];

// ─── Carga segura: si un provider falla, no rompe el server ──────
function safeRequire(file) {
    try {
        const full = path.join(__dirname, file + '.js');
        if (!fs.existsSync(full)) {
            console.warn(`[registry] Skip: no existe ${file}.js`);
            return null;
        }
        const mod = require('./' + file);
        if (!mod || typeof mod !== 'object') {
            console.warn(`[registry] Skip: ${file} no exporta un objeto`);
            return null;
        }
        return mod;
    } catch (err) {
        console.warn(`[registry] Error cargando ${file}:`, err.message);
        return null;
    }
}

// ─── Detecta qué función tiene el provider para resolver ─────────
function pickResolver(provider) {
    // Acepta cualquiera de estos nombres comunes
    if (typeof provider.resolve === 'function') return provider.resolve.bind(provider);
    if (typeof provider.extract === 'function') return provider.extract.bind(provider);
    if (typeof provider.scrape  === 'function') return provider.scrape.bind(provider);
    if (typeof provider.getServers === 'function') return provider.getServers.bind(provider);
    if (typeof provider.get === 'function') return provider.get.bind(provider);
    return null;
}

/**
 * Llama a cada provider y unifica las fuentes.
 * Devuelve el MISMO formato que ya usa tu player:
 *   { latino: { vimeos: url, streamwish: url }, español: {...}, ... }
 * NO devuelve un array plano (eso era lo que asumí antes y probablemente
 * rompe la compatibilidad con tu frontend actual).
 */
async function getSourcesFromProviders(type, id) {
    const byLang = {}; // { latino: { providerName: url, ... }, ... }
    VER_ORDER.forEach(l => byLang[l] = {});

    for (const file of PROVIDER_FILES) {
        const provider = safeRequire(file);
        if (!provider) continue;

        const resolver = pickResolver(provider);
        if (!resolver) {
            console.warn(`[registry] ${file}: no tiene resolve/extract/scrape`);
            continue;
        }

        const providerName = provider.name || file;

        for (const lang of VER_ORDER) {
            try {
                const result = await resolver(id, type, lang);

                // Aceptamos varios formatos de retorno
                if (!result) continue;

                if (typeof result === 'string') {
                    byLang[lang][providerName] = result;
                } else if (Array.isArray(result)) {
                    result.forEach((url, i) => {
                        if (url) byLang[lang][providerName + (i > 0 ? ('_' + (i + 1)) : '')] = url;
                    });
                } else if (typeof result === 'object') {
                    Object.entries(result).forEach(([k, v]) => {
                        if (v) byLang[lang][k] = v;
                    });
                }
            } catch (err) {
                // Silencioso: un provider caído no afecta a los demás
                console.warn(`[registry] ${file}/${lang}:`, err.message);
            }
        }
    }

    // Quita idiomas vacíos
    Object.keys(byLang).forEach(l => {
        if (!Object.keys(byLang[l]).length) delete byLang[l];
    });

    return byLang;
}

module.exports = { getSourcesFromProviders, PROVIDER_FILES };
