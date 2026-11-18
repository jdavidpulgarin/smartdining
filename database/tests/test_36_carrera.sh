#!/bin/sh
# ==============================================================================
# PRUEBA REPRODUCIBLE: P-23 · carrera entre el pago anticipado y el vencimiento
# ARCHIVO: database/tests/test_36_carrera.sh
# ==============================================================================
# Un pedido en 'por_pagar' tiene DOS salidas: 'recibido' (llega el pago) o
# 'cancelado' (vence, o lo cancela el cliente). Nunca pueden pasar las dos.
# Necesita sesiones y COMMIT de verdad, por eso no es un bloque DO. Crea sus
# datos con prefijo "T36C" y los borra al final.
#
#   A. El pago toma el pedido primero y tarda en confirmar: el vencimiento
#      corre a la vez, SALTA el pedido bloqueado y no lo cancela. Gana el pago.
#   B. El vencimiento toma el pedido primero y tarda en confirmar: el pago
#      espera el bloqueo, ve 'cancelado' y queda en pagos_por_devolver (nunca
#      perdido, nunca aplicado). El stock volvió.
#   C. RONDAS veces (20), pago y vencimiento (o cancelación del cliente) a la
#      vez, sin pausas: siempre exactamente UNA salida, y el stock cuadra.
#
# Uso (misma conexión que migrar.sh: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE):
#   sh database/tests/test_36_carrera.sh
#   docker compose exec -T postgres sh /smartdining-db/tests/test_36_carrera.sh
# Variables: PSQL (ruta de psql), RONDAS (20).
# ==============================================================================
set -eu

PSQL=${PSQL:-psql}
PGUSER=${PGUSER:-${POSTGRES_USER:-postgres}}
PGDATABASE=${PGDATABASE:-${POSTGRES_DB:-smartdining}}
PGCLIENTENCODING=UTF8
export PGUSER PGDATABASE PGCLIENTENCODING
RONDAS=${RONDAS:-20}

TMP=$(mktemp -d)
fallos=0

q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -c "$1" | tr -d '\r'; }
ok() { echo "OK    $*"; }
mal() { echo "FALLA $*"; fallos=$((fallos + 1)); }

limpiar() {
  q "DELETE FROM pagos_por_devolver WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE codigo_pedido LIKE 'T36C%');
     DELETE FROM transacciones WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE codigo_pedido LIKE 'T36C%');
     DELETE FROM movimientos_inventario WHERE id_insumo IN (SELECT id_insumo FROM insumos WHERE nombre = 'T36C Pan');
     DELETE FROM pedidos WHERE codigo_pedido LIKE 'T36C%';
     DELETE FROM clientes WHERE email = 't36c@correo.co';
     DELETE FROM recetas_plato WHERE id_plato IN (SELECT id_plato FROM platos WHERE nombre = 'T36C Sanduche');
     DELETE FROM platos WHERE nombre = 'T36C Sanduche';
     DELETE FROM categorias WHERE nombre = 'T36C Prueba';
     DELETE FROM insumos WHERE nombre = 'T36C Pan';" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar
TMP=$(mktemp -d)

# --- Datos: un plato con 1 pan de receta, 100 panes y un cliente --------------
q "INSERT INTO categorias (nombre, orden_visualizacion) VALUES ('T36C Prueba', 98);
   INSERT INTO platos (id_categoria, nombre, precio)
     SELECT id_categoria, 'T36C Sanduche', 10000 FROM categorias WHERE nombre = 'T36C Prueba';
   INSERT INTO insumos (nombre, unidad, stock_minimo) VALUES ('T36C Pan', 'unidad', 1);
   SELECT registrar_movimiento_inventario(id_insumo, 'entrada', 100, 'T36C carga') FROM insumos WHERE nombre = 'T36C Pan';
   INSERT INTO recetas_plato (id_plato, id_insumo, cantidad)
     SELECT p.id_plato, s.id_insumo, 1 FROM platos p, insumos s WHERE p.nombre = 'T36C Sanduche' AND s.nombre = 'T36C Pan';
   INSERT INTO clientes (nombre, email, password_hash)
     VALUES ('T36C', 't36c@correo.co', '\$2b\$10\$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12345');" >/dev/null

stock() { q "SELECT stock_actual::int FROM insumos WHERE nombre = 'T36C Pan'"; }

# Un pedido para llevar en por_pagar, creado hace 30 min (ya vencido), con 1 sanduche.
nuevo_pedido() {
  q "WITH p AS (
       INSERT INTO pedidos (codigo_pedido, estado, total, canal, id_cliente, creado_en)
       SELECT left('T36C' || md5(random()::text || clock_timestamp()::text), 16), 'por_pagar', 0, 'para_llevar',
              (SELECT id_cliente FROM clientes WHERE email = 't36c@correo.co'), now() - interval '30 minutes'
       RETURNING id_pedido)
     INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
     SELECT p.id_pedido, (SELECT id_plato FROM platos WHERE nombre = 'T36C Sanduche'), 1, 10000, 10000 FROM p
     RETURNING id_pedido"
}

