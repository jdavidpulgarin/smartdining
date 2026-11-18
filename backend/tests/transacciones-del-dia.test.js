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
  hasta: '2026-11-10',
  minimo: '2026-10-11',
  futura: false,
  antigua: false,
  total: '58000.00', // NUMERIC: pg lo entrega como texto
  cantidad: 2,
  transacciones: [
    {
      id_transaccion: 41, id_pedido: 87, codigo_pedido: 'PED-261110-7K2Q9', id_mesa: 5,
      numero_mesa: 5, monto: 34000, metodo_pago: 'efectivo', comensal: 'Ana',
      fecha: '2026-11-11T01:12:40.512Z',
      // Como lo arma la base: la fila de un pago repartido lleva el sufijo.
      referencia_externa: 'SD-5-1760212345678-Qm9#2',
    },
    {
      id_transaccion: 40, id_pedido: 86, codigo_pedido: 'PED-261110-3M8ZT', id_mesa: 2,
      numero_mesa: 2, monto: 24000, metodo_pago: 'tarjeta_debito', comensal: null,
      fecha: '2026-11-10T18:03:11.004Z',
      referencia_externa: null,
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
      assert.deepStrictEqual(Object.keys(res.body).sort(), ['cantidad', 'desde', 'hasta', 'total', 'transacciones']);
      assert.strictEqual(res.body.hasta, res.body.desde, 'con desde=hoy, desde y hasta coinciden');
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
          ['codigo_pedido', 'comensal', 'fecha', 'id_mesa', 'id_pedido', 'id_transaccion', 'metodo_pago', 'monto', 'numero_mesa', 'referencia_pago'],
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
    // zona, estado, fecha (null = hoy), "ahora" (null = now() de la base) y el tope.
    assert.deepStrictEqual(q.params, ['America/Bogota', 'completada', null, null, 30], 'todo va como parametro');
    assert.match(q.sql, /COALESCE\(\$4::timestamptz, now\(\)\) AT TIME ZONE \$1::text\)::date AS hoy/, 'hoy es el dia de la zona del restaurante');
    assert.match(q.sql, /t\.creado_en >= l\.desde_ts/, 'limite inferior sobre la columna, sin funciones');
    assert.match(q.sql, /t\.creado_en < {2}l\.hasta_ts|t\.creado_en < l\.hasta_ts/, 'limite superior exclusivo');
    // El filtro usa el alias `t.`; `f.creado_en AT TIME ZONE 'UTC'` es la
    // proyeccion de la fecha ISO, que no afecta al indice.
    assert.ok(!/t\.creado_en AT TIME ZONE|date\(t\.creado_en|t\.creado_en::date/.test(q.sql), 'ninguna funcion sobre creado_en en el filtro');
    assert.match(q.sql, /ORDER BY f\.creado_en DESC, f\.id_transaccion DESC/, 'mas reciente primero');
    // La referencia se LEE (para calcular referencia_pago), pero no sale en
    // crudo: eso lo vigila la prueba de la forma de la respuesta.
    assert.match(q.sql, /t\.referencia_externa/, 'se lee para calcular referencia_pago');
  } finally {
    db.restaurar();
  }
});

test('caja: sin transacciones hoy responde 200 con total 0 y lista vacia', async () => {
  const db = fakeCaja({ resumen: { desde: '2026-11-10', hasta: '2026-11-10', total: '0', cantidad: 0, transacciones: [] } });
  try {
    const res = await pedir(tokenStaff(1, 'admin'));

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { desde: '2026-11-10', hasta: '2026-11-10', total: 0, cantidad: 0, transacciones: [] });
  } finally {
    db.restaurar();
  }
});

