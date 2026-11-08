const test = require('node:test');
const assert = require('node:assert');
const { tokenStaff } = require('./helpers/fake-db');
const { TABLA, claveDe, pedir } = require('./helpers/catalogo-rutas');

// D-11: inyección SQL en los parámetros de ruta y de consulta.
//
// Hoy el código está bien: no hay una sola plantilla con ${} dentro de un
// pool.query() ni concatenación con +, y las únicas interpolaciones que existen
// (los LIMIT y los nombres de columna de reportes.service.js, la lista de
// columnas de constructor.service.js) son constantes del módulo, no entrada del
// usuario. O sea que esta batería no arregla nada: lo FIJA.
//
// La afirmación central no es sobre el código de respuesta —un 400, un 404 o un
// 422 son todos aceptables— sino sobre el SQL que llegó a ejecutarse: el texto
// envenenado NUNCA puede aparecer dentro de la sentencia. Si aparece, es que
// alguien lo pegó a mano en vez de pasarlo como parámetro, y eso es la
// vulnerabilidad, independientemente de lo que haya contestado la ruta.

/**
 * Cargas con las que se envenena cada parámetro.
 *
 * `valor` es lo que se escribe en la URL y `enLaBase` lo que debería llegar al
 * parámetro de la consulta, que no siempre es igual: Express decodifica el
 * porcentaje antes de poner nada en `req.params`.
 *
 * `llega: false` marca las cargas que NO pueden llegar a la base porque llevan
 * una barra y parten la URL en más segmentos, así que ninguna ruta coincide y
 * la respuesta es 404. Eso también es una defensa, pero no se puede afirmar
 * sobre el SQL porque no se ejecuta ninguno.
 */
const CARGAS = [
  { nombre: 'OR siempre verdadero', valor: '1 OR 1=1' },
  { nombre: 'punto y coma con DROP', valor: '1; DROP TABLE pedidos--' },
  { nombre: 'comilla y UNION', valor: "1' UNION SELECT NULL,NULL,NULL--" },
  { nombre: 'comentario al final', valor: '1--' },
  { nombre: 'comentario intercalado', valor: '1/**/OR/**/1=1', llega: false },
  { nombre: 'comilla suelta', valor: "1'" },
  { nombre: 'comilla doble suelta', valor: '1"' },
  { nombre: 'byte nulo', valor: '1%00', enLaBase: '1\u0000' },
  { nombre: 'id enorme', valor: '9'.repeat(40) },
  { nombre: 'negativo', valor: '-1' },
  { nombre: 'punto y coma con SET', valor: '1; SET ROLE postgres--' },
  { nombre: 'pg_sleep', valor: '1; SELECT pg_sleep(10)--' },
].map((c) => ({ llega: true, enLaBase: c.valor, ...c }));

/** Rutas con algún parámetro en la URL, y el segmento que se envenena. */
const CON_PARAMETRO = TABLA.filter((f) => f.patron.includes('/:'));

/**
 * Sustituye el valor del parámetro en la URL de la fila.
 *
 * Se apoya en que la `url` de la tabla usa el mismo número de segmentos que el
 * `patron`: se recorren en paralelo y se cambia el segmento que en el patrón
 * empieza por ':'.
 */
function urlEnvenenada(fila, carga) {
  const [camino, consulta] = fila.url.split('?');
  const partesPatron = fila.patron.split('/');
  const partesUrl = camino.split('/');

  const nuevas = partesUrl.map((parte, i) =>
    partesPatron[i] && partesPatron[i].startsWith(':') ? carga : parte
  );

  return nuevas.join('/') + (consulta ? `?${consulta}` : '');
}

/** Credenciales con las que la petición llega al controller. */
function credencialesDe(fila) {
  if (fila.acceso === 'interna') return { cabeceras: { 'x-internal-key': 'clave-interna-de-prueba' } };
  if (fila.acceso === 'publica') return {};
  return { token: tokenStaff(1, 'admin') };
}

