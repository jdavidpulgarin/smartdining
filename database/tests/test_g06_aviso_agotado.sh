#!/bin/sh
# ==============================================================================
# PRUEBA REPRODUCIBLE: G-06 · aviso de insumo agotado (script 28)
# ARCHIVO: database/tests/test_g06_aviso_agotado.sh
# ==============================================================================
# Los pg_notify solo salen al confirmar, por eso no es un bloque DO: cada caso
# abre una sesión con LISTEN inventario, mueve el stock (autocommit o una
# transacción) y cuenta los avisos "stock_bajo" que llegan. Crea sus propios
# datos con prefijo "G06A" y los borra al final.
#
#   1. Cruza el mínimo hacia abajo (10 -> 2, mínimo 3)          -> 1 aviso
#   2. Ya estaba bajo y baja más sin llegar a 0 (2 -> 1)         -> 0 avisos
#   3. Ya estaba bajo y LLEGA A 0 (1 -> 0)                       -> 1 aviso  (nuevo en el 28)
#   4. Se repone desde 0 (0 -> 2) y baja sin cruzar ni agotarse  -> 0 avisos
#   5. Sobre el mínimo, sin cruzarlo (10 -> 9)                   -> 0 avisos
#   6. Mínimo 0: 3 -> 0 cumple las dos condiciones               -> 1 aviso (no 2)
#   7. Un pedido que en la MISMA transacción cruza el mínimo y llega a 0
#      (dos detalles de 2 unidades, stock 4, mínimo 3)           -> 2 avisos: "bajo" y "agotado"
#   8. El libro sigue cuadrando: SUM(movimientos) = stock_actual.
#
# Uso (misma conexión que migrar.sh: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE):
#   sh database/tests/test_g06_aviso_agotado.sh
#   docker compose exec -T postgres sh /smartdining-db/tests/test_g06_aviso_agotado.sh
# Variable: PSQL (ruta de psql).
# ==============================================================================
set -eu

PSQL=${PSQL:-psql}
PGUSER=${PGUSER:-${POSTGRES_USER:-postgres}}
PGDATABASE=${PGDATABASE:-${POSTGRES_DB:-smartdining}}
PGCLIENTENCODING=UTF8
export PGUSER PGDATABASE PGCLIENTENCODING

TMP=$(mktemp -d)
fallos=0

q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -c "$1" | tr -d '\r'; }
ok() { echo "OK    $*"; }
mal() { echo "FALLA $*"; fallos=$((fallos + 1)); }

