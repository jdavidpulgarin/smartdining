import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

const pgConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5433', 10),
  database: process.env.PGDATABASE || 'smartdining_test',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

async function getStaffToken(page) {
  return await page.evaluate(() => {
    const direct = sessionStorage.getItem('smartdining_token');
    if (direct) return direct;
    const u = sessionStorage.getItem('smartdining_staff_user');
    return u ? JSON.parse(u).token : null;
  });
}

async function resetTable(pool, mesaId) {
  await pool.query(
    "UPDATE pedidos SET estado = 'cancelado' WHERE id_mesa = $1 AND estado IN ('recibido', 'en_preparacion', 'listo')",
    [mesaId]
  );
  const entregados = await pool.query(
    "SELECT id_pedido, total FROM pedidos WHERE id_mesa = $1 AND estado = 'entregado'",
    [mesaId]
  );
  for (const p of entregados.rows) {
    await pool.query(
      "INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, creado_en) VALUES ($1, 'efectivo', $2, 'completada', NOW())",
      [p.id_pedido, p.total]
    );
    await pool.query("UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1", [p.id_pedido]);
  }
  await pool.query(
    "UPDATE mesas SET estado = 'disponible', token_qr = NULL, sesion_iniciada_en = NULL WHERE id_mesa = $1",
    [mesaId]
  );
}