/**
 * Afirma que ninguna sentencia ejecutada lleva la carga pegada dentro.
 *
 * Devuelve cuántas veces la carga viajó como PARÁMETRO, que es donde tiene que
 * estar. Sirve para comprobar al final que la batería no pasó por vacío.
 */
function sqlSinLaCarga(db, carga, contexto) {
  let comoParametro = 0;

  for (const { sql, params } of db.ejecutadas) {
    for (const texto of new Set([carga.valor, carga.enLaBase])) {
      // Una carga de uno o dos caracteres (un espacio, una comilla sola) sale
      // por casualidad en cualquier sentencia y daría un falso positivo: la
      // comprobación por subcadena solo tiene sentido con algo distintivo.
      if (texto.length < 3) continue;
      assert.ok(
        !sql.includes(texto),
        `${contexto}: la carga entró en la SENTENCIA, no como parámetro.\nSQL: ${sql}`
      );
    }
    // Una sentencia con parámetros tiene que usar marcadores.
    if ((params || []).some((p) => String(p) === carga.enLaBase)) {
      comoParametro += 1;
      assert.ok(
        sql.includes('$1'),
        `${contexto}: se pasaron parámetros pero la sentencia no usa marcadores.\nSQL: ${sql}`
      );
    }
  }

  return comoParametro;
}

