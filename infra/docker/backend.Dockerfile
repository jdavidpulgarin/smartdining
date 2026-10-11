# syntax=docker/dockerfile:1
# Imagen de producción del backend (API REST). No modifica backend/: se
# construye con ese directorio como contexto.
#   docker build -f infra/docker/backend.Dockerfile backend

# --- 1) Dependencias de producción. bcrypt es un módulo nativo: si no hay
# binario precompilado para Alpine (musl) se compila aquí, y las herramientas
# de compilación NO pasan a la imagen final.
FROM node:22-alpine AS dependencias
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- 2) Imagen final
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencias --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node src ./src
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
