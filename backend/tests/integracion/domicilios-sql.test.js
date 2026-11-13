const test = require('node:test');
const assert = require('node:assert');

/**
 * D-20a: despacho de domicilios y repartidor contra PostgreSQL REAL (script 36).
 *
 * Lo que el doble de base no puede probar y aquí sí: el trigger
 * fn_tr_validar_pedido_domicilio (repartidor activo, estados finales, marcas
 * de tiempo), la entrega que cierra el pedido en la misma transacción, la
 * merma al cancelar un fallido (scripts 27 y 31), el trigger de zonas con un
 * barrio en otra zona activa, los LEFT JOIN de KDS / activos / transacciones,
 * y la CARRERA cancelar contra salir (una sola gana).
 *
 * DATOS PROPIOS (patrón del #218): sus usuarios (admin, cajero y dos
 * repartidores), su cliente, sus zonas con nombres y barrios ÚNICOS por
 * corrida (para no chocar con database/seed_zonas_demo.sql), sus platos
 * (tests/helpers/plato-prueba.js; con receta propia para la merma) y pedidos
 * de canal domicilio insertados directo con su fila de pedidos_domicilio. El
 * `after` lo borra todo. No depende del seed ni de otra suite.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const crypto = require('node:crypto');
const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { tokenStaff } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');

const CORRIDA = crypto.randomBytes(5).toString('hex');
const DOMINIO = `prueba-domicilios-${CORRIDA}.test`;
const PREFIJO_ZONA = `prueba-domicilios-${CORRIDA}`;
const HASH = `$2b$10$${'x'.repeat(53)}`;

let sonda = null;
let hayBase = false;
const u = {}; // { admin, cajero, rafa, lucho } -> id_usuario
let idCliente = null;
let zona = null;
let sinReceta = null;
let conReceta = null;
const pedidosCreados = [];

const token = (rol, id) => tokenStaff(id, rol);
const como = (rol, id) => {
  const auth = () => ({ Authorization: `Bearer ${token(rol, id)}` });
  return {
    get: (ruta) => request(app).get(`/api${ruta}`).set(auth()),
    patch: (ruta, cuerpo) => request(app).patch(`/api${ruta}`).set(auth()).send(cuerpo),
    post: (ruta, cuerpo) => request(app).post(`/api${ruta}`).set(auth()).send(cuerpo ?? {}),
  };
};

async function crearUsuario(rol, nombre) {
  const { rows } = await sonda.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
     VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar, TRUE) RETURNING id_usuario`,
    [nombre, `${rol}-${crypto.randomBytes(3).toString('hex')}@${DOMINIO}`, HASH, rol]
  );
  return rows[0].id_usuario;
}

async function limpiar() {
  const { rows: us } = await sonda.query('SELECT id_usuario FROM usuarios WHERE email LIKE $1::text', [`%@${DOMINIO}`]);
  const idsUsuarios = us.map((r) => r.id_usuario);
  const { rows: cs } = await sonda.query('SELECT id_cliente FROM clientes WHERE email LIKE $1::text', [`%@${DOMINIO}`]);
  const idsClientes = cs.map((r) => r.id_cliente);

  // Los pedidos de estos clientes (los platos de plato-prueba también se
  // llevan los suyos en catalogo.limpiar(), que va después).
  if (idsClientes.length) {
    const { rows: ps } = await sonda.query('SELECT id_pedido FROM pedidos WHERE id_cliente = ANY($1::int[])', [idsClientes]);
    const idsPedidos = ps.map((r) => r.id_pedido);
    if (idsPedidos.length) {
      const t = await sonda.query('DELETE FROM transacciones WHERE id_pedido = ANY($1::int[]) RETURNING id_transaccion', [idsPedidos]);
      const idsT = t.rows.map((f) => f.id_transaccion);
      if (idsT.length) {
        await sonda.query(
          `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'transacciones'
             AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
          [idsT]
        );
      }
      await sonda.query(
        `DELETE FROM movimientos_inventario
          WHERE id_detalle IN (SELECT id_detalle FROM detalles_pedido WHERE id_pedido = ANY($1::int[]))`,
        [idsPedidos]
      );
      // pedidos_domicilio, detalles e historial caen en cascada.
      await sonda.query('DELETE FROM pedidos WHERE id_pedido = ANY($1::int[])', [idsPedidos]);
    }
    await sonda.query('DELETE FROM clientes WHERE id_cliente = ANY($1::int[])', [idsClientes]);
  }
  await sonda.query('DELETE FROM zonas_envio WHERE nombre LIKE $1::text', [`${PREFIJO_ZONA}%`]);
  if (idsUsuarios.length) {
    await sonda.query('DELETE FROM usuarios WHERE id_usuario = ANY($1::int[])', [idsUsuarios]);
    await sonda.query(
      `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'usuarios' AND registro_id = ANY($1::int[])`,
      [idsUsuarios]
    );
  }
}

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  await limpiar();
  u.admin = await crearUsuario('admin', 'Admin prueba');
  u.cajero = await crearUsuario('cajero', 'Caja prueba');
  u.rafa = await crearUsuario('repartidor', 'Rafa prueba');
  u.lucho = await crearUsuario('repartidor', 'Lucho prueba');
  const c = await sonda.query(
    `INSERT INTO clientes (nombre, email, telefono, password_hash)
     VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar) RETURNING id_cliente`,
    ['Ana Cliente', `ana@${DOMINIO}`, '3001234567', HASH]
  );
  idCliente = c.rows[0].id_cliente;
  const z = await sonda.query(
    `INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min)
     VALUES ($1::varchar, $2::text[], $3::numeric, $4::int) RETURNING id_zona`,
    [`${PREFIJO_ZONA} norte`, [`barrio uno ${CORRIDA}`, `barrio dos ${CORRIDA}`], 5000, 40]
  );
  zona = z.rows[0].id_zona;
  sinReceta = await crearCatalogoPrueba(sonda, 'domicilios', { precio: 20000 });
  conReceta = await crearCatalogoPrueba(sonda, 'domicilios-merma', { receta: true, precio: 15000 });
  hayBase = true;
});

test.after(async () => {
  try {
    if (hayBase) {
      await limpiar();
      await sinReceta.limpiar();
      await conReceta.limpiar();
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

const saltar = (t) => {
  if (!hayBase) {
    t.skip('sin base de datos');
    return true;
  }
  return false;
};

/**
 * Un pedido de canal domicilio, con su fila de pedidos_domicilio (el trigger
 * diferido exige las dos en la misma transacción), llevado al estado dado.
 */
