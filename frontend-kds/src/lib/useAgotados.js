import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  cambiarDisponibilidadIngrediente,
  cambiarDisponibilidadPlato,
  obtenerMenu,
  obtenerPlato,
  obtenerPlatos,
} from '../services/api'
import {
  aplicarEvento,
  aplicarEventoPlato,
  aplicarPlatoReleido,
  cargarMenu,
  cargarPlatos,
  confirmarCambio,
  confirmarCambioPlato,
  contarAgotados,
  contarPlatosAgotados,
  estadoInicial,
  limpiarError,
  limpiarErrorPlato,
  marcarCargando,
  marcarCargandoPlatos,
  marcarEnVuelo,
  marcarEnVueloPlato,
  marcarError,
  marcarErrorPlatos,
  revertirCambio,
  revertirCambioPlato,
} from './agotados'

/**
 * Agotados: carga la carta y los platos, conmuta la disponibilidad de ambos y
 * escucha el tiempo real.
 *
 * Toda la decision esta en lib/agotados.js (probado aparte); aqui solo quedan
 * los efectos. No abre NINGUNA conexion nueva: los eventos
 * `ingrediente:disponibilidad` y `plato:disponibilidad` llegan por el socket que
 * ya tiene useTablero, a traves de `alCambiarDisponibilidad` y
 * `alCambiarDisponibilidadPlato`.
 */

const ACCIONES = {
  cargando: marcarCargando,
  cargar: cargarMenu,
  error: (estado, { mensaje, status }) => marcarError(estado, mensaje, status),
  enVuelo: (estado, { id, disponible }) => marcarEnVuelo(estado, id, disponible),
  confirmar: (estado, { id, disponible }) => confirmarCambio(estado, id, disponible),
  revertir: (estado, { id, mensaje }) => revertirCambio(estado, id, mensaje),
  limpiarError: (estado, { id }) => limpiarError(estado, id),
  evento: aplicarEvento,

  // Las mismas acciones para la seccion de platos (D-14).
  cargandoPlatos: marcarCargandoPlatos,
  cargarPlatos: (estado, { platos }) => cargarPlatos(estado, platos),
  errorPlatos: (estado, { mensaje, status }) => marcarErrorPlatos(estado, mensaje, status),
  enVueloPlato: (estado, { id, disponible }) => marcarEnVueloPlato(estado, id, disponible),
  confirmarPlato: (estado, { id, disponible }) => confirmarCambioPlato(estado, id, disponible),
  revertirPlato: (estado, { id, mensaje }) => revertirCambioPlato(estado, id, mensaje),
  limpiarErrorPlato: (estado, { id }) => limpiarErrorPlato(estado, id),
  eventoPlato: aplicarEventoPlato,
  platoReleido: aplicarPlatoReleido,
}

function reducer(estado, accion) {
  const aplicar = ACCIONES[accion.tipo]
  return aplicar ? aplicar(estado, accion.datos) : estado
}

