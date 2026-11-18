const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');
const { patronDeBusqueda } = require('../src/services/inventario.service');

// `q` en las búsquedas de inventario es TEXTO LITERAL: los comodines de ILIKE
// que escribe el usuario (%, _) y la barra invertida se escapan, y las
// consultas usan ESCAPE '\' de forma explícita. Antes, q=% traía todo.
// El comportamiento contra PostgreSQL real está en
// tests/integracion/inventario-busqueda-sql.test.js.

const BARRA = '\\';

test('patronDeBusqueda: texto normal, envuelto en %…%', () => {
  assert.strictEqual(patronDeBusqueda('carne'), '%carne%');
  assert.strictEqual(patronDeBusqueda('Carne Angus'), '%Carne Angus%');
});

test('patronDeBusqueda: escapa %, _ y la barra invertida', () => {
  assert.strictEqual(patronDeBusqueda('%'), `%${BARRA}%%`);
  assert.strictEqual(patronDeBusqueda('_'), `%${BARRA}_%`);
  assert.strictEqual(patronDeBusqueda('50%_off'), `%50${BARRA}%${BARRA}_off%`);
  // La barra se escapa PRIMERO: 'a\b' -> '%a\\b%', y 'a\%' no se convierte en
  // un % sin escapar.
  assert.strictEqual(patronDeBusqueda(`a${BARRA}b`), `%a${BARRA}${BARRA}b%`);
  assert.strictEqual(patronDeBusqueda(`a${BARRA}%`), `%a${BARRA}${BARRA}${BARRA}%%`);
  assert.strictEqual(patronDeBusqueda(BARRA), `%${BARRA}${BARRA}%`);
});

test('patronDeBusqueda: sin q no hay filtro', () => {
  assert.strictEqual(patronDeBusqueda(''), null);
  assert.strictEqual(patronDeBusqueda(null), null);
  assert.strictEqual(patronDeBusqueda(undefined), null);
});

test('patronDeBusqueda: lo que deja es un patron que solo casa el texto literal', () => {
  // Interprete minimo de ILIKE con ESCAPE '\', para comprobar el escape sin
  // base: el patron de "%" solo casa nombres que contienen un % literal.
  const casa = (patron, texto) => {
    let re = '';
    for (let i = 0; i < patron.length; i++) {
      const c = patron[i];
      if (c === BARRA) { re += patron[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; }
      else if (c === '%') re += '.*';
      else if (c === '_') re += '.';
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`, 'is').test(texto);
  };
  assert.strictEqual(casa(patronDeBusqueda('%'), 'Carne Angus'), false, 'q=% ya no trae todo');
  assert.strictEqual(casa(patronDeBusqueda('%'), 'Descuento 50%'), true);
  assert.strictEqual(casa(patronDeBusqueda('_'), 'Pan'), false, 'q=_ ya no casa cualquier caracter');
  assert.strictEqual(casa(patronDeBusqueda('_'), 'pan_brioche'), true);
  assert.strictEqual(casa(patronDeBusqueda('carne'), 'Carne Angus 200 g'), true, 'sin distinguir mayusculas');
  assert.strictEqual(casa(patronDeBusqueda(`a${BARRA}b`), `xa${BARRA}by`), true);
});

// Por la ruta: lo que llega a la base es el patron escapado, como parametro.
for (const [ruta, fragmento] of [
  ['/api/inventario/insumos?q=%25_', 'FROM insumos s'],
  ['/api/inventario/insumos?estado=bajo&q=%25_', 'FROM v_stock_bajo'],
]) {
  test(`por la ruta: ${ruta} manda el patron escapado y ESCAPE explicito`, async () => {
    const db = instalarFakeDb(() => ({ rows: [] }));
    try {
      const res = await request(app).get(ruta).set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);
      assert.strictEqual(res.status, 200);
      const q = db.buscar(fragmento);
      assert.ok(q, 'consulto');
      assert.ok(q.params.includes(`%${BARRA}%${BARRA}_%`), `parametros: ${JSON.stringify(q.params)}`);
      assert.match(q.sql, /ILIKE \$\d::TEXT ESCAPE '\\'/, 'ESCAPE explicito');
      assert.ok(!/'%' \|\|/.test(q.sql), 'ya no se concatenan comodines en SQL');
    } finally {
      db.restaurar();
    }
  });
}

test('por la ruta: la carta manda el patron escapado en sus dos consultas', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app).get('/api/inventario/carta?q=_').set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);
    assert.strictEqual(res.status, 200);
    const consultas = db.todas('FROM v_carta_disponible');
    assert.strictEqual(consultas.length, 2, 'platos e ingredientes');
    for (const q of consultas) {
      assert.strictEqual(q.params[1], `%${BARRA}_%`);
      assert.match(q.sql, /ILIKE \$2::TEXT ESCAPE '\\'/);
    }
  } finally {
    db.restaurar();
  }
});
