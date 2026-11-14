#!/bin/sh
# ==============================================================================
# SmartDining · infra/scripts/simulacro-restauracion.sh (R-18)
#
# Comprueba que un respaldo se puede restaurar, SIN tocar la base real:
#
#   ENTORNO=staging sh infra/scripts/simulacro-restauracion.sh               # el diario más reciente
#   ENTORNO=produccion sh infra/scripts/simulacro-restauracion.sh ARCHIVO.dump # uno en concreto
#   sh infra/scripts/simulacro-restauracion.sh --entorno staging [ARCHIVO.dump]
#
# ENTORNO (variable o --entorno, OBLIGATORIO y sin valor por defecto) elige el
# proyecto: staging = smartdining-staging, produccion = smartdining. La base en
# vivo con la que se compara y la carpeta de respaldos son las de ese proyecto.
# Cualquier otro valor, o ninguno: sale con 2 sin tocar nada.
#
# Como deploy (o con sudo -u deploy), en el VPS:
#   1. Levanta un postgres TEMPORAL sin red (--network none) y sin ningún
#      volumen: los datos van en un tmpfs (RAM), así no queda nada en disco.
#      Usa la misma imagen que el postgres en marcha.
#   2. Restaura el respaldo en una base nueva (pg_restore --exit-on-error).
#   3. Compara con la base en vivo: tablas en public, cantidad y última fila
#      de schema_migraciones (deben ser iguales). usuarios y pedidos se
#      muestran como referencia (la base en vivo sigue cambiando).
#   4. Imágenes (D-23): si junto al .dump está su .tar.gz (mismo nombre), lo
#      valida (gzip -t, carpeta raíz, ninguna ruta absoluta ni con ..), lo
#      extrae dentro del contenedor temporal y comprueba que salen todas las
#      .webp que lista. La cantidad del volumen en vivo es solo referencia.
#      Sin .tar.gz (respaldo anterior a D-23) solo avisa.
#   5. Borra el contenedor temporal, también si algo falla.
#
# Sale con 0 solo si todo cuadra.
# Variables: RESPALDOS_DIR (/srv/respaldos), IMAGEN (si no hay postgres en marcha).
# ==============================================================================
set -eu

DOCKER=${DOCKER:-docker}
RESPALDOS_DIR=${RESPALDOS_DIR:-/srv/respaldos}

fallar() {
  echo "simulacro: ERROR: $*" >&2
  exit 1
}

if [ "${1:-}" = "--entorno" ]; then
  ENTORNO=${2:-}
  if [ "$#" -ge 2 ]; then shift 2; else shift; fi
fi
case "${ENTORNO:-}" in
  staging) proyecto=smartdining-staging ;;
  produccion) proyecto=smartdining ;;
  *)
    echo "simulacro: ERROR: ENTORNO debe ser 'staging' o 'produccion' (recibido: '${ENTORNO:-}'). No se hizo nada." >&2
    echo "uso: ENTORNO=staging|produccion sh $0 [ARCHIVO.dump]   (o: sh $0 --entorno <entorno> [ARCHIVO.dump])" >&2
    exit 2
    ;;
esac

# --- Base en vivo de ese entorno (si hay) --------------------------------------
vivo=$("$DOCKER" ps -q --filter "label=com.docker.compose.project=$proyecto" --filter "label=com.docker.compose.service=postgres")
[ "$(printf '%s\n' "$vivo" | grep -c .)" -le 1 ] || fallar "hay más de un postgres de $proyecto corriendo"

archivo=${1:-}
if [ -z "$archivo" ]; then
  [ -n "$vivo" ] || fallar "no hay postgres de $proyecto en marcha: indica el archivo .dump"
  archivo=$(ls -1 "$RESPALDOS_DIR/$proyecto/diario"/diario-*.dump 2>/dev/null | sort | tail -n 1 || true)
  [ -n "$archivo" ] || fallar "no hay respaldos diarios en $RESPALDOS_DIR/$proyecto/diario"
