#!/bin/sh
# ==============================================================================
# PRUEBA REPRODUCIBLE: P-19 · concurrencia de la reserva y avisos pg_notify
# ARCHIVO: database/tests/test_p19_concurrencia.sh
# ==============================================================================
# Necesita COMMIT de verdad (la reserva es un trigger diferido), por eso no es
# un bloque DO. Crea sus propios datos con prefijo "P19C" y los borra al final.
#
#   A. Dos sesiones por la ÚLTIMA porción: la primera la reserva y retiene el
#      bloqueo; la segunda espera ese bloqueo y recibe SD001. Una gana.
#   B. N pedidos simultáneos (50 por defecto) por las últimas M porciones (10):
#      exactamente M confirmados, el resto SD001, stock 0 y nunca negativo.
#   D. 30 pedidos con dos insumos insertados en orden cruzado: ningún deadlock
#      (la reserva bloquea todos los insumos del pedido a la vez, por id_insumo).
#   C. pg_notify('inventario'): cruzar el mínimo y quedar sin stock avisan
#      "stock_bajo" y "disponibilidad" al confirmar.
#
# Uso (misma conexión que migrar.sh: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE):
#   sh database/tests/test_p19_concurrencia.sh
#   docker compose exec -T postgres sh /smartdining-db/tests/test_p19_concurrencia.sh
# Variables: PSQL (ruta de psql), PEDIDOS (50), PORCIONES (10).
# ==============================================================================
set -eu

PSQL=${PSQL:-psql}
PGUSER=${PGUSER:-${POSTGRES_USER:-postgres}}
PGDATABASE=${PGDATABASE:-${POSTGRES_DB:-smartdining}}
PGCLIENTENCODING=UTF8
export PGUSER PGDATABASE PGCLIENTENCODING
PEDIDOS=${PEDIDOS:-50}
PORCIONES=${PORCIONES:-10}

TMP=$(mktemp -d)
fallos=0

q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -c "$1" | tr -d '\r'; }
ok() { echo "OK    $*"; }
mal() { echo "FALLA $*"; fallos=$((fallos + 1)); }

