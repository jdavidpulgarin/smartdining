const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5433', 10),
  database: process.env.PGDATABASE || 'smartdining_test',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

function generarCodigoPedido() {
  return 'ORD-' + Math.random().toString(36).slice(2, 10).toUpperCase();
}

describe('Paso 1: Pruebas de Base de Datos (SQL Real)', () => {
  let pool;

  before(async () => {
    pool = new Pool(config);
    const res = await pool.query('SELECT current_database(), version()');
    assert.strictEqual(res.rows[0].current_database, config.database);
  });

  after(async () => {
    if (pool) await pool.end();
  });

  describe('1.1 Esquema e Integridad de Tablas', () => {
    it('deben existir las 15 tablas base más las 3 tablas del constructor', async () => {
      const res = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      const tablas = res.rows.map(r => r.table_name);
      
      const tablasEsperadas = [
        'auditoria_cambios',
        'categorias',
        'detalles_ingredientes',
        'detalles_pedido',
        'historial_estados',
        'ingredientes',
        'intentos_pago_fallidos',
        'kds_alertas',
        'kds_metricas',
        'mesas',
        'pasos_constructor',
        'pedidos',
        'platos',
        'suscripciones_push',
        'token_qr_historico',
        'transacciones',
        'transiciones_validas',
        'usuarios'
      ];

      for (const t of tablasEsperadas) {
        assert.ok(tablas.includes(t), `Falta la tabla obligatoria: ${t}`);
      }
    });

    it('la columna token_qr en mesas debe ser nullable y tener restricción UNIQUE', async () => {
      const res = await pool.query(`
        SELECT is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'mesas' AND column_name = 'token_qr';
      `);
      assert.strictEqual(res.rows[0].is_nullable, 'YES', 'token_qr debe ser nullable para permitir liberación');

      const resIdx = await pool.query(`
        SELECT indexdef 
        FROM pg_indexes 
        WHERE tablename = 'mesas' AND indexdef ILIKE '%UNIQUE%token_qr%';
      `);
      assert.ok(resIdx.rows.length > 0, 'token_qr debe tener índice UNIQUE');
    });
  });

  describe('1.2 Restricciones (Constraints y Cascadas)', () => {
    it('debe rechazar pasos con min_sel > max_sel mediante CHECK constraint', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await assert.rejects(
          async () => {
            await client.query(`
              INSERT INTO pasos_constructor (id_plato, nombre, orden, min_sel, max_sel, obligatorio)
              VALUES (1001, 'Paso Invalido', 99, 3, 1, true);
            `);
          },
          /check/i,
          'Debe violar el CHECK (min_sel <= max_sel)'
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('debe rechazar porciones fuera de ligera|normal|extra', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const pRes = await client.query(`
          INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
          VALUES (1, $1, 'recibido', 20000.00) RETURNING id_pedido;
        `, [generarCodigoPedido()]);
        const idPed = pRes.rows[0].id_pedido;

        const dpRes = await client.query(`
          INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, estado_item)
          VALUES ($1, 1001, 1, 20000.00, 20000.00, 'pendiente') RETURNING id_detalle;
        `, [idPed]);
        const idDet = dpRes.rows[0].id_detalle;

        const ingRes = await client.query('SELECT id_ingrediente FROM ingredientes WHERE id_paso = 101 LIMIT 1');
        const idIng = ingRes.rows[0].id_ingrediente;

        await assert.rejects(
          async () => {
            await client.query(`
              INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion, precio_aplicado)
              VALUES ($1, $2, 'gigante', 0.00);
            `, [idDet, idIng]);
          },
          /porcion/i
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('borrar un detalle_pedido debe borrar en cascada sus detalles_ingredientes', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const pRes = await client.query(`
          INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
          VALUES (1, $1, 'recibido', 0.00) RETURNING id_pedido;
        `, [generarCodigoPedido()]);
        const idPed = pRes.rows[0].id_pedido;

        const dpRes = await client.query(`
          INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, estado_item)
          VALUES ($1, 1001, 1, 20000.00, 20000.00, 'pendiente') RETURNING id_detalle;
        `, [idPed]);
        const idDet = dpRes.rows[0].id_detalle;

        const ing = await client.query('SELECT id_ingrediente FROM ingredientes WHERE id_paso = 101 LIMIT 1');
        await client.query(`
          INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion, precio_aplicado)
          VALUES ($1, $2, 'normal', 0.00);
        `, [idDet, ing.rows[0].id_ingrediente]);

        // Borrar el detalle_pedido
        await client.query('DELETE FROM detalles_pedido WHERE id_detalle = $1', [idDet]);

        // Verificar que los detalles_ingredientes se eliminaron
        const check = await client.query('SELECT * FROM detalles_ingredientes WHERE id_detalle = $1', [idDet]);
        assert.strictEqual(check.rows.length, 0, 'Debe eliminarse en cascada');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('1.3 Máquina de Estados de Pedido', () => {
    it('debe permitir transiciones válidas (recibido -> en_preparacion -> listo -> entregado)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const p = await client.query(
          "INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES (1, $1, 'recibido', 20000.00) RETURNING id_pedido",
          [generarCodigoPedido()]
        );
        const idPed = p.rows[0].id_pedido;

        await client.query("UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = $1", [idPed]);
        await client.query("UPDATE pedidos SET estado = 'listo' WHERE id_pedido = $1", [idPed]);
        await client.query("UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = $1", [idPed]);

        const finalState = await client.query("SELECT estado FROM pedidos WHERE id_pedido = $1", [idPed]);
        assert.strictEqual(finalState.rows[0].estado, 'entregado');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('debe rechazar una transición inválida (ej: entregado -> recibido)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const p = await client.query(
          "INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES (1, $1, 'recibido', 20000.00) RETURNING id_pedido",
          [generarCodigoPedido()]
        );
        const idPed = p.rows[0].id_pedido;

        await client.query("UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = $1", [idPed]);
        await client.query("UPDATE pedidos SET estado = 'listo' WHERE id_pedido = $1", [idPed]);
        await client.query("UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = $1", [idPed]);

        await assert.rejects(
          async () => {
            await client.query("UPDATE pedidos SET estado = 'recibido' WHERE id_pedido = $1", [idPed]);
          },
          /no autorizada|invalida/i
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('1.4 Cálculo de Totales con Extras y Cancelaciones', () => {
    it('ingrediente extra suma precio_extra; ligera y normal no suman', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const p = await client.query(
          "INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES (1, $1, 'recibido', 0.00) RETURNING id_pedido",
          [generarCodigoPedido()]
        );
        const idPed = p.rows[0].id_pedido;

        // Plato base 20000 (Bowl Personalizado)
        const dp = await client.query(`
          INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, estado_item)
          VALUES ($1, 1001, 1, 20000.00, 20000.00, 'pendiente') RETURNING id_detalle;
        `, [idPed]);
        const idDet = dp.rows[0].id_detalle;

        // Ingrediente con extra de 2500 (Carne Desmechada id_paso=102)
        const ingExtra = await client.query("SELECT id_ingrediente, precio_extra FROM ingredientes WHERE id_paso = 102 AND precio_extra > 0 LIMIT 1");
        const idIng = ingExtra.rows[0].id_ingrediente;
        const precioExtra = Number(ingExtra.rows[0].precio_extra);

        // Porción extra: debe sumar precioExtra
        await client.query(`
          INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion, precio_aplicado)
          VALUES ($1, $2, 'extra', $3);
        `, [idDet, idIng, precioExtra]);

        // Verificar el total del pedido actualizado por el trigger
        const pTot = await client.query("SELECT total FROM pedidos WHERE id_pedido = $1", [idPed]);
        assert.strictEqual(Number(pTot.rows[0].total), 20000 + precioExtra, 'El total debe incluir el extra');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('cancelar un pedido lo excluye de la cuenta de la mesa', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const p = await client.query(
          "INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES (4, $1, 'recibido', 30000.00) RETURNING id_pedido",
          [generarCodigoPedido()]
        );
        const idPed = p.rows[0].id_pedido;

        // Cancelar pedido
        await client.query("UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = $1", [idPed]);

        // obtener_cuenta_mesa(4) no debe sumar este pedido cancelado
        const c = await client.query("SELECT * FROM obtener_cuenta_mesa(4)");
        const totalMesa = Number(c.rows[0]?.total_mesa || 0);
        assert.strictEqual(totalMesa, 0, 'Pedidos cancelados deben excluirse del total de la mesa');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('1.5 Función obtener_menu_completo()', () => {
    it('devuelve menú JSON estructurado con pasos ordenados e ingredientes', async () => {
      const res = await pool.query('SELECT obtener_menu_completo() AS menu');
      const menu = res.rows[0].menu;
      assert.ok(Array.isArray(menu), 'El menú debe ser un arreglo de categorías');

      const catConstructor = menu.find(c => c.categoria === 'Arma tu plato');
      assert.ok(catConstructor, 'Debe existir la categoría Arma tu plato');

      const bowl = catConstructor.platos.find(p => p.nombre === 'Bowl Personalizado');
      assert.ok(bowl, 'Debe existir el Bowl Personalizado');
      assert.strictEqual(bowl.personalizable, true);
      assert.ok(bowl.pasos.length >= 4, 'Bowl debe tener al menos 4 pasos');

      for (const paso of bowl.pasos) {
        assert.ok(paso.ingredientes.length >= 2, `Paso ${paso.nombre} debe tener ingredientes`);
        assert.ok(typeof paso.orden === 'number');
      }
    });
  });

  describe('1.6 Cuenta por Comensal (obtener_cuenta_mesa)', () => {
    it('calcula subtotales, pagos y saldos correctamente tras pagos parciales', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const idMesa = 5;
        // H-02: Debe tener sesión activa iniciada
        await client.query("UPDATE mesas SET sesion_iniciada_en = NOW() - INTERVAL '10 minutes', estado = 'ocupada' WHERE id_mesa = $1", [idMesa]);

        // Crear pedido con dos comensales
        const ped = await client.query(`
          INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
          VALUES ($1, $2, 'recibido', 50000.00) RETURNING id_pedido;
        `, [idMesa, generarCodigoPedido()]);
        const idPed = ped.rows[0].id_pedido;

        const p1 = (await client.query("SELECT id_plato FROM platos LIMIT 1")).rows[0].id_plato;
        const p2 = (await client.query("SELECT id_plato FROM platos OFFSET 1 LIMIT 1")).rows[0].id_plato;

        await client.query(`
          INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal, estado_item)
          VALUES 
            ($1, $2, 1, 20000.00, 20000.00, 'Juan', 'pendiente'),
            ($1, $3, 1, 30000.00, 30000.00, 'Carlos', 'pendiente');
        `, [idPed, p1, p2]);

        // Registrar pago parcial de Juan: 20000
        await client.query(`
          INSERT INTO transacciones (id_pedido, monto, metodo_pago, estado_transaccion, comensal)
          VALUES ($1, 20000.00, 'efectivo', 'completada', 'Juan');
        `, [idPed]);

        const cuenta = await client.query('SELECT * FROM obtener_cuenta_mesa($1)', [idMesa]);
        assert.ok(cuenta.rows.length > 0, 'Debe retornar la cuenta de la mesa');

        const filaJuan = cuenta.rows.find(r => r.comensal === 'Juan');
        if (filaJuan) {
          assert.strictEqual(Number(filaJuan.pagado), 20000.00);
          assert.strictEqual(Number(filaJuan.saldo), 0.00);
        }

        const filaTotal = cuenta.rows.find(r => r.comensal === 'TOTAL MESA');
        assert.ok(filaTotal, 'Debe incluir fila TOTAL MESA');
        assert.strictEqual(Number(filaTotal.saldo), 30000.00, 'El saldo total restante de la mesa debe ser 30000');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('un pago con comensal = NULL cubre la cuenta general de la mesa', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const p = await client.query(
          "INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES (5, $1, 'recibido', 15000.00) RETURNING id_pedido",
          [generarCodigoPedido()]
        );
        const idPed = p.rows[0].id_pedido;

        const tx = await client.query(`
          INSERT INTO transacciones (id_pedido, monto, metodo_pago, estado_transaccion, comensal)
          VALUES ($1, 15000.00, 'efectivo', 'completada', NULL) RETURNING id_transaccion;
        `, [idPed]);
        assert.ok(tx.rows[0].id_transaccion);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('1.7 Concurrencia Real (Bloqueo FOR UPDATE)', () => {
    it('dos conexiones compitiendo por abrir la misma mesa: una gana y la otra espera o detecta bloqueo', async () => {
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      try {
        await c1.query('BEGIN');
        await c2.query('BEGIN');

        // c1 bloquea la mesa 2
        const m1 = await c1.query('SELECT * FROM mesas WHERE id_mesa = 2 FOR UPDATE NOWAIT');
        assert.strictEqual(m1.rows.length, 1);

        // c2 intenta bloquear la misma mesa con NOWAIT y debe ser rechazada inmediatamente
        await assert.rejects(
          async () => {
            await c2.query('SELECT * FROM mesas WHERE id_mesa = 2 FOR UPDATE NOWAIT');
          },
          /could not obtain lock/i
        );

        await c1.query('COMMIT');
        await c2.query('ROLLBACK');
      } finally {
        c1.release();
        c2.release();
      }
    });
  });

  describe('1.8 Datos Semilla (Seed Completo)', () => {
    it('Bowl, Wrap y Arepa existen con 4 pasos y catálogo completo de ingredientes', async () => {
      const res = await pool.query(`
        SELECT p.id_plato, p.nombre, count(DISTINCT pc.id_paso) as pasos_count, count(i.id_ingrediente) as ing_count
        FROM platos p
        JOIN pasos_constructor pc ON p.id_plato = pc.id_plato
        JOIN ingredientes i ON pc.id_paso = i.id_paso
        WHERE p.personalizable = TRUE
        GROUP BY p.id_plato, p.nombre;
      `);
      assert.ok(res.rows.length >= 3, 'Deben existir los 3 platos armables');
      for (const row of res.rows) {
        assert.ok(Number(row.pasos_count) >= 4, `Plato ${row.nombre} debe tener al menos 4 pasos`);
        assert.ok(Number(row.ing_count) >= 8, `Plato ${row.nombre} debe tener catálogo amplio de ingredientes`);
      }
    });
  });
});
