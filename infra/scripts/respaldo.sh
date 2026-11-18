#!/bin/sh
# ==============================================================================
# SmartDining · infra/scripts/respaldo.sh (R-18)
#
# Respaldo de la base (pg_dump -Fc, ya comprimido) y del volumen de imágenes
# de los platos (tar.gz, D-23) de UN entorno del VPS.
#
#   ENTORNO=staging sh infra/scripts/respaldo.sh predeploy <sha>    # deploy-staging.yml, ANTES de migrar.sh
#   ENTORNO=produccion sh infra/scripts/respaldo.sh predeploy <sha> # deploy.yml, ANTES de migrar.sh
#   sh infra/scripts/respaldo.sh --entorno staging diario            # timer smartdining-respaldo@staging
#
# ENTORNO (variable o --entorno, OBLIGATORIO y sin valor por defecto):
#   staging    proyecto smartdining-staging, clon /srv/smartdining-staging
#   produccion proyecto smartdining,         clon /srv/smartdining
# Cualquier otro valor, o ninguno: sale con 2 sin tocar nada.
#
# Contenedor: RESPALDO_CONTENEDOR (los workflows pasan el postgres de su
# compose), que TIENE que ser del proyecto de ENTORNO; o, si no se da, el
# postgres en marcha de ese proyecto. Así un entorno nunca escribe en la
# carpeta del otro.
#
# Destino: $RESPALDOS_DIR/<proyecto>/<tipo>/<tipo>-AAAAMMDD-HHMMSS[-sha7].dump
#          y, con el mismo nombre, .tar.gz con el volumen de imágenes.
#   <proyecto>           smartdining-staging o smartdining, según ENTORNO
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
# Las imágenes salen del volumen "imagenes" del proyecto (lo ubican las
# etiquetas de compose), montado en SOLO LECTURA en un contenedor temporal
# sin red con la misma imagen del postgres en marcha (ya está en el VPS: no
# se descarga nada). El tar.gz va a otro .tmp y se valida (no vacío, gzip -t
# y tar -t con la carpeta raíz); los dos se renombran solo si todo pasó.
# Si algo falla sale con 1 sin dejar nada a medias, y el despliegue se detiene
# antes de migrar. Si el proyecto todavía no tiene el volumen (antes del
# primer despliegue que lo crea), respalda solo la base y lo avisa.
#
# Los respaldos JAMÁS van al repositorio (es público): viven fuera de los
# clones y .gitignore ignora *.dump.
# ==============================================================================
set -eu
umask 027

DOCKER=${DOCKER:-docker}
RESPALDOS_DIR=${RESPALDOS_DIR:-/srv/respaldos}

fallar() {
  echo "respaldo: ERROR: $*" >&2
  exit 1
}

# --- 0. Entorno (obligatorio) ----------------------------------------------------
if [ "${1:-}" = "--entorno" ]; then
  ENTORNO=${2:-}
  if [ "$#" -ge 2 ]; then shift 2; else shift; fi
fi
case "${ENTORNO:-}" in
  staging) proyecto_esperado=smartdining-staging ruta=/srv/smartdining-staging ;;
  produccion) proyecto_esperado=smartdining ruta=/srv/smartdining ;;
  *)
    echo "respaldo: ERROR: ENTORNO debe ser 'staging' o 'produccion' (recibido: '${ENTORNO:-}'). No se respaldó nada." >&2
    echo "uso: ENTORNO=staging|produccion sh $0 predeploy <sha> | diario   (o: sh $0 --entorno <entorno> ...)" >&2
    exit 2
    ;;
esac

TIPO=${1:-}
SHA=${2:-}

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
if [ -n "${RESPALDO_CONTENEDOR:-}" ]; then
  id=$RESPALDO_CONTENEDOR
else
  id=$("$DOCKER" ps -q --filter "label=com.docker.compose.project=$proyecto_esperado" --filter "label=com.docker.compose.service=postgres") \
    || fallar "no se pudo consultar Docker"
  [ -n "$id" ] || fallar "no hay ningún postgres de $proyecto_esperado (ENTORNO=$ENTORNO) corriendo"
  [ "$(printf '%s\n' "$id" | grep -c .)" -le 1 ] || fallar "hay más de un postgres de $proyecto_esperado corriendo"
fi

