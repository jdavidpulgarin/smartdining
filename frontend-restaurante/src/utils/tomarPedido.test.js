import { describe, it, expect } from 'vitest'
import {
  claveAlias,
  unirComensales,
  buscarPorClave,
  itemTieneFaltante,
  accionErrorEnvio,
  accionError409,
  opcionPedirExistente,
  reemplazarAlias,
  armarPedido,
  agruparPorComensal,
  totalesPorComensal,
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

    it('no duplica a quien venga tanto en presencia.comensales como en presencia.sin_celular (EVENTS.md §5.2)', () => {
      const presencia = {
        comensales: ['Ana', 'Abuela', 'Carlos'],
        sin_celular: ['Abuela', 'abuela'],
      }
      const lista = unirComensales({ presencia })
      expect(lista).toEqual(['Abuela', 'Ana', 'Carlos'])
      expect(lista.filter((c) => claveAlias(c) === 'abuela')).toHaveLength(1)
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

  describe('itemTieneFaltante', () => {
    it('marca un ítem cuyo plato está en faltantes (tipo: plato)', () => {
      const item = { id_plato: 10, nombre: 'Hamburguesa Smart Angus', cantidad: 1 }
      const faltantes = [{ tipo: 'plato', id: 10, nombre: 'Hamburguesa Smart Angus' }]

      expect(itemTieneFaltante(item, faltantes)).toBe(true)
    })

    it('marca un plato del constructor cuando uno de sus ingredientes está en faltantes (tipo: ingrediente)', () => {
      const itemConstructor = {
        id_plato: 20,
        nombre: 'Bowl Personalizado',
        cantidad: 1,
        ingredientes: [
          { id_ingrediente: 101, nombre: 'Arroz Integral', porcion: 'normal' },
          { id_ingrediente: 102, nombre: 'Quinua Orgánica', porcion: 'extra' },
        ],
      }
      const faltantes = [{ tipo: 'ingrediente', id: 102, nombre: 'Quinua Orgánica' }]

      expect(itemTieneFaltante(itemConstructor, faltantes)).toBe(true)
    })

    it('devuelve false para un ítem sin faltantes', () => {
      const item = {
        id_plato: 20,
        nombre: 'Bowl Personalizado',
        cantidad: 1,
        ingredientes: [{ id_ingrediente: 101, nombre: 'Arroz Integral', porcion: 'normal' }],
      }
      const faltantes = [
        { tipo: 'plato', id: 10, nombre: 'Hamburguesa Smart Angus' },
        { tipo: 'ingrediente', id: 999, nombre: 'Panceta Crujiente' },
      ]

      expect(itemTieneFaltante(item, faltantes)).toBe(false)
      expect(itemTieneFaltante(item, [])).toBe(false)
    })

    it('NO marca nada si faltantes viene con la forma vieja ({ id_plato } o { id_ingrediente } sin tipo ni id)', () => {
      const item = {
        id_plato: 10,
        nombre: 'Hamburguesa Smart Angus',
        cantidad: 1,
        ingredientes: [{ id_ingrediente: 101, nombre: 'Arroz Integral', porcion: 'normal' }],
      }
      const faltantesFormaVieja = [
        { id_plato: 10, nombre: 'Hamburguesa Smart Angus' },
        { id_ingrediente: 101, nombre: 'Arroz Integral' },
      ]

      expect(itemTieneFaltante(item, faltantesFormaVieja)).toBe(false)
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

    it('reconoce motivo sin_stock con la forma real [{ tipo, id, nombre }] y arma el mensaje con f.nombre', () => {
      const error = {
        status: 409,
        data: {
          error: 'Sin stock suficiente para el pedido 87',
          motivo: 'sin_stock',
          faltantes: [
            { tipo: 'plato', id: 7, nombre: 'Costillas BBQ' },
            { tipo: 'ingrediente', id: 12, nombre: 'Panceta Crujiente' },
          ],
        },
      }
      const accion = accionError409(error)
      expect(accion.tipo).toBe('sin_stock')
      expect(accion.faltantes).toEqual([
        { tipo: 'plato', id: 7, nombre: 'Costillas BBQ' },
        { tipo: 'ingrediente', id: 12, nombre: 'Panceta Crujiente' },
      ])
      expect(accion.mensaje).toContain('Costillas BBQ')
      expect(accion.mensaje).toContain('Panceta Crujiente')
    })

    it('reconoce 503 con motivo reintentar y devuelve el mensaje de cruce de pedidos', () => {
      const error = {
        status: 503,
        motivo: 'reintentar',
        data: {
          error: 'intenta de nuevo',
          motivo: 'reintentar',
        },
      }
      const accion = accionErrorEnvio(error)
      expect(accion.tipo).toBe('reintentar')
      expect(accion.mensaje).toBe('Hubo un cruce con otro pedido, vuelve a enviarlo.')
    })

    it('en otros errores sin motivo reintentar devuelve el mensaje genérico de siempre', () => {
      const errorSinMensaje = { status: 500 }
      const accionGenerica = accionErrorEnvio(errorSinMensaje)
      expect(accionGenerica.tipo).toBe('desconocido')
      expect(accionGenerica.mensaje).toBe('Error al enviar la comanda a cocina')

      const error503Timeout = {
        status: 503,
        data: {
          error: 'La operación tardó demasiado y se canceló, vuelve a intentarlo en un momento',
        },
      }
      const accionTimeout = accionErrorEnvio(error503Timeout)
      expect(accionTimeout.tipo).toBe('desconocido')
      expect(accionTimeout.mensaje).toBe(
        'La operación tardó demasiado y se canceló, vuelve a intentarlo en un momento'
      )
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

  describe('opcionPedirExistente', () => {
    it('devuelve el alias del cuerpo del error si viene en el 409 alias_en_uso', () => {
      const error = {
        status: 409,
        data: {
          error: 'Ese nombre ya está en la mesa',
          motivo: 'alias_en_uso',
          alias: 'Doña Rosa',
        },
      }
      expect(
        opcionPedirExistente({
          error,
          lista: [],
          texto: 'dona rosa',
          backendCanoniza: true,
        })
      ).toBe('Doña Rosa')
    })

    it('si el error no trae alias, busca por clave en la lista recargada', () => {
      const error = {
        status: 409,
        data: {
          error: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
          motivo: 'alias_en_uso',
        },
      }
      expect(
        opcionPedirExistente({
          error,
          lista: ['Abuela', 'Carlos'],
          texto: '  ábuela ',
          backendCanoniza: true,
        })
      ).toBe('Abuela')
    })

    it('si tampoco aparece en la cuenta (registrado sin platos aún), ofrece el texto recortado solo cuando backendCanoniza es true', () => {
      const error = {
        status: 409,
        data: {
          error: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
          motivo: 'ALIAS_EN_USO',
        },
      }
      expect(
        opcionPedirExistente({
          error,
          lista: [],
          texto: '   Tío   Carlos  ',
          backendCanoniza: true,
        })
      ).toBe('Tío Carlos')

      expect(
        opcionPedirExistente({
          error,
          lista: [],
          texto: '   Tío   Carlos  ',
          backendCanoniza: false,
        })
      ).toBeNull()
    })

    it('devuelve null si el error no es alias_en_uso', () => {
      const error = {
        status: 409,
        data: {
          error: 'Mesa sin sesión',
          motivo: 'mesa_sin_sesion',
        },
      }
      expect(
        opcionPedirExistente({
          error,
          lista: ['Abuela'],
          texto: 'Abuela',
          backendCanoniza: true,
        })
      ).toBeNull()
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

  describe('agruparPorComensal y totalesPorComensal', () => {
    it('agrupa ítems por comensal manteniendo el orden e indiceOriginal', () => {
      const items = [
        { id_plato: 1, nombre: 'Ajiaco', comensal: 'Ana', precio: 20000, cantidad: 1 },
        { id_plato: 2, nombre: 'Jugo', comensal: 'Beto', precio: 5000, cantidad: 2 },
        { id_plato: 3, nombre: 'Postre', comensal: 'Ana', precio: 8000, cantidad: 1 },
        { id_plato: 4, nombre: 'Agua', precio: 3000 },
      ]

      const grupos = agruparPorComensal(items)

      expect(grupos.map((g) => g.comensal)).toEqual(['Ana', 'Beto', 'Sin comensal'])
      expect(grupos[0].items.map((it) => it.indiceOriginal)).toEqual([0, 2])
      expect(grupos[1].items.map((it) => it.indiceOriginal)).toEqual([1])
      expect(grupos[2].items.map((it) => it.indiceOriginal)).toEqual([3])
    })

    it('calcula subtotales por comensal y el total acumulado', () => {
      const items = [
        { id_plato: 1, comensal: 'Ana', precio: 20000, cantidad: 1 },
        { id_plato: 2, comensal: 'Beto', precio: 5000, cantidad: 2 },
        { id_plato: 3, comensal: 'Ana', precio: 8000, cantidad: 2 },
      ]

      const { grupos, total } = totalesPorComensal(items)

      expect(grupos[0].comensal).toBe('Ana')
      expect(grupos[0].subtotalComensal).toBe(36000)
      expect(grupos[1].comensal).toBe('Beto')
      expect(grupos[1].subtotalComensal).toBe(10000)
      expect(total).toBe(46000)
    })

    it('maneja arreglos vacíos o entradas no válidas sin fallar', () => {
      expect(agruparPorComensal([])).toEqual([])
      expect(agruparPorComensal(null)).toEqual([])
      expect(totalesPorComensal([])).toEqual({ grupos: [], total: 0 })
      expect(totalesPorComensal(undefined)).toEqual({ grupos: [], total: 0 })
    })
  })
})
