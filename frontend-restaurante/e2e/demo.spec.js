// ==============================================================================
// Guion E2E de la demo (preparación de G-08)
// ==============================================================================
// Recorre la demo de punta a punta, en navegadores reales, contra el backend,
// el socket-server, PostgreSQL y Redis de verdad:
//
//    1. El admin inicia sesión en el panel.
//    2. En Mesas abre la mesa de la demo y toma la URL del QR del modal.
//    3. Un "celular" entra con esa URL y se registra como «Ana».
//    4. El KDS se abre con la sesión de cocina.
//    5. Pedidos 1.º a 3.º de la Hamburguesa Smart Angus, por la API con la sesión de Ana.
//    6. El 4.º, desde la interfaz del cliente; el panel (Pedidos) y el KDS lo ven sin recargar.
//    7. Agotado sin recargar: panel (Menú), KDS (agotados) y cliente.
//    8. Un 2.º celular («Beto») no puede pedirla.
//    9. En Inventario el admin ve la Carne Angus en 0 y registra una entrada de 10.
//   10. Sin recargar, la Hamburguesa vuelve en el panel, el KDS y el cliente, y Ana la pide (201).
//  10a. Panel: se inicia sesión SIN recargar y un pedido nuevo llega en vivo a Pedidos (el
//       socket conecta con el token tras el login).
//  10b. Caja: en otra mesa (MESA_COBRO), dos pedidos entregados se cobran con «Toda
//       la mesa»; «Recaudado hoy» sube exactamente lo cobrado sin recargar y coincide
//       con la suma del Historial y con GET /transacciones?desde=hoy.
//   11. Limpieza: se cancelan los pedidos de la prueba, la mesa queda libre y TODOS los
//       insumos vuelven al stock que tenían antes de empezar (la Carne Angus y también lo
//       que gastó el cobro del 10b, que no se puede cancelar). Se comprueba que todo
//       quedó como estaba, así la prueba se puede correr muchas veces seguidas.
//       Queda el historial, que no se borra: pedidos cancelados y pagados, el cobro
//       del 10b y los movimientos del libro (la entrada del paso 9 y los ajustes).
//
// "Sin recargar" se comprueba con una marca en `window` que tiene que seguir ahí al final.
// La carta pública (GET /menu) se comprueba al empezar, al agotarse y al reponer, con
// 5 s de margen: si vuelve #135 (cache:menu sin invalidar), la prueba falla.
//
// Necesita los datos de la demo: seed.sql + seed_inventario_demo.sql (G-07), con la
// Carne Angus en 4 porciones (si no está en 4, la prueba la deja en 4 con un ajuste
// por la API). Cómo levantar todo: database/tests/README.md, §4.
//
// Variables: API_URL (http://localhost:4000/api), CLIENTE_URL (http://localhost:5174),
// KDS_URL (http://localhost:5175), DEMO_PASSWORD (la de fijar-password-demo.sql),
// MESA_DEMO (1). El panel es el baseURL de playwright.config.js (5173).
//
//   npx playwright test e2e/demo.spec.js
// ==============================================================================
import { test, expect, devices } from '@playwright/test'

const API = (process.env.API_URL || 'http://localhost:4000/api').replace(/\/+$/, '')
const CLIENTE = (process.env.CLIENTE_URL || 'http://localhost:5174').replace(/\/+$/, '')
const KDS = (process.env.KDS_URL || 'http://localhost:5175').replace(/\/+$/, '')
const CLAVE = process.env.DEMO_PASSWORD || 'Admin123!'
const MESA = Number(process.env.MESA_DEMO || 1)
// Mesa del paso 10b (cobro en Caja). Distinta de la de la demo.
const MESA_COBRO = Number(process.env.MESA_COBRO || 2)
/** 12000 → "12\\.000": como lo pinta formatCOP (es-CO), escapado para un RegExp. */
const pesos = (n) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n).replace(/\./g, '\\.')
const PLATO = 'Hamburguesa Smart Angus'
const INSUMO = 'Carne Angus 200 g'
const STOCK_DEMO = 4
const { defaultBrowserType: _ignorado, ...CELULAR } = devices['iPhone 13']