fi
[ -f "$archivo" ] && [ -r "$archivo" ] || fallar "no se puede leer $archivo"

# --- Imágenes: validación en el host --------------------------------------------
tar_img=${archivo%.dump}.tar.gz
r_img=- v_img=-
if [ -f "$tar_img" ]; then
  [ -r "$tar_img" ] && [ -s "$tar_img" ] || fallar "no se puede leer $tar_img o está vacío"
  gzip -t < "$tar_img" 2>/dev/null || fallar "$tar_img está corrupto (gzip -t)"
  entradas=$(tar -tzf - < "$tar_img" 2>/dev/null) || fallar "$tar_img no se puede listar"
  printf '%s\n' "$entradas" | grep -qx '\./' || fallar "$tar_img no trae la carpeta raíz"
  ! printf '%s\n' "$entradas" | grep -Eq '^/|(^|/)\.\.(/|$)' \
    || fallar "$tar_img trae rutas absolutas o con '..': no se restaura"
  r_img=$(printf '%s\n' "$entradas" | grep -c '\.webp$' || true)
else
  echo "simulacro: aviso: no hay $tar_img (respaldo anterior a D-23): solo se prueba la base" >&2
fi

if [ -n "$vivo" ]; then
  imagen=$("$DOCKER" inspect -f '{{.Config.Image}}' "$vivo")
else
  imagen=${IMAGEN:-postgres:16-alpine}
fi

# --- Contenedor temporal ----------------------------------------------------------
nombre=sd-simulacro-$(date +%Y%m%d%H%M%S)-$$
clave=$(od -An -N 18 -tx1 /dev/urandom | tr -d ' \n')
# -v: si algún día el contenedor tuviera un volumen anónimo, se borra con él
# (sin -v, `rm -f` lo dejaba huérfano en cada simulacro).
limpiar() { "$DOCKER" rm -f -v "$nombre" >/dev/null 2>&1 || true; }
trap limpiar EXIT
trap 'exit 1' HUP INT TERM

echo "simulacro: $archivo ($(wc -c < "$archivo" | tr -d ' ') bytes)"
echo "simulacro: contenedor temporal $nombre ($imagen, sin red)"
# PGDATA en un tmpfs: la imagen declara VOLUME /var/lib/postgresql/data y,
# sin esto, Docker crea ahí un volumen anónimo.
"$DOCKER" run -d --rm --name "$nombre" --network none \
  --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_PASSWORD="$clave" "$imagen" >/dev/null \
  || fallar "no se pudo levantar el postgres temporal"

# Durante la inicialización el entrypoint arranca un servidor que solo escucha
# por socket: el definitivo es el que responde por TCP local.
i=0
until "$DOCKER" exec "$nombre" pg_isready -q -h 127.0.0.1 -U postgres 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 90 ] || fallar "el postgres temporal no arrancó en 90 s"
  sleep 1
done

"$DOCKER" cp "$archivo" "$nombre:/tmp/respaldo.dump" >/dev/null
"$DOCKER" exec "$nombre" createdb -U postgres restaurada
inicio=$(date +%s)
"$DOCKER" exec "$nombre" pg_restore -U postgres --exit-on-error --no-owner --no-privileges \
  -d restaurada /tmp/respaldo.dump || fallar "pg_restore falló: el respaldo NO se puede restaurar"
segundos=$(($(date +%s) - inicio))

