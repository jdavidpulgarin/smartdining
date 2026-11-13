import { describe, it, expect } from 'vitest'
import {
  esRepartidor,
  puedeDespachar,
  enlaceVisible,
  accionesRepartidor,
  puedeAsignar,
  puedeCancelarFallido,
  validarMotivoFallo,
  ubicacionPedido,
  loEntregaElRepartidor,
  indexarPorPedido,
  mensajeErrorDomicilio,
  etiquetaEntrega,
} from '../domicilios'

const entrega = (estado_entrega, estadoPedido = 'listo') => ({ estado_entrega, pedido: { id_pedido: 9, estado: estadoPedido } })

describe('roles', () => {
  it('repartidor y quién despacha (admin y cajero, como el backend)', () => {
    expect(esRepartidor('repartidor')).toBe(true)
    expect(esRepartidor('mesero')).toBe(false)
    expect(['admin', 'cajero'].every(puedeDespachar)).toBe(true)
    expect(['mesero', 'cocina', 'repartidor'].some(puedeDespachar)).toBe(false)
  })

  it('enlaceVisible: el repartidor solo ve lo que lo nombra; los demás, como antes', () => {
    const MESAS = { path: '/mesas' }
    const CAJA = { path: '/caja', roles: ['admin', 'cajero'] }
    const INVENTARIO = { path: '/inventario', soloAdmin: true }
    const ENTREGAS = { path: '/entregas', roles: ['repartidor'] }
    expect([MESAS, CAJA, INVENTARIO, ENTREGAS].filter((i) => enlaceVisible(i, 'repartidor'))).toEqual([ENTREGAS])
    expect([MESAS, CAJA, INVENTARIO, ENTREGAS].filter((i) => enlaceVisible(i, 'mesero'))).toEqual([MESAS])
    expect([MESAS, CAJA, INVENTARIO, ENTREGAS].filter((i) => enlaceVisible(i, 'admin'))).toEqual([MESAS, CAJA, INVENTARIO])
  })
})

describe('accionesRepartidor', () => {
  it('asignado y listo en cocina: puede salir', () => {
    expect(accionesRepartidor(entrega('asignado'))).toEqual({ salir: true, esperandoCocina: false, entregar: false, fallar: false })
  })
  it('asignado pero cocina no lo tiene listo: espera (el backend daría 409 pedido_no_listo)', () => {
    expect(accionesRepartidor(entrega('asignado', 'en_preparacion'))).toMatchObject({ salir: false, esperandoCocina: true })
  })
  it('en camino: entregar o no se pudo', () => {
    expect(accionesRepartidor(entrega('en_camino'))).toMatchObject({ salir: false, entregar: true, fallar: true })
  })
  it.each(['por_asignar', 'entregado', 'fallido'])('%s: nada', (e) => {
    expect(Object.values(accionesRepartidor(entrega(e))).some(Boolean)).toBe(false)
  })
})

describe('despacho', () => {
  it('asignar solo mientras no haya salido y el pedido no esté cancelado', () => {
    expect(puedeAsignar(entrega('por_asignar', 'recibido'))).toBe(true)
    expect(puedeAsignar(entrega('asignado'))).toBe(true)
    expect(puedeAsignar(entrega('en_camino'))).toBe(false)
    expect(puedeAsignar(entrega('entregado'))).toBe(false)
    expect(puedeAsignar(entrega('asignado', 'cancelado'))).toBe(false)
  })
  it('cancelar un fallido: solo el admin y con el pedido aún en listo', () => {
    expect(puedeCancelarFallido(entrega('fallido'), 'admin')).toBe(true)
    expect(puedeCancelarFallido(entrega('fallido'), 'cajero')).toBe(false)
    expect(puedeCancelarFallido(entrega('fallido', 'cancelado'), 'admin')).toBe(false)
    expect(puedeCancelarFallido(entrega('en_camino'), 'admin')).toBe(false)
  })
  it('motivo de fallo: 1 a 200 caracteres', () => {
    expect(validarMotivoFallo('  ')).toMatch(/Escribe/)
    expect(validarMotivoFallo('x'.repeat(201))).toMatch(/200/)
    expect(validarMotivoFallo('Nadie abrió')).toBeNull()
  })
})

describe('ubicacionPedido: dónde el panel esperaba un número de mesa', () => {
  const dom = { pedido: { id_pedido: 5 }, zona: { nombre: 'Bocagrande' }, direccion: { direccion: 'Cra 3 # 5-10' } }
  it('mesa por su número', () => {
    expect(ubicacionPedido({ canal: 'mesa', mesa_numero: 4, id_mesa: 12 })).toEqual({ tipo: 'mesa', texto: 'Mesa 4', detalle: null })
    expect(ubicacionPedido({ numero_mesa: 2 }).texto).toBe('Mesa 2')
  })
  it('domicilio con zona y dirección si se tienen; si no, solo «Domicilio»', () => {
    expect(ubicacionPedido({ canal: 'domicilio', mesa_numero: null, id_mesa: null }, dom)).toEqual({ tipo: 'domicilio', texto: 'Domicilio', detalle: 'Bocagrande · Cra 3 # 5-10' })
    expect(ubicacionPedido({ canal: 'domicilio', id_mesa: null })).toEqual({ tipo: 'domicilio', texto: 'Domicilio', detalle: null })
  })
  it('para llevar, y un pedido sin mesa ni canal ya no es «Barra»', () => {
    expect(ubicacionPedido({ canal: 'para_llevar', id_mesa: null }).texto).toBe('Para llevar')
    expect(ubicacionPedido({ id_mesa: null }).texto).toBe('Sin mesa')
  })
  it('un domicilio lo entrega el repartidor', () => {
    expect(loEntregaElRepartidor({ canal: 'domicilio' })).toBe(true)
    expect(loEntregaElRepartidor({ canal: 'mesa' })).toBe(false)
  })
  it('indexarPorPedido', () => {
    expect(indexarPorPedido([dom]).get(5)).toBe(dom)
  })
})

describe('mensajes', () => {
  it.each([
    ['pedido_no_listo', /no está listo/],
    ['entrega_ya_salio', /ya salió/],
    ['no_es_tu_entrega', /no es tuya/],
    ['transicion_invalida', /Actualiza/],
    ['repartidor_no_valido', /no está activo/],
    ['entrega_en_camino', /no se puede cancelar/],
  ])('%s', (motivo, esperado) => {
    expect(mensajeErrorDomicilio({ motivo })).toMatch(esperado)
  })
  it('sin conexión y genérico', () => {
    expect(mensajeErrorDomicilio({ sinConexion: true })).toMatch(/Sin conexión/)
    expect(mensajeErrorDomicilio({ message: 'x' })).toBe('No se pudo: x')
  })
  it('etiquetas', () => {
    expect(etiquetaEntrega('fallido')).toBe('No se entregó')
  })
})