limpiar() {
  q "DELETE FROM pedidos WHERE codigo_pedido LIKE 'G06A-%';
     DELETE FROM movimientos_inventario WHERE id_insumo IN (SELECT id_insumo FROM insumos WHERE nombre LIKE 'G06A %');
     DELETE FROM recetas_plato WHERE id_plato IN (SELECT id_plato FROM platos WHERE nombre LIKE 'G06A %');
     DELETE FROM platos WHERE nombre LIKE 'G06A %';
     DELETE FROM categorias WHERE nombre = 'G06A Prueba';
     DELETE FROM insumos WHERE nombre LIKE 'G06A %';" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar
TMP=$(mktemp -d)

# --- Datos ----------------------------------------------------------------------
# Un insumo con mínimo 3 (casos 1 a 5), uno con mínimo 0 (caso 6) y un plato que
# consume 2 unidades de un tercero (caso 7).
q "INSERT INTO insumos (nombre, unidad, stock_minimo) VALUES
     ('G06A Queso', 'unidad', 3), ('G06A Sal', 'unidad', 0), ('G06A Pan', 'unidad', 3);
   INSERT INTO categorias (nombre, orden_visualizacion) VALUES ('G06A Prueba', 97);
   INSERT INTO platos (id_categoria, nombre, precio)
     SELECT id_categoria, 'G06A Sanduche', 9000 FROM categorias WHERE nombre = 'G06A Prueba';
   INSERT INTO recetas_plato (id_plato, id_insumo, cantidad)
     SELECT p.id_plato, s.id_insumo, 2 FROM platos p, insumos s
     WHERE p.nombre = 'G06A Sanduche' AND s.nombre = 'G06A Pan';" >/dev/null

QUESO=$(q "SELECT id_insumo FROM insumos WHERE nombre = 'G06A Queso'")
SAL=$(q "SELECT id_insumo FROM insumos WHERE nombre = 'G06A Sal'")
PAN=$(q "SELECT id_insumo FROM insumos WHERE nombre = 'G06A Pan'")
PLATO=$(q "SELECT id_plato FROM platos WHERE nombre = 'G06A Sanduche'")
MESA=$(q "SELECT id_mesa FROM mesas WHERE activa ORDER BY id_mesa LIMIT 1")

# Sin datos no hay prueba: mejor cortar aquí que dar casos "en verde" por accidente.
if [ -z "$QUESO" ] || [ -z "$SAL" ] || [ -z "$PAN" ] || [ -z "$PLATO" ] || [ -z "$MESA" ]; then
  echo "FALLA no se pudieron crear los datos de la prueba (¿la base tiene el script 27 y una mesa activa?)"
  exit 1
fi

# Deja el stock en un valor exacto con un movimiento (fuera de la sesión que escucha).
poner() {
  q "SELECT registrar_movimiento_inventario($1, 'ajuste', $2 - stock_actual, 'prueba G06A')
     FROM insumos WHERE id_insumo = $1 AND stock_actual <> $2" >/dev/null
}

# Corre un movimiento en una sesión con LISTEN y cuenta los avisos stock_bajo del insumo.
avisos() {
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -c "LISTEN inventario" -c "$2" -c "SELECT 1" \
    >"$TMP/out" 2>&1 || true
  grep '"tipo" *: *"stock_bajo"' "$TMP/out" | grep -c "\"id_insumo\" *: *$1[,}]" || true
}

mov() { echo "SELECT registrar_movimiento_inventario($1, '$2', $3, 'prueba G06A')"; }

esperar() { # caso, esperado, obtenido
  if [ "$3" = "$2" ]; then ok "$1 -> $3 aviso(s)"; else mal "$1: se esperaban $2 avisos y llegaron $3 ($(tr '\n' ' ' <"$TMP/out" | cut -c1-240))"; fi
}

# --- Casos ----------------------------------------------------------------------
poner "$QUESO" 10
esperar "1. cruza el mínimo (10 -> 2, mínimo 3)" 1 "$(avisos "$QUESO" "$(mov "$QUESO" merma 8)")"
esperar "2. ya bajo, baja sin agotarse (2 -> 1)" 0 "$(avisos "$QUESO" "$(mov "$QUESO" merma 1)")"
esperar "3. ya bajo y LLEGA A 0 (1 -> 0)" 1 "$(avisos "$QUESO" "$(mov "$QUESO" merma 1)")"
esperar "4. se repone desde 0 (0 -> 2)" 0 "$(avisos "$QUESO" "$(mov "$QUESO" entrada 2)")"
poner "$QUESO" 10
esperar "5. sobre el mínimo, sin cruzarlo (10 -> 9)" 0 "$(avisos "$QUESO" "$(mov "$QUESO" merma 1)")"

poner "$SAL" 3
esperar "6. mínimo 0: 3 -> 0 cumple las dos condiciones, un solo aviso" 1 "$(avisos "$SAL" "$(mov "$SAL" merma 3)")"

# 7. Dos detalles del mismo plato en un pedido: la reserva descuenta el pan dos
#    veces en la misma transacción (4 -> 2 cruza el mínimo; 2 -> 0 se agota).
poner "$PAN" 4
PEDIDO_SQL="BEGIN;
  INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES ($MESA, 'G06A-1', 'recibido', 0);
  INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    SELECT p.id_pedido, $PLATO, 1, 9000, 9000 FROM pedidos p, generate_series(1, 2) WHERE p.codigo_pedido = 'G06A-1';
  COMMIT;"
n=$(avisos "$PAN" "$PEDIDO_SQL")
bajo=$(grep '"tipo" *: *"stock_bajo"' "$TMP/out" | grep "\"id_insumo\" *: *$PAN[,}]" | grep -cE '"stock_actual" *: *2([.]0+)?[,} ]' || true)
agotado=$(grep '"tipo" *: *"stock_bajo"' "$TMP/out" | grep "\"id_insumo\" *: *$PAN[,}]" | grep -cE '"stock_actual" *: *0([.]0+)?[,} ]' || true)
if [ "$n" = 2 ] && [ "$bajo" = 1 ] && [ "$agotado" = 1 ]; then
  ok "7. un pedido que cruza el mínimo y llega a 0 -> 2 avisos (stock 2 y stock 0)"
else
  mal "7. avisos=$n (bajo=$bajo, agotado=$agotado): $(tr '\n' ' ' <"$TMP/out" | cut -c1-300)"
fi

# 8. El libro sigue cuadrando en los tres insumos de la prueba.
descuadres=$(q "SELECT count(*) FROM insumos s WHERE s.nombre LIKE 'G06A %'
                AND s.stock_actual <> COALESCE((SELECT SUM(m.cantidad) FROM movimientos_inventario m WHERE m.id_insumo = s.id_insumo), 0)")
if [ "$descuadres" = 0 ]; then ok "8. el libro cuadra: SUM(movimientos) = stock_actual"; else mal "8. $descuadres insumos no cuadran"; fi

if [ "$fallos" -eq 0 ]; then
  echo "=== PRUEBA G-06 (aviso de insumo agotado) PASADA ==="
else
  echo "=== PRUEBA G-06 (aviso de insumo agotado): $fallos FALLA(S) ==="
  exit 1
fi
