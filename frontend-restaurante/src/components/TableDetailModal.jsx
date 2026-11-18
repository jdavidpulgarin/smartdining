import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X,
  CheckCircle2,
  Receipt,
  Utensils,
  QrCode,
  LogOut,
  ArrowRight,
  UserCheck,
  AlertTriangle,
} from 'lucide-react'

import { StateBadge, StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'
import { useNavigate } from 'react-router-dom'
import { useAuth, useSocket } from '../hooks'
import { mesasApi } from '../services/api'
import { puedeUsarCaja, mesaConSesionActiva, EVENTOS_QUE_CAMBIAN_LA_CUENTA } from '../utils/caja'
import { crearUltimaPeticion } from '../utils/ultimaPeticion'
import {
  resumenDetalleMesa,
  avisoDeEstaMesa,
  AVISO_PAGADA_SIN_ENTREGAR,
} from '../utils/detalleMesa'

export function TableDetailModal({
  table,
  pedidos = [],
  onClose,
  onOpenQR,
  onFreeTable,
  onDeliverOrder,
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const userRole = (user?.rol || user?.role || '').toLowerCase()
  const canTakeOrder = userRole === 'mesero' || userRole === 'admin'

  const idMesa = Number(table?.id_mesa ?? table?.id)
  const tableName = table?.name || `Mesa ${idMesa}`
  const tableStatus = (table?.status || table?.estado || 'Disponible').toLowerCase()
  const isOcupada = tableStatus === 'ocupada'

  // Decodificar token de sesión para extraer sid
  const sesionInfo = table?.token_qr ? decodificarTokenQr(table.token_qr) : null
  const sid = sesionInfo?.sid && sesionInfo.sid !== 'N/A' ? sesionInfo.sid.slice(0, 8) : null

  // Consumo, pagado, saldo, reparto y comandas: GET /mesas/:id/cuenta, como la
  // Caja (utils/detalleMesa.js). Solo se pide con una visita en curso: para una
  // mesa libre la cuenta sería la del grupo anterior.
  const conSesion = mesaConSesionActiva(table)
  const [cuenta, setCuenta] = useState(null)
  const [errorCuenta, setErrorCuenta] = useState(null)
  const [ultimaCarga] = useState(() => crearUltimaPeticion())

  const cargarCuenta = useCallback(async () => {
    const peticion = ultimaCarga.nueva()
    if (!conSesion || !Number.isInteger(idMesa) || idMesa <= 0) {
      setCuenta(null)
      setErrorCuenta(null)
      return
    }
    try {
      const datos = await mesasApi.obtenerCuenta(idMesa)
      if (!peticion.vigente()) return
      setCuenta(datos || null)
      setErrorCuenta(null)
    } catch {
      if (!peticion.vigente()) return
      setErrorCuenta('No se pudo cargar la cuenta de la mesa.')
    }
  }, [conSesion, idMesa, ultimaCarga])

  // Al abrir (en la microtarea siguiente, como la Caja) y al cambiar de mesa o
  // de estado. Al cerrar, lo que esté en vuelo se descarta.
  useEffect(() => {
    let montado = true
    Promise.resolve().then(() => {
      if (montado) cargarCuenta()
    })
    return () => {
      montado = false
      ultimaCarga.invalidar()
    }
  }, [cargarCuenta, ultimaCarga])

  // En vivo: los mismos eventos con los que la Caja recarga sus cuentas.
  const socket = useSocket()
  useEffect(() => {
    if (!socket) return undefined
    const alAviso = (data) => {
      if (avisoDeEstaMesa(data, idMesa)) cargarCuenta()
    }
    EVENTOS_QUE_CAMBIAN_LA_CUENTA.forEach((ev) => socket.on(ev, alAviso))
    return () => {
      EVENTOS_QUE_CAMBIAN_LA_CUENTA.forEach((ev) => socket.off(ev, alAviso))
    }
  }, [socket, idMesa, cargarCuenta])

  const resumen = useMemo(
    () => resumenDetalleMesa({ mesa: table, cuenta, pedidosPanel: pedidos }),
    [table, cuenta, pedidos]
  )
  const pedidosMesa = resumen.comandas
  // Con visita en curso pero sin cuenta todavía (cargando o error): sin cifras.
  const sinCifras = resumen.conSesion && !cuenta

  const formatearDinero = (monto) => {
    return `$${Number(monto || 0).toLocaleString('es-CO')}`
  }
  const cifra = (monto) => (sinCifras ? '—' : formatearDinero(monto))

  return (
    <div className="qr-modal-backdrop" onClick={onClose}>
      <div
        className="qr-modal-card table-detail-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '680px', width: '92%' }}
      >
        {/* Encabezado */}
        <div className="table-detail-header">
          <div className="table-detail-header-left">
            <div className="table-detail-title-row">
              <div className="table-badge-large">#{table?.numero ?? table?.number ?? idMesa}</div>
              <h2 className="table-detail-title">{tableName}</h2>
            </div>
            <div className="table-detail-subtitle-row">
              <StatusBadge status={table?.status || table?.estado || 'Disponible'} />
              <span className="table-detail-meta">
                Zona {table?.location || table?.ubicacion || 'Principal'} · Capacidad {table?.seats || table?.capacidad || 4}
              </span>
              {sid && (
                <span className="table-detail-sid">
                  · sid: {sid}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="table-detail-close-btn"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tarjetas de Métricas de Mesa */}
        <div className="table-detail-metrics-grid">
          <div className="table-metric-card">
            <span className="table-metric-caption">Consumo Mesa</span>
            <strong className="table-metric-value">
              {cifra(resumen.total)}
            </strong>
            <span className="table-metric-subtext">
              {resumen.total > 0 ? `${resumen.items} ítems ordenados` : 'Sin consumo'}
            </span>
          </div>

          <div className="table-metric-card">
            <span className="table-metric-caption">Comensales</span>
            <strong className="table-metric-value">
              {resumen.comensales.length > 0 ? resumen.comensales.length : (resumen.conSesion ? '1+' : '0')}
            </strong>
            <span className="table-metric-subtext">
              {resumen.conSesion ? 'Grupo activo' : 'Mesa libre'}
            </span>
          </div>

          <div className="table-metric-card table-metric-card-saldo">
            <span className="table-metric-caption-saldo">Saldo Pendiente</span>
            <strong className="table-metric-value">
              {cifra(resumen.saldo)}
            </strong>
            <span className="table-metric-subtext">
              {resumen.pagado > 0 ? `Pagado ${formatearDinero(resumen.pagado)}` : 'Por liquidar en caja'}
            </span>
          </div>
        </div>

        {errorCuenta && (
          <div role="alert" className="table-detail-empty-box" style={{ marginBottom: '12px' }}>
            {errorCuenta}
          </div>
        )}

        {resumen.pagadaSinEntregar && (
          <div
            role="status"
            className="table-detail-empty-box"
            style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', borderColor: 'var(--sd-gold)' }}
          >
            <AlertTriangle size={16} style={{ color: 'var(--sd-gold)', flexShrink: 0 }} />
            <span>{AVISO_PAGADA_SIN_ENTREGAR}</span>
          </div>
        )}

        {/* Desglose de Comensales (si hay consumos) */}
        {resumen.comensales.length > 0 && (
          <div className="detail-section-block" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <UserCheck size={16} style={{ color: 'var(--sd-red)' }} />
              <h3 style={{ fontSize: '0.9rem', color: '#f1f5f9', margin: 0 }}>
                Cuenta Dividida por Comensal
              </h3>
            </div>
            <div className="comensales-cards-wrap" style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '160px',
              overflowY: 'auto',
            }}>
              {resumen.comensales.map((c) => (
                <div
                  key={c.nombre}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <div>
                    <strong style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{c.nombre}</strong>
                    <span style={{ color: 'var(--sd-text-muted)', fontSize: '0.75rem', marginLeft: '8px' }}>
                      ({c.items} {c.items === 1 ? 'ítem' : 'ítems'})
                    </span>
                  </div>
                  <span style={{ textAlign: 'right' }}>
                    <strong style={{ color: 'var(--sd-text)', fontSize: '0.9rem' }}>
                      {formatearDinero(c.subtotal)}
                    </strong>
                    <span style={{ display: 'block', color: 'var(--sd-text-muted)', fontSize: '0.72rem' }}>
                      {c.saldo > 0 ? `Saldo ${formatearDinero(c.saldo)}` : 'Pagado'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pedidos Activos de la Mesa */}
        <div className="detail-section-block" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Utensils size={16} style={{ color: 'var(--sd-red)' }} />
              <h3 style={{ fontSize: '0.9rem', color: '#f1f5f9', margin: 0 }}>
                Comandas en Curso ({pedidosMesa.length})
              </h3>
            </div>
          </div>

          {pedidosMesa.length > 0 ? (
            <div className="orders-cards-list" style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              maxHeight: '220px',
              overflowY: 'auto',
            }}>
              {pedidosMesa.map((ped) => {
                const isListo = ped.estado?.toLowerCase() === 'listo'
                return (
                  <div
                    key={ped.id_pedido || ped.codigo_pedido}
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: isListo
                        ? '1px solid var(--sd-gold)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ color: '#f8fafc', fontSize: '0.85rem' }}>
                          {ped.codigo_pedido || `#${ped.id_pedido}`}
                        </strong>
                        <StateBadge state={ped.estado} />
                      </div>
                      <strong style={{ color: 'var(--sd-text)', fontSize: '0.9rem' }}>
                        {formatearDinero(ped.total)}
                      </strong>
                    </div>

                    {/* Platos del pedido */}
                    <div style={{ fontSize: '0.78rem', color: 'var(--sd-text-muted)' }}>
                      {(ped.detalles || ped.items || []).map((it, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                          <span>
                            {it.cantidad}x {it.plato_nombre || it.nombre || 'Plato'}{' '}
                            {it.comensal ? `(${it.comensal})` : ''}
                          </span>
                          <span>{formatearDinero(it.subtotal || it.precio_unitario * it.cantidad)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Botón Marcar Entregado si está listo */}
                    {isListo && onDeliverOrder && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <button
                          type="button"
                          className="primary-button small"
                          onClick={() => onDeliverOrder(ped.id_pedido)}
                          style={{
                            background: 'var(--sd-red)',
                            padding: '6px 12px',
                            fontSize: '0.75rem',
                          }}
                        >
                          <CheckCircle2 size={13} />
                          <span>Marcar Entregado</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="table-detail-empty-box">
              {resumen.conSesion && sinCifras
                ? (errorCuenta ? 'Sin datos de la cuenta.' : 'Cargando cuenta…')
                : resumen.conSesion
                ? 'Sin consumo. Sesión abierta esperando comandas de los comensales.'
                : 'Sin consumo. Mesa libre.'}
            </div>
          )}
        </div>

        {/* Barra de Acciones de Mesa */}
        <div className="table-detail-modal-footer">
          {onOpenQR && (
            <button
              type="button"
              className="table-btn-secondary"
              onClick={() => {
                onClose()
                onOpenQR(table)
              }}
            >
              <QrCode size={18} />
              <span>{isOcupada ? 'Ver / Rotar QR' : 'Abrir Mesa'}</span>
            </button>
          )}

          {isOcupada && canTakeOrder && (
            <button
              type="button"
              className="table-btn-primary"
              style={{ background: 'var(--sd-red)', borderColor: 'var(--sd-red)' }}
              onClick={() => {
                onClose()
                navigate(`/mesas/${idMesa}/tomar-pedido`)
              }}
            >
              <Utensils size={18} />
              <span>Tomar Pedido</span>
              <ArrowRight size={16} />
            </button>
          )}

          {isOcupada && puedeUsarCaja(userRole) && (
            <button
              type="button"
              className="table-btn-secondary"
              onClick={() => {
                onClose()
                navigate(`/caja?mesa=${idMesa}`)
              }}
            >
              <Receipt size={18} />
              <span>Cobrar en Caja</span>
              <ArrowRight size={16} />
            </button>
          )}

          {isOcupada && onFreeTable && (
            <button
              type="button"
              className="table-btn-danger"
              onClick={() => {
                if (window.confirm(`¿Liberar ${tableName}? Se revocará el QR de la sesión.`)) {
                  onFreeTable(idMesa)
                  onClose()
                }
              }}
            >
              <LogOut size={16} />
              <span>Liberar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
