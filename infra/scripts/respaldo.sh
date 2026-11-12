#!/bin/sh
# ==============================================================================
# SmartDining · infra/scripts/respaldo.sh (R-18)
#
# Respaldo de la base (pg_dump -Fc, ya comprimido) del proyecto que esté
# corriendo en el VPS: smartdining (producción) o smartdining-staging.
#
#   sh infra/scripts/respaldo.sh predeploy <sha>   # deploy.yml y deploy-staging.yml, ANTES de migrar.sh
#   sh infra/scripts/respaldo.sh diario            # timer smartdining-respaldo (systemd)
#
# Contenedor: RESPALDO_CONTENEDOR (los workflows pasan el postgres de su
# compose) o, si no se da, el único postgres en marcha de smartdining o de
# smartdining-staging (nunca corren a la vez; si están los dos, falla).
#
# Destino: $RESPALDOS_DIR/<proyecto>/<tipo>/<tipo>-AAAAMMDD-HHMMSS[-sha7].dump
#   RESPALDOS_DIR        por defecto /srv/respaldos (lo crea instalar-respaldos.sh)
#   CONSERVAR_DIARIO     por defecto 7
#   CONSERVAR_PREDEPLOY  por defecto 5
#
# Permisos: archivos 640 y carpetas 750 con el grupo sd-respaldos (heredado de
# la carpeta del proyecto, que tiene setgid). En ese grupo solo está el usuario
# respaldos, que los baja por SFTP de solo lectura. Nadie más los lee.
#
# El dump se escribe en un .tmp y solo se renombra si pg_dump terminó bien, el
# archivo no está vacío y pg_restore --list lo lee y trae schema_migraciones.
# Si algo falla sale con 1 sin dejar nada a medias, y el despliegue se detiene
# antes de migrar.
#
# Los respaldos JAMÁS van al repositorio (es público): viven fuera de los
# clones y .gitignore ignora *.dump.
# ==============================================================================
set -eu
umask 027

DOCKER=${DOCKER:-docker}
RESPALDOS_DIR=${RESPALDOS_DIR:-/srv/respaldos}
TIPO=${1:-}
SHA=${2:-}

fallar() {
  echo "respaldo: ERROR: $*" >&2
  exit 1
}

case "$TIPO" in
  diario)
    conservar=${CONSERVAR_DIARIO:-7}
    sufijo=
    ;;
  predeploy)
    printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{7,40}$' || fallar "predeploy necesita el sha del commit (7 a 40 caracteres hexadecimales)"
    conservar=${CONSERVAR_PREDEPLOY:-5}
    sufijo="-$(printf '%s' "$SHA" | cut -c 1-7)"
    ;;
  *)
    echo "uso: sh $0 predeploy <sha> | diario" >&2
    exit 2
    ;;
esac
printf '%s' "$conservar" | grep -Eq '^[1-9][0-9]*$' || fallar "la cantidad a conservar debe ser un entero mayor que 0 (recibido: '$conservar')"

# --- 1. Contenedor de postgres y proyecto --------------------------------------
un_solo_id() {
  [ "$(printf '%s\n' "$1" | grep -c .)" -le 1 ] || fallar "hay más de un postgres de $2 corriendo"
}

if [ -n "${RESPALDO_CONTENEDOR:-}" ]; then
  id=$RESPALDO_CONTENEDOR
else
  id=
  for p in smartdining smartdining-staging; do
    c=$("$DOCKER" ps -q --filter "label=com.docker.compose.project=$p" --filter "label=com.docker.compose.service=postgres") \
      || fallar "no se pudo consultar Docker"
    [ -n "$c" ] || continue
    un_solo_id "$c" "$p"
    [ -z "$id" ] || fallar "están corriendo los postgres de smartdining y de smartdining-staging; no se sabe cuál respaldar"
    id=$c
  done
  [ -n "$id" ] || fallar "no hay ningún postgres de smartdining ni de smartdining-staging corriendo"
fi

proyecto=$("$DOCKER" inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id") \
  || fallar "no existe el contenedor $id"
case "$proyecto" in
  smartdining | smartdining-staging) ;;
  *) fallar "el contenedor $id es del proyecto '$proyecto', no de smartdining ni de smartdining-staging" ;;
esac

# --- 2. Carpeta ----------------------------------------------------------------
# La carpeta del proyecto la crea instalar-respaldos.sh (root): $RESPALDOS_DIR
# es el chroot del SFTP de solo lectura y tiene que ser de root, así que deploy
# no puede crear nada ahí. predeploy/ y diario/ sí se crean aquí, y heredan el
# grupo sd-respaldos por el setgid de la carpeta del proyecto.
if [ ! -d "$RESPALDOS_DIR/$proyecto" ]; then
  raiz=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
  if [ -n "$raiz" ] && [ -f "$raiz/infra/scripts/instalar-respaldos.sh" ]; then
    comando="cd $raiz && sudo sh infra/scripts/instalar-respaldos.sh"
  else
    # Corriendo desde /usr/local/lib/smartdining (timer): desde cualquiera de los clones.
    comando="cd /home/deploy/smartdining && sudo sh infra/scripts/instalar-respaldos.sh   (o desde /srv/smartdining-staging)"
  fi
  fallar "no existe $RESPALDOS_DIR/$proyecto: no se respaldó nada (un despliegue se detiene aquí, antes de migrar). Prepáralo UNA vez en el VPS, con un usuario con sudo:
  $comando
y vuelve a lanzar el despliegue (docs/despliegue.md §4)."
fi
destino=$RESPALDOS_DIR/$proyecto/$TIPO
mkdir -p "$destino"
# Restos de una corrida que murió de golpe (kill -9, apagón).
find "$destino" -name '*.dump.tmp' -mmin +60 -exec rm -f {} + 2>/dev/null || true

final=$destino/$TIPO-$(date +%Y%m%d-%H%M%S)$sufijo.dump
[ ! -e "$final" ] || fallar "ya existe $final"
tmp=$final.tmp
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

# --- 3. Dump y validación --------------------------------------------------------
# Las credenciales salen del propio contenedor (POSTGRES_USER, POSTGRES_DB):
# no hace falta leer ningún .env.
"$DOCKER" exec "$id" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp" \
  || fallar "pg_dump falló en $proyecto; no se guardó nada"
[ -s "$tmp" ] || fallar "pg_dump no escribió nada en $proyecto"
lista=$("$DOCKER" exec -i "$id" pg_restore --list < "$tmp") \
  || fallar "pg_restore no puede leer el respaldo de $proyecto; no se guardó"
printf '%s\n' "$lista" | grep -q ' TABLE public schema_migraciones ' \
  || fallar "el respaldo de $proyecto no trae la tabla schema_migraciones; no se guardó"
mv "$tmp" "$final"

# --- 4. Rotación (por nombre: la fecha va en él) --------------------------------
ls -1 "$destino" \
  | grep -E "^$TIPO-[0-9]{8}-[0-9]{6}(-[0-9a-f]{7})?\.dump\$" \
  | sort -r \
  | tail -n +"$((conservar + 1))" \
  | while read -r viejo; do rm -f "$destino/$viejo"; done

echo "respaldo: $proyecto $TIPO -> $final ($(wc -c < "$final" | tr -d ' ') bytes; se conservan $conservar)"