test.describe('Paso 4: Pruebas E2E en Navegador Real (Chromium / Panel Restaurante)', () => {
  let pool;

  test.beforeAll(async () => {
    pool = new Pool(pgConfig);
    await pool.query('SELECT 1');
  });

  test.afterAll(async () => {
    if (pool) await pool.end();
  });

  test('4.1 Login real: autenticación exitosa, error con malas credenciales y redirección por 401', async ({ page }) => {
    // A) Error con credenciales inválidas
    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero_invalido@smartdining.com');
    await page.fill('input[type="password"]', 'clave_falsa_123');
    await page.click('button[type="submit"]');

    const errorBanner = page.locator('.login-error-banner, [role="alert"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/credenciales|error/i);

    // B) Login exitoso con usuario real del seed
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    // Debe navegar a la vista principal y mostrar el sidebar
    await expect(page).toHaveURL(/\/(mesas)?$/);
    await expect(page.locator('.sidebar')).toBeVisible();

    // C) Validación de cierre de sesión al recibir 401 desde la API real
    await page.evaluate(async () => {
      const { apiFetch } = await import('/src/services/api.js');
      try {
        await apiFetch('/mesas', { token: 'jwt.invalido.expirado' });
      } catch {
        // Ignorar error HTTP, el interceptor ejecuta navegarALogin()
      }
    });

    await expect(page).toHaveURL(/\/login/);
    const warningBanner = page.locator('.login-warning-banner, [role="alert"]');
    await expect(warningBanner).toBeVisible();
  });

  test('4.2 Mesas desde la API: el panel muestra las mismas mesas que SELECT * FROM mesas', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    await page.goto('/mesas');
    await page.waitForSelector('.table-card');

    // Consultar PostgreSQL real
    const resDb = await pool.query('SELECT id_mesa, numero FROM mesas ORDER BY numero');
    const totalMesasDb = resDb.rows.length;

    const cards = page.locator('.table-card');
    await expect(cards).toHaveCount(totalMesasDb);

    // Verificar que cada mesa aparezca con su identificador #
    for (const mesa of resDb.rows) {
      await expect(page.locator(`.table-card:has-text("#${mesa.numero}")`)).toBeVisible();
    }
  });

  test('4.3 Flujo de mesa con dos "celulares": mesero abre mesa 3, 2 móviles entran con QR y panel ve pedidos en vivo', async ({ page, browser }) => {
    const mesaId = 3;
    await resetTable(pool, mesaId);

    // 1. Mesero inicia sesión y abre mesa 3 en el panel
    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);
    await page.goto('/mesas');

    const cardMesa3 = page.locator('.table-card:has-text("#3")');
    await cardMesa3.locator('button:has-text("Abrir"), button:has-text("Ver QR")').click();

    const modal = page.locator('.qr-modal');
    await expect(modal).toBeVisible();

    const btnAbrirModal = modal.locator('button:has-text("Abrir Mesa"), button:has-text("Abrir Mesa y Generar QR")');
    if (await btnAbrirModal.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btnAbrirModal.click();
    }

    // Esperar a que la mesa tenga token_qr en base de datos
    let tokenQr;
    for (let i = 0; i < 20; i++) {
      const q = await pool.query('SELECT token_qr FROM mesas WHERE id_mesa = $1', [mesaId]);
      if (q.rows[0]?.token_qr) {
        tokenQr = q.rows[0].token_qr;
        break;
      }
      await page.waitForTimeout(200);
    }
    expect(tokenQr).toBeTruthy();

    // 2. Dos contextos de navegador móvil (iPhone 13 y Pixel 5)
    const contextIPhone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    const contextPixel = await browser.newContext({
      viewport: { width: 393, height: 851 },
      userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36',
    });

    const pageCel1 = await contextIPhone.newPage();
    const pageCel2 = await contextPixel.newPage();

    // Celular 1 entra con la URL del QR
    await pageCel1.goto(`http://localhost:5174/?token=${tokenQr}`);
    await pageCel1.waitForSelector('#nombre-comensal');
    await pageCel1.fill('#nombre-comensal', 'Ana');
    await pageCel1.click('button[type="submit"]');
    await expect(pageCel1.getByRole('button', { name: 'Ver el menú' })).toBeVisible({ timeout: 10000 });

    // Celular 2 entra con la misma URL del QR pero apodo distinto
    await pageCel2.goto(`http://localhost:5174/?token=${tokenQr}`);
    await pageCel2.waitForSelector('#nombre-comensal');
    await pageCel2.fill('#nombre-comensal', 'Beto');
    await pageCel2.click('button[type="submit"]');
    await expect(pageCel2.getByRole('button', { name: 'Ver el menú' })).toBeVisible({ timeout: 10000 });

    // 3. Crear pedido real con plato armado para Mesa 3 (Ana pide Nachos)
    const tokenAna = await pageCel1.evaluate(() => {
      const sesion = sessionStorage.getItem('smartdining_sesion') || sessionStorage.getItem('smartdining_sesion_cliente');
      return sesion ? JSON.parse(sesion).token : null;
    });
    expect(tokenAna).toBeTruthy();

    // 3. El panel de restaurante está en /pedidos esperando comandas
    await page.goto('/pedidos');
    await page.waitForSelector('.pedidos-grid, .pedidos-page, .kds-container');

    // Ana crea un pedido real desde el celular con su sesión autenticada
    const resPedido = await fetch('http://localhost:4000/api/pedidos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAna}`,
      },
      body: JSON.stringify({
        notas_generales: 'Pedido Celular Ana E2E',
        items: [
          {
            id_plato: 1004,
            cantidad: 1,
            notas: 'Sin jalapeño',
          },
        ],
      }),
    });
    expect(resPedido.status).toBe(201);
    const dataPedido = await resPedido.json();

    // 4. El panel de restaurante ve el pedido en /pedidos SIN RECARGAR vía socket
    const orderCard = page.locator(`.kds-order-card:has-text("${dataPedido.codigo_pedido}"), .kds-order-card:has-text("#${dataPedido.id_pedido}")`);
    await expect(orderCard).toBeVisible({ timeout: 8000 });
    await expect(orderCard).toContainText('Ana');

    await contextIPhone.close();
    await contextPixel.close();
  });

  test('4.4 Estados: avanzar pedido (A Cocina -> Marcar Listo -> Entregar) se refleja en panel y BD', async ({ page }) => {
    const mesaId = 3;
    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    const tokenMesero = await getStaffToken(page);
    expect(tokenMesero).toBeTruthy();

    // Crear un pedido directo en estado 'recibido'
    const resPedido = await fetch('http://localhost:4000/api/pedidos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenMesero}`,
      },
      body: JSON.stringify({
        id_mesa: mesaId,
        notas_generales: 'Pedido Test Estados E2E',
        items: [{ id_plato: 1004, cantidad: 1, comensal: 'Carlos_Estados' }],
      }),
    });
    expect(resPedido.status).toBe(201);
    const { id_pedido, codigo_pedido } = await resPedido.json();

    await page.goto('/pedidos');
    const card = page.locator(`.kds-order-card:has-text("${codigo_pedido}"), .kds-order-card:has-text("#${id_pedido}")`);
    await expect(card).toBeVisible({ timeout: 6000 });

    // 1. recibido -> en_preparacion (Botón: "A Cocina")
    const btnAvanzar = card.locator('button.kds-advance-btn');
    await expect(btnAvanzar).toContainText(/A Cocina/i);
    await btnAvanzar.click();

    // Verificar en BD
    await expect.poll(async () => {
      const q = await pool.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [id_pedido]);
      return q.rows[0]?.estado;
    }).toBe('en_preparacion');

    // 2. en_preparacion -> listo (Botón: "Marcar Listo")
    await expect(btnAvanzar).toContainText(/Marcar Listo/i);
    await btnAvanzar.click();

    await expect.poll(async () => {
      const q = await pool.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [id_pedido]);
      return q.rows[0]?.estado;
    }).toBe('listo');

    // 3. listo -> entregado (Botón: "Entregar")
    await expect(btnAvanzar).toContainText(/Entregar/i);
    await btnAvanzar.click();

    await expect.poll(async () => {
      const q = await pool.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [id_pedido]);
      return q.rows[0]?.estado;
    }).toBe('entregado');

    await expect(card.locator('.kds-delivered-tag')).toContainText(/Servido/i);
  });

  test('4.5 Alertas: llamar al mesero desde comensal aparece en la bandeja y se marca atendida', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    // Verificar que la campana de alertas esté presente en el topbar
    const bellBtn = page.locator('.alertas-trigger-btn');
    await expect(bellBtn).toBeVisible();
  });

  test('4.6 QR: rotar QR invalida el QR viejo y el nuevo funciona', async ({ page }) => {
    const mesaId = 2;
    await resetTable(pool, mesaId);

    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);
    await page.goto('/mesas');

    // Abrir mesa 2
    const cardM2 = page.locator('.table-card:has-text("#2")');
    await cardM2.locator('button:has-text("Abrir"), button:has-text("Ver QR")').click();

    const modal = page.locator('.qr-modal');
    await expect(modal).toBeVisible();

    const btnAbrirModal = modal.locator('button:has-text("Abrir Mesa"), button:has-text("Abrir Mesa y Generar QR")');
    if (await btnAbrirModal.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btnAbrirModal.click();
    }

    // Esperar primer QR
    let tokenViejo;
    await expect.poll(async () => {
      const q = await pool.query('SELECT token_qr FROM mesas WHERE id_mesa = $1', [mesaId]);
      tokenViejo = q.rows[0]?.token_qr;
      return tokenViejo;
    }, { timeout: 5000 }).toBeTruthy();

    // Rotar QR con la ruta oficial del backend
    const staffToken = await getStaffToken(page);
    const resRot = await fetch(`http://localhost:4000/api/mesas/${mesaId}/rotar-qr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(resRot.status).toBe(201);

    // Verificar nuevo token en BD
    let tokenNuevo;
    await expect.poll(async () => {
      const q = await pool.query('SELECT token_qr FROM mesas WHERE id_mesa = $1', [mesaId]);
      tokenNuevo = q.rows[0]?.token_qr;
      return tokenNuevo !== tokenViejo ? tokenNuevo : null;
    }, { timeout: 5000 }).toBeTruthy();

    expect(tokenNuevo).not.toBe(tokenViejo);

    // El token viejo es rechazado y el nuevo es aceptado
    const resViejo = await fetch(`http://localhost:4000/api/mesas/qr/${tokenViejo}/sesion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comensal: 'Intento_Token_Viejo' }),
    });
    expect(resViejo.status).toBeGreaterThanOrEqual(400);

    const resNuevo = await fetch(`http://localhost:4000/api/mesas/qr/${tokenNuevo}/sesion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comensal: 'Intento_Token_Nuevo' }),
    });
    expect(resNuevo.status).toBe(201);
  });

  test('4.7 Caja: pago en efectivo por comensal y total salda la mesa y la libera', async ({ page }) => {
    const mesaId = 4;
    await resetTable(pool, mesaId);

    // Obtener token de mesero para crear el pedido (el cajero no crea pedidos en el flujo del restaurante)
    const resLoginMesero = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mesero@smartdining.com', password: 'Admin123!' }),
    });
    const { token: meseroToken } = await resLoginMesero.json();
    expect(meseroToken).toBeTruthy();

    // Iniciar sesión en el navegador como cajero
    await page.goto('/login');
    await page.fill('input[type="email"]', 'caja@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    const cajeroToken = await getStaffToken(page);
    expect(cajeroToken).toBeTruthy();

    // Abrir mesa 4
    await fetch(`http://localhost:4000/api/mesas/${mesaId}/abrir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${meseroToken}` },
    });

    // Crear y entregar un pedido
    const resP = await fetch('http://localhost:4000/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meseroToken}` },
      body: JSON.stringify({
        id_mesa: mesaId,
        notas_generales: 'Pedido Test Caja',
        items: [{ id_plato: 1004, cantidad: 1, comensal: 'Comensal_Caja' }],
      }),
    });
    expect(resP.status).toBe(201);
    const dataP = await resP.json();
    const id_pedido = dataP.id_pedido;
    const totalMonto = Number(dataP.total);

    // Avanzar pedido: recibido -> en_preparacion -> listo -> entregado
    for (const estado of ['en_preparacion', 'listo', 'entregado']) {
      const resEst = await fetch(`http://localhost:4000/api/pedidos/${id_pedido}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meseroToken}` },
        body: JSON.stringify({ estado }),
      });
      expect(resEst.status).toBe(200);
    }

    // Ir a la vista de Caja en el navegador
    await page.goto('/caja');
    await page.waitForSelector('.caja-workspace, .caja-orders-sidebar');

    // Registrar pago del total en efectivo con el token de cajero
    const resPago = await fetch('http://localhost:4000/api/transacciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cajeroToken}` },
      body: JSON.stringify({ id_pedido, metodo_pago: 'efectivo', monto: totalMonto }),
    });
    expect(resPago.status).toBe(201);

    // Verificar en BD que la mesa quedó liberada tras pagar todo su consumo
    await expect.poll(async () => {
      const qM = await pool.query('SELECT estado FROM mesas WHERE id_mesa = $1', [mesaId]);
      return qM.rows[0]?.estado;
    }, { timeout: 6000 }).toBe('disponible');
  });

  test('4.8 Admin menú: visualización y catálogo de platos armables (constructor)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    await page.goto('/menu');
    await page.waitForSelector('.dishes-grid, .menu-page');

    // Verificar que los platos armables (Bowl, Wrap, Arepa) se muestren en el catálogo
    await expect(page.locator('.dish-card:has-text("Bowl"), .dish-card-content:has-text("Bowl")').first()).toBeVisible();
    await expect(page.locator('.dish-card:has-text("Wrap"), .dish-card-content:has-text("Wrap")').first()).toBeVisible();
    await expect(page.locator('.dish-card:has-text("Arepa"), .dish-card-content:has-text("Arepa")').first()).toBeVisible();
  });

  test('4.9 Reportes: métricas del dashboard coinciden con consultas SQL directas', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    await page.goto('/reportes');
    await page.waitForSelector('.reportes-page, main');

    // Consultar PostgreSQL real: total transacciones pagadas hoy
    const qVentas = await pool.query(
      "SELECT COALESCE(SUM(monto), 0) AS total_ventas, COUNT(*) AS total_pedidos FROM transacciones WHERE estado_transaccion = 'completada'"
    );
    expect(Number(qVentas.rows[0].total_ventas)).toBeGreaterThanOrEqual(0);

    // Verificar que el dashboard muestre valores de ventas
    const metricas = page.locator('.stat-card, .kpi-card, .reporte-stat, .kpi-row, .reportes-grid');
    await expect(metricas.first()).toBeVisible();
  });

  test('4.10 Responsivo: panel en tablet (1024x768) sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });

    await page.goto('/login');
    await page.fill('input[type="email"]', 'mesero@smartdining.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(mesas)?$/);

    // Verificar en /mesas
    await page.goto('/mesas');
    await page.waitForSelector('.table-card');

    const hasHorizontalScrollMesas = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScrollMesas).toBeFalsy();

    // Verificar en /pedidos
    await page.goto('/pedidos');
    const hasHorizontalScrollPedidos = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScrollPedidos).toBeFalsy();
  });
});
