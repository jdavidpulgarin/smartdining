import { useState, useEffect, useCallback } from 'react'
import { generarTokenQrMesa, rotarTokenQrMesa, liberarMesaRemota, decodificarTokenQr } from '../services/qrService'
import { mesasApi, pedidosApi, getAuthToken } from '../services/api'
import { emitirSonidoAlerta } from '../utils/audio'
import { useSocketListener } from '../hooks'
import { TablesContext } from './tablesContextDef'

function normalizarMesa(backendMesa, prev = {}) {
  const id = backendMesa.id_mesa || backendMesa.numero
  const rawEstado = (backendMesa.estado || 'disponible').toLowerCase()
  const estadoCapitalizado = rawEstado.charAt(0).toUpperCase() + rawEstado.slice(1)
  const isOcupada = rawEstado === 'ocupada'
  const isDisponible = rawEstado === 'disponible'

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
    detail: isDisponible
      ? 'Lista para asignar'
      : isOcupada
        ? (backendMesa.sesion_abierta ? 'Sesión activa · QR generado' : 'Ocupada')
        : 'Reservada',
    openedAt: prev.openedAt || null,
    expiresAt: prev.expiresAt || null,
  }
}

export function TablesProvider({ children }) {
  const [tables, setTables] = useState(() => {
    try {
      const stored = sessionStorage.getItem('smartdining_tables_state')
      if (stored) return JSON.parse(stored)
    } catch {
      // fallback
    }
    return []
  })

  const [pedidosActivos, setPedidosActivos] = useState([])
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
      },
      ...prev,
    ])
  }, [])

  const atenderAlerta = useCallback((idAlerta) => {
    setAlertas((prev) => prev.filter((a) => a.id !== idAlerta))
  }, [])

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

  /**
   * Carga las mesas desde el backend real: GET /api/mesas
   */
  const cargarMesas = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    setLoading(true)
    try {
      const data = await mesasApi.listar()
      if (data?.mesas && Array.isArray(data.mesas)) {
        setTables((prevTables) => {
          const prevMap = new Map(prevTables.map((t) => [t.id, t]))
          return data.mesas.map((m) =>
            normalizarMesa(m, prevMap.get(m.id_mesa) || prevMap.get(m.numero) || {})
          )
        })
      }
    } catch (err) {
      console.warn('Aviso: no se pudieron cargar las mesas desde el backend:', err.message)
    } finally {
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

  // Cargar mesas y pedidos al montar de forma asíncrona si hay sesión activa
  useEffect(() => {
    let isSubscribed = true
    const token = getAuthToken()
    if (!token) return

    const fetchInitialData = async () => {
      try {
        const [mesasRes, pedidosRes] = await Promise.allSettled([
          mesasApi.listar(),
          pedidosApi.listarActivos(),
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
  }, [])


  // Escuchar cuando entra un pedido nuevo (order:created)
  useSocketListener('order:created', (data) => {
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
          t.id === idMesa || t.number === idMesa
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
      showNotification(`Nuevo pedido recibido: ${p.codigo_pedido || `#${p.id_pedido}`} (Mesa ${idMesa})`, 'info')
    }
  })

  // Escuchar cambio de estado de pedido (order:status)
  useSocketListener('order:status', (data) => {
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
          `🍽️ ¡Pedido ${data.codigo_pedido || `#${idPedido}`} LISTO para servir (Mesa ${data.id_mesa})!`,
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
        mensaje: `Pago confirmado por $${montoFormateado} (Mesa ${data.id_mesa})`,
      })
      emitirSonidoAlerta()
      showNotification(`💰 Pago confirmado de $${montoFormateado} para Mesa ${data.id_mesa}`, 'success')
      cargarMesas()
      cargarPedidosActivos()
    }
  })

  // Escuchar llamado al mesero (mesa:llamar_mesero / waiter:call)
  useSocketListener('mesa:llamar_mesero', (data) => {
    const idMesa = Number(data?.id_mesa || data?.mesa || 1)
    agregarAlerta({
      tipo: 'llamado',
      idMesa,
      mensaje: data?.motivo || `Comensal solicita asistencia urgente en mesa`,
    })
    emitirSonidoAlerta()
    showNotification(`🔔 Mesa ${idMesa} llama al mesero`, 'info')
  })

  useSocketListener('waiter:call', (data) => {
    const idMesa = Number(data?.id_mesa || data?.mesa || 1)
    agregarAlerta({
      tipo: 'llamado',
      idMesa,
      mensaje: data?.motivo || `Comensal solicita asistencia en mesa`,
    })
    emitirSonidoAlerta()
    showNotification(`🔔 Mesa ${idMesa} llama al mesero`, 'info')
  })

  // Escuchar solicitud de cuenta (cuenta:solicitada / bill:requested)
  useSocketListener('cuenta:solicitada', (data) => {
    const idMesa = Number(data?.id_mesa || data?.mesa || 1)
    agregarAlerta({
      tipo: 'cuenta',
      idMesa,
      mensaje: `Comensales solicitan la cuenta y factura`,
    })
    emitirSonidoAlerta()
    showNotification(`🧾 Mesa ${idMesa} solicita la cuenta`, 'info')
  })

  useSocketListener('bill:requested', (data) => {
    const idMesa = Number(data?.id_mesa || data?.mesa || 1)
    agregarAlerta({
      tipo: 'cuenta',
      idMesa,
      mensaje: `Comensales solicitan la cuenta y factura`,
    })
    emitirSonidoAlerta()
    showNotification(`🧾 Mesa ${idMesa} solicita la cuenta`, 'info')
  })



  // Escuchar si el backend o socket-server avisa de una mesa liberada
  useSocketListener('table:released', (data) => {
    if (data?.id_mesa) {
      const numId = Number(data.id_mesa)
      setTables((prev) =>
        prev.map((t) =>
          t.id === numId || t.number === numId
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
      showNotification(`Mesa ${numId} liberada por el sistema`, 'info')
    }
  })

  // Escuchar cuando el backend o trigger rota el token QR (evento de Roberto 'qr:actualizado')
  useSocketListener('qr:actualizado', (data) => {
    if (data?.id_mesa && data?.token_qr) {
      const numId = Number(data.id_mesa)
      setTables((prev) =>
        prev.map((t) =>
          t.id === numId || t.number === numId
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
      showNotification(`Mesa ${numId}: Código QR actualizado en vivo`, 'info')
    }
  })

  /**
   * Abre una mesa libre, genera el token QR dinámico v1 y la marca como 'Ocupada'.
   * Llama a POST /api/mesas/:id/abrir a través de qrService.
   */
  const abrirMesa = useCallback(async (idMesa, ttlMinutos = 240) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => t.id === numId || t.number === numId)
    const tableName = tableActual?.name || `Mesa ${numId}`

    try {
      const qrResult = await generarTokenQrMesa(numId, ttlMinutos)
      const sidCorto = qrResult.sid ? qrResult.sid.slice(0, 8) : 'activo'

      setTables((prev) =>
        prev.map((t) => {
          if (t.id === numId || t.number === numId) {
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
    const tableActual = tables.find((t) => t.id === numId || t.number === numId)
    const tableName = tableActual?.name || `Mesa ${numId}`

    try {
      await liberarMesaRemota(numId)

      setTables((prev) =>
        prev.map((t) => {
          if (t.id === numId || t.number === numId) {
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
  const regenerarQr = useCallback(async (idMesa, ttlMinutos = 240) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => t.id === numId || t.number === numId)
    const tableName = tableActual?.name || `Mesa ${numId}`

    try {
      const qrResult = await rotarTokenQrMesa(numId, ttlMinutos)
      const sidCorto = qrResult.sid ? qrResult.sid.slice(0, 8) : 'rotado'

      setTables((prev) =>
        prev.map((t) => {
          if (t.id === numId || t.number === numId) {
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

      showNotification(`QR regenerado para ${tableName}. Sesión actualizada.`, 'success')
      return qrResult
    } catch (err) {
      showNotification(err.message || `Error al rotar QR en ${tableName}`, 'error')
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