async function pedidoDomicilio({ estado = 'listo', plato = sinReceta.plato, pagado = false } = {}) {
  const client = await sonda.connect();
  let idPedido;
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `INSERT INTO pedidos (codigo_pedido, canal, id_cliente, estado)
       VALUES ($1::varchar, 'domicilio', $2::int, 'recibido') RETURNING id_pedido`,
      // codigo_pedido es VARCHAR(16): "D" + 8 de la corrida + "-" + número.
      [`D${CORRIDA.slice(0, 8)}-${pedidosCreados.length + 1}`.toUpperCase(), idCliente]
    );
    idPedido = p.rows[0].id_pedido;
    await client.query(
      `INSERT INTO pedidos_domicilio (id_pedido, direccion_texto, barrio, telefono_contacto, id_zona, costo_envio)
       VALUES ($1::int, $2::varchar, $3::varchar, $4::varchar, $5::int, $6::numeric)`,
      [idPedido, 'Calle 1 # 2-3', `barrio uno ${CORRIDA}`, '3001234567', zona, 5000]
    );
    await client.query(
      `INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario)
       VALUES ($1::int, $2::int, 1, $3::numeric)`,
      [idPedido, plato.id_plato, plato.precio]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  pedidosCreados.push(idPedido);
  for (const e of ['en_preparacion', 'listo']) {
    if (estado === 'recibido' || (estado === 'en_preparacion' && e === 'listo')) break;
    await sonda.query('UPDATE pedidos SET estado = $1::varchar WHERE id_pedido = $2::int', [e, idPedido]);
  }
  if (pagado) {
    const { rows } = await sonda.query('SELECT total FROM pedidos WHERE id_pedido = $1::int', [idPedido]);
    await sonda.query(
      `INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa)
       VALUES ($1::int, 'tarjeta_credito', $2::numeric, 'completada', $3::varchar)`,
      [idPedido, rows[0].total, `prueba-${CORRIDA}-${idPedido}`]
    );
  }
  return idPedido;
}