proyecto=$("$DOCKER" inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id") \
  || fallar "no existe el contenedor $id"
[ "$proyecto" = "$proyecto_esperado" ] \
  || fallar "el contenedor $id es del proyecto '$proyecto', no de $proyecto_esperado (ENTORNO=$ENTORNO); no se respaldó nada"

# --- 2. Carpeta ----------------------------------------------------------------
# La carpeta del proyecto la crea instalar-respaldos.sh (root): $RESPALDOS_DIR
# es el chroot del SFTP de solo lectura y tiene que ser de root, así que deploy
# no puede crear nada ahí. predeploy/ y diario/ sí se crean aquí, y heredan el
# grupo sd-respaldos por el setgid de la carpeta del proyecto.
if [ ! -d "$RESPALDOS_DIR/$proyecto" ]; then
  raiz=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
  if [ -n "$raiz" ] && [ -f "$raiz/infra/scripts/instalar-respaldos.sh" ]; then
    comando="cd $raiz && sudo ENTORNO=$ENTORNO sh infra/scripts/instalar-respaldos.sh"
  else
    # Corriendo desde /usr/local/lib/smartdining (timer): desde el clon de ese entorno.
    comando="cd $ruta && sudo ENTORNO=$ENTORNO sh infra/scripts/instalar-respaldos.sh"
  fi
  fallar "no existe $RESPALDOS_DIR/$proyecto: no se respaldó nada (un despliegue se detiene aquí, antes de migrar). Prepáralo UNA vez en el VPS, con un usuario con sudo:
  $comando
y vuelve a lanzar el despliegue (docs/despliegue.md §4)."
fi
destino=$RESPALDOS_DIR/$proyecto/$TIPO
mkdir -p "$destino"
# Restos de una corrida que murió de golpe (kill -9, apagón).
find "$destino" \( -name '*.dump.tmp' -o -name '*.tar.gz.tmp' \) -mmin +60 -exec rm -f {} + 2>/dev/null || true

base=$destino/$TIPO-$(date +%Y%m%d-%H%M%S)$sufijo
final=$base.dump
final_img=$base.tar.gz
[ ! -e "$final" ] || fallar "ya existe $final"
[ ! -e "$final_img" ] || fallar "ya existe $final_img"
tmp=$final.tmp
tmp_img=$final_img.tmp
trap 'rm -f "$tmp" "$tmp_img"' EXIT
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

# --- 4. Volumen de imágenes (D-23) ------------------------------------------------
vol=$("$DOCKER" volume ls -q --filter "label=com.docker.compose.project=$proyecto" --filter "label=com.docker.compose.volume=imagenes") \
  || fallar "no se pudo consultar los volúmenes de Docker"
n_img=0
if [ -n "$vol" ]; then
  [ "$(printf '%s\n' "$vol" | grep -c .)" -eq 1 ] || fallar "hay más de un volumen de imágenes de $proyecto"
  imagen=$("$DOCKER" inspect -f '{{.Config.Image}}' "$id") \
    || fallar "no se pudo leer la imagen del postgres de $proyecto"
  "$DOCKER" run --rm --pull never --network none -v "$vol:/imagenes:ro" --entrypoint tar "$imagen" \
    -czf - -C /imagenes . > "$tmp_img" \
    || fallar "no se pudo empaquetar el volumen $vol; no se guardó nada"
  [ -s "$tmp_img" ] || fallar "el tar.gz de $vol salió vacío; no se guardó nada"
  gzip -t < "$tmp_img" 2>/dev/null || fallar "el tar.gz de $vol está corrupto (gzip -t); no se guardó nada"
  entradas=$(tar -tzf - < "$tmp_img" 2>/dev/null) || fallar "el tar.gz de $vol no se puede listar; no se guardó nada"
  printf '%s\n' "$entradas" | grep -qx '\./' || fallar "el tar.gz de $vol no trae la carpeta raíz; no se guardó nada"
  n_img=$(printf '%s\n' "$entradas" | grep -c '\.webp$' || true)
else
  echo "respaldo: aviso: $proyecto todavía no tiene el volumen de imágenes; solo se respalda la base" >&2
fi

mv "$tmp" "$final"
[ -z "$vol" ] || mv "$tmp_img" "$final_img"

# --- 5. Rotación (por nombre: la fecha va en él; dumps y tar.gz por separado) ------
rotar() {
  ls -1 "$destino" \
    | grep -E "^$TIPO-[0-9]{8}-[0-9]{6}(-[0-9a-f]{7})?\\.$1\$" \
    | sort -r \
    | tail -n +"$((conservar + 1))" \
    | while read -r viejo; do rm -f "$destino/$viejo"; done
}
rotar 'dump'
rotar 'tar\.gz'

echo "respaldo: $proyecto $TIPO -> $final ($(wc -c < "$final" | tr -d ' ') bytes; se conservan $conservar)"
[ -z "$vol" ] || echo "respaldo: $proyecto $TIPO -> $final_img ($(wc -c < "$final_img" | tr -d ' ') bytes, $n_img imágenes .webp)"
