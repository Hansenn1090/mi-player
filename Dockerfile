FROM node:20-slim

WORKDIR /app

COPY api/package.json ./
RUN npm install --omit=dev

COPY api/ ./

EXPOSE 10000
ENV PORT=10000
ENV NODE_ENV=production

CMD ["node", "server.js"]
