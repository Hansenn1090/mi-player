const cineplus123 = require('./cineplus123');
const poseidonhd2 = require('./poseidonhd2');
const pelisPedia  = require('./pelispedia');
const pelixplay   = require('./pelixplay');
const unlimplay   = require('./unlimplay');

const PROVIDERS = [
  { name: 'pelixplay',   module: pelixplay,   priority: 1 },
  { name: 'pelispedia',  module: pelisPedia,  priority: 2 },
  { name: 'cineplus123', module: cineplus123, priority: 3 },
  { name: 'poseidonhd2', module: poseidonhd2, priority: 4 },
  { name: 'unlimplay',   module: unlimplay,   priority: 5 },
];

const ALLOWED_SERVERS = ['streamwish', 'vidmoly', 'filelions', 'vidhide'];

function isAllowedServer(name) {
  const base = String(name).toLowerCase().replace(/[\s_-]+\d+$/, '');
  if (['hglink', 'flaswish', 'wishfast', 'awish'].includes(base)) return true;
  if (['minochinos', 'vidhidepro', 'callistanise', 'hgcloud'].includes(base)) return true;
  return ALLOWED_SERVERS.includes(base);
}

async function searchAllProviders(title, year, tmdbId, type) {
  const allResults = { latino: {}, subtitulado: {} };
  const sorted = [...PROVIDERS].sort((a, b) => a.priority - b.priority);

  for (const provider of sorted) {
    if (!provider.module || typeof provider.module.search !== 'function') {
      console.warn(`[registry] ${provider.name} no tiene search, saltando...`);
      continue;
    }
    try {
      console.log(`[registry] Consultando ${provider.name}...`);
      const result = await provider.module.search(title, year, tmdbId, type);
      if (!result) continue;

      for (const lang of ['latino', 'subtitulado']) {
        if (result[lang]) {
          for (const [serverName, url] of Object.entries(result[lang])) {
            if (isAllowedServer(serverName) && !allResults[lang][serverName]) {
              allResults[lang][serverName] = url;
            }
          }
        }
      }
      if (Object.keys(allResults.latino).length >= 3) break;
    } catch (err) {
      console.error(`[registry] Error en ${provider.name}:`, err.message);
    }
  }

  console.log('[registry] Resultado:', Object.keys(allResults.latino));
  return allResults;
}

module.exports = { searchAllProviders, isAllowedServer };
