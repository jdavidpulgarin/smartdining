import { Utensils, CheckCircle2, Flame, User, Clock, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StateBadge } from './ui/Badge'

export function OrderPanel({ order }) {
  if (!order) {
    return (
      <div className="panel order-panel empty-selection">
        <div className="panel-header">
          <h2>Comanda Activa</h2>
        </div>
        <div className="order-empty-prompt">
          <Utensils size={42} className="text-muted" />
          <h3>Sin comanda seleccionada</h3>
          <p>Selecciona una mesa ocupada en el plano para monitorear sus platos en cocina o gestionar su consumo.</p>
          <Link to="/mesas" className="primary-button small inline-flex-center">
            <span>Ver Mapa de Mesas</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="panel order-panel">
      <div className="panel-header">
        <div className="panel-title-with-badge">
          <h2>Comanda en Curso</h2>
          <span className="live-pulse-badge">En Vivo</span>
        </div>
        <span className="order-id-badge font-mono">{order.id}</span>
      </div>

      <div className="order-focus">
        {/* Mesa & Estado */}
        <div className="order-header-card">
          <div className="order-mesa-block">
            <span className="order-label">Mesa Seleccionada</span>
            <strong className="order-table-name">{order.table}</strong>
          </div>
          <StateBadge state={order.state} />
        </div>

        {/* Cliente & Hora */}
        <div className="order-client-row">
          <div className="client-chip">
            <User size={13} className="text-muted" />
            <span>{order.client}</span>
          </div>
          <div className="time-chip">
            <Clock size={13} className="text-muted" />
            <span>{order.time || '12:45'}</span>
          </div>
        </div>

        {/* Lista de Platos */}
        <div className="order-items-wrapper">
          <span className="items-section-title">Ítems ordenados ({order.items.length})</span>
          <div className="items-list">
            {order.items.map((item, idx) => (
              <div key={`${order.id}-${item.name}-${idx}`} className="item-row">
                <div className="item-name-block">
                  <span className="item-qty-tag">x{item.qty}</span>
                  <div>
                    <span className="item-title-text">{item.name}</span>
                    {item.notes && (
                      <span className="item-sub-note">{item.notes}</span>
                    )}
                  </div>
                </div>
                <strong className="item-price-tag">{item.subtotal}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Total a Pagar */}
        <div className="total-box">
          <div>
            <span className="total-label-dim">Consumo Acumulado</span>
            <strong className="total-value-glow">{order.total}</strong>
          </div>
          <span className="tax-hint">IVA incluido</span>
        </div>

        {/* Acciones Rápidas */}
        <div className="order-actions">
          <Link to="/caja" className="primary-button small flex-1 text-center">
            <CheckCircle2 size={15} />
            <span>Cobrar en Caja</span>
          </Link>
          <Link to="/pedidos" className="ghost-button small text-center">
            <Flame size={15} />
            <span>KDS Cocina</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
