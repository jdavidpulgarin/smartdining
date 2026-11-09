#!/usr/bin/env node
// ==============================================================================
// PRUEBA REAL: concurrencia de POST /api/pedidos contra las últimas porciones
// ARCHIVO: database/tests/integracion/concurrencia-pedidos.js
// ==============================================================================
// Lo mismo que el caso B de test_p19_concurrencia.sh, pero por la API, con el
// backend, PostgreSQL 16 y Redis de verdad: N pedidos simultáneos (50) por las
// últimas M porciones (10) de un insumo. Se espera:
//
//   - exactamente M pedidos creados (201);
//   - N - M rechazados con 409 y motivo "sin_stock" (SD001), con el plato en
//     `faltantes`; ningún 500, ni 503 `reintentar` (deadlock), ni otro código;
//   - stock 0 al final y NUNCA negativo en el libro (MIN(stock_resultante) >= 0);
//   - el libro cuadra: SUM(movimientos) = stock_actual, con M reservas;
//   - el plato queda agotado por stock en la carta (se recalcula solo al llegar a 0).
//
// Redis entra de verdad: cada pedido lleva el comensal "Ana Prueba", registrado
// antes con POST /api/mesas/:id/comensales (que responde 503 sin Redis), y el
// backend resuelve su alias en Redis en cada uno de los N pedidos.
//
// Los datos se crean POR LA API (categoría, plato, insumo con stock inicial,
// receta y mesa) con el prefijo "CAPI", y se borran al final por SQL (los
// pedidos no tienen DELETE). Una corrida interrumpida se limpia en la
// siguiente.
//
// Uso (con backend, PostgreSQL y Redis levantados; ver tests/README.md):
//   cd database && npm install
//   API_URL=http://localhost:4000 PGPORT=5433 PGDATABASE=smartdining_test \
//     npm run test:concurrencia
//
// Variables:
//   API_URL           backend sin /api (por defecto http://localhost:4000)
//   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD   la MISMA base del backend
//   ADMIN_EMAIL, ADMIN_PASSWORD   por defecto el admin de demo del seed
//                     (contraseña de backend/scripts/fijar-password-demo.sql)
//   PEDIDOS (50), PORCIONES (10), MESA_NUMERO (901: número de la mesa de prueba)
//
// Sale con código 0 si todo pasa y 1 si algo falla.
// ==============================================================================
const { Pool } = require('pg');

const API = `${(process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '')}/api`;
const PEDIDOS = parseInt(process.env.PEDIDOS || '50', 10);
const PORCIONES = parseInt(process.env.PORCIONES || '10', 10);
const MESA_NUMERO = parseInt(process.env.MESA_NUMERO || '901', 10);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@smartdining.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const PREFIJO = 'CAPI';
const COMENSAL = 'Ana Prueba';

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5433', 10),
  database: process.env.PGDATABASE || 'smartdining_test',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});

let fallos = 0;
const ok = (msg) => console.log(`OK    ${msg}`);
const mal = (msg) => {
  console.log(`FALLA ${msg}`);
  fallos += 1;
};
const verificar = (cond, msgOk, msgMal = msgOk) => (cond ? ok(msgOk) : mal(msgMal));

