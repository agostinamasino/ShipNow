# Imagen oficial verificada; digest fija el contenido de la base utilizada.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
RUN mkdir -p /app/uploads /app/logs && chown -R node:node /app/uploads /app/logs
USER node

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "import config from './src/config/index.js'; fetch('http://127.0.0.1:'+config.port+'/health', {signal: AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Equivale a npm start, evitando un proceso npm intermedio para las señales.
CMD ["node", "src/server.js"]
