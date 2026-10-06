// ==========================================
// CARGA SEGURA DE PROVEEDORES
// ==========================================
// Función de respaldo por si un proveedor falla al cargar
const dummyFn = async () => ({});

function safeRequire(path, preferredName) {
  try {
    const mod = require(path);
    const fn = mod[preferredName] || mod.default || Object.values(mod).find(v => typeof v === 'function');
    if (typeof fn === 'function') return fn;
    console.warn(`[scraper] ${path} no exporta una función válida.`);
    return dummyFn;
  } catch (e) {
    console.warn(`[scraper] No se pudo cargar ${path}:`, e.message);
    return dummyFn;
  }
}

// Cargamos todos los proveedores. Si alguno falla, usa dummyFn y no rompe el servidor.
const providers = [
  { name: 'pelispedia', fn: safeRequire('../providers/pelispedia', 'scrapePelispedia') },
  { name: 'pelisplushd', fn: safeRequire('../providers/pelisplushd', 'scrapePelisPlusHD') },
  { name: 'unlimplay', fn: safeRequire('../providers/unlimplay', 'scrapeUnlimplay') },
  { name: 'cineplus123', fn: safeRequire('../providers/cineplus123', 'scrapeCinePlus123') },
  { name: 'pelixplay', fn: safeRequire('../providers/pelixplay', 'scrapePelixPlay') },
  { name: 'poseidonhd2', fn: safeRequire('../providers/poseidonhd2', 'scrapePoseidonHD2') }
];

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, español: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';
  const year = (info && info.year) || '';

  console.log(`[scraper] Buscando "${title}" (${year}) en ${providers.length} proveedores...`);

  // Ejecutamos todos los scrapers al mismo tiempo con un límite de 15 segundos
  const promises = providers.map(p => 
    Promise.race([
      p.fn(title, year, type),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 15s')), 15000))
    ])
    .then(data => ({ name: p.name, data }))
    .catch(err => ({ name: p.name, error: err.message }))
  );

  const results = await Promise.allSettled(promises);

  // Procesamos los resultados de cada proveedor
  for (const res of results) {
    if (res.status === 'fulfilled') {
      const { name, data, error } = res.value;
      
      if (error) {
        console.warn(`[scraper] ❌ ${name}: ${error}`);
        sources[name] = { ok: false, error };
        continue;
      }

      if (data && Object.keys(data).length > 0) {
        let count = 0;
        // Unimos los servidores en latino, español o subtitulado
        for (const lang of ['latino', 'español', 'subtitulado']) {
          if (data[lang]) {
            Object.assign(servers[lang], data[lang]);
            count += Object.keys(data[lang]).length;
          }
        }
        sources[name] = { ok: true, count };
        console.log(`[scraper] ✅ ${name}: ${count} servidores encontrados.`);
      } else {
        sources[name] = { ok: true, count: 0 };
        console.log(`[scraper] ➖ ${name}: 0 servidores.`);
      }
    }
  }

  // ==========================================
  // RESPALDO GARANTIZADO: XPASS
  // ==========================================
  // Si no se encontró nada en latino ni español, usamos Xpass.
  if (tmdbId && Object.keys(servers.latino).length === 0 && Object.keys(servers.español).length === 0) {
    servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    sources.xpass = { ok: true, count: 2 };
    console.log('[scraper] ⚠️ Sin resultados en otros proveedores. Usando fallback de Xpass.');
  }

  console.log(`[scraper] Totales finales → Latino: ${Object.keys(servers.latino).length} | Español: ${Object.keys(servers.español).length} | Sub: ${Object.keys(servers.subtitulado).length}`);

  return { servers, sources };
}

module.exports = { scrapeAll };
