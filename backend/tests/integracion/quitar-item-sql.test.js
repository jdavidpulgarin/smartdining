const test = require('node:test');
const assert = require('node:assert');

/**
 * D-13 por el comensal (J-14): POST /api/pedidos/:id/items/:id_detalle/cancelar
 * contra PostgreSQL REAL. Lo que se prueba aquí lo hace la base y un doble no
 * podría: devolver el stock (tr_devolver_inventario: devolución, no merma),
 * recalcular el total, la transición a 'cancelado' y el bloqueo frente al KDS.
 *
 * STOCK "EXACTO" CON SUITES EN PARALELO: otras suites piden los mismos platos a
 * la vez, así que el stock GLOBAL de un insumo no es comparable entre dos
 * lecturas. Se mira el LIBRO de cada detalle: reserva (-X) + devolución (+X)
 * suman 0 y no hay merma. Como SUM(movimientos) = stock_actual es la regla del
 * libro (27_inventario.sql), eso es exactamente "el stock vuelve igual".
 *
 * MESAS PROPIAS (criterio de #146): una por caso, desde MESA_NUMERO_QUITA (960
 * por omisión, rango de 20), marcadas en `ubicacion`. Se limpia después de
 * CADA caso (y otra vez en el `after`), para no retener stock reservado
 * mientras corren las otras suites; lo deja todo como estaba aunque una prueba
 * falle: borra las transacciones y su auditoría,
 * cierra la reserva de cada detalle con fn_cerrar_reserva_detalle(id, false)
 * (devuelve el stock; no hace nada si ya estaba cerrada), borra el libro de esos
 * detalles, los pedidos y las mesas.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

// Sin socket-server real (los avisos quedan SIN_CONFIGURAR) y alias en memoria.
process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { abrirSonda } = require('../helpers/base-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const { construirTokenQr } = require('../helpers/fake-db');

const MESA_BASE = parseInt(process.env.MESA_NUMERO_QUITA || '960', 10);
const MARCA_MESA = 'PRUEBA quitar-item';

let sonda = null;
let hayBase = false;
let plato = null; // normal, con receta
let constructor = null; // { id_plato, ingredientes: [{id_ingrediente, porcion}] }
let siguienteMesa = MESA_BASE;

async function limpiar() {
  const ajena = await sonda.query(
    'SELECT numero FROM mesas WHERE numero >= $1::int AND numero < $1::int + 20 AND ubicacion <> $2::text LIMIT 1',
    [MESA_BASE, MARCA_MESA]
  );
  if (ajena.rows.length) {
    throw new Error(`la mesa ${ajena.rows[0].numero} existe y no es de esta prueba: usa otro MESA_NUMERO_QUITA`);
  }
  const { rows } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = rows.map((r) => r.id_mesa);
  if (ids.length === 0) return;

  const t = await sonda.query(
    `DELETE FROM transacciones
      WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE id_mesa = ANY($1::int[]))
      RETURNING id_transaccion`,
    [ids]
  );
  const idsT = t.rows.map((f) => f.id_transaccion);
  if (idsT.length) {
    await sonda.query(
      `DELETE FROM auditoria_cambios
        WHERE tabla_afectada = 'transacciones'
          AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
      [idsT]
    );
  }
  await sonda.query(
    `SELECT fn_cerrar_reserva_detalle(dp.id_detalle, false)
       FROM detalles_pedido dp JOIN pedidos p ON p.id_pedido = dp.id_pedido
      WHERE p.id_mesa = ANY($1::int[]) ORDER BY dp.id_detalle`,
    [ids]
  );
  await sonda.query(
    `DELETE FROM movimientos_inventario
      WHERE id_detalle IN (SELECT dp.id_detalle FROM detalles_pedido dp
                           JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = ANY($1::int[]))`,
    [ids]
  );
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [ids]);
}

/** Una opción disponible y con receta por paso obligatorio, y una 'extra' en uno opcional. */
async function seleccionConstructor() {
  const { rows } = await sonda.query(
    `SELECT pc.id_plato, pc.id_paso, pc.min_sel,
            (SELECT i.id_ingrediente FROM ingredientes i
              WHERE i.id_paso = pc.id_paso AND i.disponible AND i.stock_suficiente
                AND EXISTS (SELECT 1 FROM recetas_ingrediente ri WHERE ri.id_ingrediente = i.id_ingrediente)
              ORDER BY i.id_ingrediente LIMIT 1) AS id_ingrediente
       FROM pasos_constructor pc
       JOIN platos p ON p.id_plato = pc.id_plato
      WHERE p.personalizable AND p.disponible AND p.stock_suficiente
        AND pc.id_plato = (SELECT min(p2.id_plato) FROM platos p2
                            WHERE p2.personalizable AND p2.disponible AND p2.stock_suficiente
                              AND EXISTS (SELECT 1 FROM pasos_constructor x WHERE x.id_plato = p2.id_plato))
      ORDER BY pc.orden`
  );
  if (rows.length === 0) return null;
  const ingredientes = [];
  let extraPuesta = false;
  for (const paso of rows) {
    if (!paso.id_ingrediente) {
      if (paso.min_sel > 0) return null; // un paso obligatorio sin opción con receta
      continue;
    }
    if (paso.min_sel > 0) ingredientes.push({ id_ingrediente: paso.id_ingrediente, porcion: 'normal' });
    else if (!extraPuesta) {
      ingredientes.push({ id_ingrediente: paso.id_ingrediente, porcion: 'extra' });
      extraPuesta = true;
    }
  }
  return { id_plato: rows[0].id_plato, ingredientes };
}

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  // Un plato con receta, pero NO el que eligen las otras suites (el primero
  // disponible por id): corren en paralelo y comparten su stock, que en el
  // seed alcanza para pocas unidades. Entre los demás, el que más unidades
  // deja servir con el stock de hoy.
  const p = await sonda.query(
    `WITH comun AS (
       SELECT id_plato FROM platos
        WHERE disponible AND stock_suficiente AND NOT personalizable
        ORDER BY id_plato LIMIT 1
     )
     SELECT p.id_plato FROM platos p
      WHERE p.disponible AND p.stock_suficiente AND NOT p.personalizable AND p.precio >= 1000
        AND p.id_plato NOT IN (SELECT id_plato FROM comun)
        AND EXISTS (SELECT 1 FROM recetas_plato rp WHERE rp.id_plato = p.id_plato)
      ORDER BY (SELECT min(floor(s.stock_actual / rp.cantidad)) FROM recetas_plato rp
                  JOIN insumos s ON s.id_insumo = rp.id_insumo WHERE rp.id_plato = p.id_plato) DESC,
               p.id_plato
      LIMIT 1`
  );
  plato = p.rows[0] || null;
  constructor = await seleccionConstructor();
  hayBase = Boolean(plato);
  if (!hayBase) return;
  await limpiar();
});

