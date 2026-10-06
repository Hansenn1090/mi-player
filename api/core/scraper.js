const dummyFn = async () => ({});

function safeRequire(path, preferredName) {
  try {
    const mod = require(path);
    const fn = mod[preferredName] || mod.default || Object.values(mod).find(v => typeof v === 'function');
    if (typeof fn === 'function') return fn;
    return dummyFn;
  } catch (e) {
    return dummyFn;
  }
}

// ⚠️ Eliminamos cineplus123 porque su dominio ya no existe (ENOTFOUND)
const providers = [
  { name: 'pelispedia', fn: safeRequire('../providers/pelispedia', 'scrapePelispedia') },
  { name: 'pelisplushd', fn: safeRequire('../providers/pelisplushd', 'scrapePelisPlusHD') },
  { name: 'unlimplay', fn: safeRequire('../providers/unlimplay', 'scrapeUnlimplay') },
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

  // ⚠️ Aumentamos el timeout a 30 segundos para dar tiempo a Puppeteer
  const promises = providers.map(p => 
    Promise.race([
      p.fn(title, year, type),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 30s')), 30000))
    ])
    .then(data => ({ name: p.name, data }))
    .catch(err => ({ name: p.name, error: err.message }))
  );

  const results = await Promise.allSettled(promises);

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
        for (const lang of ['latino', 'español', 'subtitulado']) {
          if (data[lang] && Object.keys(data[lang]).length > 0) { // Verificamos que no esté vacío
            Object.assign(servers[lang], data[lang]);
            count += Object.keys(data[lang]).length;
          }
        }
        if (count > 0) {
          sources[name] = { ok: true, count };
          console.log(`[scraper] ✅ ${name}: ${count} servidores encontrados.`);
        } else {
          sources[name] = { ok: true, count: 0 };
          console.log(`[scraper] ➖ ${name}: 0 servidores.`);
        }
      } else {
        sources[name] = { ok: true, count: 0 };
        console.log(`[scraper] ➖ ${name}: 0 servidores.`);
      }
    }
  }

  // ==========================================
  // RESPALDO GARANTIZADO: XPASS (CORREGIDO)
  // ==========================================
  // Ahora solo se activa si REALMENTE no hay ningún servidor latino ni español.
  const totalLatino = Object.keys(servers.latino).length;
  const totalEspanol = Object.keys(servers.español).length;
  
  if (tmdbId && totalLatino === 0 && totalEspanol === 0) {
    servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    sources.xpass = { ok: true, count: 2 };
    console.log('[scraper] ⚠️ Sin resultados en otros proveedores. Usando fallback de Xpass.');
  } else {
    console.log(`[scraper] ✅ Se encontraron servidores reales (Latino: ${totalLatino} | Español: ${totalEspanol}). No se necesita Xpass.`);
  }

  return { servers, sources };
}

module.exports = { scrapeAll };
