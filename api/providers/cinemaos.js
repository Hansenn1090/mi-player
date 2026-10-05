// core/extractors/cinemaos.js
const wreq = require('wreq-js'); // Usamos wreq-js en lugar de node-fetch

const BASE = 'https://cinemaos.tech';

async function extractCinemaOS(tmdbId, type = 'movie') {
  const url = `${BASE}/player/${tmdbId}?theme=ffffff&autoPlay=true&title=false`;

  // wreq-js imita la huella TLS de un navegador real
  const res = await wreq(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`CinemaOS respondió ${res.status}`);

  const html = await res.text();

  // ... el resto de tu lógica de extracción (regex para .mpd y subtítulos) permanece igual ...
  // ...
}
