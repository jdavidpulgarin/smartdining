import { useState } from 'react'
import {
  UtensilsCrossed,
  Clock,
  Flame,
  BellRing,
  CheckCircle2,
  Search,
  X,
  ChefHat,
  Timer,
  FileText,
  User,
  AlertCircle,
} from 'lucide-react'
import { orders as initialOrders } from '../constants/mockData'
import { useSocketListener, useSocketEmit } from '../hooks'

export function Pedidos() {
  const [ordersList, setOrdersList] = useState(initialOrders)
  const [selectedStatus, setSelectedStatus] = useState('Todos')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const emit = useSocketEmit()

  const showToast = (msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3500)
  }

  // Escuchar eventos en vivo desde el socket-server / backend
  useSocketListener('order:status', (data) => {
    console.log('📦 Estado de pedido recibido vía Socket:', data)
    if (data?.id_pedido) {
      setOrdersList((prev) =>
        prev.map((ord) =>
          ord.id === data.id_pedido
            ? { ...ord, state: data.estado || ord.state }
            : ord
        )
      )
      showToast(`Pedido ${data.id_pedido} cambió a: ${data.estado}`)
    }
  })

  useSocketListener('order:new', (newOrder) => {
    console.log('🔔 Nuevo pedido comensal recibido:', newOrder)
    setOrdersList((prev) => [newOrder, ...prev])
    showToast(`¡Nuevo pedido comensal en ${newOrder.table}!`)
  })

  // Avanzar estado de comanda
  const handleAdvanceStatus = (orderId, currentState) => {
    let nextState = 'En cocina'
    if (currentState === 'Pendiente') nextState = 'En cocina'
    else if (currentState === 'En cocina') nextState = 'Por servir'
    else if (currentState === 'Por servir') nextState = 'Entregado'
    else return

    setOrdersList((prev) =>
      prev.map((ord) =>
        ord.id === orderId ? { ...ord, state: nextState } : ord
      )
    )

    emit('order:status_update', {
      id_pedido: orderId,
      estado: nextState,
      timestamp: new Date().toISOString(),
    })

    showToast(`Comanda ${orderId} actualizada a "${nextState}"`)
  }

  // Filtrado
  const filteredOrders = ordersList.filter((ord) => {
    const matchesStatus =
      selectedStatus === 'Todos' ||
      ord.state.toLowerCase() === selectedStatus.toLowerCase()

    const matchesSearch =
      ord.table.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.id.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesStatus && matchesSearch
  })

  // Conteo de métricas
  const totalActivas = ordersList.filter((o) => o.state !== 'Entregado').length
  const pendientesCount = ordersList.filter((o) => o.state === 'Pendiente').length
  const enCocinaCount = ordersList.filter((o) => o.state === 'En cocina').length
  const porServirCount = ordersList.filter((o) => o.state === 'Por servir').length

  const getUrgencyClass = (min) => {
    if (!min) return 'urgency-low'
    if (min > 15) return 'urgency-high'
    if (min > 10) return 'urgency-mid'
    return 'urgency-low'
  }

  return (
    <main className="main-panel pedidos-page">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="table-toast-banner info">
          <BellRing size={16} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Banner de KPIs en Vivo */}
      <section className="pedidos-kpi-strip">
        <div className="pedidos-kpi-card">
          <div className="kpi-icon-badge blue">
            <UtensilsCrossed size={18} />
          </div>
          <div>
            <span className="kpi-label">Comandas Activas</span>
            <strong className="kpi-number">{totalActivas}</strong>
          </div>
        </div>

        <div className="pedidos-kpi-card">
          <div className="kpi-icon-badge amber">
            <Clock size={18} />
          </div>
          <div>
            <span className="kpi-label">Pendientes de Cocina</span>
            <strong className="kpi-number text-amber">{pendientesCount}</strong>
          </div>
        </div>

        <div className="pedidos-kpi-card">
          <div className="kpi-icon-badge flame-color">
            <Flame size={18} />
          </div>
          <div>
            <span className="kpi-label">En Preparación (KDS)</span>
            <strong className="kpi-number text-orange">{enCocinaCount}</strong>
          </div>
        </div>

        <div className="pedidos-kpi-card">
          <div className="kpi-icon-badge green">
            <BellRing size={18} />
          </div>
          <div>
            <span className="kpi-label">Listas para Servir</span>
            <strong className="kpi-number text-emerald">{porServirCount}</strong>
          </div>
        </div>
      </section>

      {/* Barra de Filtros y Búsqueda */}
      <section className="panel pedidos-filter-panel">
        <div className="pedidos-filter-row">
          <div className="status-tabs-strip">
            <button
              type="button"
              className={`status-tab-btn ${selectedStatus === 'Todos' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Todos')}
            >
              <span>Todas</span>
              <span className="tab-pill-count">{ordersList.length}</span>
            </button>
            <button
              type="button"
              className={`status-tab-btn ${selectedStatus === 'Pendiente' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Pendiente')}
            >
              <Clock size={14} />
              <span>Pendientes</span>
              <span className="tab-pill-count">{pendientesCount}</span>
            </button>
            <button
              type="button"
              className={`status-tab-btn ${selectedStatus === 'En cocina' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('En cocina')}
            >
              <Flame size={14} />
              <span>En Cocina</span>
              <span className="tab-pill-count">{enCocinaCount}</span>
            </button>
            <button
              type="button"
              className={`status-tab-btn ${selectedStatus === 'Por servir' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Por servir')}
            >
              <BellRing size={14} />
              <span>Por Servir</span>
              <span className="tab-pill-count">{porServirCount}</span>
            </button>
            <button
              type="button"
              className={`status-tab-btn ${selectedStatus === 'Entregado' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Entregado')}
            >
              <CheckCircle2 size={14} />
              <span>Entregadas</span>
            </button>
          </div>

          <div className="pedidos-search-wrap">
            <Search size={15} />
            <input
              type="text"
              placeholder="Buscar comanda por mesa, cliente o ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Grid de Comandas KDS */}
      <section className="pedidos-grid-layout">
        {filteredOrders.length === 0 ? (
          <div className="panel empty-kds-panel">
            <ChefHat size={46} className="text-muted" />
            <h3>No hay comandas que coincidan</h3>
            <p>No se encontraron comandas con el filtro "{selectedStatus}".</p>
          </div>
        ) : (
          <div className="kds-cards-grid">
            {filteredOrders.map((order) => {
              const urgency = getUrgencyClass(order.elapsedMin)
              const isDelivered = order.state.toLowerCase() === 'entregado'

              return (
                <div
                  key={order.id}
                  className={`kds-order-card state-${order.state.toLowerCase().replace(' ', '-')}`}
                  onClick={() => setSelectedOrder(order)}
                >
                  {/* Header de la Tarjeta */}
                  <div className="kds-card-top">
                    <div className="table-badge-group">
                      <span className="kds-table-badge">{order.table}</span>
                      <span className="kds-order-id font-mono">{order.id}</span>
                    </div>

                    <div className={`elapsed-timer-chip ${urgency}`}>
                      <Timer size={13} />
                      <span>{order.elapsedMin ? `${order.elapsedMin}m` : 'Nuevo'}</span>
                    </div>
                  </div>

                  {/* Comensal & Mesero */}
                  <div className="kds-meta-strip">
                    <span>
                      <User size={12} /> {order.client}
                    </span>
                    {order.waiter && (
                      <span className="waiter-name">Atiende: {order.waiter}</span>
                    )}
                  </div>

                  {/* Lista de Ítems */}
                  <div className="kds-items-container">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="kds-item-line">
                        <div className="item-qty-name">
                          <span className="kds-qty-badge">x{item.qty}</span>
                          <span className="kds-item-name">{item.name}</span>
                        </div>
                        {item.notes && (
                          <span className="kds-item-notes">
                            <AlertCircle size={11} /> {item.notes}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Footer & Acciones KDS */}
                  <div className="kds-card-footer">
                    <div className="kds-total-box">
                      <span className="total-label">Total</span>
                      <strong className="total-val">{order.total}</strong>
                    </div>

                    <div className="kds-action-btn-wrap">
                      {!isDelivered ? (
                        <button
                          type="button"
                          className="kds-advance-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAdvanceStatus(order.id, order.state)
                          }}
                        >
                          {order.state === 'Pendiente' && (
                            <>
                              <Flame size={14} />
                              <span>A Cocina</span>
                            </>
                          )}
                          {order.state === 'En cocina' && (
                            <>
                              <BellRing size={14} />
                              <span>Marcar Listo</span>
                            </>
                          )}
                          {order.state === 'Por servir' && (
                            <>
                              <CheckCircle2 size={14} />
                              <span>Entregar</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="kds-delivered-tag">
                          <CheckCircle2 size={13} /> Servido
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Modal de Detalle de Comanda */}
      {selectedOrder && (
        <div className="modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="modal-card kds-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <div className="modal-icon-badge">
                  <FileText size={20} />
                </div>
                <div>
                  <h3>Detalle de Comanda {selectedOrder.id}</h3>
                  <p className="modal-subtitle">
                    {selectedOrder.table} · {selectedOrder.client} · Registrado a las {selectedOrder.time}
                  </p>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setSelectedOrder(null)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="kds-modal-items">
                <h4>Ítems solicitados por la mesa:</h4>
                <div className="modal-items-list">
                  {selectedOrder.items.map((it, i) => (
                    <div key={i} className="modal-item-row">
                      <div className="modal-item-info">
                        <strong>{it.qty}x {it.name}</strong>
                        {it.notes && (
                          <span className="item-note-tag">Nota: {it.notes}</span>
                        )}
                      </div>
                      <span className="item-sub-amount">{it.subtotal}</span>
                    </div>
                  ))}
                </div>

                <div className="modal-total-summary">
                  <span>Importe Comanda:</span>
                  <strong>{selectedOrder.total}</strong>
                </div>
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => window.print()}
                >
                  Imprimir Comanda Cocina
                </button>
                {selectedOrder.state !== 'Entregado' && (
                  <button
                    type="button"
                    className="primary-button small"
                    onClick={() => {
                      handleAdvanceStatus(selectedOrder.id, selectedOrder.state)
                      setSelectedOrder(null)
                    }}
                  >
                    Avanzar Estado ({selectedOrder.state})
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
