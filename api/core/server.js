const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

// 1. Tu configuración de CORS (Perfecta)
app.use(cors({
  origin: [
    'https://mi-player.netlify.app',
    /\.netlify\.app$/,
    /\.onrender\.com$/,
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
}));

// ... Aquí van tus otras rutas (ej: /api/sources) ...

// 2. RUTA DEL PROXY (NUEVA Y CORREGIDA)
app.get('/api/proxy', async (req, res) => {
    const urlDestino = req.query.url;
    const refererDestino = req.query.referer || 'https://videoapp.zip/'; 
    
    if (!urlDestino) return res.status(400).send('Falta el parámetro URL');

    try {
        const response = await axios({
            method: 'get',
            url: urlDestino,
            responseType: urlDestino.includes('.m3u8') ? 'text' : 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
                'Referer': refererDestino,
                'Origin': refererDestino.replace(/\/$/, '') 
            }
        });

        if (urlDestino.includes('.m3u8')) {
            let contenidoM3U8 = response.data;
            const baseUrl = urlDestino.substring(0, urlDestino.lastIndexOf('/') + 1);
            
            contenidoM3U8 = contenidoM3U8.replace(/URI="([^"]+)"/g, (match, p1) => {
                return `URI="/api/proxy?url=${encodeURIComponent(new URL(p1, baseUrl).href)}&referer=${encodeURIComponent(refererDestino)}"`;
            });
            
            contenidoM3U8 = contenidoM3U8.split('\n').map(line => {
                if (line && !line.startsWith('#')) {
                    return `/api/proxy?url=${encodeURIComponent(new URL(line, baseUrl).href)}&referer=${encodeURIComponent(refererDestino)}`;
                }
                return line;
            }).join('\n');

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(contenidoM3U8);
        } else {
            res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
            return response.data.pipe(res);
        }
    } catch (error) {
        console.error("Error en Proxy:", error.message);
        res.status(500).send('Error interno del proxy');
    }
});

// 3. Tu app.listen
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
