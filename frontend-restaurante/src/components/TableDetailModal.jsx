import { useMemo } from 'react'
import {
  X,
  CheckCircle2,
  Receipt,
  Utensils,
  QrCode,
  LogOut,
  ArrowRight,
  UserCheck,
} from 'lucide-react'

import { StateBadge, StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'
import { useNavigate } from 'react-router-dom'

export function TableDetailModal({
  table,
  pedidos = [],
  onClose,
  onOpenQR,
  onFreeTable,
  onDeliverOrder,
}) {
  const navigate = useNavigate()

  const idMesa = Number(table?.id || table?.number)
  const tableName = table?.name || `Mesa ${idMesa}`
  const tableStatus = (table?.status || table?.estado || 'Disponible').toLowerCase()
  const isOcupada = tableStatus === 'ocupada'

  // Decodificar token de sesión para extraer sid
  const sesionInfo = table?.token_qr ? decodificarTokenQr(table.token_qr) : null
  const sid = sesionInfo?.sid && sesionInfo.sid !== 'N/A' ? sesionInfo.sid.slice(0, 8) : null

  // Filtrar pedidos activos de esta mesa
  const pedidosMesa = useMemo(() => {
    return (pedidos || []).filter(
      (p) => Number(p.id_mesa) === idMesa && p.estado !== 'cancelado'
    )
  }, [pedidos, idMesa])

  // Desglose financiero y comensales
  const resumenFinanciero = useMemo(() => {
    let totalConsumido = 0
    let totalItems = 0
    const comensalesMap = new Map()

    pedidosMesa.forEach((pedido) => {
      const items = pedido.detalles || pedido.items || []
      const totalPed = Number(pedido.total || 0)
      totalConsumido += totalPed

      items.forEach((item) => {
        const nombreComensal = (item.comensal || 'General').trim()
        const cant = Number(item.cantidad || 1)
        const subtotal = Number(item.subtotal || item.precio_unitario * cant || 0)
        totalItems += cant

        if (!comensalesMap.has(nombreComensal)) {
          comensalesMap.set(nombreComensal, {
            nombre: nombreComensal,
            itemsCount: 0,
            subtotal: 0,
            items: [],
          })
        }

        const com = comensalesMap.get(nombreComensal)
        com.itemsCount += cant
        com.subtotal += subtotal
        com.items.push(item)
      })
    })

    const pagado = 0 // Los cobros en sala se liquidan en /caja
    const saldo = Math.max(0, totalConsumido - pagado)

    return {
      totalConsumido,
      totalItems,
      pagado,
      saldo,
      comensales: Array.from(comensalesMap.values()),
    }
  }, [pedidosMesa])

  const formatearDinero = (monto) => {
    return `$${Number(monto || 0).toLocaleString('es-CO')}`
  }

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
              <div className="table-badge-large">#{idMesa}</div>
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
              {formatearDinero(resumenFinanciero.totalConsumido)}
            </strong>
            <span className="table-metric-subtext">
              {resumenFinanciero.totalItems} ítems ordenados
            </span>
          </div>

          <div className="table-metric-card">
            <span className="table-metric-caption">Comensales</span>
            <strong className="table-metric-value">
              {resumenFinanciero.comensales.length > 0 ? resumenFinanciero.comensales.length : (isOcupada ? '1+' : '0')}
            </strong>
            <span className="table-metric-subtext">
              {isOcupada ? 'Grupo activo' : 'Mesa libre'}
            </span>
          </div>

          <div className="table-metric-card table-metric-card-saldo">
            <span className="table-metric-caption-saldo">Saldo Pendiente</span>
            <strong className="table-metric-value">
              {formatearDinero(resumenFinanciero.saldo)}
            </strong>
            <span className="table-metric-subtext">
              Por liquidar en caja
            </span>
          </div>
        </div>

        {/* Desglose de Comensales (si hay consumos) */}
        {resumenFinanciero.comensales.length > 0 && (
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
              {resumenFinanciero.comensales.map((c) => (
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
                      ({c.itemsCount} {c.itemsCount === 1 ? 'ítem' : 'ítems'})
                    </span>
                  </div>
                  <strong style={{ color: 'var(--sd-text)', fontSize: '0.9rem' }}>
                    {formatearDinero(c.subtotal)}
                  </strong>
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
              {isOcupada
                ? 'Sesión abierta esperando comandas de los comensales.'
                : 'Mesa libre. No hay pedidos registrados.'}
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

          {isOcupada && (
            <button
              type="button"
              className="table-btn-primary"
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