for (const carga of CARGAS) {
  test(`d-11: "${carga.nombre}" en un :id no entra en ninguna sentencia`, async () => {
    let vecesComoParametro = 0;

    for (const fila of CON_PARAMETRO) {
      const url = urlEnvenenada(fila, carga.valor);
      const contexto = `${claveDe(fila)} con ${carga.nombre}`;

      await pedir(fila, {
        ...credencialesDe(fila),
        url,
        espia: (db) => {
          vecesComoParametro += sqlSinLaCarga(db, carga, contexto);
        },
      });
    }

    if (carga.llega) {
      assert.ok(
        vecesComoParametro > 0,
        'la carga no llegó a la base en ninguna ruta: la prueba no comprobó nada'
      );
    } else {
      assert.strictEqual(
        vecesComoParametro,
        0,
        'esta carga parte la URL, así que no debería llegar a ninguna consulta'
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Que el id envenenado no amplíe la condición
// ---------------------------------------------------------------------------

/**
 * Doble de base que solo devuelve la fila cuando el id llega EXACTO como
 * parámetro, igual que haría el WHERE de PostgreSQL.
 *
 * Con esto la prueba ya no depende de lo que conteste el controller: si una
 * carga tipo `1 OR 1=1` consiguiera la fila, sería porque el id se pegó al SQL
 * en vez de pasarse como parámetro. Es el `OR 1=1` clásico, observable sin
 * PostgreSQL real.
 */
function soloSiElIdEs(idBueno, fila) {
  return (sql, params) => {
    const coincide = (params || []).some((p) => String(p) === String(idBueno));
    if (!coincide) return { rows: [] };
    if (sql.includes('FROM pedidos') || sql.includes('FROM mesas') || sql.includes('FROM platos')) {
      return { rows: [fila] };
    }
    return { rows: [] };
  };
}

const DETALLES = [
  { metodo: 'GET', url: '/api/pedidos/87', id: 87, fila: { id_pedido: 87, id_mesa: 5, total: '0.00' } },
  { metodo: 'GET', url: '/api/mesas/5', id: 5, fila: { id_mesa: 5, numero: 5, capacidad: 4 } },
  { metodo: 'GET', url: '/api/platos/7', id: 7, fila: { id_plato: 7, nombre: 'Arepa' } },
];

for (const caso of DETALLES) {
  test(`d-11: ningún id envenenado consigue la fila de ${caso.url}`, async () => {
    const token = tokenStaff(1, 'admin');
    const responder = soloSiElIdEs(caso.id, caso.fila);

    // Control: con el id de verdad la fila SÍ llega. Si esto fallara, las
    // comprobaciones de abajo pasarían por vacío.
    const bueno = await pedir({ metodo: caso.metodo, url: caso.url }, { token, responder });
    assert.strictEqual(bueno.status, 200, `el control de ${caso.url} respondió ${bueno.status}`);

    for (const carga of CARGAS) {
      const url = caso.url.replace(String(caso.id), carga.valor);
      const res = await pedir({ metodo: caso.metodo, url }, { token, responder });

      assert.notStrictEqual(
        res.status,
        200,
        `${url} (${carga.nombre}) consiguió la fila: el id no se está pasando como parámetro`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Parámetros de consulta
// ---------------------------------------------------------------------------

/** Rutas que leen algo de la query string, con el parámetro que leen. */
const CON_CONSULTA = [
  { metodo: 'GET', base: '/api/reportes', parametro: 'rango', protegida: true },
  { metodo: 'GET', base: '/api/platos', parametro: 'id_categoria', protegida: false },
];

for (const carga of CARGAS) {
  test(`d-11: "${carga.nombre}" en la query no entra en ninguna sentencia`, async () => {
    for (const ruta of CON_CONSULTA) {
      const url = `${ruta.base}?${ruta.parametro}=${encodeURIComponent(carga.valor)}`;
      const contexto = `${ruta.metodo} ${url}`;

      const res = await pedir(
        { metodo: ruta.metodo, url },
        {
          ...(ruta.protegida ? { token: tokenStaff(1, 'admin') } : {}),
          espia: (db) => sqlSinLaCarga(db, carga, contexto),
        }
      );

      assert.ok(res.status !== 500, `${contexto} respondió 500`);
    }
  });
}

test('d-11: el rango de los reportes es una lista blanca, no un texto', async () => {
  // reportes.service.js interpola FECHA_LOCAL() y los LIMIT en el SQL. Son
  // constantes del módulo, pero el `rango` que elige las fechas viene de la
  // query: lo que lo hace seguro es el enum de zod. Esto lo fija.
  for (const rango of ['dia', 'HOY', 'hoy ', 'semana;', '', 'año']) {
    const res = await pedir(
      { metodo: 'GET', url: `/api/reportes?rango=${encodeURIComponent(rango)}` },
      { token: tokenStaff(1, 'admin') }
    );

    assert.strictEqual(res.status, 400, `rango="${rango}" respondió ${res.status}`);
  }
});

test('d-11: los tres rangos buenos siguen pasando', async () => {
  for (const rango of ['hoy', 'semana', 'mes']) {
    const res = await pedir(
      { metodo: 'GET', url: `/api/reportes?rango=${rango}` },
      { token: tokenStaff(1, 'admin') }
    );

    assert.notStrictEqual(res.status, 400, `rango=${rango} debería valer`);
  }
});

test('d-11: ninguna sentencia del repo se arma pegando texto', () => {
  // Complemento estático de lo anterior: si alguien escribe una consulta con
  // una plantilla o una concatenación, esto lo ve aunque no haya una prueba de
  // ruta que pase por ahí. Se permiten las interpolaciones de constantes, que
  // es lo que ya hacen reportes.service.js y constructor.service.js, así que se
  // busca el patrón peligroso: ${ con algo que venga de req, datos o params.
  const fs = require('node:fs');
  const path = require('node:path');

  const raiz = path.join(__dirname, '..', 'src');
  const archivos = [];
  (function recorrer(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (entrada.name.endsWith('.js')) archivos.push(completo);
    }
  })(raiz);

  assert.ok(archivos.length > 10, 'no se encontró el código fuente');

  const sospechosas = [];
  for (const archivo of archivos) {
    const lineas = fs.readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      const interpola = linea.includes('${');
      if (!interpola) return;
      const deEntrada = ['req.', 'datos.', 'params', 'body', 'query'].some((t) => linea.includes(t));
      const pareceSql = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WHERE', 'FROM', 'VALUES']
        .some((t) => linea.toUpperCase().includes(t));
      if (deEntrada && pareceSql) {
        sospechosas.push(`${path.relative(raiz, archivo)}:${i + 1}: ${linea.trim()}`);
      }
    });
  }

  assert.deepStrictEqual(
    sospechosas,
    [],
    'Hay líneas que meten entrada del usuario dentro de una sentencia:\n'
      + sospechosas.join('\n')
  );
});
