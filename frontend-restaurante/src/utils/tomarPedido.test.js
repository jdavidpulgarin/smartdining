import { describe, it, expect } from 'vitest'
import {
  claveAlias,
  unirComensales,
  buscarPorClave,
  accionError409,
  reemplazarAlias,
  armarPedido,
} from './tomarPedido'

describe('tomarPedido - lógica pura (J-16)', () => {
  describe('claveAlias', () => {
    it('elimina tildes, mayúsculas, espacios y caracteres especiales . _ \' -', () => {
      expect(claveAlias('Ábuela')).toBe('abuela')
      expect(claveAlias('abuela')).toBe('abuela')
      expect(claveAlias('  abuela  ')).toBe('abuela')
      expect(claveAlias('Ana-Lucía')).toBe('analucia')
      expect(claveAlias('Dr. Smith')).toBe('drsmith')
      expect(claveAlias("O'Connor")).toBe('oconnor')
      expect(claveAlias('Pepe_99')).toBe('pepe99')
    })

    it('"Ábuela" y "abuela" tienen exactamente la misma clave', () => {
      expect(claveAlias('Ábuela')).toBe(claveAlias('abuela'))
      expect(claveAlias('  ABUÉLA  ')).toBe(claveAlias('abuela'))
    })

    it('devuelve cadena vacía con entradas inválidas', () => {
      expect(claveAlias(null)).toBe('')
      expect(claveAlias(undefined)).toBe('')
      expect(claveAlias(123)).toBe('')
      expect(claveAlias('')).toBe('')
    })
  })

  describe('unirComensales', () => {
    it('une presencia y cuenta sin duplicar por clave y sin "General"', () => {
      const presencia = {
        comensales: ['Ana', 'Beto'],
        sin_celular: ['Abuela'],
      }
      const cuenta = {
        comensales: [
          { comensal: 'General', saldo: 10000 },
          { comensal: 'ana', saldo: 20000 }, // duplicado de Ana por clave
          { comensal: 'Carlos', saldo: 30000 },
        ],
      }

      const lista = unirComensales({ presencia, cuenta })

      // No debe contener "General"
      expect(lista).not.toContain('General')
      expect(lista).not.toContain('general')

      // No debe haber duplicados de "Ana" (se conserva el primer texto del servidor)
      expect(lista.filter((c) => claveAlias(c) === 'ana')).toHaveLength(1)
      expect(lista).toContain('Ana')

      // Debe contener a Beto, Abuela y Carlos
      expect(lista).toContain('Beto')
      expect(lista).toContain('Abuela')
      expect(lista).toContain('Carlos')

      // Debe estar ordenado alfabéticamente
      expect(lista).toEqual(['Abuela', 'Ana', 'Beto', 'Carlos'])
    })

    it('conserva el texto EXACTO que llega del servidor', () => {
      const cuenta = {
        comensales: [
          { comensal: 'Señora sin Celular' },
          { comensal: 'Doña Rosa' },
        ],
      }
      const lista = unirComensales({ cuenta })
      expect(lista).toContain('Señora sin Celular')
      expect(lista).toContain('Doña Rosa')
    })

    it('maneja arrays simples y valores nulos/vacíos', () => {
      expect(unirComensales()).toEqual([])
      expect(unirComensales({ presencia: ['Ana', 'Beto'] })).toEqual(['Ana', 'Beto'])
      expect(unirComensales({ cuenta: [{ comensal: '  ' }] })).toEqual([])
    })
  })

  describe('buscarPorClave', () => {
    const lista = ['Abuela', 'Ana Lucía', 'Carlos']

    it('encuentra el alias existente por clave sin importar tildes o mayúsculas', () => {
      expect(buscarPorClave(lista, 'abuela')).toBe('Abuela')
      expect(buscarPorClave(lista, '  Ábuela  ')).toBe('Abuela')
      expect(buscarPorClave(lista, 'ABUELA')).toBe('Abuela')
      expect(buscarPorClave(lista, 'ana lucia')).toBe('Ana Lucía')
      expect(buscarPorClave(lista, 'Ana-Lucía')).toBe('Ana Lucía')
    })

    it('devuelve null si no existe', () => {
      expect(buscarPorClave(lista, 'Roberto')).toBeNull()
      expect(buscarPorClave(lista, '')).toBeNull()
      expect(buscarPorClave(null, 'abuela')).toBeNull()
    })
  })

  describe('accionError409', () => {
    it('reconoce motivo alias_en_uso', () => {
      const error = {
        status: 409,
        data: {
          error: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
          motivo: 'alias_en_uso',
        },
      }
      const accion = accionError409(error)
      expect(accion.tipo).toBe('alias_en_uso')
      expect(accion.mensaje).toContain('Ese nombre ya lo usa otra persona')
    })

    it('reconoce motivo mesa_sin_sesion', () => {
      const error = {
        status: 409,
        data: {
          error: 'Esa mesa no tiene una sesión abierta: ábrela antes de agregar comensales',
          motivo: 'mesa_sin_sesion',
        },
      }
      const accion = accionError409(error)
      expect(accion.tipo).toBe('mesa_sin_sesion')
      expect(accion.mensaje).toContain('no tiene una sesión abierta')
    })

    it('reconoce motivo comensal_no_registrado y extrae alias', () => {
      const error = {
        status: 409,
        data: {
          error: 'Esa persona no está registrada en la mesa',
          motivo: 'comensal_no_registrado',
          alias: 'Abuela',
        },
      }
      const accion = accionError409(error)
      expect(accion.tipo).toBe('comensal_no_registrado')
      expect(accion.alias).toBe('Abuela')
    })

    it('reconoce motivo sin_stock y extrae faltantes', () => {
      const error = {
        status: 409,
        data: {
          error: 'Algunos platos o ingredientes están agotados',
          motivo: 'SIN_STOCK',
          faltantes: [
            { id_plato: 7, nombre: 'Costillas BBQ' },
            { id_ingrediente: 12, nombre: 'Panceta Crujiente' },
          ],
        },
      }
      const accion = accionError409(error)
      expect(accion.tipo).toBe('sin_stock')
      expect(accion.faltantes).toHaveLength(2)
      expect(accion.faltantes[0].nombre).toBe('Costillas BBQ')
    })

    it('mapea motivos desconocidos de forma segura', () => {
      const error = {
        status: 409,
        data: {
          error: 'Conflicto no categorizado',
          motivo: 'otro_motivo',
        },
      }
      const accion = accionError409(error)
      expect(accion.tipo).toBe('desconocido')
      expect(accion.mensaje).toBe('Conflicto no categorizado')
    })
  })

  describe('reemplazarAlias', () => {
    it('reemplaza el alias por clave en los ítems coincidentes y preserva los demás', () => {
      const items = [
        { id_plato: 1, cantidad: 1, comensal: 'abuela' },
        { id_plato: 2, cantidad: 2, comensal: 'Ábuela' },
        { id_plato: 3, cantidad: 1, comensal: 'Beto' },
      ]

      const actualizados = reemplazarAlias(items, 'abuela', 'Abuelita')

      expect(actualizados[0].comensal).toBe('Abuelita')
      expect(actualizados[1].comensal).toBe('Abuelita')
      expect(actualizados[2].comensal).toBe('Beto')
      // Inmutabilidad
      expect(actualizados).not.toBe(items)
      expect(items[0].comensal).toBe('abuela')
    })
  })

  describe('armarPedido', () => {
    it('si se escribe " abuela ", el servidor responde "Abuela" y el pedido sale con "Abuela"', () => {
      const aliasServidor = 'Abuela' // obtenido del 201
      const payload = armarPedido({
        idMesa: 5,
        items: [
          {
            id_plato: 10,
            cantidad: 2,
            comensal: aliasServidor,
            notas: 'Sin sal',
            precio: 35000, // campo de precio que debe eliminarse
            subtotal: 70000, // campo de precio que debe eliminarse
          },
        ],
      })

      expect(payload.id_mesa).toBe(5)
      expect(payload.items).toHaveLength(1)
      expect(payload.items[0].comensal).toBe('Abuela')
      expect(payload.items[0].cantidad).toBe(2)
      expect(payload.items[0].notas).toBe('Sin sal')
      // Prohibidos campos de precio
      expect(payload.items[0].precio).toBeUndefined()
      expect(payload.items[0].subtotal).toBeUndefined()
      expect(payload.items[0].total).toBeUndefined()
    })

    it('incluye ingredientes formateados con id_ingrediente y porcion', () => {
      const payload = armarPedido({
        idMesa: 3,
        items: [
          {
            id_plato: 100,
            cantidad: 1,
            comensal: 'Ana',
            ingredientes: [
              { id_ingrediente: 1, porcion: 'normal', precio_extra: 0 },
              { idIngrediente: 2, porcion: 'extra', precio_extra: 3000 },
            ],
          },
        ],
        notasGenerales: 'Mesa con niños',
      })

      expect(payload.notas_generales).toBe('Mesa con niños')
      expect(payload.items[0].ingredientes).toEqual([
        { id_ingrediente: 1, porcion: 'normal' },
        { id_ingrediente: 2, porcion: 'extra' },
      ])
      expect(payload.items[0].ingredientes[0].precio_extra).toBeUndefined()
    })

    it('falla si falta id_mesa o items', () => {
      expect(() => armarPedido({ idMesa: null, items: [{ id_plato: 1 }] })).toThrow('id_mesa')
      expect(() => armarPedido({ idMesa: 5, items: [] })).toThrow('al menos un ítem')
    })
  })
})
