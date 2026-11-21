import { useState, useEffect, useCallback, useContext, useRef } from 'react'
import { generarTokenQrMesa, rotarTokenQrMesa, liberarMesaRemota, decodificarTokenQr } from '../services/qrService'
import { mesasApi, pedidosApi, getAuthToken } from '../services/api'
import { emitirSonidoAlerta } from '../utils/audio'
import { useSocketListener } from '../hooks'
import { getSocket } from '../hooks/useSocket'
import { crearVentanaEventos } from '../utils/dedupeEventos'
import { mesaDelAviso } from '../utils/avisos'
import { detalleMesa } from '../utils/estadoMesa'
import { aplicarMesaActualizada, fusionarCargaConAvisos, mismaMesa, numeroDeMesa } from '../utils/mesaActualizada'
import { nuevoIdCobro } from '../utils/caja'
import { TablesContext } from './tablesContextDef'
import { AuthContext } from './authContextDef'

const textoMesa = (idMesa) => (idMesa ? `Mesa ${idMesa}` : 'Una mesa sin número')

// mesa:atendida (socket-server/EVENTS.md §4): solo estas alertas se avisan a la
// mesa y a las otras pantallas del panel. El tipo de la alerta es el `tipo` del evento.
const TIPOS_ATENDIDA = ['llamado', 'cuenta']
// Las alertas de waiter:call y bill:requested (eventos viejos) se quitan solo
// en esta pantalla: su mesa puede venir como número y no como id_mesa.
const ORIGEN_HEREDADO = 'heredado'
// Errores del ack que no se arreglan reintentando: la alerta se quita aquí.
const CODIGOS_SIN_REINTENTO = ['NO_AUTORIZADO', 'PAYLOAD_INVALIDO']
const ESPERA_ACK_ATENDIDA_MS = 5000
const esIdMesa = (v) => Number.isInteger(v) && v > 0
const seAvisaALaMesa = (a) => TIPOS_ATENDIDA.includes(a?.tipo) && a.origen !== ORIGEN_HEREDADO && esIdMesa(a.idMesa)
export const AVISO_ATENDIDA_SOLO_AQUI = 'No se pudo avisar a la mesa; la alerta se quitó solo en esta pantalla'
export const AVISO_ATENDIDA_REINTENTAR = 'No se pudo avisar a la mesa: revisa la conexión y vuelve a pulsar «Atendida»'

function normalizarMesa(backendMesa, prev = {}) {
  const id = backendMesa.id_mesa || backendMesa.numero
  const rawEstado = (backendMesa.estado || 'disponible').toLowerCase()
  const estadoCapitalizado = rawEstado.charAt(0).toUpperCase() + rawEstado.slice(1)
  const isOcupada = rawEstado === 'ocupada'

  return {
    id,
    id_mesa: id,
    number: backendMesa.numero || id,
    numero: backendMesa.numero || id,
    name: `Mesa ${backendMesa.numero || id}`,
    status: estadoCapitalizado,
    estado: rawEstado,
    seats: backendMesa.capacidad || 4,
    capacidad: backendMesa.capacidad || 4,
    location: backendMesa.ubicacion || 'Principal',
    ubicacion: backendMesa.ubicacion || 'Principal',
    sesion_abierta: Boolean(backendMesa.sesion_abierta),
    token_qr: prev.token_qr || null,
    qr_url: prev.qr_url || null,
    active: isOcupada,
    detail: detalleMesa(rawEstado, backendMesa.sesion_abierta),
    openedAt: prev.openedAt || null,
    expiresAt: prev.expiresAt || null,
  }
}

