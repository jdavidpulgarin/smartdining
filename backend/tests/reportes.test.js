const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeRedis, redisCaido } = require('./helpers/fake-redis');
const reportesService = require('../src/services/reportes.service');
const app = require('../server');

// D-07: GET /api/reportes?rango=hoy|semana|mes
//
// Lo que se vigila aqui:
//   - es de admin y de nadie mas: son cifras de negocio;
//   - TODO lo numerico sale como number, no como string. El panel hace cuentas
//     con esos valores (los normaliza, los compara, saca maximos) y un '8940.00'
//     en texto lo obliga a parsear;
//   - una base sin ventas responde 200 con ceros y listas vacias, NUNCA 404:
//     "hoy no se ha vendido nada" es un dato, no un error;
//   - ningun dato de cliente se escapa en los agregados;
//   - el rango nunca entra en el SQL: se traduce por un mapa del codigo.

const RUTA = '/api/reportes';

const jwtAdmin = () => `Bearer ${tokenStaff(1, 'admin')}`;

/** Fragmentos que identifican cada una de las nueve consultas del service. */
const SQL = {
  ventas: 'v_ventas_diarias',
  tiempoCocina: 'tiempo_cocina_promedio',
  tiemposKds: 'ORDER BY k.fecha DESC',
  topPlatos: 'vendidos AS',
  topIngredientes: 'detalles_ingredientes di',
  metodos: 'cobros AS',
  horas: 'por_hora AS',
  ocupacion: 'ocupacion_mesas',
  alertas: 'kds_alerts_count',
};

/** Una base con ventas de verdad, para la forma completa de la respuesta. */
function dbConDatos(parche = {}) {
  const filas = {
    ventas: [{ total_ventas: 1250000, total_pedidos: 42, pedidos_liquidados: 38 }],
    tiempoCocina: [{ tiempo_cocina_promedio: 13.1 }],
    tiemposKds: [
      {
        fecha: '2026-10-14',
        platos_preparados: 56,
        tiempo_estimado_promedio_min: 15,
        tiempo_real_promedio_min: 13.1,
        variacion_promedio_porcentaje: -12.7,
      },
    ],
    topPlatos: [
      { id_plato: 1042, nombre: 'Hamburguesa Smart Angus', categoria: 'Hamburguesas & Fuertes', unidades: 20, total: 680000, porcentaje: 100 },
      { id_plato: 1040, nombre: 'Nachos Supremos', categoria: 'Entradas', unidades: 10, total: 240000, porcentaje: 50 },
    ],
    topIngredientes: [
      { id_ingrediente: 7, nombre_ingrediente: 'Panceta Crujiente', nombre_paso: 'Elige tu Proteína', nombre_plato: 'Bowl Personalizado', veces_solicitado: 14, porciones_extra: 4, porciones_normal: 10, ingresos_extras: 12000 },
    ],
    metodos: [
      { metodo: 'Tarjeta', monto: 700000, porcentaje: 56 },
      { metodo: 'Efectivo', monto: 550000, porcentaje: 44 },
    ],
    horas: [
      { hora: '12:00 - 13:00', pedidos: 18, volumen: 100 },
      { hora: '19:00 - 20:00', pedidos: 9, volumen: 50 },
    ],
    ocupacion: [{ ocupacion_mesas: 60 }],
    alertas: [{ kds_alerts_count: 3 }],
    ...parche,
  };

  return (sql) => {
    // El orden importa: tiempoCocina y tiemposKds leen la misma vista, asi que
    // se busca primero el fragmento mas especifico.
    if (sql.includes(SQL.tiempoCocina)) return { rows: filas.tiempoCocina };
    if (sql.includes(SQL.tiemposKds)) return { rows: filas.tiemposKds };
    if (sql.includes(SQL.ventas)) return { rows: filas.ventas };
    if (sql.includes(SQL.topPlatos)) return { rows: filas.topPlatos };
    if (sql.includes(SQL.topIngredientes)) return { rows: filas.topIngredientes };
    if (sql.includes(SQL.metodos)) return { rows: filas.metodos };
    if (sql.includes(SQL.horas)) return { rows: filas.horas };
    if (sql.includes(SQL.ocupacion)) return { rows: filas.ocupacion };
    if (sql.includes(SQL.alertas)) return { rows: filas.alertas };
    return { rows: [] };
  };
}

