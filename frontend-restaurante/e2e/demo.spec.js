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
//   11. Limpieza: se cancelan los pedidos de la prueba, la mesa queda libre y la Carne
//       Angus vuelve a su stock inicial. Se comprueba que todo quedó como estaba.
//
// "Sin recargar" se comprueba con una marca en `window` que tiene que seguir ahí al final.
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

const LIMITE_ESPERA_MENU_MS = 75_000 // TTL de cache:menu (60 s) + margen

/**
 * Espera a que la carta pública (GET /menu) muestre la Hamburguesa. Hace falta
 * por #135: cache:menu vive 60 s en Redis y el inventario no lo invalida, así
 * que si la Hamburguesa estuvo agotada hace menos de un minuto (una corrida
 * anterior, un ensayo) la carta todavía la esconde. No se esconde el bug: si
 * hubo que esperar se anota en el reporte con el tiempo, y pasado el límite la
 * prueba falla diciendo por qué.
 */
async function esperarMenuConPlato() {
  const inicio = Date.now()
  const intentos = []
  for (;;) {
    const r = await api(null, '/menu')
    const esta = JSON.stringify(r.data || {}).includes(PLATO)
    const seg = Math.round((Date.now() - inicio) / 1000)
    intentos.push(`${seg}s:${r.status}:${esta ? 'sí' : 'no'}`)
    if (process.env.E2E_TRAZA) console.warn(`[menu] ${intentos.at(-1)}`)
    if (esta) return { esperaSeg: seg, intentos }
    if (Date.now() - inicio > LIMITE_ESPERA_MENU_MS) {
      throw new Error(
        `GET /menu no mostró "${PLATO}" en ${LIMITE_ESPERA_MENU_MS / 1000} s, más que el TTL de cache:menu (60 s): ` +
          `ya no es solo #135. Intentos: ${intentos.join(' ')}`
      )
    }
    await new Promise((res) => setTimeout(res, 2_000))
  }
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
    // Los hooks NO heredan el setTimeout del describe (usan los 30 s de
    // playwright.config.js): sin esto, la espera de #135 se cortaba a los 30 s.
    test.setTimeout(LIMITE_ESPERA_MENU_MS + 60_000)
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
    const { esperaSeg, intentos } = await esperarMenuConPlato()
    if (esperaSeg > 0) {
      const aviso = `#135: GET /menu escondió la Hamburguesa ${esperaSeg} s al empezar (caché de una corrida anterior)`
      test.info().annotations.push({ type: 'problema conocido', description: `${aviso}. Intentos: ${intentos.join(' ')}` })
      console.warn(`AVISO ${aviso}`)
    }
    antes = await fotografiar(admin, ids)
    expect(antes).toEqual({ stock: STOCK_DEMO, platoDisponible: true, mesa: 'disponible', pedidosAbiertos: 0, libroCuadra: true })
  })

  /**
   * Cancela lo que creó la prueba (la base devuelve las porciones), libera la
   * mesa y deja la carne en su stock de demo con un ajuste. Idempotente: el
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
    const insumo = await leerInsumo(admin, ids.insumo)
    const diferencia = STOCK_DEMO - Number(insumo.stock_actual)
    if (diferencia !== 0) {
      await api(admin, `/inventario/insumos/${ids.insumo}/movimientos`, {
        method: 'POST',
        body: { tipo: 'ajuste', cantidad: diferencia, motivo: 'E2E demo: volver a 4' },
      })
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
      beto = await sentarComensal(browser, url, 'Beto')
      // Lo correcto: GET /menu la oculta, o la PWA la marca AGOTADO. Pero el
      // caché de /menu (60 s en Redis) no se invalida cuando el inventario agota
      // un plato, así que en ese minuto Beto puede verla como disponible. En ese
      // caso se intenta pedirla por la interfaz: la base tiene que rechazarla
      // (409 sin_stock) y la PWA, decírselo. Eso es lo que la demo necesita.
      const tarjeta = tarjetaCliente(beto.page)
      const visible = (await tarjeta.count()) > 0
      if (visible && !(await tarjeta.innerText()).includes('AGOTADO')) {
        const aviso = 'GET /menu en caché: Beto ve la Hamburguesa agotada como disponible hasta 60 s (falta invalidarMenu al agotar por inventario)'
        test.info().annotations.push({ type: 'problema conocido', description: aviso })
        console.warn(`AVISO ${aviso}; se comprueba que pedirla da 409 y la PWA lo dice`)
        await tarjeta.click()
        await beto.page.getByRole('button', { name: /^AÑADIR 1/ }).click()
        await beto.page.getByRole('link', { name: /^Carrito, 1 producto/ }).click()
        await beto.page.getByRole('button', { name: /Enviar mi pedido a cocina/ }).click()
        const intento = beto.page.waitForResponse((r) => r.url().endsWith('/pedidos') && r.request().method() === 'POST')
        await beto.page.getByRole('button', { name: /Confirmar y enviar/ }).click()
        const res = await intento
        expect(res.status()).toBe(409)
        // «El plato "Hamburguesa Smart Angus" no tiene stock suficiente · Revisa tu pedido: algo se agotó en cocina»
        await expect(beto.page.getByRole('alert').filter({ hasText: PLATO }).first()).toContainText(/stock|agot/i)
        expect(beto.page.url()).not.toMatch(/\/seguimiento/)
      }
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

  test('11. Limpieza: todo queda como estaba', async () => {
    await limpiar()
    expect(await fotografiar(admin, ids)).toEqual(antes)
  })
})
