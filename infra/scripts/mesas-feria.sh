#!/bin/sh
# Mesas de la demo (feria) en el VPS, desde la raíz del clon. Es un script de
# DATOS, no una migración: el seed solo corre en una base vacía y staging y
# producción ya tienen mesas.
#
#   sh infra/scripts/mesas-feria.sh ver       # muestra qué cambiaría (no toca nada)
#   sh infra/scripts/mesas-feria.sh aplicar   # lo aplica, en una transacción
#
#   Staging:      ENV_FILE=infra/.env.staging sh infra/scripts/mesas-feria.sh ver
#   Más mesas:    FERIA_MESAS=20 sh infra/scripts/mesas-feria.sh ver
#
# Deja las mesas 1..FERIA_MESAS (15 por defecto):
# - CAPACIDAD realista por número, en ciclos de 2, 4, 4, 6 y 8 (las mesas 1-5
#   del seed ya son así): la que no exista se crea con esa capacidad
#   ('disponible', ubicación 'Feria', sin QR: el QR lo genera el panel); la
#   que tenga menos se sube; NUNCA se baja una capacidad.
# - OCUPADA SIN SESIÓN REAL (sin pedidos abiertos ni alias reservados), como
#   la mesa 3 del seed con su token falso: pasa a 'disponible' con
#   token_qr NULL, igual que la libera el backend.
# - OCUPADA CON SESIÓN REAL: no se toca y se avisa.
# Idempotente: correrlo dos veces no cambia nada la segunda vez.
#
# "Pedido abierto" es el mismo criterio del backend al liberar una mesa
# (liberarSiNoQuedanPedidosAbiertos): ni 'pagado' ni 'cancelado', y de la
# visita actual (creado desde sesion_iniciada_en, o sin sesión registrada).
# Un 'entregado' sin pagar es una cuenta pendiente: cuenta como abierto.
# Los alias reservados viven en Redis (sd:mesa:{id}:alias, los pone el
# backend al abrir la sesión por QR o al agregar a alguien sin celular). Si
# Redis no responde, no se libera nada.
#
# Por qué importa: el socket-server deja conectar a capacidad + 4 comensales
# por mesa (socket-server/src/limites.js) y la lee del backend con caché de
# 5 min; y una mesa 'ocupada' falsa no se puede abrir desde el panel.
# Requiere los contenedores postgres y redis en marcha.
set -eu

cd "$(dirname "$0")/../.."
ENV_FILE=${ENV_FILE:-infra/.env}
DOCKER=${DOCKER:-docker}
MODO=${1:-}
MESAS=${FERIA_MESAS:-15}

case "$MODO" in
  ver|aplicar) ;;
  *)
    echo "Uso: sh infra/scripts/mesas-feria.sh ver | aplicar   (FERIA_MESAS, ENV_FILE)" >&2
    exit 2 ;;
esac

# Solo un entero de 1 a 50: va escrito dentro del SQL.
case "$MESAS" in
  ''|*[!0-9]*) echo "FERIA_MESAS debe ser un entero de 1 a 50 (recibí '$MESAS')" >&2; exit 2 ;;
esac
if [ "$MESAS" -lt 1 ] || [ "$MESAS" -gt 50 ]; then
  echo "FERIA_MESAS debe ser un entero de 1 a 50 (recibí '$MESAS')" >&2; exit 2
fi

