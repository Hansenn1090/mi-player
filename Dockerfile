FROM node:20-slim

# Instalar certificados SSL (esto soluciona el error "unable to get local issuer certificate")
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY api/package.json ./
RUN npm install --omit=dev

COPY api/ ./

EXPOSE 10000
ENV PORT=10000
ENV NODE_ENV=production

CMD ["node", "server.js"]
