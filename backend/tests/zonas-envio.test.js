const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

// D-20a: zonas de entrega para el admin (/zonas-envio, en /api y en /api/v1).
// Los roles los cubre la matriz (solo admin); aquí, cuerpos, respuestas y la
// traducción de los choques del trigger fn_tr_validar_zona_envio.

const ADMIN = () => tokenStaff(1, 'admin');
const ZONA = {
  id_zona: 3,
  nombre: 'Norte',
  barrios: ['Centro', 'Los Álamos'],
  costo_envio: 5000,
  tiempo_estimado_min: 30,
  activa: true,
  creado_en: '2026-11-13T12:00:00.000Z',
  actualizado_en: '2026-11-13T12:00:00.000Z',
};

/** Error como los que lanza PostgreSQL. */
const pgError = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

async function conFake(responder, fn) {
  const db = instalarFakeDb(responder);
  try {
    return await fn(db);
  } finally {
    db.restaurar();
  }
}

const pedir = (metodo, ruta, cuerpo, prefijo = '/api') => {
  const r = request(app)[metodo](`${prefijo}${ruta}`).set('Authorization', `Bearer ${ADMIN()}`);
  return cuerpo === undefined ? r : r.send(cuerpo);
};

test('zonas-envio: GET lista TODAS (también las inactivas), en /api y en /api/v1', () =>
  conFake(
    (sql) => (sql.includes('FROM zonas_envio ORDER BY id_zona') ? { rows: [ZONA, { ...ZONA, id_zona: 4, nombre: 'Vieja', activa: false }] } : undefined),
    async (db) => {
      for (const prefijo of ['/api', '/api/v1']) {
        const res = await pedir('get', '/zonas-envio', undefined, prefijo);
        assert.strictEqual(res.status, 200, prefijo);
        assert.deepStrictEqual(res.body.zonas.map((z) => [z.id_zona, z.activa]), [[3, true], [4, false]]);
      }
      assert.ok(!db.buscar('FROM zonas_envio ORDER BY id_zona').sql.includes('WHERE activa'), 'sin filtrar por activa');
    }
  ));

test('zonas-envio: POST crea (201) con los valores recortados y activa por defecto', () =>
  conFake(
    (sql, params) => (sql.includes('INSERT INTO zonas_envio') ? { rows: [{ ...ZONA, nombre: params[0], barrios: params[1] }] } : undefined),
    async (db) => {
      const res = await pedir('post', '/zonas-envio', { nombre: '  Norte ', barrios: [' Centro ', 'Los Álamos'], costo_envio: 5000.5, tiempo_estimado_min: 30 });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(res.body.zona.nombre, 'Norte');
      const q = db.buscar('INSERT INTO zonas_envio');
      assert.deepStrictEqual(q.params, ['Norte', ['Centro', 'Los Álamos'], 5000.5, 30, true]);
      assert.match(q.sql, /\$1::varchar, \$2::text\[\], \$3::numeric, \$4::int, \$5::boolean/);
    }
  ));

test('zonas-envio: PATCH edita solo lo que viene (desactivar es PATCH { activa: false })', () =>
  conFake(
    (sql) => (sql.includes('UPDATE zonas_envio SET') ? { rows: [{ ...ZONA, activa: false }] } : undefined),
    async (db) => {
      const res = await pedir('patch', '/zonas-envio/3', { activa: false });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.zona.activa, false);
      const q = db.buscar('UPDATE zonas_envio SET');
      assert.match(q.sql, /SET activa = \$2::boolean\s+WHERE id_zona = \$1::int/);
      assert.deepStrictEqual(q.params, [3, false]);
    }
  ));

test('zonas-envio: PATCH de una zona que no existe -> 404 no_encontrado; :id inválido también', () =>
  conFake(() => ({ rows: [] }), async () => {
    for (const ruta of ['/zonas-envio/999', '/zonas-envio/abc', '/zonas-envio/0']) {
      const res = await pedir('patch', ruta, { activa: false });
      assert.strictEqual(res.status, 404, ruta);
      assert.deepStrictEqual(res.body, { error: 'Zona no encontrada', motivo: 'no_encontrado' });
    }
  }));

test('zonas-envio: no hay DELETE (las zonas se desactivan)', () =>
  conFake(() => ({ rows: [] }), async () => {
    const res = await pedir('delete', '/zonas-envio/3');
    assert.strictEqual(res.status, 404);
  }));

