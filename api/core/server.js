app.use(cors({
  origin: [
    'https://mi-player.netlify.app',    // tu frontend
    /\.netlify\.app$/,                   // cualquier preview de Netlify
    /\.onrender\.com$/,                  // tu propio backend
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
}));
