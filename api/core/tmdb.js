const axios = require('axios');

async function getMediaInfo(tmdbId, type) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('Falta TMDB_API_KEY en .env');

  const endpoint = type === 'tv' ? 'tv' : 'movie';
  const { data } = await axios.get(
    `https://api.themoviedb.org/3/${endpoint}/${tmdbId}`,
    { params: { api_key: key, language: 'es-MX' }, timeout: 10000 }
  );

  return {
    title:         data.title || data.name,
    originalTitle: data.original_title || data.original_name,
    year:          (data.release_date || data.first_air_date || '').split('-')[0],
    poster:        data.poster_path   ? `https://image.tmdb.org/t/p/w500${data.poster_path}`   : null,
    backdrop:      data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
    overview:      data.overview || '',
    runtime:       data.runtime || (data.episode_run_time?.[0]) || 100,
    genres:        (data.genres || []).map(g => g.name).join(' / '),
    voteAverage:   data.vote_average || 0,
  };
}

module.exports = { getMediaInfo };