// Importamos TODOS los proveedores que tienes en tu carpeta
const { scrapePelispedia } = require('../providers/pelispedia');
const { scrapePelisPlusHD } = require('../providers/pelisplushd');
const { scrapeUnlimplay } = require('../providers/unlimplay');
const { scrapeCinePlus123 } = require('../providers/cineplus123');
const { scrapePelixPlay } = require('../providers/pelixplay');
const { scrapePoseidonHD2 } = require('../providers/poseidonhd2');

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, español: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';
  const year = (info && info.year) || '';

  console.log('[scraper] Iniciando búsqueda en paralelo para:', title, year);

  // Ejecutamos todos los scrapers al mismo tiempo para no tardar 1 minuto
  const promises = [
    { name: 'pelispedia', fn: scrapePelispedia, args: [title, year, type] },
    { name: 'pelisplushd', fn: scrapePelisPlusHD, args: [title] },
    { name: 'unlimplay', fn: scrapeUnlimplay, args: [title, year, type] },
    { name: 'cineplus123', fn: scrapeCinePlus123, args: [title, year, type] },
    { name: 'pelixplay', fn: scrapePelixPlay, args: [title, year, type] },
    { name: 'poseidonhd2', fn: scrapePoseidonHD2, args: [title, year, type] }
  ];

  const results = await Promise.allSettled(
    promises.map(p => {
      // Ejecutamos la función, pero con un timeout de 15 segundos por si se cuelga
      return Promise.race([
        p.fn(...p.args),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
      ]).then(data => ({ name: p.name, data }))
        .catch(err => ({ name: p.name, error: err.message }));
    })
  );

  // Procesamos los resultados
  for (const res of results) {
    if (res.status === 'fulfilled') {
      const { name, data, error } = res.value;
      
      if (error) {
        console.warn(`[scraper] ${name} falló:`, error);
        sources[name] = { ok: false, error };
        continue;
      }

      if (data && Object.keys(data).length > 0) {
        let count = 0;
        // Unimos los servidores encontrados en las categorías correspondientes
        for (const lang of ['latino', 'español', 'subtitulado']) {
          if (data[lang]) {
            Object.assign(servers[lang], data[lang]);
            count += Object.keys(data[lang]).length;
          }
        }
        sources[name] = { ok: true, count };
        console.log(`[scraper] ${name}: ${count} servidores encontrados.`);
      } else {
        sources[name] = { ok: true, count: 0 };
      }
    } else {
      console.warn('[scraper] Un proveedor falló gravemente.');
    }
  }

  // Si no encontramos nada en los anteriores, usamos Xpass como último recurso
  if (tmdbId && Object.keys(servers.latino).length === 0 && Object.keys(servers.español).length === 0) {
    servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    sources.xpass = { ok: true, count: 2 };
    console.log('[scraper] Sin resultados en proveedores. Usando fallback de Xpass.');
  }

  console.log('[scraper] Totales finales:', 
    'Latino:', Object.keys(servers.latino).length,
    'Español:', Object.keys(servers.español).length,
    'Sub:', Object.keys(servers.subtitulado).length
  );

  return { servers, sources };
}

module.exports = { scrapeAll };
