import { useState } from 'react'
import {
  CreditCard,
  DollarSign,
  Smartphone,
  Receipt,
  CheckCircle2,
  Printer,
  X,
  Clock,
  User,
  Sparkles,
} from 'lucide-react'
import { orders as initialOrders } from '../constants/mockData'
import { useSocketEmit } from '../hooks'

function generateTrxId() {
  return `TRX-${Math.floor(1000 + Math.random() * 9000)}`
}

function generateRef() {
  return 'POS-AUTO-' + Date.now().toString().slice(-4)
}

function getCurrentTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Caja() {
  const emit = useSocketEmit()
  const [ordersList, setOrdersList] = useState(initialOrders)
  const [selectedOrderId, setSelectedOrderId] = useState(ordersList[0]?.id || '')
  const [includeTip, setIncludeTip] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [cashGiven, setCashGiven] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [paidReceipt, setPaidReceipt] = useState(null)
  const [activeTab, setActiveTab] = useState('pendientes') // 'pendientes' | 'historial'

  const [history, setHistory] = useState([
    {
      id_transaccion: 'TRX-9821',
      id_pedido: '#1039',
      mesa: 'Mesa 1',
      cliente: 'Carlos Méndez',
      metodo_pago: 'tarjeta_credito',
      monto: 64.0,
      hora: '12:15',
      estado: 'completada',
    },
    {
      id_transaccion: 'TRX-9820',
      id_pedido: '#1038',
      mesa: 'Mesa 4',
      cliente: 'Elena Gómez',
      metodo_pago: 'transferencia',
      monto: 42.5,
      hora: '11:50',
      estado: 'completada',
    },
  ])

  const selectedOrder = ordersList.find((o) => o.id === selectedOrderId)

  // Cálculos financieros
  const calculateFinancials = (order) => {
    if (!order) return { subtotal: 0, tax: 0, tip: 0, total: 0 }
    const itemsTotal = order.items.reduce((acc, item) => {
      const price = parseFloat(item.subtotal.replace('$', '')) || 0
      return acc + price
    }, 0)

    const subtotal = Math.round(itemsTotal * 100) / 100
    const tax = Math.round(subtotal * 0.08 * 100) / 100 // 8% Impoconsumo
    const tip = includeTip ? Math.round(subtotal * 0.1 * 100) / 100 : 0 // 10% voluntaria
    const total = Math.round((subtotal + tax + tip) * 100) / 100

    return { subtotal, tax, tip, total }
  }

  const financials = calculateFinancials(selectedOrder)
  const numericCash = parseFloat(cashGiven) || 0
  const changeDue = Math.max(0, numericCash - financials.total)

  const handleProcessPayment = (e) => {
    e.preventDefault()
    if (!selectedOrder) return

    if (paymentMethod === 'efectivo' && numericCash < financials.total) {
      alert(`El efectivo recibido ($${numericCash.toFixed(2)}) es menor al total a pagar ($${financials.total.toFixed(2)})`)
      return
    }

    const receipt = {
      id_transaccion: generateTrxId(),
      id_pedido: selectedOrder.id,
      mesa: selectedOrder.table,
      cliente: selectedOrder.client,
      metodo_pago: paymentMethod,
      items: selectedOrder.items,
      subtotal: financials.subtotal,
      tax: financials.tax,
      tip: financials.tip,
      total: financials.total,
      cashGiven: paymentMethod === 'efectivo' ? numericCash : null,
      changeDue: paymentMethod === 'efectivo' ? changeDue : null,
      referencia: authCode || generateRef(),
      hora: getCurrentTime(),
    }

    // 1. Emitir evento Socket.io
    emit('payment:confirmed', {
      id_pedido: selectedOrder.id,
      mesa: selectedOrder.table,
      monto: financials.total,
      metodo_pago: paymentMethod,
      timestamp: new Date().toISOString(),
    })

    // 2. Agregar a historial
    setHistory((prev) => [
      {
        id_transaccion: receipt.id_transaccion,
        id_pedido: receipt.id_pedido,
        mesa: receipt.mesa,
        cliente: receipt.cliente,
        metodo_pago: receipt.metodo_pago,
        monto: receipt.total,
        hora: receipt.hora,
        estado: 'completada',
      },
      ...prev,
    ])

    // 3. Remover orden de pendientes y seleccionar siguiente
    const remainingOrders = ordersList.filter((o) => o.id !== selectedOrder.id)
    setOrdersList(remainingOrders)
    setSelectedOrderId(remainingOrders[0]?.id || '')

    // 4. Mostrar comprobante
    setPaidReceipt(receipt)
    setCashGiven('')
    setAuthCode('')
  }

  const totalRecaudadoHoy =
    history.reduce((acc, h) => acc + h.monto, 0) + 2480 // base acumulada

  return (
    <main className="main-panel caja-page">
      {/* Barra de métricas de caja */}
      <section className="caja-stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Recaudado (Turno)</div>
          <div className="stat-value">${totalRecaudadoHoy.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</div>
          <div className="stat-detail positive">+{history.length} cobros registrados hoy</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Cuentas Pendientes</div>
          <div className="stat-value">{ordersList.length}</div>
          <div className="stat-detail">Mesas listas para liquidar</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Ticket Promedio</div>
          <div className="stat-value">$78.40</div>
          <div className="stat-detail">Consumo medio por mesa</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Propinas Acumuladas</div>
          <div className="stat-value">$184.20</div>
          <div className="stat-detail">10% voluntario recaudado</div>
        </div>
      </section>

      {/* Tabs de navegación */}
      <div className="caja-tabs-nav">
        <button
          className={`caja-tab-btn ${activeTab === 'pendientes' ? 'active' : ''}`}
          onClick={() => setActiveTab('pendientes')}
        >
          <Receipt size={16} />
          <span>Cuentas por Cobrar ({ordersList.length})</span>
        </button>
        <button
          className={`caja-tab-btn ${activeTab === 'historial' ? 'active' : ''}`}
          onClick={() => setActiveTab('historial')}
        >
          <Clock size={16} />
          <span>Historial de Pagos ({history.length})</span>
        </button>
      </div>

      {activeTab === 'pendientes' ? (
        <section className="caja-workspace">
          {/* Columna Izquierda: Lista de Mesas / Comandas activas */}
          <div className="panel caja-orders-sidebar">
            <div className="panel-header">
              <h3>Mesas con Consumo</h3>
              <span className="badge-count">{ordersList.length}</span>
            </div>

            {ordersList.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={36} className="text-teal" />
                <p>No hay cuentas pendientes de cobro</p>
                <small>Todas las mesas del salón están al día</small>
              </div>
            ) : (
              <div className="caja-orders-list">
                {ordersList.map((order) => {
                  const isSelected = order.id === selectedOrderId
                  const orderCalc = calculateFinancials(order)
                  return (
                    <div
                      key={order.id}
                      className={`caja-order-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedOrderId(order.id)}
                    >
                      <div className="caja-card-header">
                        <strong>{order.table}</strong>
                        <span className="order-pill">{order.id}</span>
                      </div>
                      <div className="caja-card-meta">
                        <span><User size={13} /> {order.client}</span>
                        <span><Clock size={13} /> {order.time}</span>
                      </div>
                      <div className="caja-card-footer">
                        <span className="items-count">{order.items.length} ítems</span>
                        <strong className="caja-amount">${orderCalc.total.toFixed(2)}</strong>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Columna Derecha: Panel de Liquidación y Pago */}
          <div className="panel caja-billing-panel">
            {selectedOrder ? (
              <form onSubmit={handleProcessPayment} className="caja-form">
                <div className="panel-header">
                  <div>
                    <h3>Liquidación — {selectedOrder.table}</h3>
                    <span className="panel-subtitle">
                      Orden {selectedOrder.id} · Comensal: {selectedOrder.client}
                    </span>
                  </div>
                  <span className="order-state">{selectedOrder.state}</span>
                </div>

                {/* Desglose de ítems */}
                <div className="billing-items-box">
                  <div className="billing-table-head">
                    <span>Plato / Producto</span>
                    <span className="text-center">Cant.</span>
                    <span className="text-right">Subtotal</span>
                  </div>
                  <div className="billing-table-body">
                    {selectedOrder.items.map((item, index) => (
                      <div key={index} className="billing-row">
                        <span className="item-title">{item.name}</span>
                        <span className="item-qty text-center">x{item.qty}</span>
                        <span className="item-sub text-right">{item.subtotal}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Subtotales y cálculos */}
                <div className="billing-breakdown">
                  <div className="breakdown-row">
                    <span>Consumo Neto (Subtotal)</span>
                    <strong>${financials.subtotal.toFixed(2)}</strong>
                  </div>
                  <div className="breakdown-row">
                    <span>Impoconsumo (8%)</span>
                    <span>${financials.tax.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row tip-row">
                    <label className="tip-toggle">
                      <input
                        type="checkbox"
                        checked={includeTip}
                        onChange={(e) => setIncludeTip(e.target.checked)}
                      />
                      <span>Incluir Propina Voluntaria sugerida (10%)</span>
                    </label>
                    <span>${financials.tip.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-total">
                    <span>Total a Pagar</span>
                    <em>${financials.total.toFixed(2)}</em>
                  </div>
                </div>

                {/* Métodos de Pago */}
                <div className="payment-methods-section">
                  <label className="section-label">Seleccionar Método de Pago:</label>
                  <div className="payment-methods-grid">
                    <button
                      type="button"
                      className={`payment-option-btn ${paymentMethod === 'efectivo' ? 'active' : ''}`}
                      onClick={() => setPaymentMethod('efectivo')}
                    >
                      <DollarSign size={18} />
                      <span>Efectivo</span>
                    </button>

                    <button
                      type="button"
                      className={`payment-option-btn ${paymentMethod === 'tarjeta_debito' ? 'active' : ''}`}
                      onClick={() => setPaymentMethod('tarjeta_debito')}
                    >
                      <CreditCard size={18} />
                      <span>T. Débito</span>
                    </button>

                    <button
                      type="button"
                      className={`payment-option-btn ${paymentMethod === 'tarjeta_credito' ? 'active' : ''}`}
                      onClick={() => setPaymentMethod('tarjeta_credito')}
                    >
                      <CreditCard size={18} />
                      <span>T. Crédito</span>
                    </button>

                    <button
                      type="button"
                      className={`payment-option-btn ${paymentMethod === 'transferencia' ? 'active' : ''}`}
                      onClick={() => setPaymentMethod('transferencia')}
                    >
                      <Smartphone size={18} />
                      <span>Nequi / Transf.</span>
                    </button>
                  </div>

                  {/* Detalle según método */}
                  {paymentMethod === 'efectivo' && (
                    <div className="cash-calculator-box">
                      <div className="cash-input-group">
                        <label>Efectivo Recibido ($):</label>
                        <input
                          type="number"
                          step="0.5"
                          min={financials.total}
                          placeholder={financials.total.toFixed(2)}
                          value={cashGiven}
                          onChange={(e) => setCashGiven(e.target.value)}
                          required
                        />
                      </div>
                      <div className="cash-change-result">
                        <span>Cambio / Vueltos:</span>
                        <strong className={changeDue > 0 ? 'text-teal' : ''}>
                          ${changeDue.toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  )}

                  {(paymentMethod === 'tarjeta_debito' || paymentMethod === 'tarjeta_credito') && (
                    <div className="card-input-box">
                      <label>Nro. Aprobación Datáfono (Opcional):</label>
                      <input
                        type="text"
                        placeholder="Ej. AP-94812"
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                      />
                    </div>
                  )}

                  {paymentMethod === 'transferencia' && (
                    <div className="transfer-hint-box">
                      <Sparkles size={16} />
                      <span>Confirmar notificación de abono en cuenta bancaria o QR Nequi/Daviplata.</span>
                    </div>
                  )}
                </div>

                {/* Botón de Confirmación */}
                <div className="caja-actions">
                  <button type="submit" className="primary-button checkout-submit-btn">
                    <CheckCircle2 size={18} />
                    <span>Cobrar y Liberar {selectedOrder.table} (${financials.total.toFixed(2)})</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="empty-panel-prompt">
                <Receipt size={48} className="text-muted" />
                <h3>Selecciona una mesa para liquidar</h3>
                <p>Elige una comanda en la columna izquierda para procesar el pago y emitir la factura.</p>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* Vista de Historial de Transacciones */
        <section className="panel history-panel">
          <div className="panel-header">
            <div>
              <h3>Historial de Pagos y Cierres</h3>
              <span className="panel-subtitle">Transacciones registradas durante la jornada de hoy</span>
            </div>
            <button
              className="ghost-button small"
              onClick={() => window.print()}
            >
              <Printer size={15} />
              <span>Imprimir Cuadre de Caja</span>
            </button>
          </div>

          <div className="table-responsive">
            <table className="caja-history-table">
              <thead>
                <tr>
                  <th>N° Transacción</th>
                  <th>Hora</th>
                  <th>Mesa</th>
                  <th>Comensal</th>
                  <th>Método de Pago</th>
                  <th className="text-right">Total Cobrado</th>
                  <th className="text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {history.map((tx) => (
                  <tr key={tx.id_transaccion}>
                    <td className="font-mono font-bold text-teal">{tx.id_transaccion}</td>
                    <td>{tx.hora}</td>
                    <td><strong>{tx.mesa}</strong></td>
                    <td>{tx.cliente}</td>
                    <td>
                      <span className="method-pill">{tx.metodo_pago.replace('_', ' ')}</span>
                    </td>
                    <td className="text-right font-bold">${tx.monto.toFixed(2)}</td>
                    <td className="text-center">
                      <span className="status-badge-paid">Completada</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal de Factura / Recibo Exitoso */}
      {paidReceipt && (
        <div className="modal-backdrop" onClick={() => setPaidReceipt(null)}>
          <div className="modal-card receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <div className="modal-icon-badge success-bg">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h3>Pago Procesado con Éxito</h3>
                  <p className="modal-subtitle">La mesa ha sido liberada y registrada en caja</p>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setPaidReceipt(null)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="receipt-paper" id="printable-receipt">
                <div className="receipt-header">
                  <h4>🍽️ SmartDining</h4>
                  <p>Restaurante & Experiencia Digital</p>
                  <small>NIT: 900.123.456-7 · IVA Régimen Común</small>
                  <div className="receipt-divider"></div>
                </div>

                <div className="receipt-info-grid">
                  <div><span>Recibo:</span> <strong>{paidReceipt.id_transaccion}</strong></div>
                  <div><span>Fecha:</span> {new Date().toLocaleDateString()} {paidReceipt.hora}</div>
                  <div><span>Mesa:</span> <strong>{paidReceipt.mesa}</strong></div>
                  <div><span>Cliente:</span> {paidReceipt.cliente}</div>
                  <div><span>Método:</span> {paidReceipt.metodo_pago.toUpperCase()}</div>
                  <div><span>Ref:</span> {paidReceipt.referencia}</div>
                </div>

                <div className="receipt-divider"></div>

                <div className="receipt-items-list">
                  {paidReceipt.items.map((it, i) => (
                    <div key={i} className="receipt-item-line">
                      <span>{it.qty}x {it.name}</span>
                      <span>{it.subtotal}</span>
                    </div>
                  ))}
                </div>

                <div className="receipt-divider"></div>

                <div className="receipt-totals">
                  <div><span>Subtotal:</span> <span>${paidReceipt.subtotal.toFixed(2)}</span></div>
                  <div><span>Impoconsumo (8%):</span> <span>${paidReceipt.tax.toFixed(2)}</span></div>
                  {paidReceipt.tip > 0 && (
                    <div><span>Propina (10%):</span> <span>${paidReceipt.tip.toFixed(2)}</span></div>
                  )}
                  <div className="receipt-grand-total">
                    <strong>TOTAL PAGADO:</strong>
                    <strong>${paidReceipt.total.toFixed(2)}</strong>
                  </div>
                  {paidReceipt.cashGiven && (
                    <>
                      <div><span>Efectivo recibido:</span> <span>${paidReceipt.cashGiven.toFixed(2)}</span></div>
                      <div><span>Cambio entregado:</span> <span>${paidReceipt.changeDue.toFixed(2)}</span></div>
                    </>
                  )}
                </div>

                <div className="receipt-footer">
                  <p>¡Gracias por su visita!</p>
                  <small>Generado digitalmente por SmartDining POS</small>
                </div>
              </div>

              <div className="receipt-modal-actions">
                <button
                  type="button"
                  className="primary-button small"
                  onClick={() => window.print()}
                >
                  <Printer size={16} />
                  <span>Imprimir Recibo</span>
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => setPaidReceipt(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