async function estadoDe(idPedido) {
  const { rows } = await sonda.query(
    `SELECT p.estado, p.estado_pago, pd.estado_entrega, pd.id_repartidor, pd.motivo_fallo,
            pd.asignado_en, pd.en_camino_en, pd.entregado_en, pd.fallido_en
       FROM pedidos p JOIN pedidos_domicilio pd ON pd.id_pedido = p.id_pedido
      WHERE p.id_pedido = $1::int`,
    [idPedido]
  );
  return rows[0];
}

const admin = () => como('admin', u.admin);
const cajero = () => como('cajero', u.cajero);
const rafa = () => como('repartidor', u.rafa);
const lucho = () => como('repartidor', u.lucho);

test('asignar y reasignar: queda asignado con su marca de tiempo; a otro mientras no salga', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio();
  const r1 = await cajero().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
  assert.strictEqual(r1.body.domicilio.repartidor.id_usuario, u.rafa);
  const e1 = await estadoDe(id);
  assert.strictEqual(e1.estado_entrega, 'asignado');
  assert.ok(e1.asignado_en instanceof Date);

  const r2 = await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.lucho });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual((await estadoDe(id)).id_repartidor, u.lucho);

  // Un mesero (no repartidor) -> 409 repartidor_no_valido, sin tocar nada.
  const r3 = await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.cajero });
  assert.strictEqual(r3.status, 409);
  assert.strictEqual(r3.body.motivo, 'repartidor_no_valido');
  assert.strictEqual((await estadoDe(id)).id_repartidor, u.lucho);
});

test('el despacho lista el domicilio con el cliente (nombre y teléfono) y la dirección copiada; /api/v1 igual', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio();
  for (const prefijo of ['/api', '/api/v1']) {
    const res = await request(app).get(`${prefijo}/domicilios`).set('Authorization', `Bearer ${token('admin', u.admin)}`);
    assert.strictEqual(res.status, 200, prefijo);
    const d = res.body.domicilios.find((x) => x.pedido.id_pedido === id);
    assert.ok(d, `el ${id} está en el despacho`);
    assert.deepStrictEqual(d.cliente, { nombre: 'Ana Cliente', telefono: '3001234567' });
    assert.strictEqual(d.direccion.barrio, `barrio uno ${CORRIDA}`);
    assert.strictEqual(d.costo_envio, 5000);
  }
});

test('salir: con el pedido sin listo -> 409 pedido_no_listo; en listo -> en_camino', async (t) => {
  if (saltar(t)) return;
  const verde = await pedidoDomicilio({ estado: 'en_preparacion' });
  await admin().patch(`/domicilios/${verde}/repartidor`, { id_repartidor: u.rafa });
  const r1 = await rafa().post(`/domicilios/${verde}/salir`);
  assert.strictEqual(r1.status, 409);
  assert.strictEqual(r1.body.motivo, 'pedido_no_listo');
  assert.strictEqual((await estadoDe(verde)).estado_entrega, 'asignado');

  const listo = await pedidoDomicilio();
  await admin().patch(`/domicilios/${listo}/repartidor`, { id_repartidor: u.rafa });
  const r2 = await rafa().post(`/domicilios/${listo}/salir`);
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
  const e = await estadoDe(listo);
  assert.strictEqual(e.estado_entrega, 'en_camino');
  assert.ok(e.en_camino_en instanceof Date);
  // Repetir: 409 sin efectos.
  const r3 = await rafa().post(`/domicilios/${listo}/salir`);
  assert.strictEqual(r3.body.motivo, 'transicion_invalida');
  // Reasignar ya no.
  const r4 = await admin().patch(`/domicilios/${listo}/repartidor`, { id_repartidor: u.lucho });
  assert.strictEqual(r4.body.motivo, 'entrega_ya_salio');
});

