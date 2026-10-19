// api/core/server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// 1. Configuración de CORS (Tus dominios permitidos)
app.use(cors({
  origin: [
    'https://mi-player.netlify.app',    // tu frontend
    /\.netlify\.app$/,                   // cualquier preview de Netlify
    /\.onrender\.com$/,                  // tu propio backend
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
}));

// ... Aquí van tus otras rutas (ej: /api/sources, /api/servers, etc) ...

// 2. RUTA DEL PROXY (Optimizada para Vimeo/HLS)
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
            
            // Construir la URL absoluta de tu proxy de Render
            const miProxy = `${req.protocol}://${req.get('host')}/api/proxy`;

            // Reescribir llaves de encriptación
            contenidoM3U8 = contenidoM3U8.replace(/URI="([^"]+)"/g, (match, p1) => {
                const urlAbsoluta = new URL(p1, baseUrl).href;
                return `URI="${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}"`;
            });
            
            // Reescribir segmentos de video (.ts)
            contenidoM3U8 = contenidoM3U8.split('\n').map(line => {
                if (line && !line.startsWith('#')) {
                    const urlAbsoluta = new URL(line, baseUrl).href;
                    return `${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}`;
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

// 3. Escuchar el puerto (Render usa el 10000 por defecto)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