dc() { "$DOCKER" compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
psql_prod() {
  dc exec -T postgres sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# 1. Mesas con alias reservados, de Redis. Si falla, se detiene: sin saberlo
# no se puede decidir que una mesa ocupada no tiene a nadie.
claves=$(dc exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw --scan --pattern "sd:mesa:*:alias"' < /dev/null) || {
  echo "No pude leer los alias reservados de Redis: no se cambió nada." >&2
  exit 1
}
ALIAS=$(printf '%s\n' "$claves" | sed -n 's/^sd:mesa:\([0-9][0-9]*\):alias$/\1/p' | sort -n | tr '\n' ',' | sed 's/,$//')

# 2. El plan, el mismo para ver y para aplicar. MESAS y ALIAS ya son solo
# dígitos (y comas): se pueden escribir en el SQL.
PLAN="WITH objetivo AS (
  SELECT n AS numero, (ARRAY[2, 4, 4, 6, 8])[((n - 1) % 5) + 1] AS capacidad
    FROM generate_series(1, $MESAS) AS n
), abiertos AS (
  SELECT p.id_mesa, count(*)::int AS n
    FROM pedidos p JOIN mesas m ON m.id_mesa = p.id_mesa
   WHERE p.estado NOT IN ('pagado', 'cancelado')
     AND (m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en)
   GROUP BY p.id_mesa
), plan AS (
  SELECT o.numero, m.id_mesa, m.capacidad AS capacidad_actual,
         GREATEST(COALESCE(m.capacidad, 0), o.capacidad) AS capacidad_final,
         m.estado AS estado_actual,
         COALESCE(a.n, 0) AS pedidos_abiertos,
         COALESCE(m.id_mesa = ANY('{$ALIAS}'::int[]), false) AS alias_reservados
    FROM objetivo o
    LEFT JOIN mesas m ON m.numero = o.numero
    LEFT JOIN abiertos a ON a.id_mesa = m.id_mesa
)"

MOSTRAR="$PLAN
SELECT numero,
       CASE WHEN id_mesa IS NULL THEN 'nueva: ' || capacidad_final
            WHEN capacidad_final > capacidad_actual THEN capacidad_actual || ' → ' || capacidad_final
            ELSE capacidad_actual::text END AS capacidad,
       CASE WHEN id_mesa IS NULL THEN 'se crea disponible, sin QR'
            WHEN estado_actual <> 'ocupada' THEN estado_actual || ' (sin cambio)'
            WHEN pedidos_abiertos > 0 OR alias_reservados
              THEN 'ocupada CON SESIÓN REAL: no se toca'
                   || CASE WHEN pedidos_abiertos > 0 THEN ' (' || pedidos_abiertos || ' pedido(s) abierto(s))' ELSE '' END
                   || CASE WHEN alias_reservados THEN ' (alias reservados)' ELSE '' END
            ELSE 'ocupada sin sesión → disponible, sin QR' END AS estado
  FROM plan ORDER BY numero;"

AVISOS="$PLAN
SELECT 'AVISO: la mesa ' || numero || ' está ocupada con una sesión real ('
       || concat_ws(' y ', CASE WHEN pedidos_abiertos > 0 THEN pedidos_abiertos || ' pedido(s) abierto(s)' END,
                           CASE WHEN alias_reservados THEN 'alias reservados' END)
       || '): no se tocó. Libérala desde el panel cuando la mesa se vaya.'
  FROM plan WHERE estado_actual = 'ocupada' AND (pedidos_abiertos > 0 OR alias_reservados) ORDER BY numero;"

echo "Mesas 1 a $MESAS ($ENV_FILE). Mesas con alias reservados (id_mesa): ${ALIAS:-ninguna}."
if [ "$MODO" = ver ]; then
  echo "Modo ver: no se cambia nada."
  printf '%s\n' "$MOSTRAR" | psql_prod
  printf '\\pset tuples_only on\n\\pset format unaligned\n%s\n' "$AVISOS" | psql_prod
  exit 0
fi

echo "Plan:"
printf '%s\n' "$MOSTRAR" | psql_prod
# 3. Aplicar en UNA transacción. El LOCK impide que el backend cambie una
# mesa entre el plan y los UPDATE (dura milisegundos); cada sentencia vuelve
# a calcular el plan con la base ya bloqueada.
psql_prod <<SQL
BEGIN;
LOCK TABLE mesas IN SHARE ROW EXCLUSIVE MODE;
$PLAN
INSERT INTO mesas (numero, capacidad, ubicacion, estado)
SELECT numero, capacidad_final, 'Feria', 'disponible' FROM plan WHERE id_mesa IS NULL;
$PLAN
UPDATE mesas m SET capacidad = p.capacidad_final
  FROM plan p
 WHERE m.id_mesa = p.id_mesa AND p.capacidad_final > p.capacidad_actual;
$PLAN
UPDATE mesas m SET estado = 'disponible', token_qr = NULL
  FROM plan p
 WHERE m.id_mesa = p.id_mesa AND p.estado_actual = 'ocupada'
   AND p.pedidos_abiertos = 0 AND NOT p.alias_reservados;
COMMIT;
SQL
echo "Después:"
printf '%s\n' "$MOSTRAR" | psql_prod
printf '\\pset tuples_only on\n\\pset format unaligned\n%s\n' "$AVISOS" | psql_prod
echo "Listo. El socket-server toma las capacidades nuevas en máximo 5 min (caché)."
