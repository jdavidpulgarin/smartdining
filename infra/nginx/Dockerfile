# syntax=docker/dockerfile:1
# Nginx de producción con los frontends ya compilados dentro.
# Contexto: la raíz del repositorio.
#   docker build -f infra/nginx/Dockerfile --build-arg DOMINIO=midominio.co .
#
# Solo se pasan URLs PÚBLICAS a Vite. Ningún secreto con prefijo VITE_: todo
# lo VITE_* termina dentro del JavaScript que descarga cualquiera.

ARG DOMINIO

# --- PWA del comensal
FROM node:22-alpine AS cliente
ARG DOMINIO
WORKDIR /src
COPY frontend-cliente/package.json frontend-cliente/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend-cliente/ ./
ENV VITE_API_URL=https://api.${DOMINIO}/api \
    VITE_SOCKET_URL=https://rt.${DOMINIO}
RUN npm run build

# --- Panel del restaurante
FROM node:22-alpine AS staff
ARG DOMINIO
WORKDIR /src
COPY frontend-restaurante/package.json frontend-restaurante/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend-restaurante/ ./
ENV VITE_API_URL=https://api.${DOMINIO}/api \
    VITE_SOCKET_URL=https://rt.${DOMINIO}
RUN npm run build

# --- Nginx final
FROM nginx:1.27-alpine
# Plantilla con ${DOMINIO}: la imagen oficial la procesa al arrancar.
COPY infra/nginx/templates/ /etc/nginx/templates/
COPY infra/nginx/snippets/ /etc/nginx/snippets/
COPY --from=cliente /src/dist /usr/share/nginx/html/app
COPY --from=staff /src/dist /usr/share/nginx/html/staff
# frontend-kds aún no tiene proyecto: página provisional.
COPY infra/nginx/kds/ /usr/share/nginx/html/cocina
# Recarga cada 6 h para tomar los certificados que renueva certbot.
CMD ["/bin/sh", "-c", "(while :; do sleep 6h; nginx -s reload; done) & exec /docker-entrypoint.sh nginx -g 'daemon off;'"]
