#!/bin/sh
# Mesas de la demo (feria) en el VPS, desde la raíz del clon. Es un script de
# DATOS, no una migración: el seed solo corre en una base vacía y staging y
# producción ya tienen mesas.
#
#   sh infra/scripts/mesas-feria.sh ver       # muestra qué cambiaría (no toca nada)
#   sh infra/scripts/mesas-feria.sh aplicar   # crea las que falten y sube la capacidad
#
#   Staging:    ENV_FILE=infra/.env.staging sh infra/scripts/mesas-feria.sh aplicar
#   Otro montaje: FERIA_MESAS=8 FERIA_CAPACIDAD=10 sh infra/scripts/mesas-feria.sh ver
#
# Mesas 1..FERIA_MESAS (6 por defecto) con capacidad FERIA_CAPACIDAD (8):
# - la que no exista se crea ('disponible', ubicación 'Feria', sin QR: el QR lo
#   genera el panel como en cualquier mesa);
# - la que tenga menos capacidad se sube; NUNCA se baja ni se toca su estado.
# Idempotente: correrlo dos veces no cambia nada la segunda vez.
#
# Por qué importa: el socket-server deja conectar a capacidad + 4 comensales
# por mesa (socket-server/src/limites.js) y la lee del backend con caché de
# 5 min. Con la capacidad del seed (2 a 8), una mesa de 2 con 8 personas se
# llena en la sexta (MESA_LLENA). Requiere el contenedor postgres en marcha.
set -eu

cd "$(dirname "$0")/../.."
ENV_FILE=${ENV_FILE:-infra/.env}
DOCKER=${DOCKER:-docker}
MODO=${1:-}
MESAS=${FERIA_MESAS:-6}
CAPACIDAD=${FERIA_CAPACIDAD:-8}

# Solo enteros de 1 a 50 (el socket-server ignora capacidades mayores a 50).
entero_1_50() {
  case "$2" in
    ''|*[!0-9]*) echo "$1 debe ser un entero de 1 a 50 (recibí '$2')" >&2; exit 2 ;;
  esac
  if [ "$2" -lt 1 ] || [ "$2" -gt 50 ]; then
    echo "$1 debe ser un entero de 1 a 50 (recibí '$2')" >&2; exit 2
  fi
}
entero_1_50 FERIA_MESAS "$MESAS"
entero_1_50 FERIA_CAPACIDAD "$CAPACIDAD"

psql_prod() {
  "$DOCKER" compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T postgres \
    sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# Los números ya están validados como enteros: se pueden escribir en el SQL.
PLAN="SELECT n AS numero, m.capacidad AS capacidad_actual,
       CASE WHEN m.id_mesa IS NULL THEN 'se crea con $CAPACIDAD'
            WHEN m.capacidad < $CAPACIDAD THEN 'sube a $CAPACIDAD'
            ELSE 'sin cambio' END AS cambio
  FROM generate_series(1, $MESAS) AS n LEFT JOIN mesas m ON m.numero = n
 ORDER BY n;"

case "$MODO" in
  ver)
    echo "Mesas 1 a $MESAS con capacidad $CAPACIDAD ($ENV_FILE). No se cambia nada:"
    printf '%s\n' "$PLAN" | psql_prod
    ;;
  aplicar)
    echo "Mesas 1 a $MESAS con capacidad $CAPACIDAD ($ENV_FILE):"
    printf '%s\n' "$PLAN" | psql_prod
    psql_prod <<SQL
BEGIN;
INSERT INTO mesas (numero, capacidad, ubicacion, estado)
SELECT n, $CAPACIDAD, 'Feria', 'disponible'
  FROM generate_series(1, $MESAS) AS n
 WHERE NOT EXISTS (SELECT 1 FROM mesas m WHERE m.numero = n);
UPDATE mesas SET capacidad = $CAPACIDAD
 WHERE numero BETWEEN 1 AND $MESAS AND capacidad < $CAPACIDAD;
COMMIT;
SELECT numero, capacidad, estado, ubicacion FROM mesas WHERE numero BETWEEN 1 AND $MESAS ORDER BY numero;
SQL
    echo "Listo. El socket-server toma la capacidad nueva en máximo 5 min (caché)."
    ;;
  *)
    echo "Uso: sh infra/scripts/mesas-feria.sh ver | aplicar   (FERIA_MESAS, FERIA_CAPACIDAD, ENV_FILE)" >&2
    exit 2
    ;;
esac
