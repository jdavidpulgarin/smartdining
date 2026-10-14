const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { io } = require('socket.io-client');
const { Pool } = require('pg');

const API_URL = process.env.VITE_API_URL || 'http://localhost:4000';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'super-clave-interna-de-prueba-para-test-smartdining';

const pgConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5433', 10),
  database: process.env.PGDATABASE || 'smartdining_test',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

// Helper para esperar un evento específico de socket con timeout
function esperarEvento(socket, evento, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(evento, listener);
      reject(new Error(`Timeout esperando evento "${evento}" tras ${timeoutMs}ms`));
    }, timeoutMs);

    function listener(data) {
      clearTimeout(timer);
      socket.off(evento, listener);
      resolve(data);
    }

    socket.on(evento, listener);
  });
}

// Helper para asegurar que un evento NO se reciba durante una ventana
function asegurarNoEvento(socket, evento, ventanaMs = 600) {
  return new Promise((resolve, reject) => {
    function listener(data) {
      clearTimeout(timer);
      socket.off(evento, listener);
      reject(new Error(`Fallo de aislamiento: evento "${evento}" recibido indebidamente: ${JSON.stringify(data)}`));
    }

    const timer = setTimeout(() => {
      socket.off(evento, listener);
      resolve();
    }, ventanaMs);

    socket.on(evento, listener);
  });
}