export function TablesProvider({ children }) {
  // Sesión del personal. Tolerante a no tener AuthProvider (pruebas que montan
  // solo este contexto): en ese caso se usa el token guardado.
  const tokenSesion = useContext(AuthContext)?.user?.token || null
  const [tables, setTables] = useState(() => {
    try {
      const stored = sessionStorage.getItem('smartdining_tables_state')
      if (stored) return JSON.parse(stored)
    } catch {
      // fallback
    }
    return []
  })

  // Los eventos traen id_mesa; lo que se le muestra a la gente es el NÚMERO.
  // Con mesas de id ≠ número, «Mesa {id}» nombraba otra mesa.
  const tablasRef = useRef(tables)
  useEffect(() => {
    tablasRef.current = tables
  }, [tables])
  const nombreMesa = useCallback((idMesa) => textoMesa(idMesa ? numeroDeMesa(tablasRef.current, idMesa) : null), [])

  const [pedidosActivos, setPedidosActivos] = useState([])
  const [presenciaPorMesa, setPresenciaPorMesa] = useState({})
  const [alertas, setAlertas] = useState([])
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState(null)

  const showNotification = useCallback((mensaje, tipo = 'success') => {
    setNotification({ mensaje, tipo, id: Date.now() })
    setTimeout(() => {
      setNotification((prev) => (prev?.mensaje === mensaje ? null : prev))
    }, 3500)
  }, [])

  const agregarAlerta = useCallback((nuevaAlerta) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 7)
    setAlertas((prev) => [
      {
        id,
        hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        atendida: false,
        ...nuevaAlerta,
        // La bandeja muestra el número, no el id (mesas de id ≠ número).
        ...(nuevaAlerta?.idMesa ? { numeroMesa: numeroDeMesa(tablasRef.current, nuevaAlerta.idMesa) } : {}),
      },
      ...prev,
    ])
  }, [])

  // La alerta vigente al pulsar «Atendida» (el callback no depende de `alertas`).
  const alertasRef = useRef(alertas)
  useEffect(() => {
    alertasRef.current = alertas
  }, [alertas])
  // Alertas con un mesa:atendida esperando su ack: un doble clic emite una vez.
  const atendiendo = useRef(new Set())

  const quitarAlerta = useCallback((idAlerta) => {
    setAlertas((prev) => prev.filter((a) => a.id !== idAlerta))
  }, [])

  const cambiarAlerta = useCallback((idAlerta, cambios) => {
    setAlertas((prev) => prev.map((a) => (a.id === idAlerta ? { ...a, ...cambios } : a)))
  }, [])

  /** Quita las alertas pendientes de esa mesa y ese tipo (no las heredadas: esas son solo locales). */
  const quitarAtendidas = useCallback((idMesa, tipo) => {
    setAlertas((prev) =>
      prev.filter((a) => !(a.tipo === tipo && a.idMesa === idMesa && a.origen !== ORIGEN_HEREDADO))
    )
  }, [])

  /**
   * «Atendida» en la bandeja. Un llamado o una cuenta con id_mesa emite
   * mesa:atendida { eventId, idMesa, tipo } con ack; el resto se quita solo aquí.
   * - ack ok (también duplicado): se quitan las de esa mesa y ese tipo.
   * - NO_AUTORIZADO / PAYLOAD_INVALIDO: no se arregla reintentando; se quita
   *   solo en esta pantalla, con aviso.
   * - ERROR_INTERNO, sin respuesta o sin conexión: la alerta se queda, con
   *   aviso, y el siguiente clic reintenta con el MISMO eventId.
   */
  const atenderAlerta = useCallback((idAlerta) => {
    const alerta = alertasRef.current.find((a) => a.id === idAlerta)
    if (!alerta) return
    if (!seAvisaALaMesa(alerta)) {
      quitarAlerta(idAlerta)
      return
    }
    if (atendiendo.current.has(idAlerta)) return

    const eventId = alerta.eventIdAtendida || nuevoIdCobro()
    const socket = getSocket()
    // Desconectado no se emite: Socket.io lo guardaría y lo mandaría al reconectar.
    if (!socket.connected) {
      cambiarAlerta(idAlerta, { eventIdAtendida: eventId })
      showNotification(AVISO_ATENDIDA_REINTENTAR, 'error')
      return
    }

    atendiendo.current.add(idAlerta)
    cambiarAlerta(idAlerta, { eventIdAtendida: eventId, enviando: true })
    const cuerpo = { eventId, idMesa: alerta.idMesa, tipo: alerta.tipo }
    socket.timeout(ESPERA_ACK_ATENDIDA_MS).emit('mesa:atendida', cuerpo, (err, r) => {
      atendiendo.current.delete(idAlerta)
      if (!err && r?.ok) {
        quitarAtendidas(alerta.idMesa, alerta.tipo)
        return
      }
      if (!err && CODIGOS_SIN_REINTENTO.includes(r?.codigo)) {
        quitarAlerta(idAlerta)
        showNotification(AVISO_ATENDIDA_SOLO_AQUI, 'error')
        return
      }
      cambiarAlerta(idAlerta, { enviando: false })
      showNotification(AVISO_ATENDIDA_REINTENTAR, 'error')
    })
  }, [quitarAlerta, cambiarAlerta, quitarAtendidas, showNotification])

  const limpiarAlertas = useCallback(() => {
    setAlertas([])
  }, [])


  // Guardar estado persistente en el navegador
  useEffect(() => {
    try {
      sessionStorage.setItem('smartdining_tables_state', JSON.stringify(tables))
    } catch {
      // ignorar
    }
  }, [tables])

  // Cargas de GET /api/mesas en curso: cada una anota las mesas que reciben un
  // mesa:actualizada MIENTRAS se pide, para que la respuesta (más vieja) no las
  // pise (revisión de Roberto en el #278).
  const cargasEnCurso = useRef(new Set())

  /**
   * Carga las mesas desde el backend real: GET /api/mesas
   */
  const cargarMesas = useCallback(async () => {
    const token = getAuthToken()
    if (!token) {
      setNotification({
        type: 'warning',
        message: 'Inicia sesión para ver las mesas',
      })
      return
    }

    setLoading(true)
    const avisadas = new Map()
    cargasEnCurso.current.add(avisadas)
    try {
      const data = await mesasApi.listar()
      if (data?.mesas && Array.isArray(data.mesas)) {
        setTables((prevTables) => fusionarCargaConAvisos(prevTables, data.mesas, avisadas, normalizarMesa))
      }
    } catch (err) {
      console.warn('Aviso: no se pudieron cargar las mesas desde el backend:', err.message)
    } finally {
      cargasEnCurso.current.delete(avisadas)
      setLoading(false)
    }
  }, [])

  /**
   * Carga los pedidos activos desde el backend real: GET /api/pedidos/activos
   */
  const cargarPedidosActivos = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    try {
      const data = await pedidosApi.listarActivos()
      if (data?.pedidos && Array.isArray(data.pedidos)) {
        setPedidosActivos(data.pedidos)
      }
    } catch (err) {
      console.warn('Aviso: no se pudieron cargar los pedidos activos:', err.message)
    }
  }, [])

  // Cargar mesas y pedidos al montar y CADA VEZ que cambia la sesión. Este
  // proveedor se monta también en /login, sin token: si solo cargara al montar,
  // tras iniciar sesión el salón quedaría vacío hasta recargar la página.
  useEffect(() => {
    let isSubscribed = true
    const token = tokenSesion || getAuthToken()
    if (!token) return

    const fetchInitialData = async () => {
      try {
        const [mesasRes, pedidosRes] = await Promise.allSettled([
          // El token va explícito: este efecto (hijo) corre ANTES que el de
          // AuthProvider que lo guarda en sessionStorage, así que getAuthToken()
          // todavía no lo tiene y la petición saldría sin sesión (401).
          mesasApi.listar({ token }),
          pedidosApi.listarActivos({ token }),
        ])
        if (!isSubscribed) return

        if (mesasRes.status === 'fulfilled' && mesasRes.value?.mesas) {
          setTables((prevTables) => {
            const prevMap = new Map(prevTables.map((t) => [t.id, t]))
            return mesasRes.value.mesas.map((m) =>
              normalizarMesa(m, prevMap.get(m.id_mesa) || prevMap.get(m.numero) || {})
            )
          })
        }
        if (pedidosRes.status === 'fulfilled' && pedidosRes.value?.pedidos) {
          setPedidosActivos(pedidosRes.value.pedidos)
        }
      } catch {
        // error manejado
      }
    }

    fetchInitialData()

    return () => {
      isSubscribed = false
    }
  }, [tokenSesion])


  // order:created y order:status pueden llegar repetidos si el servidor
  // reintenta (EVENTS.md §5): un eventId ya visto se ignora entero, sin repetir
  // la notificación ni el sonido. Una ventana por tipo, de los últimos 200.
  const [createdVisto] = useState(() => crearVentanaEventos())
  const [statusVisto] = useState(() => crearVentanaEventos())
  const [mesaVista] = useState(() => crearVentanaEventos())
  const [atendidaVista] = useState(() => crearVentanaEventos())

  // Escuchar cuando entra un pedido nuevo (order:created)
  useSocketListener('order:created', (data) => {
    if (createdVisto(data?.eventId)) return
    if (data?.pedido) {
      const p = data.pedido
      const idMesa = Number(p.id_mesa)
      setPedidosActivos((prev) => {
        const existe = prev.some((item) => item.id_pedido === p.id_pedido)
        if (existe) {
          return prev.map((item) => (item.id_pedido === p.id_pedido ? { ...item, ...p } : item))
        }
        return [p, ...prev]
      })

      // Marcar la mesa como ocupada y activa en el plano
      setTables((prev) =>
        prev.map((t) =>
          mismaMesa(t, idMesa)
            ? {
                ...t,
                status: 'Ocupada',
                estado: 'ocupada',
                active: true,
                detail: `Comanda ${p.codigo_pedido || `#${p.id_pedido}`} · En cocina`,
              }
            : t
        )
      )
      showNotification(`Nuevo pedido recibido: ${p.codigo_pedido || `#${p.id_pedido}`} (${nombreMesa(idMesa)})`, 'info')
    }
  })

  // Escuchar cambio de estado de pedido (order:status)
  useSocketListener('order:status', (data) => {
    if (statusVisto(data?.eventId)) return
    if (data?.id_pedido) {
      const idPedido = Number(data.id_pedido)
      const nuevoEstado = data.estado
      setPedidosActivos((prev) =>
        prev
          .map((p) => (p.id_pedido === idPedido ? { ...p, estado: nuevoEstado } : p))
          .filter((p) => p.estado !== 'cancelado')
      )

      if (nuevoEstado === 'listo') {
        agregarAlerta({
          tipo: 'pedido_listo',
          idMesa: data.id_mesa,
          mensaje: `Pedido ${data.codigo_pedido || `#${idPedido}`} listo en cocina para servir`,
        })
        emitirSonidoAlerta()
        showNotification(
          `🍽️ ¡Pedido ${data.codigo_pedido || `#${idPedido}`} LISTO para servir (${nombreMesa(data.id_mesa)})!`,
          'success'
        )
      } else if (nuevoEstado === 'entregado') {
        showNotification(
          `Pedido ${data.codigo_pedido || `#${idPedido}`} entregado a los comensales`,
          'info'
        )
      }
    }
  })

  // Escuchar confirmación de pago (payment:confirmed)
  useSocketListener('payment:confirmed', (data) => {
    if (data?.id_mesa) {
      const montoFormateado = Number(data.monto || 0).toLocaleString('es-CO')
      agregarAlerta({
        tipo: 'pago',
        idMesa: data.id_mesa,
        mensaje: `Pago confirmado por $${montoFormateado} (${nombreMesa(data.id_mesa)})`,
      })
      emitirSonidoAlerta()
      showNotification(`💰 Pago confirmado de $${montoFormateado} para ${nombreMesa(data.id_mesa)}`, 'success')
      cargarMesas()
      cargarPedidosActivos()
    }
  })

  // Escuchar llamado al mesero (mesa:llamar_mesero / waiter:call)
  useSocketListener('mesa:llamar_mesero', (data) => {
    const idMesa = mesaDelAviso(data)
    if (!idMesa) console.warn('[alertas] aviso sin número de mesa:', data)
    agregarAlerta({
      tipo: 'llamado',
      idMesa,
      mensaje: data?.motivo || `Comensal solicita asistencia urgente en mesa`,
    })
    emitirSonidoAlerta()
    showNotification(`🔔 ${nombreMesa(idMesa)} llama al mesero`, 'info')
  })

  useSocketListener('waiter:call', (data) => {
    const idMesa = mesaDelAviso(data)
    if (!idMesa) console.warn('[alertas] aviso sin número de mesa:', data)
    agregarAlerta({
      tipo: 'llamado',
      origen: ORIGEN_HEREDADO,
      idMesa,
      mensaje: data?.motivo || `Comensal solicita asistencia en mesa`,
    })
    emitirSonidoAlerta()
    showNotification(`🔔 ${nombreMesa(idMesa)} llama al mesero`, 'info')
  })

  // Escuchar solicitud de cuenta (cuenta:solicitada / bill:requested)
  useSocketListener('cuenta:solicitada', (data) => {
    const idMesa = mesaDelAviso(data)
    if (!idMesa) console.warn('[alertas] aviso sin número de mesa:', data)
    agregarAlerta({
      tipo: 'cuenta',
      idMesa,
      mensaje: `Comensales solicitan la cuenta y factura`,
    })
    emitirSonidoAlerta()
    showNotification(`🧾 ${nombreMesa(idMesa)} solicita la cuenta`, 'info')
  })

  // mesa:atendida (EVENTS.md §4): alguien del personal, en esta pantalla o en
  // otra, marcó «Atendida» un llamado o una cuenta. Se quitan sin recargar las
  // alertas pendientes de ESA mesa y ESE tipo. Llega también a quien lo emitió:
  // un eventId ya visto se ignora.
  useSocketListener('mesa:atendida', (data) => {
    if (atendidaVista(data?.eventId)) return
    const idMesa = Number(data?.id_mesa)
    if (!esIdMesa(idMesa) || !TIPOS_ATENDIDA.includes(data?.tipo)) return
    quitarAtendidas(idMesa, data.tipo)
  })

  useSocketListener('bill:requested', (data) => {
    const idMesa = mesaDelAviso(data)
    if (!idMesa) console.warn('[alertas] aviso sin número de mesa:', data)
    agregarAlerta({
      tipo: 'cuenta',
      origen: ORIGEN_HEREDADO,
      idMesa,
      mensaje: `Comensales solicitan la cuenta y factura`,
    })
    emitirSonidoAlerta()
    showNotification(`🧾 ${nombreMesa(idMesa)} solicita la cuenta`, 'info')
  })



  // Presencia ACTUAL de todas las mesas en cada conexión (también tras iniciar
  // sesión, recargar o reconectar): mesa:presencia:solicitar (EVENTS.md §5.2,
  // #175) la devuelve en el ack, sin depender de que los listeners ya estén
  // registrados. Es una foto completa: una mesa que no viene tiene 0. Si falla
  // (RATE_LIMIT, ERROR_INTERNO o un socket-server viejo sin el evento), queda el
  // envío automático del socket-server y los avisos de abajo.
  useEffect(() => {
    const socket = getSocket()
    const pedirPresencia = () => {
      socket.timeout(5000).emit('mesa:presencia:solicitar', {}, (err, r) => {
        if (err || !r?.ok || !Array.isArray(r.mesas)) return
        setPresenciaPorMesa(Object.fromEntries(r.mesas.map((p) => [Number(p.id_mesa), p])))
      })
    }
    if (socket.connected) pedirPresencia()
    socket.on('connect', pedirPresencia)
    return () => socket.off('connect', pedirPresencia)
  }, [])

  // T12 (EVENTS.md §5.7): el backend avisa cada cambio de mesa (abrir, estado,
  // crear, editar, liberar, borrar) con mesa:actualizada, solo a room:admin.
  // La lista de mesas, el admin y la Caja la ven sin recargar. Un eventId
  // repetido se ignora (ventana de los últimos 200).
  useSocketListener('mesa:actualizada', (data) => {
    if (mesaVista(data?.eventId)) return
    const id = Number(data?.id_mesa)
    if (Number.isInteger(id) && id > 0) {
      for (const avisadas of cargasEnCurso.current) avisadas.set(id, data.motivo === 'eliminada' ? 'eliminada' : 'actualizada')
    }
    setTables((prev) => aplicarMesaActualizada(prev, data, normalizarMesa))
  })

  // Al RECONECTAR se vuelven a pedir las mesas: desde #239 los avisos que se
  // perdieron sin conexión no se reenvían. Se marca el corte (disconnect) y se
  // recarga en el connect que le sigue; la primera conexión no la necesita (las
  // mesas se cargan al montar).
  const huboCorte = useRef(false)
  useSocketListener('disconnect', () => {
    huboCorte.current = true
  })
  useSocketListener('connect', () => {
    if (!huboCorte.current) return
    huboCorte.current = false
    cargarMesas()
  })

  // Escuchar presencia de comensales en vivo (room:admin recibe cambios de todas las mesas).
  // Guardarla en el contexto evita perderla al cerrar y volver a abrir "Tomar pedido".
  useSocketListener('mesa:presencia', (data) => {
    if (data && data.id_mesa != null) {
      const numId = Number(data.id_mesa)
      setPresenciaPorMesa((prev) => ({
        ...prev,
        [numId]: data,
      }))
    }
  })

  // Escuchar si el backend o socket-server avisa de una mesa liberada (evento canónico mesa:liberada)
  const onMesaLiberada = (data) => {
    if (data?.id_mesa) {
      const numId = Number(data.id_mesa)
      setPresenciaPorMesa((prev) => {
        if (!prev[numId]) return prev
        const copia = { ...prev }
        delete copia[numId]
        return copia
      })
      setTables((prev) =>
        prev.map((t) =>
          mismaMesa(t, numId)
            ? {
                ...t,
                status: 'Disponible',
                estado: 'disponible',
                token_qr: null,
                qr_url: null,
                sesion_abierta: false,
                active: false,
                detail: 'Lista para asignar',
              }
            : t
        )
      )
      showNotification(`${nombreMesa(numId)} liberada por el sistema`, 'info')
    }
  }

  useSocketListener('mesa:liberada', onMesaLiberada)
  useSocketListener('table:released', onMesaLiberada)

  // Escuchar cuando el backend o trigger rota el token QR (evento de Roberto 'qr:actualizado')
  useSocketListener('qr:actualizado', (data) => {
    if (data?.id_mesa && data?.token_qr) {
      const numId = Number(data.id_mesa)
      setTables((prev) =>
        prev.map((t) =>
          mismaMesa(t, numId)
            ? {
                ...t,
                token_qr: data.token_qr,
                status: 'Ocupada',
                estado: 'ocupada',
                sesion_abierta: true,
                detail: 'QR sincronizado en vivo por el servidor',
                actualizadoEn: data.emitidoEn || new Date().toISOString(),
              }
            : t
        )
      )
      showNotification(`${nombreMesa(numId)}: Código QR actualizado en vivo`, 'info')
    }
  })

  /**
   * Abre una mesa libre, genera el token QR dinámico v1 y la marca como 'Ocupada'.
   * Llama a POST /api/mesas/:id/abrir a través de qrService.
   */
  const abrirMesa = useCallback(async (idMesa, ttlMinutos = 240) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => mismaMesa(t, numId))
    const tableName = tableActual?.name || `Mesa ${numId}`

    try {
      const qrResult = await generarTokenQrMesa(numId, ttlMinutos)
      const sidCorto = qrResult.sid ? qrResult.sid.slice(0, 8) : 'activo'

      setTables((prev) =>
        prev.map((t) => {
          if (mismaMesa(t, numId)) {
            return {
              ...t,
              status: 'Ocupada',
              estado: 'ocupada',
              token_qr: qrResult.token,
              qr_url: qrResult.url,
              sesion_abierta: true,
              active: true,
              detail: `Sesión ${sidCorto} · Esperando comanda`,
              openedAt: qrResult.emitido_en,
              expiresAt: qrResult.expira_en,
            }
          }
          return t
        })
      )

      showNotification(`${tableName} abierta. Código QR dinámico generado con éxito.`, 'success')
      return qrResult
    } catch (err) {
      showNotification(err.message || `No se pudo abrir ${tableName}`, 'error')
      throw err
    }
  }, [tables, showNotification])

  /**
   * Libera una mesa (automática o manual para grupos que se van sin pedir),
   * revocando el QR a través del backend oficial: POST /api/mesas/:id/liberar.
   */
  const liberarMesa = useCallback(async (idMesa) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => mismaMesa(t, numId))
    const tableName = tableActual?.name || `Mesa ${numId}`

    try {
      await liberarMesaRemota(numId)

      setPresenciaPorMesa((prev) => {
        if (!prev[numId]) return prev
        const copia = { ...prev }
        delete copia[numId]
        return copia
      })

      setTables((prev) =>
        prev.map((t) => {
          if (mismaMesa(t, numId)) {
            return {
              ...t,
              status: 'Disponible',
              estado: 'disponible',
              token_qr: null,
              qr_url: null,
              sesion_abierta: false,
              active: false,
              detail: 'Lista para asignar',
              openedAt: null,
              expiresAt: null,
            }
          }
          return t
        })
      )

      showNotification(`${tableName} ha sido liberada. El QR previo ha sido revocado.`, 'info')
      return { ok: true }
    } catch (err) {
      showNotification(err.message || `No se pudo liberar ${tableName}`, 'error')
      throw err
    }
  }, [tables, showNotification])

  /**
   * Regenera el token QR de una mesa en curso (rotación de seguridad).
   */
  // `silencioso`: la renovación automática del modal (cada ~3 min) no avisa con
  // un toast ni en el éxito ni en el error; el modal muestra su propio estado.
  const regenerarQr = useCallback(async (idMesa, ttlMinutos = 240, { silencioso = false, soloSiVacia = false } = {}) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => mismaMesa(t, numId))
    const tableName = tableActual?.name || `Mesa ${numId}`

    try {
      const qrResult = await rotarTokenQrMesa(numId, ttlMinutos, { soloSiVacia })
      const sidCorto = qrResult.sid ? qrResult.sid.slice(0, 8) : 'rotado'

      setTables((prev) =>
        prev.map((t) => {
          if (mismaMesa(t, numId)) {
            return {
              ...t,
              token_qr: qrResult.token,
              qr_url: qrResult.url,
              detail: `Sesión rotada (${sidCorto})`,
              expiresAt: qrResult.expira_en,
            }
          }
          return t
        })
      )

      if (!silencioso) showNotification(`QR regenerado para ${tableName}. Sesión actualizada.`, 'success')
      return qrResult
    } catch (err) {
      if (!silencioso) showNotification(err.message || `Error al rotar QR en ${tableName}`, 'error')
      throw err
    }
  }, [tables, showNotification])

  const marcarEntregado = useCallback(async (idPedido) => {
    try {
      const res = await pedidosApi.actualizarEstado(idPedido, 'entregado')
      setPedidosActivos((prev) =>
        prev.map((p) => (p.id_pedido === idPedido ? { ...p, estado: 'entregado' } : p))
      )
      showNotification(`Pedido #${idPedido} marcado como entregado a los comensales`, 'success')
      return res
    } catch (err) {
      showNotification(err.message || 'Error al actualizar estado del pedido', 'error')
      throw err
    }
  }, [showNotification])

  const obtenerInfoSesion = useCallback((token) => {
    return decodificarTokenQr(token)
  }, [])

  return (
    <TablesContext.Provider
      value={{
        tables,
        pedidosActivos,
        presenciaPorMesa,
        alertas,
        loading,
        notification,
        cargarMesas,
        cargarPedidosActivos,
        marcarEntregado,
        atenderAlerta,
        limpiarAlertas,
        abrirMesa,
        liberarMesa,
        regenerarQr,
        obtenerInfoSesion,
        showNotification,
      }}
    >
      {children}
    </TablesContext.Provider>

  )
}

