const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

// D-20a: los listados generales ya no dejan fuera los pedidos SIN mesa
// (domicilio y para llevar, script 36): LEFT JOIN mesas en el KDS, en los
// pedidos activos del panel y en las transacciones del día. Que de verdad
// aparezcan contra PostgreSQL lo prueba tests/integracion/domicilios-sql.test.js.

async function sqlDe(ruta, rol, fragmento) {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app).get(ruta).set('Authorization', `Bearer ${tokenStaff(1, rol)}`);
    assert.ok(res.status < 500, `${ruta}: ${res.status}`);
    const q = db.buscar(fragmento);
    assert.ok(q, `${ruta} no consultó ${fragmento}`);
    return q.sql;
  } finally {
    db.restaurar();
  }
}

test('KDS: LEFT JOIN mesas y el canal del pedido', async () => {
  const sql = await sqlDe('/api/kds/comandas', 'cocina', 'm.numero AS mesa_numero');
  assert.match(sql, /LEFT JOIN mesas m ON m\.id_mesa = p\.id_mesa/);
  assert.doesNotMatch(sql, /(^|[^T] )JOIN mesas/, 'ningún JOIN mesas sin LEFT');
  assert.match(sql, /p\.canal/);
});

test('pedidos activos: LEFT JOIN mesas (p.* trae canal e id_cliente)', async () => {
  const sql = await sqlDe('/api/pedidos/activos', 'mesero', 'm.numero AS mesa_numero');
  assert.match(sql, /SELECT p\.\*, m\.numero AS mesa_numero/);
  assert.match(sql, /LEFT JOIN mesas m ON m\.id_mesa = p\.id_mesa/);
});

test('transacciones del día: LEFT JOIN mesas y canal en cada fila', async () => {
  const sql = await sqlDe('/api/transacciones?desde=hoy', 'cajero', 'FROM transacciones t');
  assert.match(sql, /LEFT JOIN mesas m ON m\.id_mesa = p\.id_mesa/);
  assert.match(sql, /'canal',\s+f\.canal/);
});