for (const [caso, url] of [
  ['desde=ayer', '/api/transacciones?desde=ayer'],
  ['una fecha inexistente (30 de febrero)', '/api/transacciones?desde=2026-02-30'],
  ['un mes inexistente (13)', '/api/transacciones?desde=2026-13-01'],
  ['el dia 00', '/api/transacciones?desde=2026-11-00'],
  ['formato D/M/A', '/api/transacciones?desde=10/11/2026'],
  ['sin ceros a la izquierda', '/api/transacciones?desde=2026-1-5'],
  ['fecha con hora', '/api/transacciones?desde=2026-11-10T00:00'],
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

// ---------------------------------------------------------------------------
// desde=AAAA-MM-DD: un rango de dias, desde ese dia hasta el final de hoy
//
// La forma y la existencia de la fecha las valida zod aqui. Si es FUTURA o
// demasiado ANTIGUA lo decide la base con el mismo "hoy de Bogota" que usa la
// consulta: aqui se prueba que el controller pasa la fecha y traduce esa
// respuesta a 400. El borde de las 20:00 de Bogota se prueba con PostgreSQL
// real y un reloj fijado, en tests/integracion/transacciones-del-dia-sql.test.js.
// ---------------------------------------------------------------------------

test('caja: desde=AAAA-MM-DD valida responde 200 con desde y hasta del rango', async () => {
  const db = fakeCaja({ resumen: { ...RESUMEN, desde: '2026-11-08', hasta: '2026-11-10' } });
  try {
    const res = await pedir(tokenStaff(1, 'cajero'), '/api/transacciones?desde=2026-11-08');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.desde, '2026-11-08');
    assert.strictEqual(res.body.hasta, '2026-11-10', 'hasta es hoy: el dia final incluido');
    assert.strictEqual(typeof res.body.total, 'number');
    assert.ok(!('futura' in res.body) && !('antigua' in res.body) && !('minimo' in res.body), 'las banderas internas no salen');

    const q = db.buscar('FROM transacciones t');
    assert.deepStrictEqual(q.params, ['America/Bogota', 'completada', '2026-11-08', null, 30], 'la fecha viaja como texto');
  } finally {
    db.restaurar();
  }
});

test('caja: el 29 de febrero de un bisiesto existe; el de un año normal no', async () => {
  const db = fakeCaja();
  try {
    assert.strictEqual(ctrl.fechaExiste('2028-02-29'), true);
    assert.strictEqual(ctrl.fechaExiste('2026-02-29'), false);
    assert.strictEqual(ctrl.fechaExiste('2026-02-28'), true);
    assert.strictEqual(ctrl.fechaExiste('2026-04-31'), false);
    assert.strictEqual(ctrl.fechaExiste('2026-12-31'), true);

    const malo = await pedir(tokenStaff(1, 'cajero'), '/api/transacciones?desde=2026-02-29');
    assert.strictEqual(malo.status, 400);
    assert.match(malo.body.error, /2026-02-29 no existe/);
  } finally {
    db.restaurar();
  }
});

test('caja: fechaExiste no depende de la zona del servidor', () => {
  // Construye con Date.UTC y lee con getUTC*: la TZ del proceso no entra.
  const tz = process.env.TZ;
  try {
    for (const zona of ['America/Bogota', 'Asia/Tokyo', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = zona;
      assert.strictEqual(ctrl.fechaExiste('2026-03-01'), true, zona);
      assert.strictEqual(ctrl.fechaExiste('2026-02-30'), false, zona);
    }
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

for (const [caso, marca, patron] of [
  ['futura', { futura: true }, /no puede ser posterior a hoy \(2026-11-10, hora de Bogot/],
  ['mas de 31 dias atras', { antigua: true }, /como mucho 30 d.as atr.s: la fecha m.s antigua permitida hoy es 2026-10-11/],
]) {
  test(`caja: si la base marca la fecha como ${caso}, responde 400 consulta_invalida con el limite`, async () => {
    const db = fakeCaja({ resumen: { ...RESUMEN, ...marca, desde: '2026-12-01', hasta: '2026-11-10', minimo: '2026-10-11' } });
    try {
      const res = await pedir(tokenStaff(1, 'cajero'), '/api/transacciones?desde=2026-12-01');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, ctrl.MOTIVO_CONSULTA_INVALIDA);
      assert.match(res.body.error, patron);
      assert.ok(!('transacciones' in res.body), 'un 400 no lista nada');
    } finally {
      db.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// referencia_pago: la referencia del pago SIN el sufijo #n de referenciaDeFila
// ---------------------------------------------------------------------------

const servicio = require('../src/services/transacciones.service');

test('referencia_pago: referenciaDelPago es la inversa exacta de referenciaDeFila', () => {
  const { referenciaDelPago, referenciaDeFila } = servicio;
  assert.strictEqual(referenciaDelPago('ref'), 'ref');
  assert.strictEqual(referenciaDelPago('ref#2'), 'ref');
  assert.strictEqual(referenciaDelPago('ref#3'), 'ref');
  assert.strictEqual(referenciaDelPago('ref#10'), 'ref');
  assert.strictEqual(referenciaDelPago(null), null);
  assert.strictEqual(referenciaDelPago(undefined), null);
  // Ida y vuelta, con referencias que ya traen '#' en medio.
  for (const ref of ['SD-5-1760212345678-Qm9vX2E', 'caja:3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f', 'SD-9#A-xyz', 'a#b#c']) {
    for (let i = 0; i < 12; i++) {
      assert.strictEqual(referenciaDelPago(referenciaDeFila(ref, i)), ref, `${ref} fila ${i}`);
    }
  }
});

test('referencia_pago: un # que no es el sufijo de referenciaDeFila se respeta', () => {
  const { referenciaDelPago } = servicio;
  assert.strictEqual(referenciaDelPago('SD-9#A-xyz'), 'SD-9#A-xyz', '# en medio');
  assert.strictEqual(referenciaDelPago('ref#1'), 'ref#1', 'referenciaDeFila nunca escribe #1');
  assert.strictEqual(referenciaDelPago('ref#02'), 'ref#02', 'ni ceros a la izquierda');
  assert.strictEqual(referenciaDelPago('ref#'), 'ref#', 'sin numero');
  assert.strictEqual(referenciaDelPago('ref#2a'), 'ref#2a', 'no es un entero final');
  assert.strictEqual(referenciaDelPago('ref#-2'), 'ref#-2');
  assert.strictEqual(referenciaDelPago('#2'), '#2', 'sin referencia delante no hay nada que quitar');
  assert.strictEqual(referenciaDelPago('ref#2#3'), 'ref#2', 'solo el sufijo FINAL');
});

test('referencia_pago: sale en cada fila y referencia_externa no sale en crudo', async () => {
  const db = fakeCaja();
  try {
    const res = await pedir(tokenStaff(1, 'cajero'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.transacciones[0].referencia_pago, 'SD-5-1760212345678-Qm9', 'sin el #2');
    assert.strictEqual(res.body.transacciones[1].referencia_pago, null, 'un cobro sin referencia sale null');
    assert.ok(!JSON.stringify(res.body).includes('referencia_externa'), 'el campo crudo no sale');
    assert.ok(!JSON.stringify(res.body).includes('Qm9#2'), 'ni su valor con sufijo');
  } finally {
    db.restaurar();
  }
});