limpiar() {
  q "DELETE FROM pedidos WHERE codigo_pedido LIKE 'P19C-%';
     DELETE FROM movimientos_inventario WHERE id_insumo IN (SELECT id_insumo FROM insumos WHERE nombre LIKE 'P19C %');
     DELETE FROM recetas_plato WHERE id_plato IN (SELECT id_plato FROM platos WHERE nombre LIKE 'P19C %');
     DELETE FROM platos WHERE nombre LIKE 'P19C %';
     DELETE FROM categorias WHERE nombre = 'P19C Prueba';
     DELETE FROM insumos WHERE nombre LIKE 'P19C %';" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar
TMP=$(mktemp -d)

# --- Datos: un plato con receta de 1 porción de un insumo -----------------------
q "INSERT INTO categorias (nombre, orden_visualizacion) VALUES ('P19C Prueba', 98);
   INSERT INTO platos (id_categoria, nombre, precio)
     SELECT id_categoria, 'P19C Sanduche', 9000 FROM categorias WHERE nombre = 'P19C Prueba';
   INSERT INTO insumos (nombre, unidad, stock_minimo) VALUES ('P19C Pan', 'unidad', 3);
   INSERT INTO recetas_plato (id_plato, id_insumo, cantidad)
     SELECT p.id_plato, s.id_insumo, 1 FROM platos p, insumos s
     WHERE p.nombre = 'P19C Sanduche' AND s.nombre = 'P19C Pan';" >/dev/null
PLATO=$(q "SELECT id_plato FROM platos WHERE nombre = 'P19C Sanduche'")
INSUMO=$(q "SELECT id_insumo FROM insumos WHERE nombre = 'P19C Pan'")
MESA=$(q "SELECT id_mesa FROM mesas ORDER BY id_mesa LIMIT 1")

stock() { q "SELECT stock_actual::int FROM insumos WHERE id_insumo = $INSUMO"; }
poner_stock() {
  actual=$(stock)
  delta=$(( $1 - actual ))
  [ "$delta" -eq 0 ] || q "SELECT registrar_movimiento_inventario($INSUMO, 'ajuste', $delta, 'prueba P19C')" >/dev/null
}

# Un pedido de 1 sanduche en su propia transacción. $1 = sufijo; $2 = segundos
# que retiene el bloqueo después de reservar (0 = confirmar en seguida).
pedido() {
  retener=""
  if [ "${2:-0}" != "0" ]; then
    retener="SET CONSTRAINTS tr_reservar_inventario IMMEDIATE; SELECT pg_sleep($2);"
  fi
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<EOF
BEGIN;
INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES ($MESA, 'P19C-$1', 'recibido', 0);
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
  SELECT id_pedido, $PLATO, 1, 9000, 9000 FROM pedidos WHERE codigo_pedido = 'P19C-$1';
$retener
COMMIT;
EOF
}

# --- A. Dos sesiones por la última porción ------------------------------------
poner_stock 1
( set +e; pedido A1 2 >"$TMP/a1.out" 2>&1; echo $? >"$TMP/a1.rc" ) &
sleep 1
( set +e; pedido A2 0 >"$TMP/a2.out" 2>&1; echo $? >"$TMP/a2.rc" ) &
wait
rc1=$(cat "$TMP/a1.rc"); rc2=$(cat "$TMP/a2.rc")
if [ "$rc1" = 0 ] && [ "$rc2" != 0 ] && grep -q "SD001" "$TMP/a2.out" && [ "$(stock)" = 0 ]; then
  ok "A. dos sesiones por la última porción: la 1ª la reserva, la 2ª espera su bloqueo y recibe SD001 (stock 0)"
else
  mal "A. sesión1 rc=$rc1, sesión2 rc=$rc2, stock=$(stock): $(tr '\n' ' ' <"$TMP/a2.out" | cut -c1-160)"
fi

# --- B. N pedidos simultáneos por las últimas M porciones ----------------------
poner_stock "$PORCIONES"
i=1
while [ "$i" -le "$PEDIDOS" ]; do
  ( set +e; pedido "B$i" 0 >"$TMP/b$i.out" 2>&1; echo $? >"$TMP/b$i.rc" ) &
  i=$((i + 1))
done
wait
exitos=0; sin_stock=0; otros=0
i=1
while [ "$i" -le "$PEDIDOS" ]; do
  if [ "$(cat "$TMP/b$i.rc")" = 0 ]; then exitos=$((exitos + 1))
  elif grep -q "SD001" "$TMP/b$i.out"; then sin_stock=$((sin_stock + 1))
  else otros=$((otros + 1)); [ "$otros" -eq 1 ] && cp "$TMP/b$i.out" "$TMP/otro.out"
  fi
  i=$((i + 1))
done
final=$(stock)
reservas=$(q "SELECT count(*) FROM movimientos_inventario m JOIN detalles_pedido d USING (id_detalle)
              JOIN pedidos p USING (id_pedido) WHERE p.codigo_pedido LIKE 'P19C-B%' AND m.tipo = 'reserva'")
if [ "$exitos" = "$PORCIONES" ] && [ "$sin_stock" = $((PEDIDOS - PORCIONES)) ] && [ "$final" = 0 ] && [ "$reservas" = "$PORCIONES" ]; then
  ok "B. $PEDIDOS pedidos simultáneos por $PORCIONES porciones: $exitos confirmados, $sin_stock SD001, stock $final, $reservas reservas"
else
  mal "B. confirmados=$exitos SD001=$sin_stock otros=$otros stock=$final reservas=$reservas"
  [ -f "$TMP/otro.out" ] && head -5 "$TMP/otro.out"
fi

libro=$(q "SELECT (SELECT stock_actual FROM insumos WHERE id_insumo = $INSUMO)
              = (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos_inventario WHERE id_insumo = $INSUMO)")
[ "$libro" = t ] && ok "B. el libro cuadra: SUM(movimientos) = stock_actual" || mal "B. el libro no cuadra"

# --- D. Pedidos con DOS insumos en orden cruzado: sin deadlocks ----------------
# Mitad de los pedidos inserta Sanduche y luego Jugo; la otra mitad al revés.
# Si cada fila bloqueara solo sus insumos, el orden cruzado daría 40P01. La
# reserva bloquea todos los insumos del pedido de una vez, por id_insumo.
q "INSERT INTO insumos (nombre, unidad) VALUES ('P19C Naranja', 'unidad');
   INSERT INTO platos (id_categoria, nombre, precio)
     SELECT id_categoria, 'P19C Jugo', 4000 FROM categorias WHERE nombre = 'P19C Prueba';
   INSERT INTO recetas_plato (id_plato, id_insumo, cantidad)
     SELECT p.id_plato, s.id_insumo, 1 FROM platos p, insumos s
     WHERE p.nombre = 'P19C Jugo' AND s.nombre IN ('P19C Naranja', 'P19C Pan');" >/dev/null
JUGO=$(q "SELECT id_plato FROM platos WHERE nombre = 'P19C Jugo'")
NARANJA=$(q "SELECT id_insumo FROM insumos WHERE nombre = 'P19C Naranja'")
poner_stock 500
q "SELECT registrar_movimiento_inventario($NARANJA, 'entrada', 500, 'prueba P19C')" >/dev/null

combo() {
  if [ $(( $2 % 2 )) -eq 0 ]; then primero=$PLATO; segundo=$JUGO; else primero=$JUGO; segundo=$PLATO; fi
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<EOF
BEGIN;
INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES ($MESA, 'P19C-$1', 'recibido', 0);
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
  SELECT id_pedido, $primero, 1, 1000, 1000 FROM pedidos WHERE codigo_pedido = 'P19C-$1';
SELECT pg_sleep(0.05);
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
  SELECT id_pedido, $segundo, 1, 1000, 1000 FROM pedidos WHERE codigo_pedido = 'P19C-$1';
COMMIT;
EOF
}
i=1
while [ "$i" -le 30 ]; do
  ( set +e; combo "D$i" "$i" >"$TMP/d$i.out" 2>&1; echo $? >"$TMP/d$i.rc" ) &
  i=$((i + 1))
done
wait
d_ok=0; d_deadlock=0
i=1
while [ "$i" -le 30 ]; do
  [ "$(cat "$TMP/d$i.rc")" = 0 ] && d_ok=$((d_ok + 1))
  grep -q "40P01" "$TMP/d$i.out" && d_deadlock=$((d_deadlock + 1))
  i=$((i + 1))
done
pan=$(stock); naranja=$(q "SELECT stock_actual::int FROM insumos WHERE id_insumo = $NARANJA")
if [ "$d_ok" = 30 ] && [ "$d_deadlock" = 0 ] && [ "$pan" = 440 ] && [ "$naranja" = 470 ]; then
  ok "D. 30 pedidos con dos insumos en orden cruzado: 30 confirmados, 0 deadlocks (pan 440, naranja 470)"
else
  mal "D. confirmados=$d_ok deadlocks=$d_deadlock pan=$pan naranja=$naranja"
fi

# --- C. pg_notify ---------------------------------------------------------------
poner_stock 5
# En una sola sesión: LISTEN y luego una merma (autocommit) que deja 0 < mínimo 3
# y el plato sin stock. psql imprime los avisos al terminar cada comando.
"$PSQL" -X -q -v ON_ERROR_STOP=1 -c "LISTEN inventario" \
  -c "SELECT registrar_movimiento_inventario($INSUMO, 'merma', 5, 'prueba P19C')" -c "SELECT 1" \
  >"$TMP/c.out" 2>&1 || true
if grep -q '"tipo" *: *"stock_bajo"' "$TMP/c.out" && grep -q '"tipo" *: *"disponibilidad"' "$TMP/c.out" \
   && grep -q "\"id\" *: *$PLATO" "$TMP/c.out"; then
  ok "C. pg_notify('inventario') avisó stock_bajo y disponibilidad del plato $PLATO al confirmar"
else
  mal "C. avisos esperados no llegaron: $(tr '\n' ' ' <"$TMP/c.out" | cut -c1-300)"
fi

if [ "$fallos" -eq 0 ]; then
  echo "=== PRUEBA P-19 (concurrencia y avisos) PASADA ==="
else
  echo "=== PRUEBA P-19 (concurrencia y avisos): $fallos FALLA(S) ==="
  exit 1
fi
