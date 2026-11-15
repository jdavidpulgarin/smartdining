#!/bin/sh
# Emite el PRIMER certificado de Let's Encrypt en el VPS. Se corre una sola vez;
# después el servicio certbot del compose lo renueva solo.
#
#   cd /srv/smartdining && ENTORNO=produccion sh infra/scripts/primer-certificado.sh
#   cd /srv/smartdining-staging && ENTORNO=staging sh infra/scripts/primer-certificado.sh
#   sh infra/scripts/primer-certificado.sh --entorno staging
#   STAGING=1 ...   certificado de PRUEBA de Let's Encrypt (sin su límite); no tiene
#                   nada que ver con el entorno staging
#   SEED_DEMO=1 ... además carga los datos de la demo
#
# ENTORNO (variable o --entorno, OBLIGATORIO y sin valor por defecto):
#   staging    clon /srv/smartdining-staging, infra/.env.staging, proyecto smartdining-staging
#   produccion clon /srv/smartdining, infra/.env, proyecto smartdining
# Se corre desde el clon de ese entorno, y COMPOSE_PROJECT_NAME del .env tiene
# que ser el del proyecto (en producción puede no estar: docker-compose.prod.yml
# ya se llama "smartdining"). Si ENV_FILE viene, tiene que ser el del entorno.
# Cualquier otro valor de ENTORNO, o ninguno: sale con 2 sin tocar nada.
#
# Si ya hay un certificado de PRUEBA (de una corrida con STAGING=1), la corrida
# sin STAGING lo reemplaza por el real. Un certificado real no se toca.
#
# Problema que resuelve: nginx no arranca sin los archivos del certificado, y
# certbot necesita a nginx sirviendo /.well-known/acme-challenge/ para emitirlo.
# Solución: certificado autofirmado temporal -> arrancar nginx -> borrarlo ->
# pedir el real por webroot -> recargar nginx.
#
# Antes de arrancar nginx (lo único público) exige que ninguna cuenta del
# personal tenga una contraseña conocida o publicada (passwords-demo.sh).
#
# Requisito: los registros DNS de DOMINIO y de app., staff., cocina., api. y rt.
# ya apuntan a la IP del VPS y los puertos 80 y 443 están abiertos.
set -eu

if [ "${1:-}" = "--entorno" ]; then
  ENTORNO=${2:-}
  if [ "$#" -ge 2 ]; then shift 2; else shift; fi
fi
case "${ENTORNO:-}" in
  staging) RUTA=/srv/smartdining-staging ENV_ENTORNO=infra/.env.staging PROYECTO=smartdining-staging EJEMPLO=infra/.env.staging.example ;;
  produccion) RUTA=/srv/smartdining ENV_ENTORNO=infra/.env PROYECTO=smartdining EJEMPLO=infra/.env.example ;;
  *)
    echo "primer-certificado: ERROR: ENTORNO debe ser 'staging' o 'produccion' (recibido: '${ENTORNO:-}'). No se hizo nada." >&2
    echo "uso: ENTORNO=staging|produccion sh $0   (o: sh $0 --entorno <entorno>)" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/../.."
[ "$(pwd -P)" = "$RUTA" ] || { echo "ENTORNO=$ENTORNO se corre desde su clon, $RUTA (estás en $(pwd -P))"; exit 1; }
[ -z "${ENV_FILE:-}" ] || [ "$ENV_FILE" = "$ENV_ENTORNO" ] \
  || { echo "ENV_FILE=$ENV_FILE no es el de ENTORNO=$ENTORNO ($ENV_ENTORNO)"; exit 1; }
ENV_FILE=$ENV_ENTORNO
# passwords-demo.sh (pasos 1 y 2) debe usar el mismo entorno.
export ENV_FILE
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE (cp $EJEMPLO $ENV_FILE)"; exit 1; }
nombre=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$ENV_FILE" | tr -d '\r')
[ "${nombre:-smartdining}" = "$PROYECTO" ] \
  || { echo "$ENV_FILE tiene COMPOSE_PROJECT_NAME=${nombre:-<vacío>} y ENTORNO=$ENTORNO necesita $PROYECTO"; exit 1; }

