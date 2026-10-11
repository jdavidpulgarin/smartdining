import { useState, useEffect, useCallback } from 'react'
import { tables as defaultTables } from '../constants/mockData'
import { generarTokenQrMesa, liberarMesaRemota, decodificarTokenQr } from '../services/qrService'
import { mesasApi, getAuthToken } from '../services/api'
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
      const stored = localStorage.getItem('smartdining_tables_state')
      if (stored) return JSON.parse(stored)
    } catch {
      // fallback
    }
    return defaultTables
  })

  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState(null)

  const showNotification = useCallback((mensaje, tipo = 'success') => {
    setNotification({ mensaje, tipo, id: Date.now() })
    setTimeout(() => {
      setNotification((prev) => (prev?.mensaje === mensaje ? null : prev))
    }, 3500)
  }, [])

  // Guardar estado persistente en el navegador
  useEffect(() => {
    try {
      localStorage.setItem('smartdining_tables_state', JSON.stringify(tables))
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

  // Cargar mesas al montar si hay token
  useEffect(() => {
    let activo = true
    const token = getAuthToken()
    if (token) {
      mesasApi
        .listar()
        .then((data) => {
          if (activo && data?.mesas && Array.isArray(data.mesas)) {
            setTables((prevTables) => {
              const prevMap = new Map(prevTables.map((t) => [t.id, t]))
              return data.mesas.map((m) =>
                normalizarMesa(m, prevMap.get(m.id_mesa) || prevMap.get(m.numero) || {})
              )
            })
          }
        })
        .catch((err) => {
          console.warn('Aviso: error inicial cargando mesas:', err.message)
        })
    }
    return () => {
      activo = false
    }
  }, [])

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
      const qrResult = await generarTokenQrMesa(numId, ttlMinutos)
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

  const obtenerInfoSesion = useCallback((token) => {
    return decodificarTokenQr(token)
  }, [])

  return (
    <TablesContext.Provider
      value={{
        tables,
        loading,
        notification,
        cargarMesas,
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