describe('Paso 3: Pruebas de Tiempo Real (Socket.io Real)', () => {
  let pool;
  let meseroToken;
  let adminToken;

  // Helper para abrir mesa real y obtener token JWT de comensal
  async function abrirMesaYObtenerSesion(idMesa, alias) {
    // 1. Limpiar mesa en BD respetando la máquina de estados
    await pool.query(
      "UPDATE pedidos SET estado = 'cancelado' WHERE id_mesa = $1 AND estado IN ('recibido', 'en_preparacion', 'listo')",
      [idMesa]
    );
    const entregados = await pool.query(
      "SELECT id_pedido, total FROM pedidos WHERE id_mesa = $1 AND estado = 'entregado'",
      [idMesa]
    );
    for (const p of entregados.rows) {
      await pool.query(
        "INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, creado_en) VALUES ($1, 'efectivo', $2, 'completada', NOW())",
        [p.id_pedido, p.total]
      );
      await pool.query("UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1", [p.id_pedido]);
    }
    await pool.query("UPDATE mesas SET estado = 'disponible', token_qr = NULL, sesion_iniciada_en = NULL WHERE id_mesa = $1", [idMesa]);

    // 2. Abrir mesa con JWT de mesero (genera QR firmado en socket-server)
    const resAbrir = await fetch(`${API_URL}/api/mesas/${idMesa}/abrir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${meseroToken}` },
    });
    assert.ok([200, 201].includes(resAbrir.status), `Fallo abrir mesa ${idMesa}: ${resAbrir.status}`);
    const dataAbrir = await resAbrir.json();
    const tokenQr = new URL(dataAbrir.url).searchParams.get('token');

    // 3. Crear sesión de comensal con token QR real
    const resSesion = await fetch(`${API_URL}/api/mesas/qr/${tokenQr}/sesion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comensal: alias }),
    });
    assert.strictEqual(resSesion.status, 201, `Fallo sesión comensal ${alias}: ${resSesion.status}`);
    const dataSesion = await resSesion.json();
    return { tokenQr, jwtComensal: dataSesion.token };
  }

  before(async () => {
    pool = new Pool(pgConfig);
    await pool.query('SELECT 1');

    // Login mesero
    const resM = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mesero@smartdining.com', password: 'Admin123!' }),
    });
    assert.strictEqual(resM.status, 200);
    const dataM = await resM.json();
    meseroToken = dataM.token;

    // Login admin
    const resA = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@smartdining.com', password: 'Admin123!' }),
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    adminToken = dataA.token;
  });

  after(async () => {
    if (pool) await pool.end();
  });

  it('3.1 Conexión autenticada con JWT de personal (mesero en room:admin)', async () => {
    const socket = io(SOCKET_URL, {
      auth: { token: meseroToken },
      transports: ['websocket'],
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    assert.ok(socket.connected, 'Socket de mesero debe estar conectado');
    socket.disconnect();
  });

  it('3.2 Rechazo de conexión sin JWT o con JWT inválido', async () => {
    const socketSinAuth = io(SOCKET_URL, {
      transports: ['websocket'],
    });

    const err = await new Promise((resolve) => {
      socketSinAuth.on('connect_error', (error) => resolve(error));
    });

    assert.ok(err, 'Debe emitir connect_error');
    assert.strictEqual(err.message, 'AUTH_REQUERIDA');
    socketSinAuth.disconnect();

    const socketInvalido = io(SOCKET_URL, {
      auth: { token: 'jwt.invalido.123' },
      transports: ['websocket'],
    });

    const errInv = await new Promise((resolve) => {
      socketInvalido.on('connect_error', (error) => resolve(error));
    });

    assert.strictEqual(errInv.message, 'TOKEN_INVALIDO');
    socketInvalido.disconnect();
  });

  it('3.3 Al crear un pedido, el panel recibe order:created en < 1s', async () => {
    // 1. Conectar socket de mesero (escucha en room:admin)
    const staffSocket = io(SOCKET_URL, {
      auth: { token: meseroToken },
      transports: ['websocket'],
    });

    await new Promise((resolve) => staffSocket.on('connect', resolve));

    // 2. Preparar mesa 3 y obtener sesión de comensal
    const mesaId = 3;
    const { jwtComensal } = await abrirMesaYObtenerSesion(mesaId, 'Comensal_P3_3');

    // Promesa de recibir evento con medición de tiempo
    const tiempoInicio = Date.now();
    const eventoPromesa = esperarEvento(staffSocket, 'order:created', 3000);

    // 3. Crear pedido vía API del backend con token de comensal
    const resPedido = await fetch(`${API_URL}/api/pedidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtComensal}`,
      },
      body: JSON.stringify({
        notas_generales: 'Pedido socket test <1s',
        items: [
          {
            id_plato: 1004, // Nachos
            cantidad: 1,
            notas: 'Sin picante',
          },
        ],
      }),
    });

    assert.strictEqual(resPedido.status, 201);
    const dataPedido = await resPedido.json();

    const eventoRecibido = await eventoPromesa;
    const duracionMs = Date.now() - tiempoInicio;

    assert.ok(duracionMs < 1000, `Latencia de entrega (${duracionMs} ms) debe ser inferior a 1000 ms`);
    assert.strictEqual(eventoRecibido.pedido.id_pedido, dataPedido.id_pedido);
    assert.strictEqual(eventoRecibido.pedido.id_mesa, mesaId);
    assert.strictEqual(eventoRecibido.pedido.estado, 'recibido');

    staffSocket.disconnect();
  });

  it('3.4 Aislamiento de salas: order:status y payment:confirmed llegan solo a la mesa correcta', async () => {
    // Abrir mesa 1 y mesa 4 con sesiones reales
    const mesa1Id = 1;
    const mesa4Id = 4;

    const { jwtComensal: jwtM1 } = await abrirMesaYObtenerSesion(mesa1Id, 'Comensal_M1_' + Date.now());
    const { jwtComensal: jwtM4 } = await abrirMesaYObtenerSesion(mesa4Id, 'Comensal_M4_' + Date.now());

    // Conectar ambos sockets y unirse a sus respectivas mesas
    const socketM1 = io(SOCKET_URL, { auth: { token: jwtM1 }, transports: ['websocket'] });
    const socketM4 = io(SOCKET_URL, { auth: { token: jwtM4 }, transports: ['websocket'] });

    await Promise.all([
      new Promise((resolve) => socketM1.on('connect', resolve)),
      new Promise((resolve) => socketM4.on('connect', resolve)),
    ]);

    // join:table para cada uno
    await new Promise((resolve) => socketM1.emit('join:table', {}, resolve));
    await new Promise((resolve) => socketM4.emit('join:table', {}, resolve));

    // A) Prueba de aislamiento en order:status
    const statusM1Promesa = esperarEvento(socketM1, 'order:status', 2000);
    const noStatusM4Promesa = asegurarNoEvento(socketM4, 'order:status', 600);

    // Notificar cambio de estado para Mesa 1
    const resStatus = await fetch(`${SOCKET_URL}/internal/order-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        id_pedido: 9999,
        id_mesa: mesa1Id,
        codigo_pedido: 'PED-TEST-M1',
        estado_anterior: 'recibido',
        estado: 'en_preparacion',
      }),
    });
    assert.strictEqual(resStatus.status, 200);

    const [eventoStatusM1] = await Promise.all([statusM1Promesa, noStatusM4Promesa]);
    assert.strictEqual(eventoStatusM1.id_mesa, mesa1Id);
    assert.strictEqual(eventoStatusM1.estado, 'en_preparacion');

    // B) Prueba de aislamiento en payment:confirmed
    const paymentM1Promesa = esperarEvento(socketM1, 'payment:confirmed', 2000);
    const noPaymentM4Promesa = asegurarNoEvento(socketM4, 'payment:confirmed', 600);

    // Notificar pago confirmado para Mesa 1
    const resPay = await fetch(`${SOCKET_URL}/internal/payment-confirmed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        id_mesa: mesa1Id,
        comensal: 'Comensal_M1',
        monto_centavos: 3500000,
        saldo_restante_centavos: 0,
        referencia_externa: 'CAJA-TEST-M1',
      }),
    });
    assert.strictEqual(resPay.status, 200);

    const [eventoPayM1] = await Promise.all([paymentM1Promesa, noPaymentM4Promesa]);
    assert.strictEqual(eventoPayM1.id_mesa, mesa1Id);
    assert.strictEqual(eventoPayM1.monto, 35000);
    assert.strictEqual(eventoPayM1.saldo_restante, 0);

    socketM1.disconnect();
    socketM4.disconnect();
  });

  it('3.5 Al liberar la mesa, los comensales reciben mesa:liberada y son desconectados del socket', async () => {
    const mesaId = 5;
    const { jwtComensal: jwtM5 } = await abrirMesaYObtenerSesion(mesaId, 'Comensal_Lib_' + Date.now());

    const socketM5 = io(SOCKET_URL, { auth: { token: jwtM5 }, transports: ['websocket'] });
    await new Promise((resolve) => socketM5.on('connect', resolve));
    await new Promise((resolve) => socketM5.emit('join:table', {}, resolve));

    // Esperar mesa:liberada y disconnect con reason
    const liberadaPromesa = esperarEvento(socketM5, 'mesa:liberada', 2000);
    const disconnectPromesa = new Promise((resolve) => {
      socketM5.on('disconnect', (reason) => resolve(reason));
    });

    // Notificar liberación de mesa vía endpoint interno
    const resLib = await fetch(`${SOCKET_URL}/internal/mesa-liberada`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        id_mesa: mesaId,
        motivo: 'pagada',
      }),
    });
    assert.strictEqual(resLib.status, 200);

    const eventoLiberada = await liberadaPromesa;
    assert.strictEqual(eventoLiberada.id_mesa, mesaId);
    assert.strictEqual(eventoLiberada.motivo, 'pagada');

    const disconnectReason = await disconnectPromesa;
    assert.strictEqual(disconnectReason, 'io server disconnect', 'El servidor debe cortar la conexión del comensal');

    socketM5.disconnect();
  });

  it('3.6 Rotación de QR: qr:actualizado llega a la sala de la mesa', async () => {
    const mesaId = 2;
    const { jwtComensal: jwtM2 } = await abrirMesaYObtenerSesion(mesaId, 'Comensal_Rot_' + Date.now());

    const socketM2 = io(SOCKET_URL, { auth: { token: jwtM2 }, transports: ['websocket'] });
    await new Promise((resolve) => socketM2.on('connect', resolve));
    await new Promise((resolve) => socketM2.emit('join:table', {}, resolve));

    const qrPromesa = esperarEvento(socketM2, 'qr:actualizado', 2000);

    const nuevoToken = 'qr-token-rotado-' + Date.now();
    const resRot = await fetch(`${SOCKET_URL}/internal/qr-rotado`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        id_mesa: mesaId,
        token_qr: nuevoToken,
      }),
    });
    assert.strictEqual(resRot.status, 200);

    const eventoQr = await qrPromesa;
    assert.strictEqual(eventoQr.id_mesa, mesaId);
    assert.strictEqual(eventoQr.token_qr, nuevoToken);

    socketM2.disconnect();
  });

  it('3.7 Hallazgo de persistencia: comprobación de estado en memoria del carrito', async () => {
    const mesaId = 3;
    const { jwtComensal: jwtM3 } = await abrirMesaYObtenerSesion(mesaId, 'Comensal_Cart_' + Date.now());

    const socketM3 = io(SOCKET_URL, { auth: { token: jwtM3 }, transports: ['websocket'] });
    await new Promise((resolve) => socketM3.on('connect', resolve));
    await new Promise((resolve) => socketM3.emit('join:table', {}, resolve));

    // Agregar ítem al carrito
    const ackUpdate = await new Promise((resolve) => {
      socketM3.emit(
        'cart:update',
        {
          eventId: crypto.randomUUID(),
          accion: 'set',
          id_linea: crypto.randomUUID(),
          id_plato: 1001,
          cantidad: 2,
          notas: 'Para probar persistencia',
        },
        resolve
      );
    });

    assert.ok(ackUpdate.ok, 'cart:update debe ser exitoso');
    assert.strictEqual(ackUpdate.carrito.items.length, 1);
    assert.strictEqual(ackUpdate.carrito.items[0].id_plato, 1001);

    // Documentación del comportamiento:
    // Al operar sin REDIS_URL, el estado del carrito reside en memoria del proceso Node.
    // Una caída o reinicio del socket-server vacía el carrito no confirmado en pedido.
    // En producción se requiere REDIS_URL para mantener carritos y deduplicación.
    socketM3.disconnect();
  });
});
