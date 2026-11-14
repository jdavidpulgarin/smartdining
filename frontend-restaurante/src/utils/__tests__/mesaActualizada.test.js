import { describe, it, expect } from 'vitest'
import { aplicarMesaActualizada } from '../mesaActualizada'

// Un normalizador mínimo con la misma forma que el de TablesContext.
const normalizar = (m, prev = {}) => ({
  id: m.id_mesa, id_mesa: m.id_mesa, numero: m.numero, estado: m.estado, capacidad: m.capacidad,
  ubicacion: m.ubicacion, sesion_abierta: Boolean(m.sesion_abierta), token_qr: prev.token_qr || null, qr_url: prev.qr_url || null,
})
const mesa = (id, extra = {}) => ({ ...normalizar({ id_mesa: id, numero: id, estado: 'disponible', capacidad: 4, ubicacion: 'Salón' }), ...extra })
const ev = (extra) => ({ eventId: 'e', id_mesa: 2, numero: 2, estado: 'ocupada', capacidad: 4, ubicacion: 'Salón', ...extra })

describe('utils/mesaActualizada (T12, §5.7)', () => {
  it('abierta: actualiza la mesa por id_mesa, sin tocar las demás', () => {
    const antes = [mesa(1), mesa(2), mesa(3)]
    const despues = aplicarMesaActualizada(antes, ev({ motivo: 'abierta', sesion_abierta: true }), normalizar)
    expect(despues.map((t) => t.estado)).toEqual(['disponible', 'ocupada', 'disponible'])
    expect(despues[1].sesion_abierta).toBe(true)
    expect(despues[0]).toBe(antes[0])
  })

  it('creada (o una mesa que no está): se agrega en su lugar por número', () => {
    const despues = aplicarMesaActualizada([mesa(1), mesa(3)], ev({ motivo: 'creada', estado: 'disponible' }), normalizar)
    expect(despues.map((t) => t.numero)).toEqual([1, 2, 3])
    const sinMotivo = aplicarMesaActualizada([mesa(1)], ev({ id_mesa: 7, numero: 7 }), normalizar)
    expect(sinMotivo.map((t) => t.numero)).toEqual([1, 7])
  })

  it('eliminada (solo id_mesa): se quita; si no estaba, nada cambia', () => {
    const antes = [mesa(1), mesa(2)]
    expect(aplicarMesaActualizada(antes, { eventId: 'x', id_mesa: 2, activa: false, motivo: 'eliminada' }, normalizar).map((t) => t.id_mesa)).toEqual([1])
    expect(aplicarMesaActualizada(antes, { eventId: 'x', id_mesa: 9, activa: false, motivo: 'eliminada' }, normalizar)).toBe(antes)
  })

  it('datos parciales: conserva lo que no viene', () => {
    const antes = [mesa(2, { capacidad: 6, ubicacion: 'Terraza' })]
    const [m] = aplicarMesaActualizada(antes, { eventId: 'x', id_mesa: 2, estado: 'reservada' }, normalizar)
    expect(m).toMatchObject({ estado: 'reservada', capacidad: 6, ubicacion: 'Terraza', numero: 2 })
  })

  it('liberada (disponible): olvida el QR revocado; ocupada lo conserva', () => {
    const antes = [mesa(2, { estado: 'ocupada', token_qr: 'v1.viejo', qr_url: 'http://x/?token=v1.viejo' })]
    const [lib] = aplicarMesaActualizada(antes, ev({ motivo: 'liberada', estado: 'disponible', sesion_abierta: false }), normalizar)
    expect(lib).toMatchObject({ estado: 'disponible', token_qr: null, qr_url: null, sesion_abierta: false })
    const [sig] = aplicarMesaActualizada(antes, ev({ motivo: 'estado' }), normalizar)
    expect(sig.token_qr).toBe('v1.viejo')
  })

  it('activa:false sin eliminada: la actualiza (GET /mesas lista las inactivas); id_mesero se guarda', () => {
    const [m] = aplicarMesaActualizada([mesa(2)], ev({ estado: 'disponible', activa: false, motivo: 'datos', id_mesero: 5 }), normalizar)
    expect(m).toMatchObject({ activa: false, id_mesero: 5 })
  })

  it('un evento sin id_mesa válido no cambia la lista', () => {
    const antes = [mesa(1)]
    for (const malo of [null, {}, { id_mesa: 0 }, { id_mesa: '2' }, { id_mesa: -1 }]) {
      expect(aplicarMesaActualizada(antes, malo, normalizar)).toBe(antes)
    }
  })
})
