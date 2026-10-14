import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Users,
  Sparkles,
  RefreshCw,
  Tag,
} from 'lucide-react'
import { mesasApi, pedidosApi, transaccionesApi, getAuthToken } from '../services/api'
import { useSocketEmit, useSocketListener, useTables } from '../hooks'

function formatCOP(monto) {
  const num = Number(monto) || 0
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(num)
}

function generateRef() {
  return 'POS-' + Date.now().toString().slice(-6)
}

function getCurrentTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Caja() {
  const emit = useSocketEmit()
  const { cargarMesas } = useTables()

  const [loading, setLoading] = useState(() => Boolean(getAuthToken()))
  const [processingPayment, setProcessingPayment] = useState(false)

  // Cuentas reales cargadas desde el backend
  const [cuentasMesas, setCuentasMesas] = useState([])
  const [selectedMesaId, setSelectedMesaId] = useState(null)
  const [selectedComensal, setSelectedComensal] = useState('TOTAL') // 'TOTAL' o nombre del comensal

  // Detalles de ítems del pedido activo
  const [detallesPedido, setDetallesPedido] = useState([])
  const [loadingDetalles, setLoadingDetalles] = useState(false)

  // Opciones de cobro
  const [includeTip, setIncludeTip] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [cashGiven, setCashGiven] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [paidReceipt, setPaidReceipt] = useState(null)
  const [activeTab, setActiveTab] = useState('pendientes') // 'pendientes' | 'historial'

  // Historial de transacciones de la jornada
  const [history, setHistory] = useState(() => {
    try {
      const stored = sessionStorage.getItem('smartdining_caja_history')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  // Sincronizar historial con sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('smartdining_caja_history', JSON.stringify(history))
    } catch {
      // Ignorar error de almacenamiento
    }
  }, [history])

  /**
   * Carga las cuentas activas directamente desde la API para todas las mesas ocupadas
   */
  const cargarCuentas = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    setLoading(true)
    setErrorMessage(null)

    try {
      // 1. Obtener estado actual de las mesas
      const mesasRes = await mesasApi.listar()
      const listaMesas = mesasRes?.mesas || []

      // 2. Para cada mesa ocupada, consultar su cuenta desglosada
      const mesasOcupadas = listaMesas.filter(
        (m) => m.estado === 'ocupada' || Boolean(m.sesion_abierta)
      )

      if (mesasOcupadas.length === 0) {
        setCuentasMesas([])
        return
      }

      const promesas = mesasOcupadas.map(async (mesa) => {
        try {
          const cuenta = await mesasApi.obtenerCuenta(mesa.id_mesa)
          if (cuenta) {
            return {
              ...cuenta,
              numero_mesa: mesa.numero,
              ubicacion_mesa: mesa.ubicacion,
            }
          }
        } catch {
          // Si una mesa no tiene pedidos o falla, retornar null
        }
        return null
      })

      const cuentas = (await Promise.all(promesas)).filter(
        (c) => c && (Number(c.saldo_mesa) > 0 || Number(c.total_mesa) > 0)
      )

      setCuentasMesas(cuentas)

      // Seleccionar automáticamente la primera mesa si no hay una elegida
      setSelectedMesaId((prev) => {
        if (prev && cuentas.some((c) => c.id_mesa === prev)) return prev
        return cuentas[0]?.id_mesa || null
      })
    } catch (err) {
      console.warn('Aviso al cargar cuentas de caja:', err.message)
      setErrorMessage('No se pudieron consultar las cuentas del salón. Mostrando datos de respaldo.')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSelectMesa = useCallback((mesaId) => {
    setSelectedMesaId(mesaId)
    setSelectedComensal('TOTAL')
  }, [])

  // Cargar cuentas al montar de forma asíncrona
  useEffect(() => {
    let cancel = false
    const token = getAuthToken()
    if (!token) return

    mesasApi
      .listar()
      .then(async (mesasRes) => {
        if (cancel) return
        const listaMesas = mesasRes?.mesas || []
        const mesasOcupadas = listaMesas.filter(
          (m) => m.estado === 'ocupada' || Boolean(m.sesion_abierta)
        )

        if (mesasOcupadas.length === 0) {
          if (!cancel) {
            setCuentasMesas([])
            setLoading(false)
          }
          return
        }

        const promesas = mesasOcupadas.map(async (mesa) => {
          try {
            const cuenta = await mesasApi.obtenerCuenta(mesa.id_mesa)
            if (cuenta) {
              return {
                ...cuenta,
                numero_mesa: mesa.numero,
                ubicacion_mesa: mesa.ubicacion,
              }
            }
          } catch {
            // Ignorar
          }
          return null
        })

        const cuentas = (await Promise.all(promesas)).filter(
          (c) => c && (Number(c.saldo_mesa) > 0 || Number(c.total_mesa) > 0)
        )

        if (!cancel) {
          setCuentasMesas(cuentas)
          setSelectedMesaId((prev) => {
            if (prev && cuentas.some((c) => c.id_mesa === prev)) return prev
            return cuentas[0]?.id_mesa || null
          })
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancel) {
          console.warn('Aviso al cargar cuentas de caja:', err.message)
          setErrorMessage('No se pudieron consultar las cuentas del salón.')
          setLoading(false)
        }
      })

    return () => {
      cancel = true
    }
  }, [])

  // Escuchar eventos de WebSockets en tiempo real para mantener la caja sincronizada
  useSocketListener('order:created', () => cargarCuentas())
  useSocketListener('order:status', () => cargarCuentas())
  useSocketListener('payment:confirmed', (data) => {
    cargarCuentas()
    if (data?.id_mesa) cargarMesas()
  })
  useSocketListener('mesa:liberada', () => {
    cargarCuentas()
    cargarMesas()
  })
  useSocketListener('mesa-liberada', () => {
    cargarCuentas()
    cargarMesas()
  })
  useSocketListener('cuenta:solicitada', (data) => {
    cargarCuentas()
    if (data?.id_mesa) {
      handleSelectMesa(Number(data.id_mesa))
    }
  })

  // Mesa actualmente seleccionada
  const selectedCuenta = useMemo(() => {
    return cuentasMesas.find((c) => c.id_mesa === selectedMesaId) || null
  }, [cuentasMesas, selectedMesaId])

  // Cargar detalle de ítems del pedido activo cuando se selecciona una mesa
  useEffect(() => {
    let cancel = false

    async function cargarItemsPedido() {
      if (!selectedCuenta || !selectedCuenta.pedidos || selectedCuenta.pedidos.length === 0) {
        setDetallesPedido([])
        return
      }

      const primerPedido = selectedCuenta.pedidos[0]
      setLoadingDetalles(true)
      try {
        const pedData = await pedidosApi.obtener(primerPedido.id_pedido)
        if (!cancel && pedData?.detalles) {
          setDetallesPedido(pedData.detalles)
        }
      } catch {
        if (!cancel) setDetallesPedido([])
      } finally {
        if (!cancel) setLoadingDetalles(false)
      }
    }

    cargarItemsPedido()
    return () => {
      cancel = true
    }
  }, [selectedCuenta])

  // Cálculo del monto a cobrar según selección de comensal o mesa completa
  const financialDetails = useMemo(() => {
    if (!selectedCuenta) {
      return {
        subtotal: 0,
        tip: 0,
        total: 0,
        yaPagado: 0,
        saldoPendiente: 0,
        comensalNombre: 'Toda la Mesa',
      }
    }

    let subtotalCobro = 0
    let yaPagado = 0
    let comensalNombre = 'Toda la Mesa'

    if (selectedComensal === 'TOTAL') {
      subtotalCobro = Number(selectedCuenta.saldo_mesa) || 0
      yaPagado = Number(selectedCuenta.pagado_mesa) || 0
      comensalNombre = 'Toda la Mesa'
    } else {
      const c = (selectedCuenta.comensales || []).find(
        (item) => item.comensal === selectedComensal
      )
      if (c) {
        subtotalCobro = Number(c.saldo) || 0
        yaPagado = Number(c.pagado) || 0
        comensalNombre = c.comensal
      } else {
        subtotalCobro = Number(selectedCuenta.saldo_mesa) || 0
      }
    }

    const tip = includeTip ? Math.round(subtotalCobro * 0.1) : 0
    const total = subtotalCobro + tip

    return {
      subtotal: subtotalCobro,
      tip,
      total,
      yaPagado,
      saldoPendiente: subtotalCobro,
      comensalNombre,
    }
  }, [selectedCuenta, selectedComensal, includeTip])

  const numericCash = parseFloat(cashGiven) || 0
  const changeDue = Math.max(0, numericCash - financialDetails.total)

  // Procesar registro de pago en el backend
  const handleProcessPayment = async (e) => {
    e.preventDefault()
    if (!selectedCuenta) return

    if (paymentMethod === 'efectivo' && numericCash < financialDetails.total) {
      alert(
        `El efectivo recibido (${formatCOP(numericCash)}) es menor al total a pagar (${formatCOP(
          financialDetails.total
        )})`
      )
      return
    }

    // Identificar el pedido activo con saldo en la mesa
    const pedidoTarget = selectedCuenta.pedidos?.[0]
    if (!pedidoTarget) {
      alert('No se encontró un pedido activo para liquidar en esta mesa.')
      return
    }

    setProcessingPayment(true)
    const refOperacion = authCode.trim() || generateRef()

    try {
      // 1. Llamar al backend real: POST /api/transacciones
      const resTx = await transaccionesApi.registrarPago({
        id_pedido: pedidoTarget.id_pedido,
        monto: financialDetails.subtotal,
        metodo_pago: paymentMethod,
        referencia_externa: refOperacion,
        comensal: selectedComensal === 'TOTAL' ? null : selectedComensal,
      })

      // 2. Construir comprobante de pago
      const receipt = {
        id_transaccion: resTx?.id_transaccion ? `TRX-${resTx.id_transaccion}` : generateRef(),
        id_pedido: pedidoTarget.codigo_pedido || `#${pedidoTarget.id_pedido}`,
        mesa: `Mesa ${selectedCuenta.numero || selectedCuenta.numero_mesa}`,
        comensal: financialDetails.comensalNombre,
        metodo_pago: paymentMethod,
        items: detallesPedido.length > 0 ? detallesPedido : [
          {
            nombre: 'Consumo registrado',
            cantidad: selectedCuenta.items_totales || 1,
            subtotal: financialDetails.subtotal,
          },
        ],
        subtotal: financialDetails.subtotal,
        tip: financialDetails.tip,
        total: financialDetails.total,
        cashGiven: paymentMethod === 'efectivo' ? numericCash : null,
        changeDue: paymentMethod === 'efectivo' ? changeDue : null,
        referencia: refOperacion,
        hora: getCurrentTime(),
      }

      // 3. Emitir evento por WebSockets
      emit('payment:confirmed', {
        id_pedido: pedidoTarget.id_pedido,
        id_mesa: selectedCuenta.id_mesa,
        monto: financialDetails.total,
        comensal: selectedComensal === 'TOTAL' ? null : selectedComensal,
        metodo_pago: paymentMethod,
        timestamp: new Date().toISOString(),
      })

      // 4. Agregar al historial local
      setHistory((prev) => [
        {
          id_transaccion: receipt.id_transaccion,
          id_pedido: pedidoTarget.id_pedido,
          mesa: receipt.mesa,
          comensal: receipt.comensal,
          metodo_pago: receipt.metodo_pago,
          monto: receipt.total,
          hora: receipt.hora,
          estado: 'completada',
          referencia: receipt.referencia,
        },
        ...prev,
      ])

      // 5. Mostrar recibo y limpiar inputs
      setPaidReceipt(receipt)
      setCashGiven('')
      setAuthCode('')

      // 6. Recargar mesas y cuentas
      await cargarCuentas()
      await cargarMesas()
    } catch (err) {
      alert(`Error al registrar el cobro en caja: ${err.message}`)
    } finally {
      setProcessingPayment(false)
    }
  }

  // Métricas acumuladas del turno
  const totalRecaudadoHoy = useMemo(() => {
    return history.reduce((acc, h) => acc + (Number(h.monto) || 0), 0)
  }, [history])

  return (
    <main className="main-panel caja-page">
      {/* Barra de métricas de caja */}
      <section className="caja-stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Recaudado (Turno)</div>
          <div className="stat-value">{formatCOP(totalRecaudadoHoy)}</div>
          <div className="stat-detail positive">+{history.length} cobros registrados hoy</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Cuentas por Cobrar</div>
          <div className="stat-value">{cuentasMesas.length}</div>
          <div className="stat-detail">Mesas con saldo pendiente</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Saldo Total en Salón</div>
          <div className="stat-value">
            {formatCOP(
              cuentasMesas.reduce((acc, c) => acc + (Number(c.saldo_mesa) || 0), 0)
            )}
          </div>
          <div className="stat-detail">Consumo pendiente de cierre</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Operador de Caja</div>
          <div className="stat-value font-mono text-emerald-neon text-lg">Activo</div>
          <div className="stat-detail">Cobro directo · POS Digital</div>
        </div>
      </section>

      {/* Tabs de navegación */}
      <div className="caja-tabs-nav">
        <button
          className={`caja-tab-btn ${activeTab === 'pendientes' ? 'active' : ''}`}
          onClick={() => setActiveTab('pendientes')}
        >
          <Receipt size={16} />
          <span>Cuentas por Cobrar ({cuentasMesas.length})</span>
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
          {/* Columna Izquierda: Lista de Mesas con Cuentas Abiertas */}
          <div className="panel caja-orders-sidebar">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <h3>Mesas con Saldo</h3>
                <span className="badge-count">{cuentasMesas.length}</span>
              </div>
              <button
                className="ghost-button small"
                onClick={cargarCuentas}
                disabled={loading}
                title="Actualizar cuentas"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {loading && cuentasMesas.length === 0 ? (
              <div className="caja-loading-box">
                <RefreshCw size={28} className="animate-spin text-emerald-neon" />
                <p>Consultando cuentas del salón...</p>
              </div>
            ) : cuentasMesas.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={40} className="text-emerald-neon" />
                <p>No hay cuentas pendientes de cobro</p>
                <small>Todas las mesas activas están al día o libres</small>
              </div>
            ) : (
              <div className="caja-orders-list">
                {cuentasMesas.map((cuenta) => {
                  const isSelected = cuenta.id_mesa === selectedMesaId
                  return (
                    <div
                      key={cuenta.id_mesa}
                      className={`caja-order-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectMesa(cuenta.id_mesa)}
                    >
                      <div className="caja-card-header">
                        <strong>Mesa {cuenta.numero || cuenta.numero_mesa}</strong>
                        <span className="order-pill">
                          {cuenta.pedidos?.[0]?.codigo_pedido || `ID: ${cuenta.id_mesa}`}
                        </span>
                      </div>
                      <div className="caja-card-meta">
                        <span>
                          <Users size={13} /> {cuenta.comensales?.length || 1} comensales
                        </span>
                        <span>
                          <Tag size={13} /> {cuenta.ubicacion || cuenta.ubicacion_mesa || 'Salón'}
                        </span>
                      </div>
                      <div className="caja-card-footer">
                        <span className="items-count">
                          {cuenta.items_totales || cuenta.pedidos?.length || 0} ítems
                        </span>
                        <strong className="caja-amount">
                          {formatCOP(cuenta.saldo_mesa)}
                        </strong>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Columna Derecha: Panel de Liquidación y Pago */}
          <div className="panel caja-billing-panel">
            {selectedCuenta ? (
              <form onSubmit={handleProcessPayment} className="caja-form">
                <div className="panel-header">
                  <div>
                    <h3>Liquidación — Mesa {selectedCuenta.numero || selectedCuenta.numero_mesa}</h3>
                    <span className="panel-subtitle">
                      {selectedCuenta.pedidos?.[0]?.codigo_pedido
                        ? `Pedido ${selectedCuenta.pedidos[0].codigo_pedido} · `
                        : ''}
                      Ubicación: {selectedCuenta.ubicacion || 'Principal'}
                    </span>
                  </div>
                  <span className="status-badge-occupied">
                    Saldo: {formatCOP(selectedCuenta.saldo_mesa)}
                  </span>
                </div>

                {/* Selector de División de Cuenta: Toda la mesa o por comensal */}
                <div className="comensal-selector-box">
                  <label className="section-label">
                    <Users size={16} />
                    <span>Seleccionar Cobro (División de Cuenta):</span>
                  </label>
                  <div className="comensal-chips-group">
                    <button
                      type="button"
                      className={`comensal-chip ${selectedComensal === 'TOTAL' ? 'active' : ''}`}
                      onClick={() => setSelectedComensal('TOTAL')}
                    >
                      <span>Toda la Mesa</span>
                      <strong className="chip-amount">{formatCOP(selectedCuenta.saldo_mesa)}</strong>
                    </button>

                    {(selectedCuenta.comensales || []).map((c, i) => {
                      const owes = Number(c.saldo) > 0
                      const isChipSelected = selectedComensal === c.comensal
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`comensal-chip ${isChipSelected ? 'active' : ''} ${
                            !owes ? 'paid-chip' : ''
                          }`}
                          onClick={() => owes && setSelectedComensal(c.comensal)}
                          disabled={!owes}
                        >
                          <div className="chip-header">
                            <User size={13} />
                            <span>{c.comensal}</span>
                          </div>
                          <strong className="chip-amount">
                            {owes ? formatCOP(c.saldo) : 'Pagado ✔'}
                          </strong>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Desglose de ítems */}
                <div className="billing-items-box">
                  <div className="billing-table-head">
                    <span>Plato / Producto</span>
                    <span className="text-center">Comensal</span>
                    <span className="text-center">Cant.</span>
                    <span className="text-right">Subtotal</span>
                  </div>

                  <div className="billing-table-body">
                    {loadingDetalles ? (
                      <div className="p-4 text-center text-sm text-muted">
                        Cargando comanda...
                      </div>
                    ) : detallesPedido.length > 0 ? (
                      detallesPedido.map((item, idx) => (
                        <div key={idx} className="billing-row">
                          <div className="item-title-group">
                            <span className="item-title">{item.plato_nombre || item.nombre}</span>
                            {item.ingredientes && item.ingredientes.length > 0 && (
                              <small className="item-extras">
                                {item.ingredientes.map((ing) => ing.nombre).join(', ')}
                              </small>
                            )}
                          </div>
                          <span className="item-comensal text-center text-muted text-xs">
                            {item.comensal || 'General'}
                          </span>
                          <span className="item-qty text-center">x{item.cantidad}</span>
                          <span className="item-sub text-right">
                            {formatCOP(item.subtotal)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="billing-row">
                        <span className="item-title">
                          Consumo general de Mesa {selectedCuenta.numero || selectedCuenta.numero_mesa}
                        </span>
                        <span className="item-comensal text-center">Mesa</span>
                        <span className="item-qty text-center">x1</span>
                        <span className="item-sub text-right">
                          {formatCOP(financialDetails.subtotal)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Subtotales y cálculos de cobro */}
                <div className="billing-breakdown">
                  <div className="breakdown-row">
                    <span>Cobro para:</span>
                    <strong className="text-emerald-neon">{financialDetails.comensalNombre}</strong>
                  </div>
                  <div className="breakdown-row">
                    <span>Subtotal a Liquidar</span>
                    <strong>{formatCOP(financialDetails.subtotal)}</strong>
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
                    <span>{formatCOP(financialDetails.tip)}</span>
                  </div>
                  <div className="breakdown-total">
                    <span>Total a Cobrar</span>
                    <em>{formatCOP(financialDetails.total)}</em>
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

                  {/* Detalle interactivo según método */}
                  {paymentMethod === 'efectivo' && (
                    <div className="cash-calculator-box">
                      <div className="cash-input-group">
                        <label htmlFor="efectivo-input">Efectivo Recibido (COP):</label>
                        <input
                          id="efectivo-input"
                          type="number"
                          step="1000"
                          min={financialDetails.total}
                          placeholder={financialDetails.total.toString()}
                          value={cashGiven}
                          onChange={(e) => setCashGiven(e.target.value)}
                          required
                        />
                      </div>
                      <div className="cash-change-result">
                        <span>Cambio / Vueltos:</span>
                        <strong className={changeDue > 0 ? 'text-emerald-neon' : ''}>
                          {formatCOP(changeDue)}
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
                      <span>Confirmar abono en App Bancolombia / Nequi / Daviplata antes de emitir recibo.</span>
                    </div>
                  )}
                </div>

                {/* Botón de Confirmación */}
                <div className="caja-actions">
                  <button
                    type="submit"
                    className="primary-button checkout-submit-btn"
                    disabled={processingPayment || financialDetails.total <= 0}
                  >
                    {processingPayment ? (
                      <>
                        <RefreshCw size={18} className="animate-spin" />
                        <span>Registrando cobro en base de datos...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={18} />
                        <span>
                          Cobrar {formatCOP(financialDetails.total)} —{' '}
                          {financialDetails.comensalNombre}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="empty-panel-prompt">
                <Receipt size={48} className="text-muted" />
                <h3>Selecciona una mesa para liquidar</h3>
                <p>Elige una mesa con saldo en la columna izquierda para registrar el cobro y emitir factura.</p>
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
            <button className="ghost-button small" onClick={() => window.print()}>
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
                  <th>Comensal / Tipo</th>
                  <th>Método de Pago</th>
                  <th className="text-right">Total Cobrado</th>
                  <th className="text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {history.map((tx, idx) => (
                  <tr key={tx.id_transaccion || idx}>
                    <td className="font-mono font-bold text-emerald-neon">{tx.id_transaccion}</td>
                    <td>{tx.hora}</td>
                    <td><strong>{tx.mesa}</strong></td>
                    <td>{tx.comensal || tx.cliente || 'Mesa'}</td>
                    <td>
                      <span className="method-pill">{tx.metodo_pago.replace('_', ' ')}</span>
                    </td>
                    <td className="text-right font-bold">{formatCOP(tx.monto)}</td>
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
                  <p className="modal-subtitle">Transacción guardada en base de datos</p>
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
                  <div><span>Comensal:</span> {paidReceipt.comensal}</div>
                  <div><span>Método:</span> {paidReceipt.metodo_pago.toUpperCase()}</div>
                  <div><span>Ref:</span> {paidReceipt.referencia}</div>
                </div>

                <div className="receipt-divider"></div>

                <div className="receipt-items-list">
                  {paidReceipt.items.map((it, i) => (
                    <div key={i} className="receipt-item-line">
                      <span>{it.cantidad || it.qty || 1}x {it.plato_nombre || it.nombre}</span>
                      <span>{formatCOP(it.subtotal)}</span>
                    </div>
                  ))}
                </div>

                <div className="receipt-divider"></div>

                <div className="receipt-totals">
                  <div><span>Subtotal:</span> <span>{formatCOP(paidReceipt.subtotal)}</span></div>
                  {paidReceipt.tip > 0 && (
                    <div><span>Propina voluntaria (10%):</span> <span>{formatCOP(paidReceipt.tip)}</span></div>
                  )}
                  <div className="receipt-grand-total">
                    <strong>TOTAL PAGADO:</strong>
                    <strong>{formatCOP(paidReceipt.total)}</strong>
                  </div>
                  {paidReceipt.cashGiven && (
                    <>
                      <div><span>Efectivo recibido:</span> <span>{formatCOP(paidReceipt.cashGiven)}</span></div>
                      <div><span>Cambio entregado:</span> <span>{formatCOP(paidReceipt.changeDue)}</span></div>
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