export function useAgotados({ token }) {
  const [estado, despachar] = useReducer(reducer, undefined, estadoInicial)

  /**
   * Lee la carta. Un fallo aqui NO es un error del tablero: la insignia
   * simplemente no aparece y la cocina sigue trabajando. Por eso el error se
   * queda dentro de este estado y nunca sube al tablero.
   */
  const recargarIngredientes = useCallback(async () => {
    despachar({ tipo: 'cargando' })
    try {
      const menu = await obtenerMenu()
      despachar({ tipo: 'cargar', datos: menu })
    } catch (error) {
      despachar({
        tipo: 'error',
        datos: { mensaje: error.message, status: error.status ?? null },
      })
    }
  }, [])

  /**
   * Lee los platos (D-14). Son dos listas independientes: si GET /platos falla
   * y la carta no, la seccion de ingredientes sigue sirviendo igual, y al
   * contrario. Por eso cada una tiene su propio aviso.
   */
  const recargarPlatos = useCallback(async () => {
    despachar({ tipo: 'cargandoPlatos' })
    try {
      const platos = await obtenerPlatos()
      despachar({ tipo: 'cargarPlatos', datos: { platos } })
    } catch (error) {
      despachar({
        tipo: 'errorPlatos',
        datos: { mensaje: error.message, status: error.status ?? null },
      })
    }
  }, [])

  /**
   * Recarga las dos listas. En paralelo y con `allSettled`: ninguna espera a la
   * otra y el fallo de una no cancela a la otra, que ya guardo su propio error.
   */
  const recargar = useCallback(async () => {
    await Promise.allSettled([recargarIngredientes(), recargarPlatos()])
  }, [recargarIngredientes, recargarPlatos])

  // Primera carga, una sola vez: GET /menu y GET /platos son publicas, asi que
  // no esperan token.
  useEffect(() => {
    recargar()
  }, [recargar])

  /**
   * Conmuta un ingrediente: optimista, con reversion si el PATCH falla.
   *
   * No se pide confirmacion a proposito: la accion es reversible con el mismo
   * toque y un dialogo a mitad de servicio es justo lo que una cocina no puede
   * permitirse.
   */
  const conmutar = useCallback(
    async (idIngrediente, disponible) => {
      despachar({ tipo: 'enVuelo', datos: { id: idIngrediente, disponible } })
      try {
        const ingrediente = await cambiarDisponibilidadIngrediente(token, idIngrediente, disponible)
        despachar({
          tipo: 'confirmar',
          datos: {
            id: idIngrediente,
            // Manda el servidor, no lo que se pidio.
            disponible: typeof ingrediente?.disponible === 'boolean'
              ? ingrediente.disponible
              : disponible,
          },
        })
        return { ok: true }
      } catch (error) {
        // Un 401 ya cerro la sesion en el servicio; aun asi se revierte, para
        // no dejar el interruptor mintiendo mientras la app navega al login.
        despachar({ tipo: 'revertir', datos: { id: idIngrediente, mensaje: error.message } })
        return { ok: false, mensaje: error.message }
      }
    },
    [token]
  )

  /**
   * Conmuta un PLATO. Mismo trato que un ingrediente: optimista, con reversion
   * si el PATCH falla y el error real del backend en la fila.
   */
  const conmutarPlato = useCallback(
    async (idPlato, disponible) => {
      despachar({ tipo: 'enVueloPlato', datos: { id: idPlato, disponible } })
      try {
        const plato = await cambiarDisponibilidadPlato(token, idPlato, disponible)
        despachar({
          tipo: 'confirmarPlato',
          datos: {
            id: idPlato,
            // Manda el servidor, no lo que se pidio. `disponible` de la fila es
            // el interruptor MANUAL; el efectivo lo recalcula el estado con
            // stock_suficiente, que la misma respuesta trae (ISSUE #136/#137).
            disponible: typeof plato?.disponible === 'boolean' ? plato.disponible : disponible,
          },
        })
        // La fila completa, para no perder el stock que acaba de decir el
        // servidor (un plato repuesto a mano puede seguir sin inventario).
        if (plato && typeof plato === 'object') {
          despachar({ tipo: 'platoReleido', datos: { id: idPlato, fila: plato } })
        }
        return { ok: true }
      } catch (error) {
        despachar({ tipo: 'revertirPlato', datos: { id: idPlato, mensaje: error.message } })
        return { ok: false, mensaje: error.message }
      }
    },
    [token]
  )

  const alLlegarEvento = useCallback((evento) => {
    despachar({ tipo: 'evento', datos: evento })
  }, [])

  /**
   * plato:disponibilidad (EVENTS.md §5.4). ISSUE #137.
   *
   * El evento trae UN booleano, el EFECTIVO, y no dice si lo apago la cocina o
   * el inventario. Se aplica primero —asi la fila cambia al instante, y el orden
   * por `emitidoEn` lo decide el estado— y despues se RELEE el plato
   * (GET /platos/:id, publica) para quedarse con las dos columnas de verdad,
   * igual que hace el panel del restaurante (#133).
   *
   * Si la relectura falla, no se rompe nada: queda lo que aplico el evento. De
   * varias relecturas del mismo plato solo vale la ultima que se pidio, para que
   * una lenta no pise a una nueva.
   */
  const relecturas = useRef(new Map())

  const alLlegarEventoPlato = useCallback(async (evento) => {
    despachar({ tipo: 'eventoPlato', datos: evento })

    const id = Number(evento?.id_plato)
    if (!Number.isInteger(id) || id <= 0) return

    const turno = (relecturas.current.get(id) || 0) + 1
    relecturas.current.set(id, turno)
    try {
      const fila = await obtenerPlato(id)
      if (relecturas.current.get(id) !== turno) return
      despachar({ tipo: 'platoReleido', datos: { id, fila } })
    } catch {
      // Se queda el valor del evento: es lo mejor que se sabe, y la proxima
      // recarga del panel lo pone al dia.
    }
  }, [])

  const descartarError = useCallback((idIngrediente) => {
    despachar({ tipo: 'limpiarError', datos: { id: idIngrediente } })
  }, [])

  const descartarErrorPlato = useCallback((idPlato) => {
    despachar({ tipo: 'limpiarErrorPlato', datos: { id: idPlato } })
  }, [])

  return {
    estado,
    agotados: contarAgotados(estado),
    platosAgotados: contarPlatosAgotados(estado),
    recargar,
    conmutar,
    conmutarPlato,
    alLlegarEvento,
    alLlegarEventoPlato,
    descartarError,
    descartarErrorPlato,
  }
}
