const axios = require('axios');

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';
const LANG = 'es-ES';

const FALLBACK = (id, type) => ({
  tmdbId: id,
  type: type || 'movie',
  title: 'Película ' + id,
  year: '',
  poster: '',
  backdrop: '',
  overview: '',
  runtime: 0,
  genres: [],
  voteAverage: 0,
});

async function getMediaInfo(id, type = 'movie') {
  if (!id) return FALLBACK('0', type);
  if (!TMDB_KEY) {
    console.warn('[tmdb] Falta TMDB_API_KEY');
    return FALLBACK(id, type);
  }

  try {
    const url = `${TMDB_BASE}/${type}/${id}?api_key=${TMDB_KEY}&language=${LANG}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    return {
      tmdbId: id, type,
      title: data.title || data.name || 'Sin título',
      year: (data.release_date || data.first_air_date || '').slice(0, 4),
      poster: data.poster_path ? `${IMG_BASE}/w342${data.poster_path}` : '',
      backdrop: data.backdrop_path ? `${IMG_BASE}/w1280${data.backdrop_path}` : '',
      overview: data.overview || '',
      runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]) || 0,
      genres: (data.genres || []).map(g => g.name),
      voteAverage: Math.round((data.vote_average || 0) * 10) / 10,
    };
  } catch (err) {
    console.warn('[tmdb] Error:', err.response ? err.response.status : err.message);
    return FALLBACK(id, type);
  }
}

module.exports = { getMediaInfo };
