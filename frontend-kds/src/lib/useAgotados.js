import { useCallback, useEffect, useReducer } from 'react'
import { cambiarDisponibilidadIngrediente, obtenerMenu } from '../services/api'
import {
  aplicarEvento,
  cargarMenu,
  confirmarCambio,
  contarAgotados,
  estadoInicial,
  limpiarError,
  marcarCargando,
  marcarEnVuelo,
  marcarError,
  revertirCambio,
} from './agotados'

/**
 * Ingredientes agotados: carga la carta, conmuta la disponibilidad y escucha el
 * tiempo real.
 *
 * Toda la decision esta en lib/agotados.js (probado aparte); aqui solo quedan
 * los efectos. No abre NINGUNA conexion nueva: los eventos
 * `ingrediente:disponibilidad` llegan por el socket que ya tiene useTablero, a
 * traves de `alCambiarDisponibilidad`.
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
  const recargar = useCallback(async () => {
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

  // Primera carga, una sola vez: GET /menu es publico, asi que no espera token.
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

  const alLlegarEvento = useCallback((evento) => {
    despachar({ tipo: 'evento', datos: evento })
  }, [])

  const descartarError = useCallback((idIngrediente) => {
    despachar({ tipo: 'limpiarError', datos: { id: idIngrediente } })
  }, [])

  return {
    estado,
    agotados: contarAgotados(estado),
    recargar,
    conmutar,
    alLlegarEvento,
    descartarError,
  }
}