// Después de CADA caso, no solo al final: así las líneas que quedan vivas no
// retienen stock reservado mientras corren las otras suites.
test.afterEach(async () => {
  if (hayBase) await limpiar();
});

test.after(async () => {
  try {
    if (hayBase) await limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Mesa propia, abierta, con su QR vigente; y el JWT de un comensal de ella. */
async function mesaConComensal(alias = 'Ana') {
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
     VALUES ($1::int, 4, $2::text, 'ocupada', NOW()) RETURNING id_mesa`,
    [siguienteMesa++, MARCA_MESA]
  );
  const idMesa = m.rows[0].id_mesa;
  const { token, sid } = construirTokenQr(idMesa);
  await sonda.query('UPDATE mesas SET token_qr = $1::text WHERE id_mesa = $2::int', [token, idMesa]);
  const jwtDe = (quien) => jwt.sign({ id_mesa: idMesa, sid, rol: 'comensal', comensal: quien }, process.env.JWT_SECRET);
  return { idMesa, tokenQr: token, jwtComensal: jwtDe(alias), jwtDe };
}

const quitar = (jwtComensal, idPedido, idDetalle) => request(app)
  .post(`/api/pedidos/${idPedido}/items/${idDetalle}/cancelar`)
  .set('Authorization', `Bearer ${jwtComensal}`);

async function pedidoCon(idMesa, items) {
  const pedido = await pedidosService.crearConDetalles({ id_mesa: idMesa, id_usuario: null, items });
  const { rows } = await sonda.query(
    'SELECT id_detalle, cantidad, subtotal FROM detalles_pedido WHERE id_pedido = $1::int ORDER BY id_detalle',
    [pedido.id_pedido]
  );
  return { idPedido: pedido.id_pedido, detalles: rows };
}

/** El libro de un detalle: tipo -> { insumos, suma }. */
async function libroDe(idDetalle) {
  const { rows } = await sonda.query(
    `SELECT tipo, array_agg(id_insumo ORDER BY id_insumo) AS insumos, SUM(cantidad)::numeric AS suma, count(*)::int AS filas
       FROM movimientos_inventario WHERE id_detalle = $1::int GROUP BY tipo`,
    [idDetalle]
  );
  return Object.fromEntries(rows.map((r) => [r.tipo, r]));
}

async function filaPedido(idPedido) {
  const { rows } = await sonda.query('SELECT estado, total FROM pedidos WHERE id_pedido = $1::int', [idPedido]);
  return rows[0];
}

async function estadoItem(idDetalle) {
  const { rows } = await sonda.query('SELECT estado_item, cantidad FROM detalles_pedido WHERE id_detalle = $1::int', [idDetalle]);
  return rows[0];
}

/** Devuelto exacto: la reserva y la devolución del detalle se anulan, sin merma. */
function devueltoExacto(libro) {
  assert.ok(libro.reserva, 'hubo reserva');
  assert.ok(libro.devolucion, 'hubo devolución');
  assert.strictEqual(libro.merma, undefined, 'no es merma');
  assert.deepStrictEqual(libro.devolucion.insumos, libro.reserva.insumos, 'vuelven los mismos insumos');
  assert.strictEqual(Number(libro.reserva.suma) + Number(libro.devolucion.suma), 0, 'vuelve exactamente lo reservado');
}

test('a. quitar una línea de cantidad 2: se cancela ENTERA, el stock vuelve exacto (devolución) y el total baja', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles: [doble, sencilla] } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 2, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  const antes = await filaPedido(idPedido);

  const res = await quitar(jwtComensal, idPedido, doble.id_detalle);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const linea = await estadoItem(doble.id_detalle);
  assert.deepStrictEqual(linea, { estado_item: 'cancelado', cantidad: 2 }, 'la línea completa, sin tocar la cantidad');
  devueltoExacto(await libroDe(doble.id_detalle));
  assert.strictEqual((await libroDe(sencilla.id_detalle)).devolucion, undefined, 'la otra línea sigue reservada');

  const despues = await filaPedido(idPedido);
  assert.strictEqual(despues.estado, 'recibido');
  assert.strictEqual(despues.total, antes.total - doble.subtotal);
  assert.strictEqual(res.body.pedido.total, despues.total);
  assert.strictEqual(typeof res.body.pedido.total, 'number');
  const items = res.body.pedido.items;
  assert.deepStrictEqual(items.map((i) => [i.id_detalle, i.estado_item]), [
    [doble.id_detalle, 'cancelado'], [sencilla.id_detalle, 'pendiente'],
  ]);
  assert.ok(items.every((i) => Array.isArray(i.ingredientes) && typeof i.plato_nombre === 'string'), 'forma del seguimiento');
});

test('b. plato del CONSTRUCTOR: vuelven también las porciones de los ingredientes elegidos', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  if (!constructor) return t.skip('la base no tiene un plato del constructor con recetas');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles: [armado] } = await pedidoCon(idMesa, [
    { id_plato: constructor.id_plato, cantidad: 1, comensal: 'Ana', ingredientes: constructor.ingredientes },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);

  // Los insumos que consumen las opciones elegidas, según sus recetas.
  const { rows: esperados } = await sonda.query(
    `SELECT DISTINCT ri.id_insumo FROM detalles_ingredientes di
       JOIN recetas_ingrediente ri ON ri.id_ingrediente = di.id_ingrediente
      WHERE di.id_detalle = $1::int ORDER BY 1`,
    [armado.id_detalle]
  );
  assert.ok(esperados.length > 0, 'las opciones elegidas tienen receta');

  const res = await quitar(jwtComensal, idPedido, armado.id_detalle);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const libro = await libroDe(armado.id_detalle);
  devueltoExacto(libro);
  for (const { id_insumo: idInsumo } of esperados) {
    assert.ok(libro.devolucion.insumos.includes(idInsumo), `vuelve el insumo ${idInsumo} de una opción elegida`);
  }
  const item = res.body.pedido.items.find((i) => i.id_detalle === armado.id_detalle);
  assert.strictEqual(item.estado_item, 'cancelado');
  assert.strictEqual(item.ingredientes.length, constructor.ingredientes.length, 'con su personalización');
});

test('c. quitar el último plato vivo: el pedido pasa a cancelado con historial y la mesa NO se libera', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, tokenQr, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles: [unica] } = await pedidoCon(idMesa, [{ id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' }]);

  const res = await quitar(jwtComensal, idPedido, unica.id_detalle);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.pedido.estado, 'cancelado');
  assert.strictEqual(res.body.pedido.total, 0);

  assert.strictEqual((await filaPedido(idPedido)).estado, 'cancelado');
  const { rows: hist } = await sonda.query(
    `SELECT id_usuario, estado_anterior, estado_nuevo, observaciones FROM historial_estados
      WHERE id_pedido = $1::int AND estado_nuevo = 'cancelado'`,
    [idPedido]
  );
  assert.deepStrictEqual(hist, [{ id_usuario: null, estado_anterior: 'recibido', estado_nuevo: 'cancelado', observaciones: 'Cancelado por el comensal' }]);
  devueltoExacto(await libroDe(unica.id_detalle));

  const { rows: mesa } = await sonda.query('SELECT estado, token_qr FROM mesas WHERE id_mesa = $1::int', [idMesa]);
  assert.deepStrictEqual(mesa[0], { estado: 'ocupada', token_qr: tokenQr }, 'la mesa sigue abierta con su QR');
  // Y la sesión del comensal sigue viva: puede volver a pedir.
  const otra = await request(app).get('/api/pedidos/mesa').set('Authorization', `Bearer ${jwtComensal}`);
  assert.strictEqual(otra.status, 200);
});

test('d. cocina empieza y después el comensal: 409 item_en_preparacion; y A LA VEZ, uno gana y el otro espera', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // En serie.
  const m1 = await mesaConComensal('Ana');
  const p1 = await pedidoCon(m1.idMesa, [{ id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' }]);
  await pedidosService.actualizarEstado(p1.idPedido, 'en_preparacion', null, null);
  const tarde = await quitar(m1.jwtComensal, p1.idPedido, p1.detalles[0].id_detalle);
  assert.strictEqual(tarde.status, 409);
  assert.strictEqual(tarde.body.motivo, 'item_en_preparacion');
  assert.strictEqual((await estadoItem(p1.detalles[0].id_detalle)).estado_item, 'pendiente');
  assert.deepStrictEqual(Object.keys(await libroDe(p1.detalles[0].id_detalle)), ['reserva'], 'sigue reservado');

  // A la vez, en los DOS órdenes: gana quien llega primero al bloqueo del
  // pedido, y el otro espera y decide con lo ya confirmado.
  const ganaComensal = await carrera('comensal');
  assert.strictEqual(ganaComensal.comensal.status, 200, JSON.stringify(ganaComensal.comensal.body));
  assert.strictEqual(ganaComensal.linea.estado_item, 'cancelado');
  devueltoExacto(ganaComensal.libro); // el pedido seguía en 'recibido': devolución, no merma

  const ganaCocina = await carrera('cocina');
  assert.strictEqual(ganaCocina.comensal.status, 409, JSON.stringify(ganaCocina.comensal.body));
  assert.strictEqual(ganaCocina.comensal.body.motivo, 'item_en_preparacion');
  assert.strictEqual(ganaCocina.linea.estado_item, 'pendiente');
  assert.deepStrictEqual(Object.keys(ganaCocina.libro), ['reserva'], 'ni devolución ni merma');
});

/**
 * El comensal quita un plato mientras cocina pasa el pedido a 'en_preparacion'.
 *
 * Una tercera conexión retiene el pedido (FOR UPDATE). Se lanza `primero`, se
 * espera a verlo BLOQUEADO en pg_stat_activity, se lanza el otro, se espera a
 * ver los dos, y se suelta: PostgreSQL atiende la cola en orden, así que gana
 * `primero` y el otro decide con lo que aquel confirmó. Sin temporizadores.
 */
async function carrera(primero) {
  const m = await mesaConComensal('Ana');
  const p = await pedidoCon(m.idMesa, [
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  const idDetalle = p.detalles[0].id_detalle;
  // Conexiones ya abiertas en el pool de la app: sin esto, la petición del
  // comensal se quedaba abriendo una conexión nueva y no llegaba a la cola.
  await Promise.all([1, 2, 3, 4].map(() => pool.query('SELECT 1')));

  const lanzar = {
    comensal: () => quitar(m.jwtComensal, p.idPedido, idDetalle).then((r) => r),
    cocina: () => pedidosService.actualizarEstado(p.idPedido, 'en_preparacion', null, null)
      .then((r) => ({ ok: true, r }), (err) => ({ ok: false, err })),
  };
  const segundo = primero === 'comensal' ? 'cocina' : 'comensal';
  const enCola = {};

  const reten = await sonda.connect();
  try {
    await reten.query('BEGIN');
    await reten.query('SELECT 1 FROM pedidos WHERE id_pedido = $1::int FOR UPDATE', [p.idPedido]);
    const esperar = async (cuantos) => {
      for (let i = 0; i < 20000; i++) {
        const { rows } = await reten.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`
        );
        if (rows[0].n >= cuantos) return;
      }
      assert.fail(`no se vieron ${cuantos} esperando el bloqueo del pedido`);
    };
    enCola[primero] = lanzar[primero]();
    await esperar(1);
    enCola[segundo] = lanzar[segundo]();
    await esperar(2);
  } finally {
    await reten.query('ROLLBACK');
    reten.release();
  }

  const [comensal, cocina] = await Promise.all([enCola.comensal, enCola.cocina]);
  assert.ok(cocina.ok, `cocina no falla: ${cocina.err && cocina.err.message}`);
  assert.strictEqual((await filaPedido(p.idPedido)).estado, 'en_preparacion', 'cocina siempre aplica su cambio');
  return { comensal, linea: await estadoItem(idDetalle), libro: await libroDe(idDetalle) };
}

