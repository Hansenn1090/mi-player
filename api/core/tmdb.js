const axios = require('axios');

// Asegúrate de que esta variable esté configurada en Render como TMDB_API_KEY
const API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * Obtiene la información de una película o serie desde TMDB
 * @param {string} id - El ID de TMDB (ej. 142319)
 * @param {string} type - 'movie' o 'tv'
 * @returns {Promise<Object>} - Objeto con la información formateada para el scraper
 */
async function getMediaInfo(id, type = 'movie') {
  // Si no hay API Key, devolvemos un objeto vacío para que el scraper intente buscar solo por título si lo tuviera
  if (!API_KEY) {
    console.warn('[TMDB] No hay API_KEY configurada en las variables de entorno.');
    return { tmdbId: id, type, title: '', year: '' };
  }

  try {
    // Determinar si es película o serie
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `${BASE_URL}/${endpoint}/${id}?api_key=${API_KEY}&language=es-ES`;

    console.log(`[TMDB] Buscando ${endpoint} con ID: ${id}`);
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    // Extraer el año (TMDB usa release_date para películas y first_air_date para series)
    const dateStr = data.release_date || data.first_air_date || '';
    const year = dateStr ? dateStr.split('-')[0] : '';

    // Extraer duración (runtime para películas, episode_run_time para series)
    let runtime = data.runtime || 0;
    if (!runtime && data.episode_run_time && data.episode_run_time.length > 0) {
      runtime = data.episode_run_time[0];
    }

    // Formatear la respuesta exactamente como la espera tu server.js
    const info = {
      tmdbId: id,
      type: type,
      title: data.title || data.name || '',
      year: year,
      poster: data.poster_path ? `${IMAGE_BASE}/w500${data.poster_path}` : '',
      backdrop: data.backdrop_path ? `${IMAGE_BASE}/original${data.backdrop_path}` : '',
      overview: data.overview || '',
      runtime: runtime,
      genres: data.genres ? data.genres.map(g => g.name) : [],
      voteAverage: data.vote_average || 0
    };

    console.log(`[TMDB] OK: ${info.title} (${info.year})`);
    return info;

  } catch (error) {
    console.error(`[TMDB] Error al buscar ${type} con ID ${id}:`, error.message);
    // Devolvemos un objeto básico para que el servidor no se caiga si TMDB falla
    return { 
      tmdbId: id, 
      type, 
      title: 'Error al conectar con TMDB', 
      year: '',
      poster: '',
      backdrop: '',
      overview: '',
      runtime: 0,
      genres: [],
      voteAverage: 0
    };
  }
}

// Exportar la función con el nombre exacto que usa server.js
module.exports = { getMediaInfo };
