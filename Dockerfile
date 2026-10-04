FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 \
    libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxfixes3 libxkbcommon0 libxrandr2 wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY api/package.json ./
RUN npm install --omit=dev

COPY api/ ./

EXPOSE 10000
ENV PORT=10000

CMD ["node", "server.js"]