test('un repartidor ajeno -> 403 no_es_tu_entrega', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio();
  await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });
  const res = await lucho().post(`/domicilios/${id}/salir`);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.motivo, 'no_es_tu_entrega');
  assert.strictEqual((await estadoDe(id)).estado_entrega, 'asignado');
});

test('en camino nadie cancela: PATCH estado, POST cancelar (personal) y la última línea -> 409 entrega_en_camino', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio();
  await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });
  await rafa().post(`/domicilios/${id}/salir`);
  const { rows: det } = await sonda.query('SELECT id_detalle FROM detalles_pedido WHERE id_pedido = $1::int', [id]);

  const respuestas = [
    await admin().patch(`/pedidos/${id}/estado`, { estado: 'cancelado' }),
    await admin().post(`/pedidos/${id}/cancelar`, {}),
    await admin().post(`/pedidos/${id}/items/${det[0].id_detalle}/cancelar`, { motivo: 'El cliente ya no lo quiere' }),
  ];
  for (const res of respuestas) {
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.motivo, 'entrega_en_camino');
  }
  const e = await estadoDe(id);
  assert.deepStrictEqual([e.estado, e.estado_entrega], ['listo', 'en_camino'], 'nada cambió');
  const { rows: linea } = await sonda.query('SELECT estado_item FROM detalles_pedido WHERE id_pedido = $1::int', [id]);
  assert.notStrictEqual(linea[0].estado_item, 'cancelado');
});

test('entregar: el pedido pasa a entregado y, pagado con saldo 0, a pagado; firmado por el repartidor', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio({ pagado: true });
  assert.strictEqual((await estadoDe(id)).estado_pago, 'pagado');
  await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });
  await rafa().post(`/domicilios/${id}/salir`);
  const res = await rafa().post(`/domicilios/${id}/entregar`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));

  const e = await estadoDe(id);
  assert.deepStrictEqual([e.estado, e.estado_entrega], ['pagado', 'entregado']);
  assert.ok(e.entregado_en instanceof Date);
  const { rows: hist } = await sonda.query(
    `SELECT estado_anterior, estado_nuevo, id_usuario FROM historial_estados
      WHERE id_pedido = $1::int AND estado_nuevo IN ('entregado', 'pagado') ORDER BY id_historial`,
    [id]
  );
  assert.deepStrictEqual(hist, [
    { estado_anterior: 'listo', estado_nuevo: 'entregado', id_usuario: u.rafa },
    { estado_anterior: 'entregado', estado_nuevo: 'pagado', id_usuario: u.rafa },
  ]);
  // Final: ni repetir ni fallar.
  assert.strictEqual((await rafa().post(`/domicilios/${id}/entregar`)).body.motivo, 'transicion_invalida');
  assert.strictEqual((await rafa().post(`/domicilios/${id}/fallar`, { motivo: 'x' })).body.motivo, 'transicion_invalida');
});

test('entregar sin pago completo: queda en entregado (no se cierra)', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio();
  await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });
  await rafa().post(`/domicilios/${id}/salir`);
  assert.strictEqual((await rafa().post(`/domicilios/${id}/entregar`)).status, 200);
  assert.strictEqual((await estadoDe(id)).estado, 'entregado');
});

