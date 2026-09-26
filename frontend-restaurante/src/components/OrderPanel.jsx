import { PrimaryButton, GhostButton, LinkButton } from './ui/Button'
import { StateBadge } from './ui/Badge'

export function OrderPanel({ order }) {
  return (
    <div className="panel order-panel">
      <div className="panel-header">
        <h2>Pedido activo</h2>
        <LinkButton>Actualizar</LinkButton>
      </div>

      <div className="order-focus">
        <div className="order-header">
          <div>
            <span className="order-label">Mesa</span>
            <strong>{order.table}</strong>
          </div>
          <StateBadge state={order.state} />
        </div>

        <div className="order-client-row">
          <div>
            <span className="order-label">Cliente</span>
            <strong>{order.client}</strong>
          </div>
          <span className="order-id">{order.id}</span>
        </div>

        <div className="items-list">
          {order.items.map((item) => (
            <div key={`${order.id}-${item.name}`} className="item-row">
              <div className="item-name-block">
                <strong>{item.qty}x</strong>
                <span>{item.name}</span>
              </div>
              <b>{item.subtotal}</b>
            </div>
          ))}
        </div>

        <div className="total-box">
          <span>Total</span>
          <strong>{order.total}</strong>
        </div>

        <div className="order-actions">
          <PrimaryButton className="small">Enviar a cocina</PrimaryButton>
          <GhostButton className="small">Editar</GhostButton>
        </div>
      </div>
    </div>
  )
}
