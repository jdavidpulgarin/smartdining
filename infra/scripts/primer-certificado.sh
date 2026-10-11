#!/bin/sh
# Emite el PRIMER certificado de Let's Encrypt en el VPS. Se corre una sola vez;
# después el servicio certbot del compose lo renueva solo.
#
#   sh infra/scripts/primer-certificado.sh            # certificado real
#   STAGING=1 sh infra/scripts/primer-certificado.sh  # prueba (sin límite de Let's Encrypt)
#   SEED_DEMO=1 sh infra/scripts/primer-certificado.sh # además carga los datos de la demo
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

cd "$(dirname "$0")/../.."
ENV_FILE=infra/.env
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE (cp infra/.env.example infra/.env)"; exit 1; }

DOMINIO=$(sed -n 's/^DOMINIO=//p' "$ENV_FILE" | tr -d '\r')
CERTBOT_EMAIL=$(sed -n 's/^CERTBOT_EMAIL=//p' "$ENV_FILE" | tr -d '\r')
case "$DOMINIO" in ''|*cambia-esto*|*example.com) echo "Define DOMINIO en $ENV_FILE"; exit 1;; esac
case "$CERTBOT_EMAIL" in ''|*cambia-esto*|*example.com) echo "Define CERTBOT_EMAIL en $ENV_FILE"; exit 1;; esac

dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
# certbot con los volúmenes del compose montados en escritura.
certbot() { dc run --rm --no-deps --entrypoint "$1" certbot -c "$2"; }

VIVO=/etc/letsencrypt/live/$DOMINIO

if certbot sh "test -f $VIVO/fullchain.pem && ! test -f $VIVO/.temporal"; then
  echo "Ya existe un certificado para $DOMINIO; certbot del compose lo renueva."
  exit 0
fi

echo "1/6 Servicios internos (sin nginx: todavía nada es público)"
dc up -d --build --wait postgres redis backend socket-server
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