let token = null;
async function api(ruta, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${ruta}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/**
 * Falla en seco si la preparación no sale: sin datos no hay prueba. Del cuerpo
 * solo se muestran `error` y `motivo`: una respuesta puede traer tokens (el QR).
 */
async function exigir(promesa, esperados, que) {
  const r = await promesa;
  if (![].concat(esperados).includes(r.status)) {
    const detalle = [r.data?.error, r.data?.motivo].filter(Boolean).join(' · ');
    throw new Error(`${que}: se esperaba ${[].concat(esperados).join(' o ')} y llegó ${r.status} ${detalle}`);
  }
  return r.data;
}

/**
 * Borra lo que crea la prueba. Orden:
 *   1. los pedidos (detalles, historial y métricas caen en cascada; los
 *      movimientos de reserva quedan con id_detalle NULL);
 *   2. la reserva del alias en Redis, por la API: DELETE /comensales responde
 *      409 mientras la persona tiene platos, por eso va después de 1;
 *   3. el resto (movimientos, receta, plato, categoría, insumo y mesa).
 */
async function limpiar() {
  const mesaVieja = await pool.query('SELECT id_mesa FROM mesas WHERE numero = $1', [MESA_NUMERO]);
  await pool.query(`DELETE FROM pedidos WHERE id_mesa IN (SELECT id_mesa FROM mesas WHERE numero = $1)`, [
    MESA_NUMERO,
  ]);
  if (token && mesaVieja.rowCount > 0) {
    const r = await api(`/mesas/${mesaVieja.rows[0].id_mesa}/comensales/${encodeURIComponent(COMENSAL)}`, {
      method: 'DELETE',
    });
    if (r.status !== 204) {
      console.log(`AVISO no se soltó el alias en Redis (${r.status} ${r.data?.error || ''}); vence solo en 24 h`);
    }
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(
      `DELETE FROM movimientos_inventario
        WHERE id_insumo IN (SELECT id_insumo FROM insumos WHERE nombre LIKE $1)`,
      [`${PREFIJO} %`]
    );
    await cliente.query(
      `DELETE FROM recetas_plato WHERE id_plato IN (SELECT id_plato FROM platos WHERE nombre LIKE $1)`,
      [`${PREFIJO} %`]
    );
    await cliente.query(`DELETE FROM platos WHERE nombre LIKE $1`, [`${PREFIJO} %`]);
    await cliente.query(`DELETE FROM categorias WHERE nombre = $1`, [`${PREFIJO} Prueba`]);
    await cliente.query(`DELETE FROM insumos WHERE nombre LIKE $1`, [`${PREFIJO} %`]);
    await cliente.query(`DELETE FROM mesas WHERE numero = $1`, [MESA_NUMERO]);
    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

async function main() {
  console.log(`== Concurrencia por la API: ${PEDIDOS} pedidos por ${PORCIONES} porciones (${API}) ==`);
  await pool.query('SELECT 1');

  // La mesa de prueba no puede chocar con una mesa de verdad.
  const ajena = await pool.query(
    `SELECT 1 FROM mesas m WHERE numero = $1
        AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id_mesa = m.id_mesa)
        AND NOT EXISTS (SELECT 1 FROM insumos WHERE nombre LIKE $2)`,
    [MESA_NUMERO, `${PREFIJO} %`]
  );
  if (ajena.rowCount > 0) {
    throw new Error(`la mesa ${MESA_NUMERO} existe y tiene pedidos que no son de esta prueba: usa otro MESA_NUMERO`);
  }

  const login = await exigir(
    api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }),
    200,
    'login del admin'
  );
  token = login.token;
  // Lo que haya dejado una corrida interrumpida (también su alias en Redis).
  await limpiar();

  // --- Datos, por la API ---------------------------------------------------------
  const categoria = await exigir(
    api('/categorias', { method: 'POST', body: { nombre: `${PREFIJO} Prueba`, orden_visualizacion: 99 } }),
    201,
    'crear categoría'
  );
  const idCategoria = categoria.id_categoria ?? categoria.categoria?.id_categoria;
  const plato = await exigir(
    api('/platos', {
      method: 'POST',
      // tiempo_preparacion_estimado va explícito: sin él, POST /platos responde
      // 500 (inserta NULL en una columna NOT NULL en vez de dejar el DEFAULT).
      body: {
        id_categoria: idCategoria,
        nombre: `${PREFIJO} Hamburguesa`,
        precio: 9000,
        disponible: true,
        tiempo_preparacion_estimado: 10,
      },
    }),
    201,
    'crear plato'
  );
  const idPlato = plato.id_plato ?? plato.plato?.id_plato;
  const { insumo } = await exigir(
    api('/inventario/insumos', {
      method: 'POST',
      body: { nombre: `${PREFIJO} Pan`, unidad: 'unidad', stock_minimo: 3, stock_inicial: PORCIONES },
    }),
    201,
    'crear insumo con stock inicial'
  );
  await exigir(
    api(`/platos/${idPlato}/receta`, {
      method: 'PUT',
      body: { insumos: [{ id_insumo: insumo.id_insumo, cantidad: 1 }] },
    }),
    200,
    'guardar receta'
  );
  const mesa = await exigir(
    api('/mesas', { method: 'POST', body: { numero: MESA_NUMERO, capacidad: 4, ubicacion: `${PREFIJO} prueba` } }),
    201,
    'crear mesa'
  );
  // 201 la abre; 200 si ya estaba abierta (es idempotente).
  await exigir(api(`/mesas/${mesa.id_mesa}/abrir`, { method: 'POST' }), [200, 201], 'abrir mesa');
  const registro = await api(`/mesas/${mesa.id_mesa}/comensales`, { method: 'POST', body: { alias: COMENSAL } });
  if (registro.status === 503) throw new Error('POST /mesas/:id/comensales respondió 503: el backend no tiene Redis');
  if (registro.status !== 201) {
    throw new Error(`registrar comensal: ${registro.status} ${registro.data?.error || ''}`);
  }
  const alias = registro.data.alias;

  const inicial = await api(`/inventario/insumos/${insumo.id_insumo}`);
  const stockInicial = Number(inicial.data?.stock_actual ?? inicial.data?.insumo?.stock_actual);
  verificar(
    stockInicial === PORCIONES,
    `preparado por la API: plato ${idPlato}, insumo ${insumo.id_insumo} con ${PORCIONES} porciones, mesa ${MESA_NUMERO} abierta y "${alias}" en Redis`,
    `stock inicial ${stockInicial}, se esperaba ${PORCIONES}`
  );

  // --- N pedidos a la vez ----------------------------------------------------------
  const cuerpo = { id_mesa: mesa.id_mesa, items: [{ id_plato: idPlato, cantidad: 1, comensal: alias }] };
  const inicio = Date.now();
  const respuestas = await Promise.all(
    Array.from({ length: PEDIDOS }, () =>
      api('/pedidos', { method: 'POST', body: cuerpo }).catch((err) => ({ status: 0, data: { error: err.message } }))
    )
  );
  const ms = Date.now() - inicio;

  const creados = respuestas.filter((r) => r.status === 201);
  const sinStock = respuestas.filter((r) => r.status === 409 && r.data?.motivo === 'sin_stock');
  const otros = respuestas.filter((r) => !creados.includes(r) && !sinStock.includes(r));
  const resumenOtros = Object.entries(
    otros.reduce((acc, r) => {
      const k = `${r.status} ${r.data?.motivo || r.data?.error || ''}`.trim();
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([k, n]) => `${n}× ${k}`)
    .join(', ');

  verificar(
    creados.length === PORCIONES && sinStock.length === PEDIDOS - PORCIONES && otros.length === 0,
    `${PEDIDOS} POST /api/pedidos simultáneos (${ms} ms): ${creados.length} creados (201), ${sinStock.length} con 409 sin_stock, 0 otros`,
    `creados=${creados.length} sin_stock=${sinStock.length} otros=${otros.length}${resumenOtros ? ` (${resumenOtros})` : ''}`
  );

  // `faltantes` dice QUÉ QUITAR DEL CARRITO (el plato), no el insumo de bodega.
  const faltantesBien = sinStock.every(
    (r) =>
      Array.isArray(r.data.faltantes) &&
      r.data.faltantes.length === 1 &&
      r.data.faltantes[0].tipo === 'plato' &&
      Number(r.data.faltantes[0].id) === idPlato &&
      Object.keys(r.data.faltantes[0]).sort().join() === 'id,nombre,tipo'
  );
  verificar(
    sinStock.length > 0 && faltantesBien,
    'cada 409 trae faltantes = [el plato], solo con tipo, id y nombre (sin cantidades de bodega)',
    `faltantes inesperados: ${JSON.stringify(sinStock.find((r) => !r.data?.faltantes)?.data || sinStock[0]?.data?.faltantes)}`
  );

  const codigos = new Set(creados.map((r) => r.data.codigo_pedido));
  verificar(
    codigos.size === creados.length && creados.every((r) => r.data.estado === 'recibido' && Number(r.data.total) === 9000),
    'los pedidos creados tienen código único, estado recibido y total 9000'
  );

  // --- Estado final: por la API y en la base ----------------------------------------
  const final = await api(`/inventario/insumos/${insumo.id_insumo}`);
  const insumoFinal = final.data?.insumo ?? final.data;
  verificar(
    Number(insumoFinal?.stock_actual) === 0 && insumoFinal?.agotado === true,
    'GET /inventario/insumos/:id → stock_actual 0 y agotado',
    `GET del insumo: ${JSON.stringify(insumoFinal)}`
  );

  const libro = await pool.query(
    `SELECT s.stock_actual::numeric AS stock,
            (SELECT MIN(stock_resultante) FROM movimientos_inventario WHERE id_insumo = s.id_insumo) AS minimo,
            (SELECT SUM(cantidad) FROM movimientos_inventario WHERE id_insumo = s.id_insumo) AS suma,
            (SELECT COUNT(*) FROM movimientos_inventario WHERE id_insumo = s.id_insumo AND tipo = 'reserva') AS reservas
       FROM insumos s WHERE s.id_insumo = $1`,
    [insumo.id_insumo]
  );
  const l = libro.rows[0];
  verificar(
    Number(l.stock) === 0 && Number(l.minimo) >= 0,
    `en la base: stock 0 y nunca negativo (mínimo del libro: ${Number(l.minimo)})`,
    `stock=${l.stock} mínimo del libro=${l.minimo}`
  );
  verificar(
    Number(l.suma) === Number(l.stock) && Number(l.reservas) === PORCIONES,
    `el libro cuadra: SUM(movimientos) = stock_actual, con ${PORCIONES} reservas`,
    `SUM=${l.suma} stock=${l.stock} reservas=${l.reservas}`
  );

  const enBase = await pool.query(
    `SELECT COUNT(DISTINCT p.id_pedido) AS pedidos, COUNT(d.id_detalle) AS detalles,
            COUNT(*) FILTER (WHERE d.comensal = $2) AS con_alias
       FROM pedidos p JOIN detalles_pedido d ON d.id_pedido = p.id_pedido
      WHERE p.id_mesa = $1`,
    [mesa.id_mesa, alias]
  );
  const b = enBase.rows[0];
  verificar(
    Number(b.pedidos) === PORCIONES && Number(b.detalles) === PORCIONES && Number(b.con_alias) === PORCIONES,
    `en la base: ${PORCIONES} pedidos, ${PORCIONES} detalles, todos a nombre de "${alias}"; ningún rechazado quedó a medias`,
    `pedidos=${b.pedidos} detalles=${b.detalles} con alias=${b.con_alias}`
  );

  // `platos.disponible` es el interruptor MANUAL de la cocina y no se toca; lo
  // que la base recalcula es `stock_suficiente` (v_carta_disponible).
  const carta = await api('/inventario/carta');
  const enCarta = (carta.data?.platos || []).find((p) => Number(p.id) === idPlato);
  verificar(
    enCarta?.disponible === true && enCarta?.disponible_efectivo === false && enCarta?.motivo === 'stock',
    'GET /inventario/carta: el plato quedó agotado por stock (disponible_efectivo false, motivo "stock"; el interruptor manual sigue en true)',
    `plato en la carta: ${JSON.stringify(enCarta)}`
  );

  // Uno más después de agotar: sigue siendo un rechazo limpio, no un 500.
  const tarde = await api('/pedidos', { method: 'POST', body: cuerpo });
  verificar(
    tarde.status === 409,
    `un pedido más con el plato agotado → 409 (${tarde.data?.motivo || tarde.data?.error})`,
    `pedido tardío: ${tarde.status} ${JSON.stringify(tarde.data)}`
  );
}

main()
  .catch((err) => {
    mal(`la prueba no pudo correr: ${err.message}`);
  })
  .finally(async () => {
    try {
      await limpiar();
    } catch (err) {
      console.log(`AVISO no se pudieron borrar los datos ${PREFIJO}: ${err.message}`);
    }
    await pool.end();
    console.log(fallos === 0 ? '=== CONCURRENCIA POR LA API PASADA ===' : `=== ${fallos} FALLA(S) ===`);
    process.exit(fallos === 0 ? 0 : 1);
  });
