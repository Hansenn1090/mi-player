// api/providers/registry.js

// Importa TODOS tus proveedores existentes
const unlimplay = require('./unlimplay');
const pelisplushd = require('./pelisplushd');
const pelixplay = require('./pelixplay');
const poseidonhd2 = require('./poseidonhd2');
const cineplus123 = require('./cineplus123');
const cinemaos = require('./cinemaos');
const pelisplus = require('./pelisplus');
const multi = require('./multi');
// ... añade los que falten

const PROVIDERS = [
    unlimplay,
    pelisplushd,
    pelixplay,
    poseidonhd2,
    cineplus123,
    cinemaos,
    pelisplus,
    multi
];

const VER_ORDER = ['latino', 'castellano', 'subtitulado'];

/**
 * Obtiene las fuentes de todos los proveedores, con el mismo formato
 * que PlayLatinSRC espera en el frontend.
 */
async function getSourcesFromProviders(type, id) {
    let allSources = [];

    for (const provider of PROVIDERS) {
        // Verifica que el proveedor tenga la función resolve
        if (typeof provider.resolve !== 'function') continue;

        for (const version of VER_ORDER) {
            try {
                const url = await provider.resolve(id, type, version);
                if (url) {
                    allSources.push({
                        name: provider.name,      // Ej: 'unlimplay', 'dropload'
                        version: version,          // 'latino', 'castellano', etc.
                        url: url,
                        recommended: provider.recommended || false
                    });
                }
            } catch (err) {
                console.error(`[${provider.name}/${version}] Error:`, err.message);
            }
        }
    }

    // ============================================================
    // FUENTE ALTERNATIVA (igual que PlayLatinSRC con ALT_URL)
    // Se añade SIEMPRE al final, sin importar si hay otras fuentes.
    // ============================================================
    const altUrl = `https://unlimplay.com/f/embed/${type}/${id}`;
    allSources.push({
        name: 'unlimplay',
        version: 'latino',
        url: altUrl,
        alt: true // Marca especial para que el frontend sepa que es la alternativa
    });

    return allSources;
}

module.exports = { getSourcesFromProviders };
