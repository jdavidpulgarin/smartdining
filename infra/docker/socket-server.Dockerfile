# syntax=docker/dockerfile:1
# Imagen de producción del socket-server.
# Construir desde la raíz:  docker build -f infra/docker/socket-server.Dockerfile socket-server

# --- 1) Dependencias de producción (sin devDependencies ni caché de npm)
FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- 2) Imagen final: solo node, el código y node_modules de producción
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencias --chown=node:node /app/node_modules ./node_modules
# Solo lo que corre en producción (el resto lo excluye el .dockerignore).
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node src ./src
# Usuario sin privilegios que trae la imagen oficial: si alguien lograra
# ejecutar código en el proceso, no sería root dentro del contenedor.
USER node
EXPOSE 4001
# /health responde 503 si Redis está caído: el contenedor queda "unhealthy".
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4001/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# node maneja SIGTERM (cierre ordenado, src/cierre.js); el compose usa init: true.
CMD ["node", "server.js"]
