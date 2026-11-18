const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');
const ctrl = require('../src/controllers/configuracion.controller');
const servicio = require('../src/services/configuracion.service');

// Correo y redes del local en la configuración (script 29, P-21). Las reglas
// del PUT son las MISMAS de la base (ck_configuracion_correo y
// fn_redes_contacto_validas); la comparación caso por caso contra PostgreSQL
// está en tests/integracion/configuracion-contacto-sql.test.js.

const admin = () => tokenStaff(1, 'admin');

const FILA = {
  id: 1,
  nombre: 'SmartDining',
  telefono: '3001234567',
  direccion: 'Calle 1',
  url_logo: null,
  horario: { lunes: { abre: '11:00', cierra: '22:00' } },
  propina_sugerida_pct: '10.00',
  moneda: 'COP',
  correo: 'hola@smartdining.co',
  redes: { instagram: 'https://instagram.com/smartdining', whatsapp: '+573001234567' },
  actualizado_en: '2026-11-08T12:00:00.000Z',
  actualizado_por: 1,
};

function fakeDb({ error = null } = {}) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM configuracion_restaurante')) return { rows: [FILA] };
    if (sql.includes('UPDATE configuracion_restaurante')) {
      if (error) throw error;
      const columnas = (sql.match(/SET ([\s\S]*?)\s+WHERE/) || [, ''])[1]
        .split(',')
        .map((c) => c.trim().split(' ')[0]);
      const cambiada = { ...FILA };
      columnas.forEach((c, i) => {
        cambiada[c] = ['horario', 'redes'].includes(c) ? JSON.parse(params[i + 1]) : params[i + 1];
      });
      return { rows: [cambiada] };
    }
    return undefined;
  });
}

const put = (cuerpo) => request(app).put('/api/configuracion').set('Authorization', `Bearer ${admin()}`).send(cuerpo);

const valida = (cuerpo) => ctrl.configuracionSchema.safeParse(cuerpo).success;

// ---------------------------------------------------------------------------
// El esquema: cada red válida e inválida
// ---------------------------------------------------------------------------

const CASOS_REDES = [
  // [clave, valor, ¿válido?, por qué]
  ['instagram', 'https://instagram.com/smartdining', true, 'perfil'],
  ['instagram', 'https://www.instagram.com/smartdining', true, 'con www.'],
  ['instagram', 'https://m.instagram.com/smartdining', true, 'con m.'],
  ['instagram', 'https://INSTAGRAM.COM/SmartDining', true, 'mayusculas en el dominio (~* en la base)'],
  ['instagram', 'http://instagram.com/smartdining', false, 'http, no https'],
  ['instagram', 'https://instagram.com/', false, 'sin perfil'],
  ['instagram', 'https://instagram.com.evil.co/x', false, 'otro dominio'],
  ['instagram', 'https://facebook.com/smartdining', false, 'la red equivocada'],
  ['instagram', 'https://instagram.com/smart dining', false, 'con espacio'],
  ['facebook', 'https://facebook.com/smartdining', true, 'pagina'],
  ['facebook', 'https://www.facebook.com/smartdining', true, 'con www.'],
  ['facebook', 'https://fb.com/smartdining', true, 'fb.com'],
  ['facebook', 'https://FB.COM/smartdining', true, 'FB.COM en mayusculas'],
  ['facebook', 'https://facebook.co/smartdining', false, '.co, no .com'],
  ['facebook', 'facebook.com/smartdining', false, 'sin https://'],
  ['tiktok', 'https://tiktok.com/@smartdining', true, 'perfil'],
  ['tiktok', 'https://www.TikTok.com/@smartdining', true, 'mayusculas'],
  ['tiktok', 'https://vm.tiktok.com/ZMabc/', true, 'subdominio corto'],
  ['tiktok', 'https://tiktok.com', false, 'sin perfil'],
  ['whatsapp', '+573001234567', true, 'E.164'],
  ['whatsapp', '+1234567', true, '7 digitos, el minimo'],
  ['whatsapp', '+123456789012345', true, '15 digitos, el maximo'],
  ['whatsapp', '573001234567', false, 'sin +'],
  ['whatsapp', '+0573001234567', false, 'empieza en 0'],
  ['whatsapp', '+57 300 1234567', false, 'con espacios'],
  ['whatsapp', '+123456', false, '6 digitos'],
  ['whatsapp', '+1234567890123456', false, '16 digitos'],
  ['whatsapp', 'https://wa.me/573001234567', false, 'el enlace lo arma el frontend'],
];

