// ==========================================
// CARGA SEGURA DE PROVEEDORES
// ==========================================
// Función de respaldo por si un proveedor falla al cargar o no exporta la función
const dummyFn = async () => ({});

function safeRequire(path, preferredName) {
  try {
    const mod = require(path);
    // Busca la función por el nombre que le pasamos, o por 'default', o la primera función que encuentre
    const fn = mod[preferredName] || mod.default || Object.values(mod).find(v => typeof v === 'function');
    if (typeof fn === 'function') {
      return fn;
    } else {
      console.warn(`[scraper] El archivo ${path} no exporta una función válida.`);
      return dummyFn;
    }
  } catch (e) {
    console.warn(`[scraper] No se pudo cargar ${path}:`, e.message);
    return dummyFn;
  }
}

// Cargamos todos los proveedores de forma segura
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

  console.log(`[scraper] Iniciando búsqueda en paralelo para: ${title} (${year})`);

  // Ejecutamos todos los scrapers al mismo tiempo para no tardar 1 minuto
  const promises = providers.map(p => {
    // Ejecutamos la función, pero con un timeout de 15 segundos por si se cuelga
    return Promise.race([
      p.fn(title, year, type),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 15s')), 15000))
    ]).then(data => ({ name: p.name, data }))
      .catch(err => ({ name: p.name, error: err.message }));
  });

  const results = await Promise.allSettled(promises);

  // Procesamos los resultados
  for (const res of results) {
    if (res.status === 'fulfilled') {
      const { name, data, error } = res.value;
      
      if (error) {
        console.warn(`[scraper] ❌ ${name} falló:`, error);
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
        console.log(`[scraper] ✅ ${name}: ${count} servidores encontrados.`);
      } else {
        sources[name] = { ok: true, count: 0 };
        console.log(`[scraper] ➖ ${name}: 0 servidores.`);
      }
    } else {
      console.warn('[scraper] Un proveedor falló gravemente.');
    }
  }

  // ==========================================
  // RESPALDO GARANTIZADO: XPASS
  // ==========================================
  // Si no encontramos nada en los anteriores, usamos Xpass como último recurso
  if (tmdbId && Object.keys(servers.latino).length === 0 && Object.keys(servers.español).length === 0) {
    servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    sources.xpass = { ok: true, count: 2 };
    console.log('[scraper] ⚠️ Sin resultados en otros proveedores. Usando fallback de Xpass.');
  }

  console.log('[scraper] Totales finales:', 
    'Latino:', Object.keys(servers.latino).length,
    'Español:', Object.keys(servers.español).length,
    'Sub:', Object.keys(servers.subtitulado).length
  );

  return { servers, sources };
}

module.exports = { scrapeAll };
