#!/bin/sh
# Valida los límites de nginx de infra/.env ANTES de aplicarlos, sin reiniciar
# nginx (en el VPS, desde la raíz del clon):
#
#   sh infra/scripts/validar-nginx.sh                              # producción
#   ENV_FILE=infra/.env.staging sh infra/scripts/validar-nginx.sh  # staging
#
# Toma los NGINX_* que resolvería docker compose con ese .env y genera la
# configuración igual que el arranque de la imagen (envsubst sobre
# /etc/nginx/templates) en una carpeta temporal DENTRO del nginx en marcha, y
# corre `nginx -t` sobre ella. No toca la configuración que está sirviendo.
#
# Hace falta porque un valor mal escrito (p. ej. NGINX_RAFAGA_PAGOS=muchas)
# deja a nginx sin arrancar al recrearlo, y con él caen TODOS los sitios.
# `docker compose run nginx nginx -t` no sirve: nginx tiene IP fija y el
# contenedor temporal choca con la del que está corriendo.
#
# PLANTILLAS=<carpeta> valida OTRAS plantillas (*.template) en vez de las que
# trae la imagen en marcha, p. ej. las de una rama antes de fusionarla:
#
#   PLANTILLAS=/tmp/rama/infra/nginx/templates ENV_FILE=infra/.env.staging \
#     sh infra/scripts/validar-nginx.sh
#
# Se mandan por stdin (tar) al mismo nginx y solo viven en su carpeta temporal.
# Los snippets son siempre los de la imagen.
set -eu

if [ -n "${PLANTILLAS:-}" ]; then
  PLANTILLAS=$(cd "$PLANTILLAS" && pwd) || { echo "PLANTILLAS no es una carpeta: $PLANTILLAS" >&2; exit 1; }
  ls "$PLANTILLAS"/*.template > /dev/null 2>&1 || { echo "No hay archivos .template en $PLANTILLAS" >&2; exit 1; }
fi

cd "$(dirname "$0")/../.."
ENV_FILE=${ENV_FILE:-infra/.env}
DOCKER=${DOCKER:-docker}

dc() { "$DOCKER" compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }

# Líneas "      NGINX_LIMITE_PAGOS: 120r/m" o '      NGINX_RAFAGA_PAGOS: "60"'.
vars=$(dc config nginx | sed -n 's/^ *\(NGINX_[A-Z_]*\): *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1=\2/p')
[ -n "$vars" ] || { echo "No encontré variables NGINX_* en la configuración de nginx ($ENV_FILE)." >&2; exit 1; }

echo "Valores con $ENV_FILE:"
args=""
for v in $vars; do
  printf '  %s\n' "$v"
  args="$args -e $v"
done

# stdin del exec: las plantillas de PLANTILLAS (tar) o nada (/dev/null). Nunca
# el stdin de este script: así no se come el resto de un script que llegue
# por stdin (p. ej. por ssh).
entrada() {
  if [ -n "${PLANTILLAS:-}" ]; then
    echo "Plantillas: $PLANTILLAS" >&2
    (cd "$PLANTILLAS" && tar -cf - ./*.template)
  else
    cat /dev/null
  fi
}
[ -n "${PLANTILLAS:-}" ] && args="$args -e SD_PLANTILLAS_STDIN=1"

# shellcheck disable=SC2086 # $args son pares -e VAR=valor sin espacios.
if entrada < /dev/null | dc exec -T $args nginx sh -c '
  set -e
  dir=$(mktemp -d)
  trap "rm -rf \"$dir\"" EXIT
  mkdir "$dir/conf.d"
  origen=/etc/nginx/templates
  if [ "${SD_PLANTILLAS_STDIN:-}" = 1 ]; then
    origen="$dir/plantillas"
    mkdir "$origen"
    tar -xf - -C "$origen"
  fi
  vars=$(printf "\${%s} " $(env | cut -d= -f1))
  for t in "$origen"/*.template; do
    envsubst "$vars" < "$t" > "$dir/conf.d/$(basename "$t" .template)"
  done
  # nginx.conf FUERA de conf.d: si no, el include *.conf lo incluiría a él mismo.
  sed "s#include /etc/nginx/conf.d/\*.conf;#include $dir/conf.d/*.conf;#" /etc/nginx/nginx.conf > "$dir/nginx.conf"
  nginx -t -c "$dir/nginx.conf"
'; then
  if [ -n "${PLANTILLAS:-}" ]; then
    echo "OK: las plantillas de $PLANTILLAS son válidas con $ENV_FILE (se aplican al desplegar la imagen que las trae)"
  else
    echo "OK: aplica con:  docker compose -f docker-compose.prod.yml --env-file $ENV_FILE up -d nginx"
  fi
else
  echo "NO apliques: nginx no arrancaría con estos valores. Corrige $ENV_FILE." >&2
  exit 1
fi
