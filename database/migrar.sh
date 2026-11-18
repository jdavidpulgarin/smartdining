#!/bin/sh
# ==============================================================================
# SmartDining · database/migrar.sh (P-17)
#
# Aplica, en orden, los scripts de database/scripts/ que esta base todavía no
# tiene registrados en schema_migraciones. Cada script corre en UNA transacción
# junto con su registro: o queda aplicado y registrado, o no queda nada.
#
# Antes de aplicar nada revisa los ya aplicados: si alguno cambió (checksum
# distinto del registrado) se detiene con error. Un script aplicado NUNCA se
# edita; el cambio va en un script nuevo.
#
# Tres situaciones:
#   - base vacía: carga la línea base con 00_ejecutar_todo.sql (schema, 01 a 25
#     y seed) y después los scripts nuevos (26 en adelante).
#   - base cargada antes de P-17 (sin schema_migraciones): corre solo el 25,
#     que registra 00 a 25 como aplicados, y después los scripts nuevos.
#   - base al día: aplica solo lo que falte. Si no falta nada, no cambia nada.
#
# Conexión: variables estándar de PostgreSQL (PGHOST, PGPORT, PGUSER,
# PGPASSWORD, PGDATABASE). Dentro del contenedor de postgres caen en
# POSTGRES_USER y POSTGRES_DB por el socket local, sin contraseña.
#
# Uso:
#   Docker (recomendado, igual que en producción):
#     docker compose exec -T postgres sh /smartdining-db/migrar.sh
#   Git Bash en Windows, con un PostgreSQL local:
#     PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe" PGUSER=postgres \
#       PGDATABASE=smartdining sh database/migrar.sh
#
# Variables opcionales:
#   PSQL                 ruta de psql (por defecto: psql del PATH)
#   MIGRAR_SCRIPTS_DIR   carpeta de scripts (por defecto: database/scripts)
#
# Es POSIX sh a propósito: la imagen postgres:16-alpine no trae bash.
# No corras dos migraciones a la vez sobre la misma base.
# ==============================================================================
set -eu

DIR_BASE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS_DIR=${MIGRAR_SCRIPTS_DIR:-$DIR_BASE/scripts}
PSQL=${PSQL:-psql}

PGUSER=${PGUSER:-${POSTGRES_USER:-postgres}}
PGDATABASE=${PGDATABASE:-${POSTGRES_DB:-smartdining}}
PGCLIENTENCODING=UTF8
export PGUSER PGDATABASE PGCLIENTENCODING

LINEA_BASE=00_ejecutar_todo.sql
SCRIPT_REGISTRO=25_schema_migraciones.sql

fallar() {
  echo "migrar: ERROR: $*" >&2
  exit 1
}

# Consulta sin formato. -X: no lee ~/.psqlrc. Se quitan los \r porque psql.exe
# en Windows termina las líneas en \r\n ("t\r" no es "t"); se captura primero
# para no perder el código de salida de psql en una tubería.
consulta() {
  salida=$("$PSQL" -X -q -At -v ON_ERROR_STOP=1 -c "$1") || return 1
  printf '%s\n' "$salida" | tr -d '\r'
}

# sha256 del archivo SIN retornos de carro: un checkout con CRLF en Windows no
# debe parecer un script editado.
checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    tr -d '\r' < "$1" | sha256sum | cut -d ' ' -f 1
  else
    tr -d '\r' < "$1" | shasum -a 256 | cut -d ' ' -f 1
  fi
}

# El nombre va dentro de SQL: solo se aceptan los que cumplen la convención
# (y el CHECK de la tabla), así no puede llevar comillas.
nombre_valido() {
  echo "$1" | grep -Eq '^[0-9]{2,}_[A-Za-z0-9_]+\.sql$'
}

# Aplica un script y lo registra en la MISMA transacción (--single-transaction
# envuelve el -f y el -c). Si el script ya estaba registrado con checksum NULL
# (la línea base), le fija el checksum.
aplicar() {
  nombre=$1
  suma=$2
  (
    cd "$SCRIPTS_DIR"
    # -o /dev/null: descarta los resultados de los SELECT del script (setval
    # del seed, etc.); los \echo de progreso y los errores sí se ven.
    "$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -o /dev/null \
      -f "$nombre" \
      -c "INSERT INTO schema_migraciones (nombre, checksum) VALUES ('$nombre', '$suma')
          ON CONFLICT (nombre) DO UPDATE SET checksum = EXCLUDED.checksum
          WHERE schema_migraciones.checksum IS NULL"
  ) || fallar "falló $nombre; se deshizo completo (nada quedó a medias). Corrígelo y vuelve a correr."
}