DOMINIO=$(sed -n 's/^DOMINIO=//p' "$ENV_FILE" | tr -d '\r')
CERTBOT_EMAIL=$(sed -n 's/^CERTBOT_EMAIL=//p' "$ENV_FILE" | tr -d '\r')
case "$DOMINIO" in ''|*cambia-esto*|*example.com) echo "Define DOMINIO en $ENV_FILE"; exit 1;; esac
case "$CERTBOT_EMAIL" in ''|*cambia-esto*|*example.com) echo "Define CERTBOT_EMAIL en $ENV_FILE"; exit 1;; esac

dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
# certbot con los volúmenes del compose montados en escritura.
certbot() { dc run --rm --no-deps --entrypoint "$1" certbot -c "$2"; }

VIVO=/etc/letsencrypt/live/$DOMINIO

if certbot sh "test -f $VIVO/fullchain.pem && ! test -f $VIVO/.temporal"; then
  # Un certificado de prueba de Let's Encrypt lo emite "(STAGING) ...". Sin
  # STAGING=1 se reemplaza por el real; cualquier otro caso ya está listo.
  if [ "${STAGING:-0}" != "1" ] && certbot sh "openssl x509 -in $VIVO/fullchain.pem -noout -issuer | grep -q STAGING"; then
    echo "Hay un certificado de PRUEBA para $DOMINIO: se reemplaza por el real."
  else
    echo "Ya existe un certificado para $DOMINIO; certbot del compose lo renueva."
    exit 0
  fi
fi

echo "1/6 Servicios internos (sin nginx: todavía nada es público)"
dc up -d --build --wait postgres redis
# Con la base recién creada, docker-init.sh ya migró y esto no hace nada; con
# un volumen que ya existía, aplica los scripts que falten antes del backend.
dc exec -T postgres sh /smartdining-db/migrar.sh
dc up -d --build --wait backend socket-server
# docker-init.sh solo corre 00_ejecutar_todo.sql, que NO crea usuarios, mesas
# ni platos de ejemplo: están en database/seed.sql (idempotente: WHERE NOT
# EXISTS). Se cargan ANTES del paso 2 para que sus contraseñas pasen el control.
if [ "${SEED_DEMO:-0}" = "1" ]; then
  echo "   Datos de la demo (database/seed.sql)"
  dc exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < database/seed.sql
fi

echo "2/6 Contraseñas del personal"
if ! sh infra/scripts/passwords-demo.sh verificar; then
  # Interactivo: pide la contraseña nueva. Si no hay terminal, se detiene aquí.
  sh infra/scripts/passwords-demo.sh cambiar
fi

echo "3/6 Certificado temporal autofirmado"
certbot sh "mkdir -p $VIVO && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=localhost \
    -keyout $VIVO/privkey.pem -out $VIVO/fullchain.pem && touch $VIVO/.temporal"

echo "4/6 Arrancando nginx y certbot"
dc up -d --build nginx certbot

echo "5/6 Pidiendo el certificado real"
# certbot se niega a escribir sobre una carpeta live/ que no creó él.
certbot sh "rm -rf $VIVO /etc/letsencrypt/archive/$DOMINIO /etc/letsencrypt/renewal/$DOMINIO.conf"
PRUEBA=""
[ "${STAGING:-0}" = "1" ] && PRUEBA="--staging"
certbot sh "certbot certonly --webroot -w /var/www/certbot $PRUEBA \
  --cert-name $DOMINIO --email $CERTBOT_EMAIL --agree-tos --no-eff-email \
  --rsa-key-size 4096 --non-interactive \
  -d $DOMINIO -d app.$DOMINIO -d staff.$DOMINIO -d cocina.$DOMINIO -d api.$DOMINIO -d rt.$DOMINIO"

echo "6/6 Recargando nginx"
dc exec nginx nginx -s reload
echo "Listo: https://app.$DOMINIO"