test('e. reintento sobre una línea ya cancelada: 409 item_ya_cancelado y el stock NO se devuelve dos veces', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles: [a] } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 2, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  assert.strictEqual((await quitar(jwtComensal, idPedido, a.id_detalle)).status, 200);
  const libroAntes = await libroDe(a.id_detalle);
  const totalAntes = (await filaPedido(idPedido)).total;

  const otra = await quitar(jwtComensal, idPedido, a.id_detalle);
  assert.strictEqual(otra.status, 409);
  assert.strictEqual(otra.body.motivo, 'item_ya_cancelado');
  assert.deepStrictEqual(await libroDe(a.id_detalle), libroAntes, 'ni una devolución más');
  assert.strictEqual((await filaPedido(idPedido)).total, totalAntes);
});

// pago_registrado ESTRICTO (revisión de Jarrison): CUALQUIER transacción
// completada bloquea, grande o pequeña. Antes solo bloqueaba si el total nuevo
// quedaba por debajo de lo pagado.
for (const [nota, montoDe] of [
  ['un pago grande (más que lo que quedaría sin la línea)', (total, subtotal) => total - subtotal + 500],
  ['un pago parcial PEQUEÑO (100), que antes no bloqueaba', () => 100],
]) {
  test(`f. con ${nota}: 409 pago_registrado y nada cambia`, async (t) => {
    if (!hayBase) return t.skip('sin base de datos');
    const { idMesa, jwtComensal } = await mesaConComensal('Ana');
    const { idPedido, detalles: [deAna] } = await pedidoCon(idMesa, [
      { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
      { id_plato: plato.id_plato, cantidad: 1, comensal: 'Beto' },
    ]);
    const antes = await filaPedido(idPedido);
    const monto = montoDe(antes.total, deAna.subtotal);
    assert.ok(monto > 0 && monto <= antes.total);
    await sonda.query(
      `INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion)
       VALUES ($1::int, 'efectivo', $2::numeric, 'completada')`,
      [idPedido, monto]
    );
    const conPago = await filaPedido(idPedido);

    const res = await quitar(jwtComensal, idPedido, deAna.id_detalle);
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.motivo, 'pago_registrado');
    assert.strictEqual((await estadoItem(deAna.id_detalle)).estado_item, 'pendiente');
    assert.deepStrictEqual(Object.keys(await libroDe(deAna.id_detalle)), ['reserva']);
    assert.deepStrictEqual(await filaPedido(idPedido), conPago);
  });
}

test('g. otro comensal de la misma mesa no quita lo de Ana; con otra mayúscula y tilde Ana sí', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtDe } = await mesaConComensal('Ana');
  const { idPedido, detalles: [deAna] } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ána María' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Beto' },
  ]);
  const deBeto = await quitar(jwtDe('Beto'), idPedido, deAna.id_detalle);
  assert.strictEqual(deBeto.status, 403);
  assert.strictEqual(deBeto.body.motivo, 'no_es_tuyo');
  assert.strictEqual((await estadoItem(deAna.id_detalle)).estado_item, 'pendiente');

  const mismaPersona = await quitar(jwtDe('ana  maria'), idPedido, deAna.id_detalle);
  assert.strictEqual(mismaPersona.status, 200, JSON.stringify(mismaPersona.body));
});