# --- Imágenes: extracción en el contenedor temporal ----------------------------------
if [ "$r_img" != "-" ]; then
  "$DOCKER" cp "$tar_img" "$nombre:/tmp/imagenes.tar.gz" >/dev/null
  x_img=$("$DOCKER" exec "$nombre" sh -c 'mkdir /tmp/imagenes && tar -xzf /tmp/imagenes.tar.gz -C /tmp/imagenes && find /tmp/imagenes -type f -name "*.webp" | wc -l') \
    || fallar "el tar.gz de imágenes no se pudo extraer: NO se puede restaurar"
  x_img=$(printf '%s' "$x_img" | tr -d ' \r\n')
  [ "$x_img" = "$r_img" ] || fallar "el tar.gz lista $r_img imágenes .webp y al extraerlo salen $x_img"
  if [ -n "$vivo" ]; then
    vol=$("$DOCKER" volume ls -q --filter "label=com.docker.compose.project=$proyecto" --filter "label=com.docker.compose.volume=imagenes")
    if [ -n "$vol" ]; then
      v_img=$("$DOCKER" run --rm --pull never --network none -v "$vol:/imagenes:ro" --entrypoint sh "$imagen" \
        -c 'find /imagenes -type f -name "*.webp" | wc -l' | tr -d ' \r\n') || v_img=-
    fi
  fi
fi

# --- Verificación -------------------------------------------------------------------
CONSULTA="SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
  (SELECT count(*) FROM schema_migraciones),
  (SELECT COALESCE(max(nombre), '-') FROM schema_migraciones),
  (SELECT count(*) FROM usuarios),
  (SELECT count(*) FROM pedidos)"

r=$("$DOCKER" exec "$nombre" psql -X -At -F ' ' -v ON_ERROR_STOP=1 -U postgres -d restaurada -c "$CONSULTA") \
  || fallar "la base restaurada no responde a la verificación (¿faltan tablas?)"
# shellcheck disable=SC2086
set -- $r
r_tablas=$1 r_migr=$2 r_ultima=$3 r_usuarios=$4 r_pedidos=$5

v_tablas=- v_migr=- v_ultima=- v_usuarios=- v_pedidos=-
if [ -n "$vivo" ]; then
  v=$("$DOCKER" exec "$vivo" sh -c 'psql -X -At -F " " -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$CONSULTA") \
    || fallar "no se pudo consultar la base en vivo"
  # shellcheck disable=SC2086
  set -- $v
  v_tablas=$1 v_migr=$2 v_ultima=$3 v_usuarios=$4 v_pedidos=$5
fi

printf '\n%-22s %-34s %s\n' "" "restaurada" "en vivo${vivo:+ ($proyecto)}"
printf '%-22s %-34s %s\n' "tablas (public)" "$r_tablas" "$v_tablas"
printf '%-22s %-34s %s\n' "schema_migraciones" "$r_migr" "$v_migr"
# printf cuenta bytes: "ú" y "ó" ocupan dos cada una, de ahí el 24.
printf '%-24s %-34s %s\n' "última migración" "$r_ultima" "$v_ultima"
printf '%-22s %-34s %s\n' "usuarios" "$r_usuarios" "$v_usuarios"
printf '%-22s %-34s %s\n' "pedidos" "$r_pedidos" "$v_pedidos"
# "á" ocupa dos bytes, de ahí el 23.
printf '%-23s %-34s %s\n' "imágenes .webp" "$r_img" "$v_img"
printf '%-22s %s s\n\n' "pg_restore" "$segundos"

[ "$r_tablas" -gt 0 ] && [ "$r_migr" -gt 0 ] || fallar "la base restaurada está vacía"
if [ -n "$vivo" ]; then
  [ "$r_tablas" = "$v_tablas" ] || fallar "la restaurada tiene $r_tablas tablas y la base en vivo $v_tablas"
  [ "$r_migr" = "$v_migr" ] && [ "$r_ultima" = "$v_ultima" ] \
    || fallar "schema_migraciones no coincide con la base en vivo (¿se migró después de este respaldo?)"
fi

limpiar
trap - EXIT
[ -z "$("$DOCKER" ps -aq --filter "name=^$nombre\$")" ] || fallar "no se pudo borrar $nombre"
if [ "$r_img" != "-" ]; then
  echo "simulacro: OK. La base y las $r_img imágenes se restauran completas; contenedor temporal borrado."
else
  echo "simulacro: OK. El respaldo se restaura completo; contenedor temporal borrado."
fi