for (const [caso, cuerpo] of [
  ['vacío', {}],
  ['sin barrios', { nombre: 'N', costo_envio: 1, tiempo_estimado_min: 10 }],
  ['barrios vacío', { nombre: 'N', barrios: [], costo_envio: 1, tiempo_estimado_min: 10 }],
  ['un barrio en blanco', { nombre: 'N', barrios: ['  '], costo_envio: 1, tiempo_estimado_min: 10 }],
  ['nombre de 81', { nombre: 'n'.repeat(81), barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 10 }],
  ['costo negativo', { nombre: 'N', barrios: ['A'], costo_envio: -1, tiempo_estimado_min: 10 }],
  ['costo con tres decimales', { nombre: 'N', barrios: ['A'], costo_envio: 1.005, tiempo_estimado_min: 10 }],
  ['costo como texto', { nombre: 'N', barrios: ['A'], costo_envio: '1000', tiempo_estimado_min: 10 }],
  ['tiempo 0', { nombre: 'N', barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 0 }],
  ['tiempo 601', { nombre: 'N', barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 601 }],
  ['tiempo con decimales', { nombre: 'N', barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 10.5 }],
  ['un campo de más', { nombre: 'N', barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 10, id_zona: 9 }],
]) {
  test(`zonas-envio: POST ${caso} -> 400 cuerpo_invalido sin tocar la base`, () =>
    conFake(() => ({ rows: [] }), async (db) => {
      const res = await pedir('post', '/zonas-envio', cuerpo);
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(db.buscar('zonas_envio'), undefined);
    }));
}

test('zonas-envio: PATCH vacío o con un campo de más -> 400 cuerpo_invalido', () =>
  conFake(() => ({ rows: [] }), async () => {
    for (const cuerpo of [{}, { borrar: true }]) {
      const res = await pedir('patch', '/zonas-envio/3', cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    }
  }));

/** Captura console.error mientras corre `fn`. */
async function capturarLog(fn) {
  const original = console.error;
  const lineas = [];
  console.error = (...a) => lineas.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lineas.join('\n');
}

test('zonas-envio: el barrio en OTRA zona activa (unique_violation del trigger) -> 409 barrio_en_otra_zona con el barrio', () =>
  conFake(
    (sql) => {
      if (sql.includes('INSERT INTO zonas_envio') || sql.includes('UPDATE zonas_envio')) {
        throw pgError('23505', 'El barrio "los alamos" ya está en la zona activa "Sur"', {
          where: 'función PL/pgSQL fn_tr_validar_zona_envio() en la línea 27 en RAISE',
        });
      }
      return undefined;
    },
    async () => {
      for (const [metodo, ruta, cuerpo] of [
        ['post', '/zonas-envio', { nombre: 'Norte', barrios: ['Los Álamos'], costo_envio: 1, tiempo_estimado_min: 10 }],
        ['patch', '/zonas-envio/3', { activa: true }],
      ]) {
        const res = await pedir(metodo, ruta, cuerpo);
        assert.strictEqual(res.status, 409);
        assert.deepStrictEqual(res.body, {
          error: 'El barrio "los alamos" ya está en otra zona activa ("Sur")',
          motivo: 'barrio_en_otra_zona',
          barrio: 'los alamos',
          zona: 'Sur',
        });
        assert.ok(!JSON.stringify(res.body).includes('PL/pgSQL'), 'sin el detalle de PostgreSQL');
      }
    }
  ));

test('zonas-envio: el nombre repetido (zonas_envio_nombre_key) -> 409 zona_duplicada, sin el detail', () =>
  conFake(
    (sql) => {
      if (sql.includes('INSERT INTO zonas_envio')) {
        throw pgError('23505', 'llave duplicada viola restricción de unicidad', {
          constraint: 'zonas_envio_nombre_key',
          detail: 'Ya existe la llave (nombre)=(Norte).',
        });
      }
      return undefined;
    },
    async () => {
      const res = await pedir('post', '/zonas-envio', { nombre: 'Norte', barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 10 });
      assert.strictEqual(res.status, 409);
      assert.deepStrictEqual(res.body, { error: 'Ya existe una zona con ese nombre', motivo: 'zona_duplicada' });
    }
  ));

test('zonas-envio: el mismo barrio dos veces en la zona -> 400 barrio_repetido', () =>
  conFake(
    (sql) => {
      if (sql.includes('INSERT INTO zonas_envio')) throw pgError('23505', 'El barrio "a" está repetido en la zona "N"');
      return undefined;
    },
    async () => {
      const res = await pedir('post', '/zonas-envio', { nombre: 'N', barrios: ['a', 'A'], costo_envio: 1, tiempo_estimado_min: 10 });
      assert.strictEqual(res.status, 400);
      assert.deepStrictEqual(res.body, { error: 'El barrio "a" está dos veces en la zona', motivo: 'barrio_repetido', barrio: 'a' });
    }
  ));

test('zonas-envio: otro error de la base -> genérico con motivo, y el log sin el mensaje de PostgreSQL', () =>
  conFake(
    (sql) => {
      if (sql.includes('INSERT INTO zonas_envio')) throw pgError('23514', 'check secreto', { detail: 'fila con datos' });
      return undefined;
    },
    async () => {
      let res;
      const log = await capturarLog(async () => {
        res = await pedir('post', '/zonas-envio', { nombre: 'N', barrios: ['A'], costo_envio: 1, tiempo_estimado_min: 10 });
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.motivo, 'dato_invalido');
      assert.ok(!log.includes('check secreto') && !log.includes('fila con datos'), log);
      assert.match(log, /23514/);
    }
  ));
