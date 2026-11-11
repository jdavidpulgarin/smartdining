const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');
const ctrl = require('../src/controllers/transacciones.controller');

// GET /api/transacciones?desde=hoy: el cierre de caja (P1, propuesta de Roberto).
//
// Aqui se prueban los roles, la query y la FORMA de la respuesta con un doble de
// la base. Que "hoy" sea el dia de Bogota, que solo salgan las completadas y que
// el total cuadre se prueba contra PostgreSQL de verdad en
// tests/integracion/transacciones-del-dia-sql.test.js.

/** La unica fila que devuelve la consulta del servicio, como la arma la base. */
const RESUMEN = {
  desde: '2026-11-10',
  total: '58000.00', // NUMERIC: pg lo entrega como texto
  cantidad: 2,
  transacciones: [
    {
      id_transaccion: 41, id_pedido: 87, codigo_pedido: 'PED-261110-7K2Q9', id_mesa: 5,
      numero_mesa: 5, monto: 34000, metodo_pago: 'efectivo', comensal: 'Ana',
      fecha: '2026-11-11T01:12:40.512Z',
    },
    {
      id_transaccion: 40, id_pedido: 86, codigo_pedido: 'PED-261110-3M8ZT', id_mesa: 2,
      numero_mesa: 2, monto: 24000, metodo_pago: 'tarjeta_debito', comensal: null,
      fecha: '2026-11-10T18:03:11.004Z',
    },
  ],
};

function fakeCaja({ resumen = RESUMEN } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('FROM transacciones t')) return { rows: [resumen] };
    return { rows: [] };
  });
}

const pedir = (token, url = '/api/transacciones?desde=hoy') => {
  const req = request(app).get(url);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

test('caja: sin token responde 401', async () => {
  const db = fakeCaja();
  try {
    const res = await pedir(null);
    assert.strictEqual(res.status, 401);
  } finally {
    db.restaurar();
  }
});

for (const rol of ['mesero', 'cocina']) {
  test(`caja: ${rol} responde 403`, async () => {
    const db = fakeCaja();
    try {
      const res = await pedir(tokenStaff(3, rol));
      assert.strictEqual(res.status, 403);
      assert.strictEqual(db.todas('FROM transacciones t').length, 0, 'ni consulta la base');
    } finally {
      db.restaurar();
    }
  });
}

test('caja: un comensal responde 403', async () => {
  const db = fakeCaja();
  try {
    const res = await pedir(tokenComensal(5));
    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});

for (const rol of ['admin', 'cajero']) {
  test(`caja: ${rol} responde 200 con la forma del contrato`, async () => {
    const db = fakeCaja();
    try {
      const res = await pedir(tokenStaff(1, rol));

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(Object.keys(res.body).sort(), ['cantidad', 'desde', 'total', 'transacciones']);
      assert.match(res.body.desde, /^\d{4}-\d{2}-\d{2}$/, 'el dia en AAAA-MM-DD');
      assert.strictEqual(res.body.cantidad, 2);
      assert.strictEqual(res.body.transacciones.length, 2);

      // monto y total son NUMEROS, aunque la base entregue NUMERIC como texto.
      assert.strictEqual(typeof res.body.total, 'number');
      assert.strictEqual(res.body.total, 58000);
      for (const t of res.body.transacciones) {
        assert.strictEqual(typeof t.monto, 'number', 'monto es numero');
        assert.deepStrictEqual(
          Object.keys(t).sort(),
          ['codigo_pedido', 'comensal', 'fecha', 'id_mesa', 'id_pedido', 'id_transaccion', 'metodo_pago', 'monto', 'numero_mesa'],
          'solo los campos del contrato: nada de la pasarela'
        );
        assert.ok(!('referencia_externa' in t));
        assert.match(t.fecha, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'fecha ISO en UTC');
      }
      // Mas reciente primero: la base ya ordena; aqui se conserva el orden.
      assert.strictEqual(res.body.transacciones[0].id_transaccion, 41);
    } finally {
      db.restaurar();
    }
  });
}

test('caja: la consulta filtra por estado completada y por el dia de Bogota', async () => {
  const db = fakeCaja();
  try {
    await pedir(tokenStaff(1, 'cajero'));

    const q = db.buscar('FROM transacciones t');
    assert.ok(q, 'consulto las transacciones');
    assert.deepStrictEqual(q.params, ['America/Bogota', 'completada'], 'zona y estado van como parametros');
    assert.match(q.sql, /date_trunc\('day', now\(\) AT TIME ZONE \$1\)/, 'el dia se recorta en la zona del restaurante');
    assert.match(q.sql, /t\.creado_en >= l\.desde/, 'limite inferior sobre la columna, sin funciones');
    assert.match(q.sql, /t\.creado_en < {2}l\.hasta|t\.creado_en < l\.hasta/, 'limite superior exclusivo');
    assert.match(q.sql, /ORDER BY f\.creado_en DESC, f\.id_transaccion DESC/, 'mas reciente primero');
    assert.ok(!/referencia_externa/.test(q.sql), 'no se lee la referencia de la pasarela');
  } finally {
    db.restaurar();
  }
});

test('caja: sin transacciones hoy responde 200 con total 0 y lista vacia', async () => {
  const db = fakeCaja({ resumen: { desde: '2026-11-10', total: '0', cantidad: 0, transacciones: [] } });
  try {
    const res = await pedir(tokenStaff(1, 'admin'));

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { desde: '2026-11-10', total: 0, cantidad: 0, transacciones: [] });
  } finally {
    db.restaurar();
  }
});

for (const [caso, url] of [
  ['desde=ayer', '/api/transacciones?desde=ayer'],
  ['una fecha (todavia no)', '/api/transacciones?desde=2026-11-10'],
  ['sin desde', '/api/transacciones'],
  ['un parametro extra', '/api/transacciones?desde=hoy&estado=fallida'],
]) {
  test(`caja: ${caso} responde 400 con { error, motivo } y sin tocar la base`, async () => {
    const db = fakeCaja();
    try {
      const res = await pedir(tokenStaff(1, 'cajero'), url);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(typeof res.body.error, 'string');
      assert.strictEqual(res.body.motivo, ctrl.MOTIVO_CONSULTA_INVALIDA);
      assert.strictEqual(res.body.codigo, undefined, 'la convencion es { error, motivo }');
      assert.strictEqual(db.todas('FROM transacciones t').length, 0);
    } finally {
      db.restaurar();
    }
  });
}
