import { useState, useEffect, useCallback } from 'react'
import { tables as defaultTables } from '../constants/mockData'
import { generarTokenQrMesa, liberarMesaRemota, decodificarTokenQr } from '../services/qrService'
import { useSocketListener } from '../hooks'
import { TablesContext } from './tablesContextDef'

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

  const [notification, setNotification] = useState(null)

  // Guardar estado persistente en el navegador
  useEffect(() => {
    try {
      localStorage.setItem('smartdining_tables_state', JSON.stringify(tables))
    } catch {
      // ignorar
    }
  }, [tables])

  const showNotification = useCallback((mensaje, tipo = 'success') => {
    setNotification({ mensaje, tipo, id: Date.now() })
    setTimeout(() => {
      setNotification((prev) => (prev?.mensaje === mensaje ? null : prev))
    }, 3500)
  }, [])

  // Escuchar si el backend o socket-server avisa de una mesa liberada
  useSocketListener('table:released', (data) => {
    if (data?.id_mesa) {
      setTables((prev) =>
        prev.map((t) =>
          t.id === Number(data.id_mesa) || t.number === Number(data.id_mesa)
            ? { ...t, status: 'Disponible', token_qr: null, active: false, detail: 'Lista para asignar' }
            : t
        )
      )
      showNotification(`Mesa ${data.id_mesa} liberada por el sistema`, 'info')
    }
  })

  /**
   * Abre una mesa libre, genera el token QR dinámico v1 y la marca como 'Ocupada'.
   */
  const abrirMesa = useCallback(async (idMesa, ttlMinutos = 240) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => t.id === numId || t.number === numId)
    const tableName = tableActual?.name || `Mesa ${numId}`

    const qrResult = await generarTokenQrMesa(numId, ttlMinutos)
    const sidCorto = qrResult.sid ? qrResult.sid.slice(0, 8) : 'activo'

    setTables((prev) =>
      prev.map((t) => {
        if (t.id === numId || t.number === numId) {
          return {
            ...t,
            status: 'Ocupada',
            token_qr: qrResult.token,
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
  }, [tables, showNotification])

  /**
   * Libera una mesa (automática o manual para grupos que se van sin pedir),
   * revocando el QR y limpiando el token a NULL.
   */
  const liberarMesa = useCallback(async (idMesa) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => t.id === numId || t.number === numId)
    const tableName = tableActual?.name || `Mesa ${numId}`

    // Llamar a los servidores (backend / socket-server)
    await liberarMesaRemota(numId)

    setTables((prev) =>
      prev.map((t) => {
        if (t.id === numId || t.number === numId) {
          return {
            ...t,
            status: 'Disponible',
            token_qr: null,
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
  }, [tables, showNotification])

  /**
   * Regenera el token QR de una mesa en curso (rotación de seguridad).
   */
  const regenerarQr = useCallback(async (idMesa, ttlMinutos = 240) => {
    const numId = Number(idMesa)
    const tableActual = tables.find((t) => t.id === numId || t.number === numId)
    const tableName = tableActual?.name || `Mesa ${numId}`

    const qrResult = await generarTokenQrMesa(numId, ttlMinutos)
    const sidCorto = qrResult.sid ? qrResult.sid.slice(0, 8) : 'rotado'

    setTables((prev) =>
      prev.map((t) => {
        if (t.id === numId || t.number === numId) {
          return {
            ...t,
            token_qr: qrResult.token,
            detail: `Sesión rotada (${sidCorto})`,
            expiresAt: qrResult.expira_en,
          }
        }
        return t
      })
    )

    showNotification(`QR regenerado para ${tableName}. Sesión actualizada.`, 'success')
    return qrResult
  }, [tables, showNotification])

  const obtenerInfoSesion = useCallback((token) => {
    return decodificarTokenQr(token)
  }, [])

  return (
    <TablesContext.Provider
      value={{
        tables,
        notification,
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