test('fallar: sin motivo 400; con motivo, fallido (final) y el pedido sigue listo; el admin lo cancela con MERMA', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio({ plato: conReceta.plato });
  await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });
  await rafa().post(`/domicilios/${id}/salir`);

  const sinMotivo = await rafa().post(`/domicilios/${id}/fallar`, {});
  assert.strictEqual(sinMotivo.status, 400);
  assert.strictEqual(sinMotivo.body.motivo, 'cuerpo_invalido');

  const res = await rafa().post(`/domicilios/${id}/fallar`, { motivo: 'No había nadie en la dirección' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  let e = await estadoDe(id);
  assert.deepStrictEqual([e.estado, e.estado_entrega, e.motivo_fallo], ['listo', 'fallido', 'No había nadie en la dirección']);
  assert.ok(e.fallido_en instanceof Date);
  assert.strictEqual((await rafa().post(`/domicilios/${id}/salir`)).body.motivo, 'transicion_invalida', 'sin reintentos');

  // El admin lo cancela: listo -> cancelado, lo cocinado es merma.
  const cancelar = await admin().patch(`/pedidos/${id}/estado`, { estado: 'cancelado', observaciones: 'Entrega fallida' });
  assert.strictEqual(cancelar.status, 200, JSON.stringify(cancelar.body));
  e = await estadoDe(id);
  assert.deepStrictEqual([e.estado, e.estado_entrega], ['cancelado', 'fallido']);
  const { rows: libro } = await sonda.query(
    `SELECT m.tipo FROM movimientos_inventario m
       JOIN detalles_pedido dp ON dp.id_detalle = m.id_detalle
      WHERE dp.id_pedido = $1::int ORDER BY m.id`,
    [id]
  );
  assert.deepStrictEqual(libro.map((m) => m.tipo), ['reserva', 'merma'], 'merma, no devolución');
});

test('zonas: un barrio que ya está en otra zona activa -> 409 barrio_en_otra_zona con el barrio', async (t) => {
  if (saltar(t)) return;
  const res = await admin().post('/zonas-envio', {
    nombre: `${PREFIJO_ZONA} sur`,
    barrios: [`  Barrio   UNO ${CORRIDA.toUpperCase()} `],
    costo_envio: 3000,
    tiempo_estimado_min: 20,
  });
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'barrio_en_otra_zona');
  assert.strictEqual(res.body.barrio, `barrio uno ${CORRIDA}`);
  assert.strictEqual(res.body.zona, `${PREFIJO_ZONA} norte`);

  // Inactiva sí se puede (el trigger solo mira las activas), y el nombre repetido no.
  const inactiva = await admin().post('/zonas-envio', {
    nombre: `${PREFIJO_ZONA} sur`, barrios: [`barrio uno ${CORRIDA}`], costo_envio: 3000, tiempo_estimado_min: 20, activa: false,
  });
  assert.strictEqual(inactiva.status, 201, JSON.stringify(inactiva.body));
  const repetida = await admin().post('/zonas-envio', {
    nombre: `${PREFIJO_ZONA} sur`, barrios: [`otro ${CORRIDA}`], costo_envio: 3000, tiempo_estimado_min: 20,
  });
  assert.strictEqual(repetida.status, 409);
  assert.strictEqual(repetida.body.motivo, 'zona_duplicada');
  // Activarla choca con la norte.
  const activar = await admin().patch(`/zonas-envio/${inactiva.body.zona.id_zona}`, { activa: true });
  assert.strictEqual(activar.status, 409);
  assert.strictEqual(activar.body.motivo, 'barrio_en_otra_zona');
  const todas = (await admin().get('/zonas-envio')).body.zonas.filter((z) => z.nombre.startsWith(PREFIJO_ZONA));
  assert.deepStrictEqual(todas.map((z) => [z.nombre, z.activa]), [[`${PREFIJO_ZONA} norte`, true], [`${PREFIJO_ZONA} sur`, false]]);
});

