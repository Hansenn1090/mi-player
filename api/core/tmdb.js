const axios = require('axios');

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';
const LANG = 'es-ES';

async function getMediaInfo(id, type = 'movie') {
  if (!id) return null;
  if (!TMDB_KEY) {
    console.error('[tmdb] Falta TMDB_API_KEY');
    return null;
  }

  try {
    const url = `${TMDB_BASE}/${type}/${id}?api_key=${TMDB_KEY}&language=${LANG}`;
    const { data } = await axios.get(url, { timeout: 10000 });

    return {
      tmdbId: id,
      type,
      title: data.title || data.name || '',
      originalTitle: data.original_title || data.original_name || '',
      overview: data.overview || '',
      year: (data.release_date || data.first_air_date || '').slice(0, 4),
      runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]) || 0,
      voteAverage: Math.round((data.vote_average || 0) * 10) / 10,
      genres: (data.genres || []).map(g => g.name),
      poster: data.poster_path ? `${IMG_BASE}/w342${data.poster_path}` : '',
      backdrop: data.backdrop_path ? `${IMG_BASE}/w1280${data.backdrop_path}` : '',
    };
  } catch (err) {
    console.error('[tmdb] Error:', err.message);
    return null;
  }
}

module.exports = { getMediaInfo };