// ---------------------------------------------------------------------- API --
async function api(token, ruta, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${ruta}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Una petición colgada tiene que fallar con su nombre, no comerse el
    // tiempo de toda la prueba.
    signal: AbortSignal.timeout(15_000),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

/**
 * Margen para que GET /menu refleje un cambio de stock. Desde #138 (issue #135)
 * el backend invalida cache:menu con cada aviso de disponibilidad del canal
 * `inventario`, así que llega en milisegundos; el margen solo cubre el viaje del
 * NOTIFY. Si vuelve #135, la carta tarda hasta 60 s (el TTL) y la prueba FALLA:
 * ya no se espera a que caduque la caché.
 */
const MARGEN_MENU_MS = 5_000

/** ¿La carta pública (GET /menu) ofrece la Hamburguesa ahora mismo? */
async function menuOfrecePlato() {
  const r = await api(null, '/menu')
  if (r.status !== 200) throw new Error(`GET /menu: ${r.status}`)
  return JSON.stringify(r.data || {}).includes(PLATO)
}

/** Falla si GET /menu no dice `ofrece` dentro del margen: sería #135 otra vez. */
async function esperarMenu(ofrece, cuando) {
  await expect
    .poll(menuOfrecePlato, {
      message: `GET /menu ${ofrece ? 'no ofrece' : 'sigue ofreciendo'} "${PLATO}" ${cuando} tras ${MARGEN_MENU_MS / 1000} s: ¿cache:menu sin invalidar otra vez (#135)?`,
      timeout: MARGEN_MENU_MS,
    })
    .toBe(ofrece)
}

async function login(email) {
  const r = await api(null, '/auth/login', { method: 'POST', body: { email, password: CLAVE } })
  if (r.status !== 200) throw new Error(`login de ${email}: ${r.status} ${r.data?.error || ''}`)
  return r.data.token
}

async function leerInsumo(token, id) {
  const r = await api(token, `/inventario/insumos/${id}`)
  return r.data?.insumo ?? r.data
}

async function platoEnCarta(token, idPlato) {
  const r = await api(token, '/inventario/carta')
  return (r.data?.platos || []).find((p) => Number(p.id) === idPlato)
}

async function libroCuadra(token, insumo) {
  const r = await api(token, `/inventario/insumos/${insumo.id_insumo}/movimientos?limite=500`)
  const suma = (r.data?.movimientos || []).reduce((acc, m) => acc + Number(m.cantidad), 0)
  return Math.abs(suma - Number(insumo.stock_actual)) < 0.001
}

async function pedidosAbiertosDeMesa(token, idMesa) {
  const r = await api(token, '/pedidos/activos')
  return (r.data?.pedidos || []).filter((p) => Number(p.id_mesa) === idMesa)
}

/** { id_insumo: stock_actual } de todos los insumos. */
async function stockDeInsumos(token) {
  const insumos = (await api(token, '/inventario/insumos?limite=500')).data?.insumos || []
  return Object.fromEntries(insumos.map((i) => [i.id_insumo, Number(i.stock_actual)]))
}

/** Lo que la demo enseña. Se toma antes y se compara al final. */
async function fotografiar(token, ids) {
  const insumo = await leerInsumo(token, ids.insumo)
  const plato = await platoEnCarta(token, ids.plato)
  const mesas = (await api(token, '/mesas')).data
  const mesa = (Array.isArray(mesas) ? mesas : mesas?.mesas || []).find((m) => Number(m.id_mesa) === MESA)
  return {
    stock: Number(insumo.stock_actual),
    platoDisponible: plato?.disponible_efectivo,
    mesa: mesa?.estado,
    pedidosAbiertos: (await pedidosAbiertosDeMesa(token, MESA)).length,
    libroCuadra: await libroCuadra(token, insumo),
    mesaCobro: (Array.isArray(mesas) ? mesas : mesas?.mesas || []).find((m) => Number(m.id_mesa) === MESA_COBRO)?.estado,
    stockInsumos: await stockDeInsumos(token),
  }
}

// ---------------------------------------------------------- navegadores --
const marcar = (page) => page.evaluate(() => { window.__sinRecargar = true })
const sinRecargar = (page) => page.evaluate(() => window.__sinRecargar === true)

async function entrarPanel(page, email) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', CLAVE)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

/** El botón de disponibilidad de la tarjeta del plato en Menú del panel. */
const interruptorMenu = (page) =>
  page.locator('.sd-card', { has: page.getByText(PLATO, { exact: true }) }).getByTitle('Alternar disponibilidad para comensales')

/** Sesión del comensal guardada por la PWA (el objeto con token e idMesa). */
const tokenComensal = (page) =>
  page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      try {
        const v = JSON.parse(sessionStorage.getItem(sessionStorage.key(i)))
        if (v && v.token && v.idMesa) return v.token
      } catch { /* no es JSON */ }
    }
    return null
  })

