import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { cambiarEstadoComanda, obtenerComandas } from '../services/api'
import { crearSocket, esErrorDeToken } from '../services/socket'
import {
  aplicarCreado,
  aplicarEstado,
  cargarInicial,
  estadoInicial,
  marcarCargando,
  marcarError,
  marcarEstadoLocal,
  esEventoRepetido,
} from './comandas'

/**
 * Une la carga por API y el tiempo real en un solo estado del tablero.
 *
 * Toda la decision sobre que hacer con cada evento esta en lib/comandas.js
 * (probado aparte); aqui solo quedan los efectos: pedir, conectar, reconectar y
 * limpiar.
 */

const ACCIONES = {
  cargando: marcarCargando,
  cargar: cargarInicial,
  error: marcarError,
  creado: aplicarCreado,
  estado: aplicarEstado,
  // Movimiento optimista tras un PATCH propio: no espera al socket.
  local: (estado, { id_pedido, nuevoEstado }) => marcarEstadoLocal(estado, id_pedido, nuevoEstado),
}

function reducer(estado, accion) {
  const aplicar = ACCIONES[accion.tipo]
  return aplicar ? aplicar(estado, accion.datos) : estado
}

/** Cada cuanto se repinta el cronometro de las tarjetas, sin pedir nada. */
const REFRESCO_RELOJ_MS = 30_000

export function useTablero({ token, alCaducarSesion, alLlegarComandaNueva }) {
  const [estado, despachar] = useReducer(reducer, undefined, estadoInicial)
  const [conectado, setConectado] = useState(false)

  // El reloj avanza en su propio estado para que solo se repinten los minutos,
  // sin tocar las comandas.
  const [ahora, setAhora] = useState(() => Date.now())

  // En un callback del socket, `alCaducarSesion` podria ser el de un render
  // viejo; con la ref siempre se llama al actual sin reconectar el socket.
  const alCaducarRef = useRef(alCaducarSesion)
  useEffect(() => {
    alCaducarRef.current = alCaducarSesion
  }, [alCaducarSesion])

  const alLlegarRef = useRef(alLlegarComandaNueva)
  useEffect(() => {
    alLlegarRef.current = alLlegarComandaNueva
  }, [alLlegarComandaNueva])

  // El aviso sonoro solo debe sonar por una comanda que ENTRA por el socket, no
  // al recargar ni al reconectar. Para saber si el evento aporta algo nuevo hay
  // que mirar el estado vigente dentro del callback, y el del render en que se
  // suscribio el socket ya estaria viejo: de ahi la ref.
  const estadoRef = useRef(estado)
  useEffect(() => {
    estadoRef.current = estado
  }, [estado])

  /**
   * Pide las comandas y REEMPLAZA el tablero.
   *
   * Se usa en la carga inicial, en cada reconexion y en el boton Reintentar:
   * mientras el socket estuvo caido pudieron pasar cosas que no llegaron, asi
   * que mezclar dejaria comandas fantasma.
   */
  const recargar = useCallback(async () => {
    if (!token) return
    despachar({ tipo: 'cargando' })
    try {
      const comandas = await obtenerComandas(token)
      despachar({ tipo: 'cargar', datos: comandas })
    } catch (error) {
      // Un 401 ya disparo el cierre de sesion en el servicio; aqui solo se
      // muestra el fallo para que el cocinero sepa que la pantalla no esta al dia.
      despachar({ tipo: 'error', datos: error.message })
    }
  }, [token])

  useEffect(() => {
    if (!token) return undefined

    let vivo = true
    const socket = crearSocket(token)

    // Primera carga. La reconexion la encadena el propio evento 'connect'.
    recargar()

    socket.on('connect', () => {
      if (!vivo) return
      setConectado(true)
      // En la primera conexion esto repite la carga de arriba; es una consulta
      // de mas al arrancar, a cambio de que toda reconexion recargue siempre
      // por el mismo camino.
      recargar()
    })

    socket.on('disconnect', () => {
      if (vivo) setConectado(false)
    })

    socket.on('connect_error', (error) => {
      if (!vivo) return
      setConectado(false)
      // Un token invalido no se arregla reintentando: se cierra la sesion.
      if (esErrorDeToken(error)) {
        socket.close()
        alCaducarRef.current?.()
      }
    })

    socket.on('order:created', (evento) => {
      if (!vivo) return

      const actual = estadoRef.current
      const idPedido = evento?.pedido?.id_pedido
      const esNueva =
        idPedido !== undefined &&
        idPedido !== null &&
        !esEventoRepetido(actual, evento?.eventId) &&
        !actual.comandas.some((c) => c.id_pedido === idPedido)

      despachar({ tipo: 'creado', datos: evento })
      if (esNueva) alLlegarRef.current?.(evento)
    })

    socket.on('order:status', (evento) => {
      if (vivo) despachar({ tipo: 'estado', datos: evento })
    })

    return () => {
      vivo = false
      socket.removeAllListeners()
      socket.close()
    }
  }, [token, recargar])

  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), REFRESCO_RELOJ_MS)
    return () => clearInterval(reloj)
  }, [])

  /**
   * Avanza una comanda (PATCH) y mueve la tarjeta en el acto.
   *
   * Devuelve { ok } o { ok: false, mensaje } para que la tarjeta muestre el
   * fallo donde el cocinero lo esta mirando. Si la base rechaza la transicion
   * (trigger), se recarga el tablero: significa que lo que hay en pantalla ya
   * no es lo que hay en la base.
   */
  const avanzar = useCallback(
    async (idPedido, nuevoEstado) => {
      try {
        const comanda = await cambiarEstadoComanda(token, idPedido, nuevoEstado)
        despachar({
          tipo: 'local',
          datos: { id_pedido: idPedido, nuevoEstado: comanda?.estado || nuevoEstado },
        })
        return { ok: true }
      } catch (error) {
        // 401 ya cerro la sesion en el servicio. Para el resto, el tablero se
        // vuelve a leer porque puede estar desincronizado.
        if (error.status !== 401) recargar()
        // Sin status no hubo respuesta: el fetch ni siquiera llego (red caida,
        // backend apagado). Es distinto de un 409 del trigger, y la tarjeta
        // decide cosas distintas con cada uno.
        return {
          ok: false,
          mensaje: error.message || 'No se pudo cambiar el estado',
          sinRespuesta: !error.status,
        }
      }
    },
    [token, recargar]
  )

  return { estado, conectado, ahora, recargar, avanzar }
}
