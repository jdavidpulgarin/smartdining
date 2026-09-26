export function OrderPanel({ order }) {
  return (
    <div className="panel order-panel">
      <div className="panel-header">
        <h2>Pedido activo</h2>
        <button className="link-button">Actualizar</button>
      </div>

      <div className="order-focus">
        <div className="order-header">
          <div>
            <span className="order-label">Mesa</span>
            <strong>{order.table}</strong>
          </div>
          <span className="order-state">{order.state}</span>
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
          <button className="primary-button small">Enviar a cocina</button>
          <button className="ghost-button small">Editar</button>
        </div>
      </div>
    </div>
  )
}