async function sentarComensal(browser, url, nombre) {
  const ctx = await browser.newContext(CELULAR)
  const page = await ctx.newPage()
  await page.goto(url)
  await page.getByRole('textbox', { name: '¿Cómo te llamas?' }).fill(nombre)
  await page.getByRole('button', { name: 'ENTRAR A LA MESA' }).click()
  await page.getByRole('button', { name: 'VER EL MENÚ' }).click()
  await expect(page.getByRole('heading', { name: 'NUESTRO MENÚ' })).toBeVisible()
  return { ctx, page, token: await tokenComensal(page) }
}

/** La tarjeta del plato en el menú del cliente (botón con el nombre del plato). */
const tarjetaCliente = (page) => page.getByRole('button', { name: new RegExp(`^${PLATO}`) }).first()

// ================================================================== guion ==
test.describe.configure({ mode: 'serial' })

test.describe('Guion de la demo (G-08): agotar la Hamburguesa y reponerla', () => {
  test.setTimeout(180_000)

  let admin
  let ids
  let antes
  const creados = [] // id_pedido de todo lo que crea la prueba

  test.beforeAll(async () => {
    admin = await login('admin@smartdining.com')
    const insumos = (await api(admin, '/inventario/insumos?limite=500')).data?.insumos || []
    const carne = insumos.find((i) => i.nombre === INSUMO)
    const plato = ((await api(null, '/platos')).data?.platos || []).find((p) => p.nombre === PLATO)
    if (!carne || !plato) throw new Error(`faltan los datos de la demo (${INSUMO} / ${PLATO}): carga seed_inventario_demo.sql`)
    ids = { insumo: carne.id_insumo, plato: plato.id_plato }

    if ((await pedidosAbiertosDeMesa(admin, MESA)).length > 0) {
      throw new Error(`la mesa ${MESA} tiene pedidos abiertos: ciérralos o usa otra MESA_DEMO`)
    }
    // Mesa abierta sin pedidos (una corrida cortada): se libera.
    await api(admin, `/mesas/${MESA}/liberar`, { method: 'POST' })
    if (Number(carne.stock_actual) !== STOCK_DEMO) {
      await api(admin, `/inventario/insumos/${ids.insumo}/movimientos`, {
        method: 'POST',
        body: { tipo: 'ajuste', cantidad: STOCK_DEMO - Number(carne.stock_actual), motivo: 'E2E demo: dejar la carne en 4' },
      })
    }
    // Aunque la corrida anterior terminara hace un segundo con la Hamburguesa
    // agotada, la carta ya tiene que ofrecerla (antes de #138 había que esperar
    // hasta 60 s a que caducara la caché).
    await esperarMenu(true, 'al empezar, con la carne en 4,')
    antes = await fotografiar(admin, ids)
    const { stockInsumos, ...resumen } = antes
    expect(resumen).toEqual({ stock: STOCK_DEMO, platoDisponible: true, mesa: 'disponible', pedidosAbiertos: 0, libroCuadra: true, mesaCobro: 'disponible' })
    expect(Object.keys(stockInsumos).length).toBeGreaterThan(0)
  })

  /**
   * Cancela lo que creó la prueba (la base devuelve las porciones), libera la
   * mesa y deja CADA insumo en el stock que tenía al empezar, con un ajuste.
   * Hace falta para todos y no solo para la carne: el cobro del 10b gasta
   * insumos de otro plato y un pedido pagado no se cancela, así que sin esto
   * cada corrida dejaba menos stock hasta agotar ese plato. Idempotente: el
   * test 11 la llama y comprueba; afterAll la repite por si la prueba se cortó.
   */
  async function limpiar() {
    if (!admin) return
    while (creados.length) {
      const id = creados.shift()
      const r = await api(admin, `/pedidos/${id}/cancelar`, { method: 'POST', body: { motivo: 'E2E demo' } })
      if (r.status !== 200) console.warn(`AVISO cancelar pedido ${id}: ${r.status} ${r.data?.error || ''}`)
    }
    await api(admin, `/mesas/${MESA}/liberar`, { method: 'POST' })
    if (!antes?.stockInsumos) return
    const ahora = await stockDeInsumos(admin)
    for (const [id, stock] of Object.entries(antes.stockInsumos)) {
      const diferencia = Math.round((stock - (ahora[id] ?? stock)) * 1000) / 1000
      if (diferencia === 0) continue
      const r = await api(admin, `/inventario/insumos/${id}/movimientos`, {
        method: 'POST',
        body: { tipo: 'ajuste', cantidad: diferencia, motivo: 'E2E demo: volver al stock de antes' },
      })
      if (r.status !== 201) console.warn(`AVISO ajuste insumo ${id}: ${r.status} ${r.data?.error || ''}`)
    }
  }

  test.afterAll(limpiar)

  test('de punta a punta, sin recargar ninguna pantalla', async ({ browser }) => {
    const ctxAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const panel = await ctxAdmin.newPage()
    let ana, beto, kds, pedidosPanel, menuPanel, url

    await test.step('1. El admin inicia sesión en el panel', async () => {
      await entrarPanel(panel, 'admin@smartdining.com')
      await expect(panel.getByText('Administrador')).toBeVisible()
    })

    await test.step('2. Abre la mesa desde Mesas y toma la URL del QR', async () => {
      await panel.goto('/mesas')
      const tarjeta = panel.getByRole('button', { name: new RegExp(`^Mesa ${MESA}, estado`) })
      await tarjeta.getByRole('button', { name: 'Abrir / QR' }).click()
      await panel.getByRole('button', { name: 'Abrir Mesa y Generar QR' }).click()
      const enlace = panel.locator('.qr-url-box input')
      await expect(enlace).toHaveValue(/token=/)
      const token = new URL(await enlace.inputValue()).searchParams.get('token')
      url = `${CLIENTE}/?token=${encodeURIComponent(token)}`
    })

    await test.step('3. Ana entra con el QR desde su celular', async () => {
      ana = await sentarComensal(browser, url, 'Ana')
      expect(ana.token).toBeTruthy()
      await expect(tarjetaCliente(ana.page)).toBeVisible()
      await marcar(ana.page)
    })

    await test.step('4. El KDS abre con la sesión de cocina; el panel queda en Pedidos y en Menú', async () => {
      const ctxKds = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      kds = await ctxKds.newPage()
      await kds.goto(KDS)
      await kds.getByRole('textbox', { name: 'Correo de cocina' }).fill('cocina@smartdining.com')
      await kds.getByRole('textbox', { name: 'Contraseña' }).fill(CLAVE)
      await kds.getByRole('button', { name: 'Entrar' }).click()
      await expect(kds.getByRole('button', { name: /agotad/i }).first()).toBeVisible()
      await marcar(kds)

      pedidosPanel = panel
      await pedidosPanel.goto('/pedidos')
      await marcar(pedidosPanel)
      // Segunda pestaña del panel con la MISMA sesión: el token vive en
      // sessionStorage, que es por pestaña. Se copia en vez de volver a iniciar
      // sesión (el login tiene un límite de 5 por minuto).
      const sesion = await panel.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)))
      menuPanel = await ctxAdmin.newPage()
      await menuPanel.addInitScript((datos) => {
        for (const [k, v] of Object.entries(datos)) sessionStorage.setItem(k, v)
      }, sesion)
      await menuPanel.goto('/menu')
      await expect(interruptorMenu(menuPanel)).toHaveText(/DISPONIBLE/)
      await marcar(menuPanel)
    })

    await test.step('5. Pedidos 1.º a 3.º de la Hamburguesa, por la API con la sesión de Ana', async () => {
      for (let n = 1; n <= 3; n++) {
        const r = await api(ana.token, '/pedidos', {
          method: 'POST',
          body: { items: [{ id_plato: ids.plato, cantidad: 1 }], notas_generales: `E2E demo, pedido ${n}` },
        })
        expect(r.status, `pedido ${n}: ${r.data?.error || ''}`).toBe(201)
        creados.push(r.data.id_pedido)
      }
      expect(Number((await leerInsumo(admin, ids.insumo)).stock_actual)).toBe(1)
    })

    let cuarto
    await test.step('6. El 4.º pedido, desde la interfaz del cliente; panel y KDS lo ven sin recargar', async () => {
      await tarjetaCliente(ana.page).click()
      await ana.page.getByRole('button', { name: /^AÑADIR 1/ }).click()
      await ana.page.getByRole('link', { name: /^Carrito, 1 producto/ }).click()
      await ana.page.getByRole('button', { name: /Enviar mi pedido a cocina/ }).click()
      const respuesta = ana.page.waitForResponse((r) => r.url().endsWith('/pedidos') && r.request().method() === 'POST')
      await ana.page.getByRole('button', { name: /Confirmar y enviar/ }).click()
      const res = await respuesta
      expect(res.status()).toBe(201)
      cuarto = await res.json()
      creados.push(cuarto.id_pedido)
      await ana.page.waitForURL(/\/seguimiento/)

      await expect(pedidosPanel.getByText(cuarto.codigo_pedido).first()).toBeVisible({ timeout: 10_000 })
      await expect(kds.getByText(new RegExp(`${cuarto.codigo_pedido}|#${cuarto.id_pedido}\\b`)).first()).toBeVisible({ timeout: 10_000 })
    })

    await test.step('7. Agotado sin recargar: panel (Menú), KDS y cliente', async () => {
      expect(Number((await leerInsumo(admin, ids.insumo)).stock_actual)).toBe(0)
      // Con #133 dice "AGOTADO · SIN STOCK"; sin él, "AGOTADO". Los dos son agotado.
      await expect(interruptorMenu(menuPanel)).toHaveText(/^\s*AGOTADO/, { timeout: 10_000 })

      await kds.getByRole('button', { name: /agotad/i }).first().click()
      const cajon = kds.getByRole('dialog', { name: 'Ingredientes y platos agotados' })
      await cajon.getByRole('tab', { name: /platos/i }).click()
      await expect(cajon.getByText(PLATO).first()).toBeVisible()
      await expect(cajon.locator('li, tr, [role="listitem"]', { hasText: PLATO }).first()).toContainText(/agotad/i)

      // Ana vuelve al menú por el enlace de la app (navegación interna, sin recargar).
      await ana.page.getByRole('link', { name: 'PEDIR MÁS PLATOS' }).click()
      await expect(ana.page.getByRole('heading', { name: 'NUESTRO MENÚ' })).toBeVisible()
      await expect(tarjetaCliente(ana.page)).toContainText('AGOTADO')
      await tarjetaCliente(ana.page).click()
      await expect(ana.page.getByRole('button', { name: 'NO DISPONIBLE' })).toBeDisabled()
      await ana.page.keyboard.press('Escape')
    })

    await test.step('8. Beto entra después y no puede pedirla', async () => {
      // La carta ya no la ofrece: agotarla por inventario invalida cache:menu (#135).
      await esperarMenu(false, 'agotada')
      beto = await sentarComensal(browser, url, 'Beto')
      // En la PWA de Beto no sale, o sale marcada AGOTADO; nunca como disponible.
      const tarjeta = tarjetaCliente(beto.page)
      if ((await tarjeta.count()) > 0) await expect(tarjeta).toContainText('AGOTADO')
      // Y aunque alguien la pida a mano, la base la rechaza.
      const r = await api(beto.token, '/pedidos', { method: 'POST', body: { items: [{ id_plato: ids.plato, cantidad: 1 }] } })
      expect(r.status).toBe(409)
      expect(r.data?.motivo).toBe('sin_stock')
      expect(r.data?.faltantes).toEqual([{ tipo: 'plato', id: ids.plato, nombre: PLATO }])
    })

    await test.step('9. En Inventario el admin ve la carne en 0 y registra una entrada de 10', async () => {      // Por el menú del panel, como en la demo (Menú sigue abierto en su pestaña).
      await panel.getByRole('navigation', { name: 'Navegación principal del restaurante' }).getByRole('link', { name: 'INVENTARIO' }).click()
      const fila = panel.getByTestId(`insumo-${ids.insumo}`)
      await expect(fila).toContainText(INSUMO)
      // La fila se lee "Carne Angus 200 g · Porción · 0 porc. · 2 porc. · AGOTADO".
      await expect(fila).toContainText(/(^|\D)0 porc\./)
      await expect(fila).toContainText('AGOTADO')
      await fila.getByRole('button', { name: `Movimiento de ${INSUMO}` }).click()
      const form = panel.getByRole('form', { name: 'Registrar movimiento' })
      await form.getByLabel('Entrada').check()
      await form.getByLabel(/CANTIDAD/).fill('10')
      await form.getByLabel(/MOTIVO/).fill('E2E demo: llegó la carne')
      const guardado = panel.waitForResponse((r) => r.url().includes(`/insumos/${ids.insumo}/movimientos`) && r.request().method() === 'POST')
      await form.getByRole('button', { name: 'REGISTRAR' }).click()
      expect((await guardado).status()).toBe(201)
      await expect(fila).toContainText(/(^|\D)10 porc\./)
      await expect(fila).not.toContainText('AGOTADO')
    })

    await test.step('10. Sin recargar, la Hamburguesa vuelve en el panel, el KDS y el cliente; Ana la pide', async () => {
      await esperarMenu(true, 'repuesta')
      await expect(interruptorMenu(menuPanel)).toHaveText(/DISPONIBLE/, { timeout: 10_000 })
      const cajon = kds.getByRole('dialog', { name: 'Ingredientes y platos agotados' })
      await expect(cajon.locator('li, tr, [role="listitem"]', { hasText: PLATO }).first()).not.toContainText(/agotad/i, { timeout: 10_000 })
      await expect(tarjetaCliente(ana.page)).not.toContainText('AGOTADO', { timeout: 10_000 })

      await tarjetaCliente(ana.page).click()
      await ana.page.getByRole('button', { name: /^AÑADIR 1/ }).click()
      await ana.page.getByRole('link', { name: /^Carrito, 1 producto/ }).click()
      await ana.page.getByRole('button', { name: /Enviar mi pedido a cocina/ }).click()
      const respuesta = ana.page.waitForResponse((r) => r.url().endsWith('/pedidos') && r.request().method() === 'POST')
      await ana.page.getByRole('button', { name: /Confirmar y enviar/ }).click()
      const res = await respuesta
      expect(res.status()).toBe(201)
      creados.push((await res.json()).id_pedido)
      expect(Number((await leerInsumo(admin, ids.insumo)).stock_actual)).toBe(9)
    })

    await test.step('Ninguna pantalla se recargó', async () => {
      for (const [nombre, page] of [['cliente de Ana', ana.page], ['KDS', kds], ['panel en Menú', menuPanel]]) {
        expect(await sinRecargar(page), nombre).toBe(true)
      }
    })

    for (const c of [ana?.ctx, beto?.ctx, kds?.context(), ctxAdmin]) await c?.close()
  })

  test('10a. Tras iniciar sesión SIN recargar, el panel recibe en vivo un pedido nuevo', async ({ browser }) => {
    // El resto del guion recarga después del login (page.goto), y así no se
    // veía el fallo: el socket se creaba en /login sin token y nadie lo volvía
    // a conectar al entrar. Aquí se entra y se navega SOLO por la interfaz.
    if ((await pedidosAbiertosDeMesa(admin, MESA_COBRO)).length > 0) {
      throw new Error(`la mesa ${MESA_COBRO} tiene pedidos abiertos: ciérralos o usa otra MESA_COBRO`)
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await entrarPanel(page, 'mesero@smartdining.com')
    await marcar(page)
    await page.getByRole('navigation', { name: /Navegación principal/ }).getByRole('link', { name: 'PEDIDOS' }).click()
    await expect(page).toHaveURL(/\/pedidos$/)

    expect([200, 201]).toContain((await api(admin, `/mesas/${MESA_COBRO}/abrir`, { method: 'POST' })).status)
    const platos = (await api(null, '/platos')).data?.platos || []
    const otro = platos.find((p) => !/Angus/i.test(p.nombre) && !p.personalizable
      && p.disponible !== false && p.stock_suficiente !== false && Number(p.precio) > 0)
    const r = await api(admin, '/pedidos', { method: 'POST', body: { id_mesa: MESA_COBRO, items: [{ id_plato: otro.id_plato, cantidad: 1 }] } })
    expect(r.status).toBe(201)
    await expect(page.getByText(r.data.codigo_pedido).first()).toBeVisible({ timeout: 10_000 })
    expect(await sinRecargar(page), 'el panel no se recargó').toBe(true)

    expect((await api(admin, `/pedidos/${r.data.id_pedido}/cancelar`, { method: 'POST', body: { motivo: 'E2E demo 10a' } })).status).toBe(200)
    await api(admin, `/mesas/${MESA_COBRO}/liberar`, { method: 'POST' })
    await ctx.close()
  })

  test('10b. Caja: después de un cobro, «Recaudado hoy» sube exactamente lo cobrado y cuadra con el Historial', async ({ browser }) => {
    // Mesa propia (MESA_COBRO, 2 por omisión) y un plato que no use la Carne
    // Angus: así no toca la mesa ni la carne de la demo. El cobro libera la mesa
    // solo; las transacciones quedan (son dinero cobrado de verdad, no hay ruta
    // para borrarlas). Lo que gasta de insumos lo devuelve limpiar() con un
    // ajuste, porque un pedido pagado ya no se cancela.
    const caja = await login('caja@smartdining.com')
    if ((await pedidosAbiertosDeMesa(admin, MESA_COBRO)).length > 0) {
      throw new Error(`la mesa ${MESA_COBRO} tiene pedidos abiertos: ciérralos o usa otra MESA_COBRO`)
    }
    const platos = (await api(null, '/platos')).data?.platos || []
    // Ni personalizable (pide opciones del constructor) ni sin stock.
    const otro = platos.find((p) => !/Angus/i.test(p.nombre) && !p.personalizable
      && p.disponible !== false && p.stock_suficiente !== false && Number(p.precio) > 0)
    expect(otro, 'un plato sin Carne Angus para cobrar').toBeTruthy()
    expect([200, 201]).toContain((await api(admin, `/mesas/${MESA_COBRO}/abrir`, { method: 'POST' })).status)
    for (const cantidad of [1, 2]) {
      const r = await api(admin, '/pedidos', { method: 'POST', body: { id_mesa: MESA_COBRO, items: [{ id_plato: otro.id_plato, cantidad }] } })
      expect(r.status).toBe(201)
      for (const estado of ['en_preparacion', 'listo', 'entregado']) {
        expect((await api(admin, `/pedidos/${r.data.id_pedido}/estado`, { method: 'PATCH', body: { estado } })).status).toBe(200)
      }
    }
    const saldo = Number((await api(caja, `/mesas/${MESA_COBRO}/cuenta`)).data.saldo_mesa)
    const totalAntes = (await api(caja, '/transacciones?desde=hoy')).data.total

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await ctx.newPage()
    await entrarPanel(page, 'caja@smartdining.com')
    await page.goto(`/caja?mesa=${MESA_COBRO}`)
    const recaudado = page.getByTestId('recaudado-hoy')
    await expect(recaudado).toHaveText(new RegExp(`^\\$\\s?${pesos(totalAntes)} RECAUDADO HOY$`))

    // "Toda la mesa": un solo cobro repartido entre los dos pedidos.
    await page.getByRole('button', { name: /TODA LA MESA/ }).click()
    await page.getByLabel(/EFECTIVO RECIBIDO/).fill(String(Math.ceil(saldo / 1000) * 1000))
    await page.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByText('Pago Procesado con Éxito')).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar recibo' }).click()

    // Sube EXACTAMENTE lo cobrado, sin recargar la página.
    await expect(recaudado).toHaveText(new RegExp(`^\\$\\s?${pesos(totalAntes + saldo)} RECAUDADO HOY$`))
    expect((await api(caja, '/transacciones?desde=hoy')).data.total).toBe(totalAntes + saldo)

    // Y cuadra con la suma del Historial de hoy (una fila por cobro).
    await page.getByRole('button', { name: /HISTORIAL DE PAGOS/ }).click()
    const montos = await page.locator('.history-panel tbody tr td:nth-child(6)').allInnerTexts()
    const sumaHistorial = montos.reduce((acc, t) => acc + Number(t.replace(/[^\d]/g, '')), 0)
    expect(sumaHistorial).toBe(totalAntes + saldo)
    await expect(page.getByTestId('total-historial')).toHaveText(new RegExp(pesos(totalAntes + saldo)))
    await expect(page.locator('.history-panel tbody tr').first()).toContainText(`Mesa ${MESA_COBRO}`)
    await ctx.close()
  })

  test('11. Limpieza: todo queda como estaba', async () => {
    await limpiar()
    expect(await fotografiar(admin, ids)).toEqual(antes)
  })
})