# estado|transacciones completadas|pagos por devolver
foto() {
  q "SELECT p.estado || '|' ||
            (SELECT count(*) FROM transacciones t WHERE t.id_pedido = p.id_pedido AND t.estado_transaccion = 'completada') || '|' ||
            (SELECT count(*) FROM pagos_por_devolver d WHERE d.id_pedido = p.id_pedido)
       FROM pedidos p WHERE p.id_pedido = $1"
}

# --- A. El pago toma el pedido primero ----------------------------------------
S0=$(stock)
P=$(nuevo_pedido)
[ "$(stock)" = $((S0 - 1)) ] || mal "A: la reserva no descontó el pan"
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 \
  -c "BEGIN" \
  -c "SELECT resultado FROM registrar_pago_anticipado($P, 10000, 'tarjeta_credito', 'T36C-A-$P')" \
  -c "SELECT pg_sleep(3)" -c "COMMIT" > "$TMP/a_pago" 2>&1 &
PID=$!
sleep 1
VENCIDOS=$(q "SELECT count(*) FROM cancelar_por_pagar_vencidos(15) c WHERE c = $P")
wait $PID || true
if [ "$VENCIDOS" = 0 ] && grep -q '^confirmado' "$TMP/a_pago" && [ "$(foto "$P")" = "recibido|1|0" ] && [ "$(stock)" = $((S0 - 1)) ]; then
  ok "A: el pago bloquea primero; el vencimiento lo salta (SKIP LOCKED): recibido, 1 transacción, 0 por devolver, stock reservado"
else
  mal "A: vencidos=$VENCIDOS pago=$(tr '\n' ' ' < "$TMP/a_pago") foto=$(foto "$P") stock=$(stock)"
fi

# --- B. El vencimiento toma el pedido primero ---------------------------------
S0=$(stock)
P=$(nuevo_pedido)
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 \
  -c "BEGIN" -c "SELECT count(*) FROM cancelar_por_pagar_vencidos(15)" \
  -c "SELECT pg_sleep(3)" -c "COMMIT" > "$TMP/b_vence" 2>&1 &
PID=$!
sleep 1
INICIO=$(date +%s)
PAGO=$(q "SELECT resultado FROM registrar_pago_anticipado($P, 10000, 'tarjeta_credito', 'T36C-B-$P')")
ESPERO=$(( $(date +%s) - INICIO ))
wait $PID || true
if [ "$PAGO" = por_devolver ] && [ "$ESPERO" -ge 1 ] && [ "$(foto "$P")" = "cancelado|0|1" ] && [ "$(stock)" = "$S0" ]; then
  ok "B: el vencimiento bloquea primero; el pago espera (${ESPERO} s), ve cancelado y queda por devolver; 0 transacciones; el stock volvió"
else
  mal "B: pago=$PAGO esperó=${ESPERO}s foto=$(foto "$P") stock=$(stock) (antes $S0)"
fi

# --- C. Rondas sin pausas -----------------------------------------------------
S0=$(stock)
pagados=0; cancelados=0; dobles=0; perdidos=0
i=1
while [ "$i" -le "$RONDAS" ]; do
  P=$(nuevo_pedido)
  if [ $((i % 2)) -eq 0 ]; then
    CANCELA="SELECT count(*) FROM cancelar_por_pagar_vencidos(15)"
  else
    CANCELA="SELECT cancelar_pedido_por_pagar($P, 'T36C me arrepentí')"
  fi
  q "SELECT resultado FROM registrar_pago_anticipado($P, 10000, 'tarjeta_credito', 'T36C-C-$P')" > "$TMP/c_pago" 2>&1 &
  P1=$!
  q "$CANCELA" > "$TMP/c_cancela" 2>&1 &
  P2=$!
  wait $P1 || true
  wait $P2 || true
  case "$(foto "$P")" in
    "recibido|1|0") pagados=$((pagados + 1)) ;;
    "cancelado|0|1") cancelados=$((cancelados + 1)) ;;
    "cancelado|1|"*|"recibido|"*"|1") dobles=$((dobles + 1)); echo "  ronda $i: $(foto "$P")" ;;
    *) perdidos=$((perdidos + 1)); echo "  ronda $i: $(foto "$P") pago=$(cat "$TMP/c_pago") cancela=$(cat "$TMP/c_cancela")" ;;
  esac
  i=$((i + 1))
done
if [ "$dobles" -eq 0 ] && [ "$perdidos" -eq 0 ] && [ $((pagados + cancelados)) -eq "$RONDAS" ]; then
  ok "C: $RONDAS rondas simultáneas: $pagados pagadas, $cancelados canceladas (con su pago por devolver); ninguna con las dos salidas ni pago perdido"
else
  mal "C: pagadas=$pagados canceladas=$cancelados dobles=$dobles perdidas=$perdidos"
fi
if [ "$(stock)" = $((S0 - pagados)) ]; then
  ok "C: el stock cuadra: solo las pagadas se quedan con su pan ($S0 → $(stock))"
else
  mal "C: stock $(stock), esperado $((S0 - pagados))"
fi

if [ "$fallos" -gt 0 ]; then
  echo "FALLARON $fallos casos"
  exit 1
fi
echo "=== PRUEBA P-23 (carrera) PASADA ==="
