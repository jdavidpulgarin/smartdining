import { describe, it, expect } from 'vitest'
import { resumenDetalleMesa, avisoDeEstaMesa } from '../detalleMesa'
import { mesaConSesionActiva } from '../caja'

const ocupada = { id_mesa: 3, numero: 3, status: 'Ocupada' }
const disponible = { id_mesa: 3, numero: 3, status: 'Disponible' }

// Forma de GET /mesas/:id/cuenta (obtener_cuenta_mesa_json, script 20).
const cuenta = (extra = {}) => ({
  id_mesa: 3,
  numero: 3,
  estado_mesa: 'ocupada',
  total_mesa: 0,
  pagado_mesa: 0,
  saldo_mesa: 0,
  items_totales: 0,
  pedidos: [],
  comensales: [],
  ...extra,
})

// El pedido zombi de staging: mesa 3, visita anterior, entregado y sin pagar.
const ord001 = {
  id_pedido: 1,
  codigo_pedido: 'ORD-001',
  id_mesa: 3,
  estado: 'entregado',
  total: 70000,
  detalles: [{ cantidad: 2, plato_nombre: 'Bandeja', subtotal: 70000, comensal: 'Ana' }],
}

describe('mesaConSesionActiva (regla de la Caja)', () => {
  it('ocupada o con sesión abierta: sí; disponible, reservada o sin mesa: no', () => {
    expect(mesaConSesionActiva({ estado: 'ocupada' })).toBe(true)
    expect(mesaConSesionActiva({ status: 'Ocupada' })).toBe(true)
    expect(mesaConSesionActiva({ estado: 'disponible', sesion_abierta: true })).toBe(true)
    expect(mesaConSesionActiva({ estado: 'disponible' })).toBe(false)
    expect(mesaConSesionActiva({ status: 'Reservada' })).toBe(false)
    expect(mesaConSesionActiva(null)).toBe(false)
  })
})

