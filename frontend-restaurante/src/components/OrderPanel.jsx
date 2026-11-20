import { Utensils, CheckCircle2, Flame, User, Clock, ArrowRight } from 'lucide-react'
import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { StateBadge } from './ui/Badge'
import { AuthContext } from '../context/authContextDef'
import { puedeUsarCaja } from '../utils/caja'

export function OrderPanel({ order, onDeliver }) {
  // Sin AuthProvider (algunas pruebas) no hay rol: el enlace a Caja no se muestra.
  const rol = useContext(AuthContext)?.user?.rol
  if (!order) {
    return (
      <div className="panel order-panel empty-selection t plano ms-order-ticket">
        <div className="panel-header banda ms-order-band">
          <h2>Comanda Activa</h2>
        </div>
        <div className="order-empty-prompt ms-empty-prompt">
          <Utensils size={42} className="text-muted" />
          <h3>Sin comanda seleccionada</h3>
          <p>Selecciona una mesa ocupada en el plano para monitorear sus platos en cocina o gestionar su consumo.</p>
          <Link to="/mesas" className="btn-mapa-mesas btn claro ms-btn">
            <span>Ver Mapa de Mesas</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  const isListo = order.state?.toLowerCase() === 'listo'

  return (
    <div className="panel order-panel t plano ms-order-ticket">
      <div className="panel-header banda ms-order-band">
        <div className="panel-title-with-badge">
          <h2>Comanda en Curso</h2>
          <span className="live-pulse-badge">En Vivo</span>
        </div>
        <span className="order-id-badge font-mono">{order.id}</span>
      </div>

      <div className="order-focus ms-order-body">
        {/* Mesa & Estado */}
        <div className="order-header-card ms-mesa-card">
          <div className="order-mesa-block">
            <span className="order-label ms-order-label">Mesa Seleccionada</span>
            <strong className="order-table-name ms-table-name">{order.table}</strong>
          </div>
          <StateBadge state={order.state} />
        </div>

        {/* Cliente & Hora */}
        <div className="order-client-row ms-meta-row">
          <div className="client-chip ms-client-chip">
            <User size={13} className="text-muted" />
            <span>{order.client}</span>
          </div>
          <div className="time-chip ms-time-chip">
            <Clock size={13} className="text-muted" />
            <span>{order.time || '12:45'}</span>
          </div>
        </div>

        <div className="corte ms-corte" />

        {/* Lista de Platos */}
        <div className="order-items-wrapper ms-items-wrapper">
          <span className="items-section-title ms-items-title">Ítems ordenados ({order.items?.length || 0})</span>
          <div className="items-list ms-items-list">
            {(order.items || []).map((item, idx) => (
              <div key={`${order.id}-${item.name}-${idx}`} className="item-row ms-item-row">
                <div className="item-name-block ms-item-name">
                  <span className="item-qty-tag ms-qty">x{item.qty}</span>
                  <div>
                    <span className="item-title-text ms-item-title">{item.name}</span>
                    {item.notes && (
                      <span className="item-sub-note ms-item-note">{item.notes}</span>
                    )}
                  </div>
                </div>
                <strong className="item-price-tag ms-item-price">{item.subtotal}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="corte ms-corte" />

        {/* Total a Pagar */}
        <div className="total-box ms-total-box">
          <div>
            <span className="total-label-dim ms-total-label">Consumo Acumulado</span>
            <strong className="total-value-glow ms-total-value">{order.total}</strong>
          </div>
          <span className="tax-hint ms-tax-hint">IVA incluido</span>
        </div>

        {/* Acciones Rápidas */}
        <div className="order-actions ms-order-actions">
          {isListo && onDeliver && (
            <button
              type="button"
              className="primary-button small flex-1 text-center btn-entregar-order btn urg ms-btn-urg"
              onClick={() => onDeliver(order.id_pedido || order.id)}
            >
              <CheckCircle2 size={15} />
              <span>Marcar Entregado</span>
            </button>
          )}

          {puedeUsarCaja(rol) && (
            <Link to="/caja" className="ghost-button small flex-1 text-center btn claro ms-btn-caja">
              <span>Cobrar en Caja</span>
            </Link>
          )}
          <Link to="/pedidos" className="ghost-button small text-center btn claro ms-btn-kds">
            <Flame size={15} />
            <span>KDS Cocina</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