for (const [clave, valor, esperado, porque] of CASOS_REDES) {
  test(`redes.${clave} ${esperado ? 'acepta' : 'rechaza'} ${JSON.stringify(valor)} (${porque})`, () => {
    assert.strictEqual(valida({ redes: { [clave]: valor } }), esperado);
  });
}

test('redes: una red de mas de 200 caracteres se rechaza; de 200 justos, no', () => {
  const base = 'https://instagram.com/';
  assert.strictEqual(valida({ redes: { instagram: base + 'a'.repeat(200 - base.length) } }), true);
  assert.strictEqual(valida({ redes: { instagram: base + 'a'.repeat(201 - base.length) } }), false);
});

test('redes: null o "" como VALOR de una red se rechazan (una red sin usar se omite)', () => {
  assert.strictEqual(valida({ redes: { instagram: null } }), false);
  assert.strictEqual(valida({ redes: { instagram: '' } }), false);
  assert.strictEqual(valida({ redes: { whatsapp: 573001234567 } }), false, 'numero en vez de texto');
});

test('redes: una clave desconocida se rechaza (.strict())', () => {
  assert.strictEqual(valida({ redes: { twitter: 'https://x.com/smartdining' } }), false);
});

test('redes: null se rechaza (NOT NULL); {} es valido (sin redes); un arreglo no', () => {
  assert.strictEqual(valida({ redes: null }), false);
  assert.strictEqual(valida({ redes: {} }), true);
  assert.strictEqual(valida({ redes: [] }), false);
  assert.strictEqual(valida({ redes: 'https://instagram.com/x' }), false);
});

test('correo: forma, null para quitarlo, y el tope de 254', () => {
  assert.strictEqual(valida({ correo: 'hola@smartdining.co' }), true);
  assert.strictEqual(valida({ correo: 'a.b+c@sub.dominio.com.co' }), true);
  assert.strictEqual(valida({ correo: null }), true, 'null = quitar el correo');
  for (const malo of ['sinarroba.com', 'a@b', 'a@@b.co', 'a b@c.co', 'a@b.', 'a@b.c.', '', ' hola@x.co']) {
    assert.strictEqual(valida({ correo: malo }), false, JSON.stringify(malo));
  }
  const local = 'a'.repeat(254 - '@x.co'.length);
  assert.strictEqual(valida({ correo: `${local}@x.co` }), true, '254 justos');
  assert.strictEqual(valida({ correo: `a${local}@x.co` }), false, '255');
});

// ---------------------------------------------------------------------------
// Por la ruta
// ---------------------------------------------------------------------------

test('GET publico: trae correo y redes, y NADA mas de lo que ya traia', async () => {
  const db = fakeDb();
  try {
    const res = await request(app).get('/api/configuracion');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body).sort(), [
      'correo', 'direccion', 'horario', 'moneda', 'nombre', 'propina_sugerida_pct', 'redes', 'telefono', 'url_logo',
    ]);
    assert.strictEqual(res.body.correo, FILA.correo);
    assert.deepStrictEqual(res.body.redes, FILA.redes);
    assert.strictEqual(res.body.actualizado_por, undefined, 'la auditoria sigue fuera');
  } finally {
    db.restaurar();
  }
});