describe('resumenDetalleMesa', () => {
  it('mesa DISPONIBLE con pedidos de una sesión anterior: sin consumo, sin saldo y sin comandas', () => {
    // La cuenta de una mesa libre es la de la visita anterior (sesion_iniciada_en
    // no se borra al liberar): no debe salir nada.
    const r = resumenDetalleMesa({
      mesa: disponible,
      cuenta: cuenta({
        estado_mesa: 'disponible',
        total_mesa: 24000,
        pagado_mesa: 24000,
        pedidos: [{ id_pedido: 62, codigo_pedido: 'PED-261117-76A0F', estado: 'pagado', total: 24000 }],
        comensales: [{ comensal: 'Daniel', items_pedidos: 1, subtotal: 24000, pagado: 0, saldo: 24000 }],
      }),
      pedidosPanel: [ord001],
    })
    expect(r).toMatchObject({ conSesion: false, total: 0, pagado: 0, saldo: 0, comandas: [], comensales: [] })
    expect(r.pagadaSinEntregar).toBe(false)
  })

  it('pedidos del panel de otra visita no entran: las comandas son SOLO las de la cuenta', () => {
    const r = resumenDetalleMesa({ mesa: ocupada, cuenta: cuenta(), pedidosPanel: [ord001] })
    expect(r.conSesion).toBe(true)
    expect(r.comandas).toEqual([])
    expect(r.total).toBe(0)
    expect(r.saldo).toBe(0)
  })

  it('sin pagos: consumo = saldo, pagado 0, reparto por comensal y los ítems del pedido vivo', () => {
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({
        total_mesa: 50000,
        saldo_mesa: 50000,
        items_totales: 2,
        pedidos: [{ id_pedido: 80, codigo_pedido: 'PED-A', estado: 'en_preparacion', total: 50000 }],
        comensales: [
          { comensal: 'Ana', items_pedidos: 1, subtotal: 30000, pagado: 0, saldo: 30000 },
          { comensal: 'Luis', items_pedidos: 1, subtotal: 20000, pagado: 0, saldo: 20000 },
        ],
      }),
      pedidosPanel: [ord001, { id_pedido: 80, detalles: [{ cantidad: 1, plato_nombre: 'Arepa' }] }],
    })
    expect(r).toMatchObject({ total: 50000, pagado: 0, saldo: 50000, items: 2, pagadaSinEntregar: false })
    expect(r.comensales.map((c) => [c.nombre, c.saldo])).toEqual([['Ana', 30000], ['Luis', 20000]])
    expect(r.comandas).toHaveLength(1)
    expect(r.comandas[0].detalles).toEqual([{ cantidad: 1, plato_nombre: 'Arepa' }])
  })

  it('pago parcial: saldo de la cuenta, sin aviso de pagada', () => {
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({
        total_mesa: 50000,
        pagado_mesa: 30000,
        saldo_mesa: 20000,
        pedidos: [{ id_pedido: 80, codigo_pedido: 'PED-A', estado: 'listo', total: 50000 }],
        comensales: [
          { comensal: 'Ana', items_pedidos: 1, subtotal: 30000, pagado: 30000, saldo: 0 },
          { comensal: 'Luis', items_pedidos: 1, subtotal: 20000, pagado: 0, saldo: 20000 },
        ],
      }),
    })
    expect(r).toMatchObject({ total: 50000, pagado: 30000, saldo: 20000, pagadaSinEntregar: false })
    expect(r.comensales.find((c) => c.nombre === 'Ana').saldo).toBe(0)
  })

  it('pago total con pedidos SIN entregar: saldo 0 y aviso "Pagada: marca los pedidos como entregados…"', () => {
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({
        total_mesa: 50000,
        pagado_mesa: 50000,
        saldo_mesa: 0,
        pedidos: [
          { id_pedido: 80, codigo_pedido: 'PED-A', estado: 'listo', total: 30000 },
          { id_pedido: 81, codigo_pedido: 'PED-B', estado: 'entregado', total: 20000 },
        ],
      }),
    })
    expect(r).toMatchObject({ total: 50000, pagado: 50000, saldo: 0, pagadaSinEntregar: true })
    expect(r.comandas.map((p) => p.codigo_pedido)).toEqual(['PED-A', 'PED-B'])
  })

  it('pago total con TODO entregado (pedidos ya cerrados en pagado): saldo 0, sin aviso y sin comandas', () => {
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({
        total_mesa: 50000,
        pagado_mesa: 50000,
        saldo_mesa: 0,
        pedidos: [{ id_pedido: 80, codigo_pedido: 'PED-A', estado: 'pagado', total: 50000 }],
      }),
    })
    expect(r).toMatchObject({ total: 50000, pagado: 50000, saldo: 0, pagadaSinEntregar: false, comandas: [] })
  })

  it('pago total a nombre de "General" con otro comensal con subtotal: todos quedan sin saldo ("Pagado")', () => {
    // El caso real de staging: cobrar "toda la cuenta" deja el pago en General
    // y a Daniel con su subtotal como saldo, aunque la mesa tenga saldo 0.
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({
        total_mesa: 24000,
        pagado_mesa: 24000,
        saldo_mesa: 0,
        pedidos: [{ id_pedido: 62, codigo_pedido: 'PED-B', estado: 'listo', total: 24000 }],
        comensales: [
          { comensal: 'Daniel', items_pedidos: 1, subtotal: 24000, pagado: 0, saldo: 24000 },
          { comensal: 'General', items_pedidos: 0, subtotal: 0, pagado: 24000, saldo: 0 },
        ],
      }),
    })
    expect(r.comensales.map((c) => [c.nombre, c.saldo])).toEqual([['Daniel', 0], ['General', 0]])
    expect(r.comensales.every((c) => c.saldo === 0)).toBe(true)
    expect(r.pagadaSinEntregar).toBe(true)
  })

  it('con saldo pendiente en la mesa, el saldo por comensal se respeta', () => {
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({
        total_mesa: 24000,
        pagado_mesa: 10000,
        saldo_mesa: 14000,
        comensales: [
          { comensal: 'Daniel', items_pedidos: 1, subtotal: 24000, pagado: 0, saldo: 24000 },
          { comensal: 'General', items_pedidos: 0, subtotal: 0, pagado: 10000, saldo: 0 },
        ],
      }),
    })
    expect(r.comensales.find((c) => c.nombre === 'Daniel').saldo).toBe(24000)
  })

  it('si la cuenta ya dice que la mesa está disponible, gana aunque el panel siga en ocupada', () => {
    const r = resumenDetalleMesa({
      mesa: ocupada,
      cuenta: cuenta({ estado_mesa: 'disponible', total_mesa: 24000, pagado_mesa: 24000 }),
    })
    expect(r).toMatchObject({ conSesion: false, total: 0, saldo: 0 })
  })

  it('con visita en curso y la cuenta aún sin cargar: conSesion sin cifras', () => {
    expect(resumenDetalleMesa({ mesa: ocupada, cuenta: null })).toMatchObject({ conSesion: true, total: 0, comandas: [] })
  })
})

describe('avisoDeEstaMesa', () => {
  it('filtra por id_mesa; sin id_mesa recarga por si acaso', () => {
    expect(avisoDeEstaMesa({ id_mesa: 3 }, 3)).toBe(true)
    expect(avisoDeEstaMesa({ id_mesa: '3' }, 3)).toBe(true)
    expect(avisoDeEstaMesa({ id_mesa: 4 }, 3)).toBe(false)
    expect(avisoDeEstaMesa(undefined, 3)).toBe(true)
  })
})
