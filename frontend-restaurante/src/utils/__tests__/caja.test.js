import { describe, it, expect } from 'vitest'
import {
  puedeUsarCaja,
  nuevoIdCobro,
  comensalDelCobro,
  claveDeCobro,
  idCobroParaEnviar,
  mensajeDeErrorCobro,
  descartarIdCobro,
  agruparCobros,
  horaBogota,
} from '../caja'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('utils/caja', () => {
  it('puedeUsarCaja: solo admin y cajero', () => {
    expect(['admin', 'cajero'].map(puedeUsarCaja)).toEqual([true, true])
    expect(['mesero', 'cocina', undefined, ''].map(puedeUsarCaja)).toEqual([false, false, false, false])
  })

  it('nuevoIdCobro: UUID v4, también sin randomUUID (http en la red local)', () => {
    expect(nuevoIdCobro()).toMatch(UUID)
    const sinRandomUUID = { getRandomValues: (b) => globalThis.crypto.getRandomValues(b) }
    const ids = new Set(Array.from({ length: 50 }, () => nuevoIdCobro(sinRandomUUID)))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(UUID)
  })

  it('comensalDelCobro: TOTAL y General → null; una persona → su nombre', () => {
    expect(comensalDelCobro('TOTAL')).toBeNull()
    expect(comensalDelCobro('General')).toBeNull()
    expect(comensalDelCobro(null)).toBeNull()
    expect(comensalDelCobro('Ana')).toBe('Ana')
  })

  it('idCobroParaEnviar: el mismo cobro reutiliza el id; otro monto, persona, mesa o método lleva uno nuevo', () => {
    let n = 0
    const generar = () => `id-${++n}`
    const base = { id_mesa: 1, comensal: null, monto: 60000, metodo_pago: 'efectivo' }
    const primero = idCobroParaEnviar(null, base, generar)
    expect(primero.id_cobro).toBe('id-1')
    expect(idCobroParaEnviar(primero, { ...base }, generar)).toBe(primero)
    expect(idCobroParaEnviar(primero, { ...base, monto: '60000' }, generar).id_cobro).toBe('id-1')
    for (const cambio of [{ monto: 30000 }, { comensal: 'Ana' }, { id_mesa: 2 }, { metodo_pago: 'transferencia' }]) {
      expect(idCobroParaEnviar(primero, { ...base, ...cambio }, generar).id_cobro).not.toBe('id-1')
    }
    expect(claveDeCobro(base)).toBe(claveDeCobro({ ...base, comensal: undefined }))
  })

  it('mensajeDeErrorCobro: cada motivo del contrato en palabras del cajero', () => {
    const f = (n) => `$${n}`
    expect(mensajeDeErrorCobro({ sinConexion: true })).toMatch(/no se cobra dos veces/)
    expect(mensajeDeErrorCobro({ motivo: 'excede', data: { saldo: 1500 } }, f)).toMatch(/saldo actual \$1500/)
    expect(mensajeDeErrorCobro({ motivo: 'sin_cuenta' })).toMatch(/ya no tiene nada por cobrar/)
    expect(mensajeDeErrorCobro({ motivo: 'autor_inexistente' })).toMatch(/vuelve a iniciar sesión/)
    expect(mensajeDeErrorCobro({ motivo: 'mesa_inexistente' })).toMatch(/ya no existe/)
    expect(mensajeDeErrorCobro({ motivo: 'cuerpo_invalido', message: 'monto inválido' })).toMatch(/monto inválido/)
    expect(mensajeDeErrorCobro({ message: 'boom' })).toMatch(/boom/)
    expect(mensajeDeErrorCobro({ motivo: 'id_cobro_en_uso' })).toMatch(/otra mesa.*COBRAR otra vez/)
  })

  it('agruparCobros: un cobro repartido es una fila; sin referencia, cada fila es un cobro; montos sin coma flotante', () => {
    const t = (id, monto, ref, fecha) => ({ id_transaccion: id, numero_mesa: 4, monto, metodo_pago: 'efectivo', comensal: null, fecha, referencia_pago: ref })
    const g = agruparCobros([
      t(3, 0.2, 'caja:x', '2026-11-11T20:00:02Z'),
      t(2, 0.1, 'caja:x', '2026-11-11T20:00:02Z'),
      t(9, 5000, null, '2026-11-11T19:00:00Z'),
      t(8, 1000, null, '2026-11-11T21:00:00Z'),
    ])
    expect(g.map((c) => [c.ids.join(','), c.monto])).toEqual([['8', 1000], ['2,3', 0.3], ['9', 5000]])
    expect(agruparCobros([])).toEqual([])
  })

  it('horaBogota: la hora del restaurante, también después de las 7 p. m. (ya "mañana" en UTC)', () => {
    expect(horaBogota('2026-11-12T01:30:00.000Z')).toBe('20:30')
    expect(horaBogota('2026-11-11T20:11:14.981Z')).toBe('15:11')
    expect(horaBogota('no-es-fecha')).toBe('')
  })

  it('descartarIdCobro: solo con id_cobro_en_uso; un error de red o un excede conservan el id (reintento seguro)', () => {
    expect(descartarIdCobro({ motivo: 'id_cobro_en_uso' })).toBe(true)
    for (const err of [{ sinConexion: true }, { motivo: 'excede' }, { motivo: 'sin_cuenta' }, {}, null]) {
      expect(descartarIdCobro(err)).toBe(false)
    }
  })
})