[ -d "$SCRIPTS_DIR" ] || fallar "no existe la carpeta de scripts: $SCRIPTS_DIR"
consulta "SELECT 1" >/dev/null || fallar "no hay conexión con la base '$PGDATABASE' (usuario '$PGUSER')."

echo "migrar: base '$PGDATABASE' en ${PGHOST:-socket local}, scripts en $SCRIPTS_DIR"

aplicados=0
adoptados=0
sin_cambios=0

# --- 1. Línea base ------------------------------------------------------------
if [ "$(consulta "SELECT to_regclass('public.schema_migraciones') IS NOT NULL")" != "t" ]; then
  if [ "$(consulta "SELECT to_regclass('public.usuarios') IS NULL")" = "t" ]; then
    echo "migrar: base vacía -> carga la línea base ($LINEA_BASE)"
    [ -f "$SCRIPTS_DIR/$LINEA_BASE" ] || fallar "falta $LINEA_BASE"
    aplicar "$LINEA_BASE" "$(checksum "$SCRIPTS_DIR/$LINEA_BASE")"
  else
    echo "migrar: base anterior a P-17 -> registra la línea base ($SCRIPT_REGISTRO)"
    [ -f "$SCRIPTS_DIR/$SCRIPT_REGISTRO" ] || fallar "falta $SCRIPT_REGISTRO"
    aplicar "$SCRIPT_REGISTRO" "$(checksum "$SCRIPTS_DIR/$SCRIPT_REGISTRO")"
  fi
  aplicados=$((aplicados + 1))
fi

# --- 2. Verificar los ya aplicados ANTES de aplicar nada ----------------------
cambiados=""
for ruta in "$SCRIPTS_DIR"/[0-9][0-9]*_*.sql; do
  [ -f "$ruta" ] || continue
  nombre=$(basename "$ruta")
  nombre_valido "$nombre" || fallar "nombre de script no válido: $nombre (usa NN_descripcion.sql)"
  registrado=$(consulta "SELECT COALESCE(checksum, '-') FROM schema_migraciones WHERE nombre = '$nombre'")
  if [ -n "$registrado" ] && [ "$registrado" != "-" ] && [ "$registrado" != "$(checksum "$ruta")" ]; then
    cambiados="$cambiados $nombre"
  fi
done
if [ -n "$cambiados" ]; then
  fallar "estos scripts ya aplicados cambiaron:$cambiados
  Un script aplicado NUNCA se edita: deshaz el cambio (git checkout -- <archivo>)
  y pon la corrección en un script nuevo. No se aplicó nada."
fi

# --- 3. Adoptar checksums de la línea base y aplicar los nuevos ---------------
for ruta in "$SCRIPTS_DIR"/[0-9][0-9]*_*.sql; do
  [ -f "$ruta" ] || continue
  nombre=$(basename "$ruta")
  suma=$(checksum "$ruta")
  registrado=$(consulta "SELECT COALESCE(checksum, '-') FROM schema_migraciones WHERE nombre = '$nombre'")

  if [ -z "$registrado" ]; then
    echo "migrar: aplica   $nombre"
    aplicar "$nombre" "$suma"
    aplicados=$((aplicados + 1))
  elif [ "$registrado" = "-" ]; then
    consulta "UPDATE schema_migraciones SET checksum = '$suma' WHERE nombre = '$nombre' AND checksum IS NULL" >/dev/null
    adoptados=$((adoptados + 1))
  else
    sin_cambios=$((sin_cambios + 1))
  fi
done

# Registrados cuyo archivo ya no está: no se deshace nada, solo se avisa.
for nombre in $(consulta "SELECT nombre FROM schema_migraciones ORDER BY nombre"); do
  [ -f "$SCRIPTS_DIR/$nombre" ] || echo "migrar: AVISO: $nombre está registrado pero el archivo ya no existe"
done

if [ "$adoptados" -gt 0 ]; then
  echo "migrar: checksum registrado para $adoptados script(s) de la línea base"
fi
if [ "$aplicados" -eq 0 ] && [ "$adoptados" -eq 0 ]; then
  echo "migrar: nada que hacer, la base está al día ($sin_cambios scripts sin cambios)"
else
  echo "migrar: listo: $aplicados aplicado(s), $adoptados adoptado(s), $sin_cambios sin cambios"
fi
