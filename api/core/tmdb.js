const axios = require('axios');

// ✅ TU API KEY de TMDB (la correcta)
const TMDB_KEY = process.env.TMDB_API_KEY || '2d85217008ed46189916cf9cf1eaef53';
const BASE = 'https://api.themoviedb.org/3';

async function getTmdbInfo(tmdbId, type = 'movie') {
  try {
    const url = `${BASE}/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=es-ES`;
    const { data } = await axios.get(url, { timeout: 12000 });
    return {
      tmdbId: String(tmdbId),
      type,
      title: data.title || data.name || 'Sin título',
      year: (data.release_date || data.first_air_date || '').slice(0, 4),
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
      overview: data.overview || '',
      runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]) || 0,
      genres: (data.genres || []).map(g => g.name),
      voteAverage: data.vote_average || 0,
    };
  } catch (e) {
    console.error('[tmdb] Error:', e.message);
    return {
      tmdbId: String(tmdbId),
      type,
      title: '',
      year: '',
      poster: null,
      backdrop: null,
      overview: '',
      runtime: 0,
      genres: [],
      voteAverage: 0,
    };
  }
}

module.exports = { getTmdbInfo };