test('GET /completa (admin): el SELECT trae correo y redes', async () => {
  const db = fakeDb();
  try {
    const res = await request(app).get('/api/configuracion/completa').set('Authorization', `Bearer ${admin()}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.correo, FILA.correo);
    assert.deepStrictEqual(res.body.redes, FILA.redes);
    assert.match(db.buscar('FROM configuracion_restaurante').sql, /correo, redes/);
  } finally {
    db.restaurar();
  }
});

test('PUT: redes REEMPLAZA el objeto completo', async () => {
  const db = fakeDb();
  try {
    const nuevas = { tiktok: 'https://tiktok.com/@smartdining' };
    const res = await put({ redes: nuevas });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.redes, nuevas, 'instagram y whatsapp de antes ya no estan');
    const update = db.buscar('UPDATE configuracion_restaurante');
    assert.match(update.sql, /redes = \$2::jsonb/);
    assert.deepStrictEqual(JSON.parse(update.params[1]), nuevas);
  } finally {
    db.restaurar();
  }
});

test('PUT: redes {} deja el local sin redes', async () => {
  const db = fakeDb();
  try {
    const res = await put({ redes: {} });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.redes, {});
  } finally {
    db.restaurar();
  }
});

test('PUT: si redes y correo no vienen, se conservan (no entran en el SET)', async () => {
  const db = fakeDb();
  try {
    const res = await put({ nombre: 'Otro nombre' });
    assert.strictEqual(res.status, 200);
    const set = (db.buscar('UPDATE configuracion_restaurante').sql.match(/SET ([\s\S]*?)\s+WHERE/) || [, ''])[1];
    assert.ok(!set.includes('redes') && !set.includes('correo'), set);
    assert.deepStrictEqual(res.body.redes, FILA.redes);
    assert.strictEqual(res.body.correo, FILA.correo);
  } finally {
    db.restaurar();
  }
});

test('PUT: correo null lo quita', async () => {
  const db = fakeDb();
  try {
    const res = await put({ correo: null });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.correo, null);
    const update = db.buscar('UPDATE configuracion_restaurante');
    assert.match(update.sql, /correo = \$2::text/);
    assert.strictEqual(update.params[1], null);
  } finally {
    db.restaurar();
  }
});

test('PUT: los parametros del UPDATE llevan su tipo explicito', async () => {
  const db = fakeDb();
  try {
    await put({ nombre: 'X', horario: {}, propina_sugerida_pct: 12.5, moneda: 'USD', correo: 'a@b.co', redes: {} });
    const set = (db.buscar('UPDATE configuracion_restaurante').sql.match(/SET ([\s\S]*?)\s+WHERE/) || [, ''])[1];
    for (const esperado of ['nombre = $2::text', 'horario = $3::jsonb', 'propina_sugerida_pct = $4::numeric',
      'moneda = $5::text', 'correo = $6::text', 'redes = $7::jsonb']) {
      assert.ok(set.includes(esperado), `${esperado} en ${set}`);
    }
  } finally {
    db.restaurar();
  }
});

test('PUT: un 400 de correo o de redes lleva su motivo; los demas 400 no cambian', async () => {
  const db = fakeDb();
  try {
    const r1 = await put({ correo: 'no-es-correo' });
    assert.strictEqual(r1.status, 400);
    assert.strictEqual(r1.body.motivo, 'correo_invalido');
    const r2 = await put({ redes: { whatsapp: '573001234567' } });
    assert.strictEqual(r2.status, 400);
    assert.strictEqual(r2.body.motivo, 'redes_invalidas');
    assert.match(r2.body.error, /whatsapp/);
    const r3 = await put({ redes: null });
    assert.strictEqual(r3.status, 400);
    assert.strictEqual(r3.body.motivo, 'redes_invalidas');
    const r4 = await put({ moneda: 'cop' });
    assert.strictEqual(r4.status, 400);
    assert.strictEqual(r4.body.motivo, undefined, 'el resto conserva { error }');
    assert.strictEqual(db.todas('UPDATE configuracion_restaurante').length, 0);
  } finally {
    db.restaurar();
  }
});

for (const [constraint, motivo] of [
  ['ck_configuracion_correo', 'correo_invalido'],
  ['ck_configuracion_redes', 'redes_invalidas'],
]) {
  test(`si aun asi la base rechaza (23514 de ${constraint}) -> 400 ${motivo}, no 500 ni 422`, async () => {
    const err = new Error(`el nuevo registro viola la restricción «${constraint}»`);
    err.code = '23514';
    err.constraint = constraint;
    const db = fakeDb({ error: err });
    try {
      const res = await put({ correo: 'valido@segun.zod' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, motivo);
      assert.ok(!/ck_|23514/.test(res.body.error), 'no filtra el detalle interno');
    } finally {
      db.restaurar();
    }
  });
}

test('otro CHECK de configuracion sigue como antes (el manejador central)', () => {
  const err = Object.assign(new Error('check'), { code: '23514', constraint: 'ck_configuracion_propina' });
  assert.strictEqual(servicio.traducirCheckDeContacto(err), null);
});
