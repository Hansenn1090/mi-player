const multi = require('./multi');

const PROVIDERS = [
  { name: 'multi', module: multi, priority: 1 },
];

const ALLOWED_SERVERS = ['streamwish', 'vidmoly', 'filelions', 'vidhide'];

function isAllowedServer(name) {
  const base = String(name).toLowerCase().replace(/[\s_-]+\d+$/, '');
  if (['hglink', 'flaswish', 'wishfast', 'awish', 'embedwish'].includes(base)) return true;
  if (['minochinos', 'vidhidepro', 'callistanise', 'hgcloud'].includes(base)) return true;
  return ALLOWED_SERVERS.includes(base);
}

async function searchAllProviders(title, year, tmdbId, type) {
  const allResults = { latino: {}, subtitulado: {} };

  for (const provider of PROVIDERS) {
    if (!provider.module || typeof provider.module.search !== 'function') continue;
    try {
      const result = await provider.module.search(title, year, tmdbId, type);
      if (!result) continue;

      for (const lang of ['latino', 'subtitulado']) {
        if (result[lang]) {
          for (const [name, url] of Object.entries(result[lang])) {
            if (isAllowedServer(name) && !allResults[lang][name]) {
              allResults[lang][name] = url;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[registry] Error en ${provider.name}:`, err.message);
    }
  }

  console.log('[registry] Resultado final:', Object.keys(allResults.latino));
  return allResults;
}

module.exports = { searchAllProviders, isAllowedServer };
