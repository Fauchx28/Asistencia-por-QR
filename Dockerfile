# Imagen para publicar Asistencia QR (Railway, Render, Fly.io o un VPS con Docker).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/asistencia.db \
    BACKUP_DIR=/data/backups \
    OCR_CACHE_DIR=/data/ocr

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Todo lo que debe sobrevivir a un reinicio (base de datos, copias, idioma del OCR) vive en /data:
# monta ahí un volumen o disco persistente.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