/** Una base recien sembrada: ninguna venta todavia. */
function dbVacia() {
  return dbConDatos({
    ventas: [{ total_ventas: 0, total_pedidos: 0, pedidos_liquidados: 0 }],
    tiempoCocina: [{ tiempo_cocina_promedio: null }],
    tiemposKds: [],
    topPlatos: [],
    topIngredientes: [],
    metodos: [],
    horas: [],
    ocupacion: [{ ocupacion_mesas: 0 }],
    alertas: [{ kds_alerts_count: 0 }],
  });
}

const pedir = (query = '', token = jwtAdmin()) => {
  const peticion = request(app).get(`${RUTA}${query}`);
  if (token) peticion.set('Authorization', token);
  return peticion;
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('admin obtiene el reporte', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('?rango=hoy');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rango, 'hoy');
  } finally {
    db.restaurar();
  }
});

for (const rol of ['cajero', 'mesero', 'cocina']) {
  test(`${rol} no puede ver los reportes: 403 y no se consulta nada`, async () => {
    const db = instalarFakeDb(dbConDatos());
    try {
      const res = await pedir('?rango=hoy', `Bearer ${tokenStaff(2, rol)}`);

      assert.strictEqual(res.status, 403);
      // Son cifras de negocio: no debe ni llegar a la base.
      assert.strictEqual(db.buscar('v_ventas_diarias'), undefined);
    } finally {
      db.restaurar();
    }
  });
}

test('un comensal recibe 403', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('?rango=hoy', `Bearer ${tokenComensal(5)}`);
    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});

