async function getMediaInfo(id, type = 'movie') {
  if (!id) return null;
  if (!TMDB_KEY) return null;

  try {
    const url = `${TMDB_BASE}/${type}/${id}?api_key=${TMDB_KEY}&language=${LANG}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    // ... return normal
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.warn(`[tmdb] ID ${id} no existe en TMDB`);
      return {
        tmdbId: id,
        type,
        title: 'Película sin información',
        year: '',
        poster: '',
        backdrop: '',
        overview: '',
        runtime: 0,
        genres: [],
        voteAverage: 0,
      };
    }
    console.error('[tmdb] Error:', err.message);
    return null;
  }
}
