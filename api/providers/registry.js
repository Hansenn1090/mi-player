// ══════════════════════════════════════════════════════════════════════════
// Importar todos los proveedores
// ══════════════════════════════════════════════════════════════════════════
const cineplus123 = require('./cineplus123');
const poseidonhd2 = require('./poseidonhd2');
const pelisPedia  = require('./pelispedia');
const pelixplay   = require('./pelixplay');
const unlimplay   = require('./unlimplay');

// ══════════════════════════════════════════════════════════════════════════
// Lista de proveedores ordenados por prioridad
// El primero en la lista se consulta primero
// ══════════════════════════════════════════════════════════════════════════
const PROVIDERS = [
  { name: 'pelixplay',   module: pelixplay,   priority: 1 },
  { name: 'pelispedia',  module: pelisPedia,  priority: 2 },
  { name: 'cineplus123', module: cineplus123, priority: 3 },
  { name: 'poseidonhd2', module: poseidonhd2, priority: 4 },
  { name: 'unlimplay',   module: unlimplay,   priority: 5 },
];

// ══════════════════════════════════════════════════════════════════════════
// Servidores finales permitidos (los que se reproducen con HLS nativo)
// ══════════════════════════════════════════════════════════════════════════
const ALLOWED_SERVERS = ['streamwish', 'vidmoly', 'filelions', 'vidhide'];

function isAllowedServer(name) {
  const base = String(name).toLowerCase().replace(/[\s_-]+\d+$/, '');
  if (['hglink', 'flaswish', 'wishfast', 'awish'].includes(base)) return true;
  if (['minochinos', 'vidhidepro', 'callistanise', 'hgcloud'].includes(base)) return true;
  return ALLOWED_SERVERS.includes(base);
}

// ══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: Busca en todos los proveedores y combina resultados
// ══════════════════════════════════════════════════════════════════════════
async function searchAllProviders(title, year, tmdbId, type) {
  const allResults = { latino: {}, subtitulado: {} };
  const sorted = [...PROVIDERS].sort((a, b) => a.priority - b.priority);

  for (const provider of sorted) {
    // Verificar que el módulo tenga la función search
    if (!provider.module || typeof provider.module.search !== 'function') {
      console.warn(`[registry] ${provider.name} no tiene función search, saltando...`);
      continue;
    }

    try {
      console.log(`[registry] Consultando ${provider.name}...`);
      const result = await provider.module.search(title, year, tmdbId, type);

      if (!result) {
        console.log(`[registry] ${provider.name} sin resultados`);
        continue;
      }

      // Combinar resultados por idioma
      for (const lang of ['latino', 'subtitulado']) {
        if (result[lang] && typeof result[lang] === 'object') {
          for (const [serverName, url] of Object.entries(result[lang])) {
            // Solo aceptar los servidores de la lista blanca
            if (isAllowedServer(serverName) && !allResults[lang][serverName]) {
              allResults[lang][serverName] = url;
            }
          }
        }
      }

      // Si ya tenemos suficientes resultados, dejar de buscar
      if (Object.keys(allResults.latino).length >= 3) {
        console.log(`[registry] Suficientes resultados, deteniendo búsqueda`);
        break;
      }
    } catch (err) {
      console.error(`[registry] Error en ${provider.name}:`, err.message);
      // Continuar con el siguiente proveedor
    }
  }

  console.log(`[registry] Resultado final:`, {
    latino: Object.keys(allResults.latino),
    subtitulado: Object.keys(allResults.subtitulado),
  });

  return allResults;
}

// ══════════════════════════════════════════════════════════════════════════
// EXPORTAR
// ══════════════════════════════════════════════════════════════════════════
module.exports = {
  searchAllProviders,
  isAllowedServer,
  PROVIDERS,
};