test('LEFT JOIN: el pedido sin mesa sale en el KDS, en los activos y en las transacciones del día', async (t) => {
  if (saltar(t)) return;
  const id = await pedidoDomicilio({ estado: 'recibido', pagado: true });

  const kds = await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${token('admin', u.admin)}`);
  const enKds = kds.body.comandas.find((c) => c.id_pedido === id);
  assert.ok(enKds, 'está en el KDS');
  assert.strictEqual(enKds.mesa_numero, null);
  assert.strictEqual(enKds.canal, 'domicilio');

  const activos = await admin().get('/pedidos/activos');
  const enActivos = activos.body.pedidos.find((p) => p.id_pedido === id);
  assert.ok(enActivos, 'está en los activos');
  assert.strictEqual(enActivos.mesa_numero, null);
  assert.strictEqual(enActivos.canal, 'domicilio');
  assert.strictEqual(enActivos.id_cliente, idCliente);

  const caja = await cajero().get('/transacciones?desde=hoy');
  const enCaja = caja.body.transacciones.find((x) => x.id_pedido === id);
  assert.ok(enCaja, 'cuenta en el recaudado de hoy');
  assert.strictEqual(enCaja.numero_mesa, null);
  assert.strictEqual(enCaja.canal, 'domicilio');
});

test('repartidor: /domicilios/mios trae SOLO las suyas', async (t) => {
  if (saltar(t)) return;
  const deRafa = await pedidoDomicilio();
  const deLucho = await pedidoDomicilio();
  await admin().patch(`/domicilios/${deRafa}/repartidor`, { id_repartidor: u.rafa });
  await admin().patch(`/domicilios/${deLucho}/repartidor`, { id_repartidor: u.lucho });
  const ids = (await rafa().get('/domicilios/mios')).body.domicilios.map((d) => d.pedido.id_pedido);
  assert.ok(ids.includes(deRafa));
  assert.ok(!ids.includes(deLucho));
});

/** Espera a ver `cuantas` conexiones esperando un bloqueo en esta base. */
async function esperarBloqueados(conexion, cuantas) {
  for (let i = 0; i < 20000; i++) {
    const { rows } = await conexion.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`
    );
    if (rows[0].n >= cuantas) return;
  }
  assert.fail(`no se vieron ${cuantas} peticiones esperando el bloqueo`);
}

for (const primero of ['cancelar', 'salir']) {
  test(`carrera: cancelar y salir A LA VEZ (llega primero ${primero}) -> gana uno, nunca los dos`, async (t) => {
    if (saltar(t)) return;
    const id = await pedidoDomicilio();
    await admin().patch(`/domicilios/${id}/repartidor`, { id_repartidor: u.rafa });

    await Promise.all([1, 2, 3, 4].map(() => pool.query('SELECT 1')));
    const lanzar = {
      cancelar: () => admin().patch(`/pedidos/${id}/estado`, { estado: 'cancelado' }).then((r) => r),
      salir: () => rafa().post(`/domicilios/${id}/salir`).then((r) => r),
    };
    const segundo = primero === 'cancelar' ? 'salir' : 'cancelar';
    const enCola = {};
    const reten = await sonda.connect();
    try {
      await reten.query('BEGIN');
      await reten.query('SELECT 1 FROM pedidos WHERE id_pedido = $1::int FOR UPDATE', [id]);
      enCola[primero] = lanzar[primero]();
      await esperarBloqueados(reten, 1);
      enCola[segundo] = lanzar[segundo]();
      await esperarBloqueados(reten, 2);
    } finally {
      await reten.query('ROLLBACK');
      reten.release();
    }
    const cancelar = await enCola.cancelar;
    const salir = await enCola.salir;

    const e = await estadoDe(id);
    if (primero === 'cancelar') {
      assert.strictEqual(cancelar.status, 200, JSON.stringify(cancelar.body));
      assert.strictEqual(salir.status, 409);
      assert.strictEqual(salir.body.motivo, 'pedido_no_listo');
      assert.deepStrictEqual([e.estado, e.estado_entrega], ['cancelado', 'asignado']);
    } else {
      assert.strictEqual(salir.status, 200, JSON.stringify(salir.body));
      assert.strictEqual(cancelar.status, 409);
      assert.strictEqual(cancelar.body.motivo, 'entrega_en_camino');
      assert.deepStrictEqual([e.estado, e.estado_entrega], ['listo', 'en_camino']);
    }
  });
}
