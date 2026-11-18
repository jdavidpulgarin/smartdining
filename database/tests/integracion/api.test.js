const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const API_URL = process.env.VITE_API_URL || 'http://localhost:4000';

const pgConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5433', 10),
  database: process.env.PGDATABASE || 'smartdining_test',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

describe('Paso 2: Pruebas de Integración API + BD Real', () => {
  let pool;
  let adminToken;
  let meseroToken;
  let cajeroToken;

  before(async () => {
    pool = new Pool(pgConfig);
    await pool.query('SELECT 1');
  });

  after(async () => {
    if (pool) await pool.end();
  });

  describe('2.1 Autenticación y RBAC', () => {
    it('login real de admin, mesero y cajero con usuarios del seed', async () => {
      // 1. Admin
      const resAdmin = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@smartdining.com', password: 'Admin123!' }),
      });
      assert.strictEqual(resAdmin.status, 200);
      const dataAdmin = await resAdmin.json();
      assert.strictEqual(dataAdmin.usuario.rol, 'admin');
      adminToken = dataAdmin.token;

      // 2. Mesero
      const resMesero = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mesero@smartdining.com', password: 'Admin123!' }),
      });
      assert.strictEqual(resMesero.status, 200);
      const dataMesero = await resMesero.json();
      assert.strictEqual(dataMesero.usuario.rol, 'mesero');
      meseroToken = dataMesero.token;

      // 3. Cajero
      const resCaja = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'caja@smartdining.com', password: 'Admin123!' }),
      });
      assert.strictEqual(resCaja.status, 200);
      const dataCaja = await resCaja.json();
      assert.strictEqual(dataCaja.usuario.rol, 'cajero');
      cajeroToken = dataCaja.token;
    });

    it('devuelve 401 con credenciales inválidas', async () => {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@smartdining.com', password: 'PasswordErrada' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('devuelve 403 cuando un mesero intenta registrar un pago', async () => {
      const res = await fetch(`${API_URL}/api/transacciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${meseroToken}`,
        },
        body: JSON.stringify({
          id_pedido: 1,
          metodo_pago: 'efectivo',
          monto: 10000,
        }),
      });
      assert.strictEqual(res.status, 403, 'Mesero no tiene permiso para cobrar transacciones');
    });
  });

  describe('2.2 Ciclo de Mesa con QR y Sesión', () => {
    let tokenQr;
    let jwtComensal;
    const ID_MESA_TEST = 2; // Mesa sin pedidos

    it('abrir mesa devuelve URL con ?token= y crea sesión activa', async () => {
      await pool.query(
        "UPDATE pedidos SET estado = 'cancelado' WHERE id_mesa = $1 AND estado IN ('recibido', 'en_preparacion', 'listo')",
        [ID_MESA_TEST]
      );
      const ent2 = await pool.query("SELECT id_pedido, total FROM pedidos WHERE id_mesa = $1 AND estado = 'entregado'", [ID_MESA_TEST]);
      for (const p of ent2.rows) {
        await pool.query("INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, creado_en) VALUES ($1, 'efectivo', $2, 'completada', NOW())", [p.id_pedido, p.total]);
        await pool.query("UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1", [p.id_pedido]);
      }
      await pool.query("UPDATE mesas SET estado = 'disponible', token_qr = NULL, sesion_iniciada_en = NULL WHERE id_mesa = $1", [ID_MESA_TEST]);

      const resAbrir = await fetch(`${API_URL}/api/mesas/${ID_MESA_TEST}/abrir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${meseroToken}` },
      });
      assert.ok([200, 201].includes(resAbrir.status), `Respuesta esperada 200/201, recibida: ${resAbrir.status}`);
      const dataAbrir = await resAbrir.json();
      assert.ok(dataAbrir.url, 'Debe devolver la URL del QR');
      assert.ok(dataAbrir.url.includes('?token='), 'URL debe contener parámetro ?token=');

      const urlObj = new URL(dataAbrir.url);
      tokenQr = urlObj.searchParams.get('token');
      assert.ok(tokenQr, 'Debe contener el token del QR');

      // Verificar en base de datos
      const mesaDb = await pool.query('SELECT estado, token_qr, sesion_iniciada_en FROM mesas WHERE id_mesa = $1', [ID_MESA_TEST]);
      assert.strictEqual(mesaDb.rows[0].estado, 'ocupada');
      assert.strictEqual(mesaDb.rows[0].token_qr, tokenQr);
      assert.ok(mesaDb.rows[0].sesion_iniciada_en, 'sesion_iniciada_en debe estar fijado');
    });

    it('POST /api/mesas/qr/:token/sesion emite JWT con rol comensal y alias', async () => {
      const alias = 'UserTest_' + Math.random().toString(36).slice(2, 7);
      const resSesion = await fetch(`${API_URL}/api/mesas/qr/${tokenQr}/sesion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comensal: alias }),
      });
      assert.strictEqual(resSesion.status, 201);
      const dataSesion = await resSesion.json();
      assert.ok(dataSesion.token, 'Debe devolver el JWT');
      assert.strictEqual(dataSesion.comensal, alias);
      assert.strictEqual(dataSesion.mesa.id_mesa, ID_MESA_TEST);
      jwtComensal = dataSesion.token;
    });

    it('liberar mesa sin pedidos abiertos y verificar que el token viejo ya no sirve', async () => {
      const resLiberar = await fetch(`${API_URL}/api/mesas/${ID_MESA_TEST}/liberar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${meseroToken}` },
      });
      assert.strictEqual(resLiberar.status, 200);

      // En la BD debe estar disponible y sin token_qr
      const mesaDb = await pool.query('SELECT estado, token_qr FROM mesas WHERE id_mesa = $1', [ID_MESA_TEST]);
      assert.strictEqual(mesaDb.rows[0].estado, 'disponible');
      assert.strictEqual(mesaDb.rows[0].token_qr, null);

      // Intentar entrar con el token viejo debe fallar
      const resViejo = await fetch(`${API_URL}/api/mesas/qr/${tokenQr}/sesion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comensal: 'IntentoFallido' }),
      });
      assert.ok(resViejo.status >= 400, 'El token QR revocado no debe permitir abrir sesión');
    });
  });

  describe('2.3 Pedido con Plato Armado, Transición de Estados y Pago Real', () => {
    const ID_MESA = 5;
    let tokenQrMesa;
    let comensalToken;
    let aliasComensal;
    let idPedidoCreado;
    let totalEsperado;

    before(async () => {
      // Limpiar pedidos anteriores en mesa 5 y abrirla limpia
      await pool.query(
        "UPDATE pedidos SET estado = 'cancelado' WHERE id_mesa = $1 AND estado IN ('recibido', 'en_preparacion', 'listo')",
        [ID_MESA]
      );
      const ent5 = await pool.query("SELECT id_pedido, total FROM pedidos WHERE id_mesa = $1 AND estado = 'entregado'", [ID_MESA]);
      for (const p of ent5.rows) {
        await pool.query("INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, creado_en) VALUES ($1, 'efectivo', $2, 'completada', NOW())", [p.id_pedido, p.total]);
        await pool.query("UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1", [p.id_pedido]);
      }
      await pool.query("UPDATE mesas SET estado = 'disponible', token_qr = NULL, sesion_iniciada_en = NULL WHERE id_mesa = $1", [ID_MESA]);

      const resAbrir = await fetch(`${API_URL}/api/mesas/${ID_MESA}/abrir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${meseroToken}` },
      });
      const data = await resAbrir.json();
      const url = new URL(data.url);
      tokenQrMesa = url.searchParams.get('token');

      // Crear sesión de comensal con alias único
      aliasComensal = 'Carlos_' + Math.random().toString(36).slice(2, 7);
      const resSesion = await fetch(`${API_URL}/api/mesas/qr/${tokenQrMesa}/sesion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comensal: aliasComensal }),
      });
      const dataSesion = await resSesion.json();
      comensalToken = dataSesion.token;
    });

    it('crear un pedido con plato armado y verificar cálculo exacto en BD', async () => {
      // Bowl Personalizado (id_plato: 1001, base: 20000)
      // Paso 1 (Base): id_ingrediente 1 (Arroz Integral, extra: 0) -> normal
      // Paso 2 (Proteína): id_ingrediente 5 (Carne Desmechada, extra: 2500) -> extra (+2500)
      // Paso 3 (Toppings): id_ingrediente 8 (Maíz Tierno, extra: 0) -> normal (+0)
      // Paso 4 (Salsa): id_ingrediente 13 (Salsa de Ajo, extra: 0) -> normal (+0)
      // Total esperado: 20000 + 2500 = 22500.00
      totalEsperado = 22500.00;

      const resPedido = await fetch(`${API_URL}/api/pedidos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${comensalToken}`,
        },
        body: JSON.stringify({
          items: [
            {
              id_plato: 1001,
              cantidad: 1,
              comensal: aliasComensal,
              ingredientes: [
                { id_ingrediente: 1, porcion: 'normal' },
                { id_ingrediente: 5, porcion: 'extra' },
                { id_ingrediente: 8, porcion: 'normal' },
                { id_ingrediente: 13, porcion: 'normal' },
              ],
            },
          ],
        }),
      });

      assert.strictEqual(resPedido.status, 201);
      const dataPedido = await resPedido.json();
      idPedidoCreado = dataPedido.id_pedido;
      assert.ok(idPedidoCreado, 'Debe devolver el id_pedido');

      // Verificar en PostgreSQL real
      const pDb = await pool.query('SELECT total, estado, estado_pago FROM pedidos WHERE id_pedido = $1', [idPedidoCreado]);
      assert.strictEqual(Number(pDb.rows[0].total), totalEsperado, 'Total en BD debe coincidir con cálculo');
      assert.strictEqual(pDb.rows[0].estado, 'recibido');
      assert.strictEqual(pDb.rows[0].estado_pago, 'pendiente');
    });

    it('cambiar el estado del pedido vía API y verificar en la BD', async () => {
      // recibido -> en_preparacion
      const res1 = await fetch(`${API_URL}/api/pedidos/${idPedidoCreado}/estado`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${meseroToken}`,
        },
        body: JSON.stringify({ estado: 'en_preparacion' }),
      });
      assert.strictEqual(res1.status, 200);

      // en_preparacion -> listo
      const res2 = await fetch(`${API_URL}/api/pedidos/${idPedidoCreado}/estado`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${meseroToken}`,
        },
        body: JSON.stringify({ estado: 'listo' }),
      });
      assert.strictEqual(res2.status, 200);

      // listo -> entregado
      const res3 = await fetch(`${API_URL}/api/pedidos/${idPedidoCreado}/estado`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${meseroToken}`,
        },
        body: JSON.stringify({ estado: 'entregado' }),
      });
      assert.strictEqual(res3.status, 200);

      // Verificar en la BD
      const pDb = await pool.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [idPedidoCreado]);
      assert.strictEqual(pDb.rows[0].estado, 'entregado');
    });

    it('pago en efectivo por cajero salda la cuenta y libera la mesa si está entregado', async () => {
      // Registrar pago en efectivo por el total
      const resPago = await fetch(`${API_URL}/api/transacciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cajeroToken}`,
        },
        body: JSON.stringify({
          id_pedido: idPedidoCreado,
          metodo_pago: 'efectivo',
          monto: totalEsperado,
        }),
      });

      assert.strictEqual(resPago.status, 201);

      // Verificar que el pedido pasó a estado pagado en la BD
      const pDb = await pool.query('SELECT estado, estado_pago FROM pedidos WHERE id_pedido = $1', [idPedidoCreado]);
      assert.strictEqual(pDb.rows[0].estado_pago, 'pagado');
      assert.strictEqual(pDb.rows[0].estado, 'pagado', 'Pedido entregado y pagado pasa a pagado (H-03)');

      // La mesa debe quedar liberada (disponible)
      const mesaDb = await pool.query('SELECT estado FROM mesas WHERE id_mesa = $1', [ID_MESA]);
      assert.strictEqual(mesaDb.rows[0].estado, 'disponible', 'La mesa debe quedar disponible tras liquidación completa');
    });
  });
});
