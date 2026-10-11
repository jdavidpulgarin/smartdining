import { useMemo } from 'react'
import {
  X,
  Users,
  CheckCircle2,
  Receipt,
  Utensils,
  QrCode,
  LogOut,
  MapPin,
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
        <div className="qr-modal-header">
          <div className="table-modal-title-row">
            <div className="table-badge-large">#{idMesa}</div>
            <div>
              <div className="modal-title-with-pill">
                <h2 className="qr-modal-title">{tableName}</h2>
                <StatusBadge status={table?.status || table?.estado} />
              </div>
              <span className="qr-modal-subtitle">
                <MapPin size={12} className="inline-icon" /> Zona {table?.location || table?.ubicacion || 'Principal'} ·{' '}
                <Users size={12} className="inline-icon" /> Capacidad {table?.seats || table?.capacidad || 4} comensales
                {sid && (
                  <span style={{ marginLeft: '8px', color: 'var(--emerald-400, #34d399)' }}>
                    · sid: {sid}
                  </span>
                )}
              </span>

            </div>
          </div>

          <button
            type="button"
            className="qr-modal-close-btn"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tarjetas de Métricas de Mesa */}
        <div className="table-detail-metrics-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          margin: '16px 0',
        }}>
          <div className="metric-glass-card" style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '12px 14px',
          }}>
            <span className="metric-caption" style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
              Consumo Mesa
            </span>
            <strong style={{ fontSize: '1.25rem', color: '#f8fafc', display: 'block', marginTop: '4px' }}>
              {formatearDinero(resumenFinanciero.totalConsumido)}
            </strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--emerald-400, #34d399)' }}>
              {resumenFinanciero.totalItems} ítems ordenados
            </span>
          </div>

          <div className="metric-glass-card" style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '12px 14px',
          }}>
            <span className="metric-caption" style={{ fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
              Comensales
            </span>
            <strong style={{ fontSize: '1.25rem', color: '#f8fafc', display: 'block', marginTop: '4px' }}>
              {resumenFinanciero.comensales.length > 0 ? resumenFinanciero.comensales.length : (isOcupada ? '1+' : '0')}
            </strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)' }}>
              {isOcupada ? 'Grupo activo' : 'Mesa libre'}
            </span>
          </div>

          <div className="metric-glass-card" style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '12px',
            padding: '12px 14px',
          }}>
            <span className="metric-caption" style={{ fontSize: '0.75rem', color: 'var(--emerald-400, #34d399)', display: 'block' }}>
              Saldo Pendiente
            </span>
            <strong style={{ fontSize: '1.25rem', color: 'var(--emerald-300, #6ee7b7)', display: 'block', marginTop: '4px' }}>
              {formatearDinero(resumenFinanciero.saldo)}
            </strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)' }}>
              Por liquidar en caja
            </span>
          </div>
        </div>

        {/* Desglose de Comensales (si hay consumos) */}
        {resumenFinanciero.comensales.length > 0 && (
          <div className="detail-section-block" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <UserCheck size={16} className="text-emerald" />
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
                    <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.75rem', marginLeft: '8px' }}>
                      ({c.itemsCount} {c.itemsCount === 1 ? 'ítem' : 'ítems'})
                    </span>
                  </div>
                  <strong style={{ color: 'var(--emerald-400, #34d399)', fontSize: '0.9rem' }}>
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
              <Utensils size={16} className="text-emerald" />
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
                        ? '1px solid rgba(16, 185, 129, 0.5)'
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
                      <strong style={{ color: 'var(--emerald-400, #34d399)', fontSize: '0.9rem' }}>
                        {formatearDinero(ped.total)}
                      </strong>
                    </div>

                    {/* Platos del pedido */}
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>
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
                            background: 'var(--emerald-600, #059669)',
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
            <div style={{
              textAlign: 'center',
              padding: '18px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.02)',
              color: 'var(--text-muted, #94a3b8)',
              fontSize: '0.85rem',
            }}>
              {isOcupada
                ? 'Sesión abierta esperando comandas de los comensales.'
                : 'Mesa libre. No hay pedidos registrados.'}
            </div>
          )}
        </div>

        {/* Barra de Acciones de Mesa */}
        <div className="table-detail-modal-footer" style={{
          display: 'flex',
          gap: '10px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          paddingTop: '16px',
        }}>
          {onOpenQR && (
            <button
              type="button"
              className="ghost-button small flex-1"
              onClick={() => {
                onClose()
                onOpenQR(table)
              }}
            >
              <QrCode size={15} />
              <span>{isOcupada ? 'Ver / Rotar QR' : 'Abrir Mesa'}</span>
            </button>
          )}

          {isOcupada && (
            <button
              type="button"
              className="primary-button small flex-1"
              onClick={() => {
                onClose()
                navigate(`/caja?mesa=${idMesa}`)
              }}
            >
              <Receipt size={15} />
              <span>Cobrar en Caja</span>
              <ArrowRight size={13} />
            </button>
          )}

          {isOcupada && onFreeTable && (
            <button
              type="button"
              className="ghost-button small"
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              onClick={() => {
                if (window.confirm(`¿Liberar ${tableName}? Se revocará el QR de la sesión.`)) {
                  onFreeTable(idMesa)
                  onClose()
                }
              }}
            >
              <LogOut size={14} />
              <span>Liberar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