test('sin token responde 401', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('?rango=hoy', null);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(db.buscar('v_ventas_diarias'), undefined);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El parametro rango
// ---------------------------------------------------------------------------

for (const rango of ['hoy', 'semana', 'mes']) {
  test(`rango=${rango} responde 200 y lo devuelve en el cuerpo`, async () => {
    const db = instalarFakeDb(dbConDatos());
    try {
      const res = await pedir(`?rango=${rango}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.rango, rango);
    } finally {
      db.restaurar();
    }
  });
}

test('sin rango usa hoy, que es lo que pide el panel', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rango, 'hoy');
  } finally {
    db.restaurar();
  }
});

for (const [caso, query] of [
  ['inventado', '?rango=ayer'],
  ['vacio', '?rango='],
  ['numerico', '?rango=7'],
  ['en mayusculas', '?rango=HOY'],
  ['con espacios', '?rango=%20hoy%20'],
  ['repetido (llega como arreglo)', '?rango=hoy&rango=mes'],
  ['objeto', '?rango[x]=hoy'],
]) {
  test(`un rango ${caso} responde 400 y no toca la base`, async () => {
    const db = instalarFakeDb(dbConDatos());
    try {
      const res = await pedir(query);

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /rango debe ser hoy, semana o mes/);
      assert.strictEqual(db.buscar('v_ventas_diarias'), undefined, 'ni una consulta');
    } finally {
      db.restaurar();
    }
  });
}

test('un parametro de mas se ignora, no es un 400', async () => {
  // Igual que el resto de la API con las claves extra del cuerpo.
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('?rango=hoy&desde=2020-01-01&orden=desc');
    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Forma de la respuesta
// ---------------------------------------------------------------------------

const CLAVES = [
  'rango',
  'totalVentas',
  'totalPedidos',
  'pedidosLiquidados',
  'ticketPromedio',
  'tiempoCocinaPromedio',
  'ocupacionMesas',
  'kdsAlertsCount',
  'topPlatos',
  'metodosPago',
  'horasPico',
  'topIngredientes',
  'tiemposKds',
];

test('la respuesta trae exactamente las claves del contrato', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('?rango=hoy');
    assert.deepStrictEqual(Object.keys(res.body).sort(), [...CLAVES].sort());
  } finally {
    db.restaurar();
  }
});

test('todo lo numerico es number, no string', async () => {
  // Es el punto del contrato: el panel hace cuentas con estos valores.
  const db = instalarFakeDb(dbConDatos());
  try {
    const { body } = await pedir('?rango=hoy');

    for (const campo of [
      'totalVentas', 'totalPedidos', 'pedidosLiquidados',
      'ticketPromedio', 'ocupacionMesas', 'kdsAlertsCount', 'tiempoCocinaPromedio',
    ]) {
      assert.strictEqual(typeof body[campo], 'number', `${campo} debe ser number`);
    }

    for (const p of body.topPlatos) {
      for (const campo of ['id_plato', 'unidades', 'total', 'porcentaje']) {
        assert.strictEqual(typeof p[campo], 'number', `topPlatos.${campo}`);
      }
      assert.strictEqual(typeof p.nombre, 'string', 'las etiquetas si son texto');
    }
    for (const m of body.metodosPago) {
      assert.strictEqual(typeof m.monto, 'number');
      assert.strictEqual(typeof m.porcentaje, 'number');
      assert.strictEqual(typeof m.metodo, 'string');
    }
    for (const h of body.horasPico) {
      assert.strictEqual(typeof h.volumen, 'number');
      assert.strictEqual(typeof h.pedidos, 'number');
      assert.strictEqual(typeof h.hora, 'string');
    }
    for (const t of body.tiemposKds) {
      for (const campo of [
        'platos_preparados', 'tiempo_estimado_promedio_min',
        'tiempo_real_promedio_min', 'variacion_promedio_porcentaje',
      ]) {
        assert.strictEqual(typeof t[campo], 'number', `tiemposKds.${campo}`);
      }
    }
    for (const i of body.topIngredientes) {
      for (const campo of ['veces_solicitado', 'porciones_extra', 'ingresos_extras']) {
        assert.strictEqual(typeof i[campo], 'number', `topIngredientes.${campo}`);
      }
    }
  } finally {
    db.restaurar();
  }
});

test('ningun monto llega como texto formateado', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const { body } = await pedir('?rango=hoy');
    const crudo = JSON.stringify(body);

    assert.ok(!crudo.includes('$'), 'el formato de moneda es del panel');
    assert.ok(!/\d\s*min/.test(crudo), 'las unidades las pone el panel');
    assert.ok(!/\d%/.test(crudo), 'el signo de porcentaje tambien');
  } finally {
    db.restaurar();
  }
});

test('un numero de pg que llegue como string se devuelve como number', async () => {
  // node-postgres entrega bigint como string: si una consulta se escribe sin
  // cast, el contrato se rompe en silencio. El Number() defensivo lo cubre.
  const db = instalarFakeDb(
    dbConDatos({
      ventas: [{ total_ventas: '1250000.00', total_pedidos: '42', pedidos_liquidados: '38' }],
      alertas: [{ kds_alerts_count: '3' }],
    })
  );
  try {
    const { body } = await pedir('?rango=hoy');

    assert.strictEqual(body.totalVentas, 1250000);
    assert.strictEqual(body.totalPedidos, 42);
    assert.strictEqual(body.kdsAlertsCount, 3);
    assert.strictEqual(typeof body.totalVentas, 'number');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Base sin ventas
// ---------------------------------------------------------------------------

test('una base sin ventas responde 200 con ceros y listas vacias', async () => {
  const db = instalarFakeDb(dbVacia());
  try {
    const res = await pedir('?rango=hoy');

    assert.strictEqual(res.status, 200, '"hoy no se vendio nada" es un dato, no un 404');
    assert.strictEqual(res.body.totalVentas, 0);
    assert.strictEqual(res.body.totalPedidos, 0);
    assert.strictEqual(res.body.pedidosLiquidados, 0);
    assert.strictEqual(res.body.ticketPromedio, 0);
    assert.strictEqual(res.body.ocupacionMesas, 0);
    assert.strictEqual(res.body.kdsAlertsCount, 0);
    assert.deepStrictEqual(res.body.topPlatos, []);
    assert.deepStrictEqual(res.body.metodosPago, []);
    assert.deepStrictEqual(res.body.horasPico, []);
    assert.deepStrictEqual(res.body.topIngredientes, []);
    assert.deepStrictEqual(res.body.tiemposKds, []);
  } finally {
    db.restaurar();
  }
});

test('sin comandas, el tiempo de cocina es null y no 0', async () => {
  // 0 min diria "se cocina al instante"; null dice "todavia no se sabe".
  const db = instalarFakeDb(dbVacia());
  try {
    const { body } = await pedir('?rango=hoy');
    assert.strictEqual(body.tiempoCocinaPromedio, null);
  } finally {
    db.restaurar();
  }
});

test('una consulta que no devuelve ninguna fila no rompe la respuesta', async () => {
  // Si una vista no existiera o filtrara todo, rows queda vacio.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await pedir('?rango=mes');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalVentas, 0);
    assert.strictEqual(res.body.ticketPromedio, 0);
    assert.deepStrictEqual(res.body.topPlatos, []);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Ticket promedio
// ---------------------------------------------------------------------------

test('el ticket promedio se calcula sobre los pedidos liquidados', async () => {
  const db = instalarFakeDb(
    dbConDatos({ ventas: [{ total_ventas: 1000000, total_pedidos: 50, pedidos_liquidados: 25 }] })
  );
  try {
    const { body } = await pedir('?rango=hoy');
    // 1.000.000 / 25 = 40.000, no 1.000.000 / 50: un pedido abierto todavia no
    // es una venta.
    assert.strictEqual(body.ticketPromedio, 40000);
  } finally {
    db.restaurar();
  }
});

test('sin pedidos liquidados el ticket promedio es 0, no una division por cero', async () => {
  const db = instalarFakeDb(
    dbConDatos({ ventas: [{ total_ventas: 0, total_pedidos: 7, pedidos_liquidados: 0 }] })
  );
  try {
    const { body } = await pedir('?rango=hoy');

    assert.strictEqual(body.ticketPromedio, 0);
    assert.ok(Number.isFinite(body.ticketPromedio), 'ni Infinity ni NaN');
  } finally {
    db.restaurar();
  }
});

test('el ticket promedio se redondea a dos decimales', async () => {
  const db = instalarFakeDb(
    dbConDatos({ ventas: [{ total_ventas: 100000, total_pedidos: 3, pedidos_liquidados: 3 }] })
  );
  try {
    const { body } = await pedir('?rango=hoy');
    assert.strictEqual(body.ticketPromedio, 33333.33);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// horasPico: el volumen es para pintar una barra
// ---------------------------------------------------------------------------

test('el volumen de horasPico esta entre 0 y 100', async () => {
  // El panel lo usa como height: ${volumen}%, asi que un conteo crudo pintaria
  // una barra del 3 % para una hora de 3 pedidos.
  const db = instalarFakeDb(dbConDatos());
  try {
    const { body } = await pedir('?rango=hoy');

    assert.ok(body.horasPico.length > 0);
    for (const h of body.horasPico) {
      assert.ok(h.volumen >= 0 && h.volumen <= 100, `volumen fuera de rango: ${h.volumen}`);
    }
  } finally {
    db.restaurar();
  }
});

test('horasPico conserva el conteo real aparte del volumen', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const { body } = await pedir('?rango=hoy');

    assert.strictEqual(body.horasPico[0].pedidos, 18);
    assert.strictEqual(body.horasPico[0].volumen, 100, 'la hora pico es el 100 %');
    assert.strictEqual(body.horasPico[1].pedidos, 9);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Metodos de pago: la agrupacion de tarjetas
// ---------------------------------------------------------------------------

test('las etiquetas de metodo de pago vienen en espanol y agrupadas', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const { body } = await pedir('?rango=hoy');
    assert.deepStrictEqual(body.metodosPago.map((m) => m.metodo), ['Tarjeta', 'Efectivo']);
  } finally {
    db.restaurar();
  }
});

test('la consulta junta debito y credito bajo una sola etiqueta', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=hoy');

    const consulta = db.buscar('cobros AS');
    assert.ok(consulta, 'se consulto el reparto por metodo');
    // Las dos ramas del CASE caen en 'Tarjeta': al duenio le interesa cuanto
    // entro por datafono, no de que tipo era el plastico.
    assert.match(consulta.sql, /'tarjeta_debito'\s+THEN 'Tarjeta'/);
    assert.match(consulta.sql, /'tarjeta_credito'\s+THEN 'Tarjeta'/);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Las consultas: zona horaria, parametros y topes
// ---------------------------------------------------------------------------

test('el rango viaja como parametro: nunca se interpola en el SQL', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=mes');

    for (const consulta of db.todas('limites AS')) {
      // No se busca la subcadena "mes" a secas: `FROM mesas` la contiene. Lo
      // que no puede aparecer es el rango como literal de SQL.
      assert.ok(
        !/'(hoy|semana|mes)'/.test(consulta.sql),
        'el rango no entra como literal en el SQL'
      );
      // Entra como numero por $1, traducido por el mapa del codigo: 'mes' son
      // 29 dias hacia atras contando hoy.
      assert.strictEqual(consulta.params[0], 29);
      assert.strictEqual(typeof consulta.params[0], 'number');
      assert.strictEqual(consulta.params[1], 'America/Bogota');
    }
  } finally {
    db.restaurar();
  }
});

for (const [rango, dias] of [['hoy', 0], ['semana', 6], ['mes', 29]]) {
  test(`rango=${rango} consulta ${dias} dias hacia atras`, async () => {
    const db = instalarFakeDb(dbConDatos());
    try {
      await pedir(`?rango=${rango}`);
      assert.strictEqual(db.buscar('v_ventas_diarias').params[0], dias);
    } finally {
      db.restaurar();
    }
  });
}

test('todas las consultas usan la zona de Bogota explicita', async () => {
  // Con TZ=UTC en el servidor, "hoy" se correria cinco horas y el corte de
  // caja saldria mal sin que nadie lo notara.
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=hoy');

    const consultas = db.todas('limites AS');
    assert.strictEqual(consultas.length, 9, 'las nueve consultas del reporte');
    for (const c of consultas) {
      assert.match(c.sql, /AT TIME ZONE \$2/);
      assert.strictEqual(c.params[1], 'America/Bogota');
    }
  } finally {
    db.restaurar();
  }
});

test('las listas llevan LIMIT', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=mes');

    assert.match(db.buscar('vendidos AS').sql, new RegExp(`LIMIT ${reportesService.TOPE_PLATOS}`));
    assert.match(
      db.buscar('detalles_ingredientes di').sql,
      new RegExp(`LIMIT ${reportesService.TOPE_INGREDIENTES}`)
    );
    assert.match(
      db.buscar('ORDER BY k.fecha DESC').sql,
      new RegExp(`LIMIT ${reportesService.TOPE_DIAS_KDS}`)
    );
  } finally {
    db.restaurar();
  }
});

test('las consultas de ranking excluyen los pedidos cancelados', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=mes');

    for (const fragmento of ['vendidos AS', 'detalles_ingredientes di', 'por_hora AS']) {
      assert.match(db.buscar(fragmento).sql, /p\.estado <> 'cancelado'/, fragmento);
    }
  } finally {
    db.restaurar();
  }
});

test('solo se suman transacciones completadas', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=mes');
    assert.match(db.buscar('cobros AS').sql, /estado_transaccion = 'completada'/);
  } finally {
    db.restaurar();
  }
});

test('los ingredientes se agrupan por id y no por nombre', async () => {
  // En la carta hay nombres repetidos a proposito y son ingredientes distintos.
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=mes');
    assert.match(db.buscar('detalles_ingredientes di').sql, /GROUP BY i\.id_ingrediente/);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Nada de datos de clientes
// ---------------------------------------------------------------------------

test('la respuesta no filtra ningun dato de cliente', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    const { body } = await pedir('?rango=mes');
    const crudo = JSON.stringify(body).toLowerCase();

    for (const fuga of ['comensal', 'referencia_externa', 'id_transaccion', 'token', 'email']) {
      assert.ok(!crudo.includes(fuga), `no debe aparecer "${fuga}"`);
    }
  } finally {
    db.restaurar();
  }
});

test('las consultas no leen columnas de cliente', async () => {
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=mes');

    for (const consulta of db.todas('limites AS')) {
      assert.ok(!/\bcomensal\b/.test(consulta.sql), consulta.sql.slice(0, 60));
      assert.ok(!/referencia_externa/.test(consulta.sql));
    }
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test('la segunda llamada sale del cache y no vuelve a la base', async () => {
  const redis = instalarFakeRedis();
  const db = instalarFakeDb(dbConDatos());
  try {
    const primera = await pedir('?rango=hoy');
    const consultasTrasPrimera = db.todas('limites AS').length;

    const segunda = await pedir('?rango=hoy');

    assert.strictEqual(segunda.status, 200);
    assert.deepStrictEqual(segunda.body, primera.body);
    assert.strictEqual(
      db.todas('limites AS').length,
      consultasTrasPrimera,
      'ni una consulta mas'
    );
  } finally {
    db.restaurar();
    redis.restaurar();
  }
});

test('cada rango tiene su propia clave de cache', async () => {
  const redis = instalarFakeRedis();
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=hoy');
    await pedir('?rango=semana');

    const guardadas = redis.todas('setEx').map((o) => o.clave);
    assert.ok(guardadas.includes('cache:reportes:hoy'));
    assert.ok(guardadas.includes('cache:reportes:semana'));
  } finally {
    db.restaurar();
    redis.restaurar();
  }
});

test('el cache se guarda con TTL de 60 segundos', async () => {
  const redis = instalarFakeRedis();
  const db = instalarFakeDb(dbConDatos());
  try {
    await pedir('?rango=hoy');
    assert.strictEqual(redis.ttlDe('cache:reportes:hoy'), reportesService.TTL_SEGUNDOS);
  } finally {
    db.restaurar();
    redis.restaurar();
  }
});

test('con Redis caido el reporte sale igual: el cache nunca lanza', async () => {
  const redis = redisCaido();
  const db = instalarFakeDb(dbConDatos());
  try {
    const res = await pedir('?rango=hoy');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalVentas, 1250000);
  } finally {
    db.restaurar();
    redis.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Errores de la base
// ---------------------------------------------------------------------------

test('si una vista no existe, sale 500 generico y no se filtra el esquema', async () => {
  // Es el caso real de una base creada antes de 24_vistas_reportes.sql.
  const db = instalarFakeDb((sql) => {
    if (sql.includes('v_ventas_diarias')) {
      const err = new Error('no existe la relación «v_ventas_diarias»');
      err.code = '42P01';
      throw err;
    }
    return { rows: [] };
  });
  try {
    const res = await pedir('?rango=hoy');

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Error interno del servidor');
    assert.ok(!JSON.stringify(res.body).includes('v_ventas_diarias'));
  } finally {
    db.restaurar();
  }
});

test('el rango se traduce por un mapa del codigo', () => {
  assert.deepStrictEqual(reportesService.RANGOS, ['hoy', 'semana', 'mes']);
  assert.deepStrictEqual(reportesService.DIAS_POR_RANGO, { hoy: 0, semana: 6, mes: 29 });
  assert.strictEqual(reportesService.claveCache('hoy'), 'cache:reportes:hoy');
});
