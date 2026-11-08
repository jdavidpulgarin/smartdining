import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  CreditCard,
  DollarSign,
  Smartphone,
  Receipt,
  CheckCircle2,
  Printer,
  X,
  User,
  Users,
  Sparkles,
  RefreshCw,
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
  const [errorMessage, setErrorMessage] = useState(null)
  const [processingPayment, setProcessingPayment] = useState(false)

  // Cuentas reales cargadas desde el backend
  const [cuentasMesas, setCuentasMesas] = useState([])
  const [selectedMesaId, setSelectedMesaId] = useState(null)
  const [selectedComensal, setSelectedComensal] = useState('TOTAL')

  // Detalles de ítems del pedido activo
  const [detallesPedido, setDetallesPedido] = useState([])
  const [loadingDetalles, setLoadingDetalles] = useState(false)

  // Opciones de cobro
  const [includeTip, setIncludeTip] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [cashGiven, setCashGiven] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [paidReceipt, setPaidReceipt] = useState(null)
  const [activeTab, setActiveTab] = useState('pendientes')

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
      setErrorMessage('No se pudieron consultar las cuentas del salón.')
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

  const totalSaldoSalon = useMemo(() => {
    return cuentasMesas.reduce((acc, c) => acc + (Number(c.saldo_mesa) || 0), 0)
  }, [cuentasMesas])

  return (
    <div className="sd-caja-page-wrap">
      {/* Franja roja con resumen financiero y pestañas */}
      <div className="sd-red-band">
        <div className="sd-red-band-content">
          <div className="sd-red-band-filters">
            <button
              type="button"
              className={`sd-red-band-btn ${activeTab === 'pendientes' ? 'active' : ''}`}
              onClick={() => setActiveTab('pendientes')}
            >
              CUENTAS POR COBRAR <span>{cuentasMesas.length}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${activeTab === 'historial' ? 'active' : ''}`}
              onClick={() => setActiveTab('historial')}
            >
              HISTORIAL DE PAGOS <span>{history.length}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 16, textTransform: 'uppercase' }}>
              SALDO SALÓN: <strong>{formatCOP(totalSaldoSalon)}</strong>
            </span>
            <button
              type="button"
              className="sd-red-band-btn"
              onClick={cargarCuentas}
              disabled={loading}
              title="Actualizar cuentas"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>ACTUALIZAR</span>
            </button>
          </div>
        </div>
      </div>

      <div className="sd-page-container sd-caja-container">
        {/* Encabezado con título editorial y contadores */}
        <header className="sd-caja-header" style={{ marginBottom: 28 }}>
          <h1 className="sd-page-title">
            CAJA<br />
            REGISTRADORA
          </h1>
          <div className="sd-tables-counters">
            <span>{formatCOP(totalRecaudadoHoy)} RECAUDADO HOY</span>
            <span className="sd-counter-sep">·</span>
            <span>{cuentasMesas.length} CUENTAS PENDIENTES</span>
            <span className="sd-counter-sep">·</span>
            <span className="sd-counter-alert">{formatCOP(totalSaldoSalon)} POR COBRAR</span>
          </div>
        </header>

        {errorMessage && (
          <div className="table-toast-banner info" style={{ marginBottom: 20 }}>
            <span>{errorMessage}</span>
          </div>
        )}

        {activeTab === 'pendientes' ? (
          <div className="sd-caja-layout">
            {/* Columna Izquierda: Botones de Cuentas (72px alto) */}
            <aside className="sd-caja-col-accounts">
              <h2 className="sd-card-title" style={{ fontSize: 22, marginBottom: 12 }}>
                MESAS CON SALDO ({cuentasMesas.length})
              </h2>

              {loading && cuentasMesas.length === 0 ? (
                <div className="sd-card sd-empty-box">
                  <RefreshCw size={28} className="animate-spin" style={{ color: 'var(--sd-red)' }} />
                  <p>CONSULTANDO CUENTAS DEL SALÓN...</p>
                </div>
              ) : cuentasMesas.length === 0 ? (
                <div className="sd-card sd-empty-box">
                  <CheckCircle2 size={40} style={{ color: 'var(--sd-white)' }} />
                  <p>NO HAY CUENTAS PENDIENTES</p>
                  <small style={{ color: 'var(--sd-text-muted)' }}>
                    Todas las mesas están al día o libres
                  </small>
                </div>
              ) : (
                <div className="sd-caja-accounts-list">
                  {cuentasMesas.map((cuenta) => {
                    const isSelected = cuenta.id_mesa === selectedMesaId
                    const mesaNum = cuenta.numero || cuenta.numero_mesa

                    return (
                      <button
                        key={cuenta.id_mesa}
                        type="button"
                        className={`sd-caja-account-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectMesa(cuenta.id_mesa)}
                      >
                        <div>
                          <strong className="sd-account-mesa-name">
                            Mesa {mesaNum}
                          </strong>
                          <span className="sd-account-meta">
                            <Users size={12} /> {cuenta.comensales?.length || 1} COMENSALES · {cuenta.ubicacion || cuenta.ubicacion_mesa || 'SALÓN'}
                          </span>
                        </div>
                        <strong className="sd-account-saldo">
                          {formatCOP(cuenta.saldo_mesa)}
                        </strong>
                      </button>
                    )
                  })}
                </div>
              )}
            </aside>

            {/* Columna Derecha: Tarjeta COBRAR / MESA NN */}
            <main className="sd-caja-col-billing">
              {selectedCuenta ? (
                <div className="sd-card sd-billing-card">
                  <header style={{ marginBottom: 20 }}>
                    <h2 className="sd-page-title sd-billing-title" style={{ fontSize: 52 }}>
                      COBRAR / MESA {selectedCuenta.numero || selectedCuenta.numero_mesa}
                    </h2>
                    <span style={{ fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)', fontSize: 16 }}>
                      {selectedCuenta.pedidos?.[0]?.codigo_pedido ? `PEDIDO ${selectedCuenta.pedidos[0].codigo_pedido} · ` : ''}
                      UBICACIÓN: {(selectedCuenta.ubicacion || selectedCuenta.ubicacion_mesa || 'PRINCIPAL').toUpperCase()}
                    </span>
                  </header>

                  {/* Saldo Grande de la Mesa */}
                  <div className="sd-billing-large-saldo">
                    <span className="sd-saldo-label">SALDO PENDIENTE MESA</span>
                    <strong className="sd-saldo-amount">
                      {formatCOP(selectedCuenta.saldo_mesa)}
                    </strong>
                  </div>

                  {/* Selector de División de Cuenta: Toda la mesa o por comensal */}
                  <div style={{ marginBottom: 20 }}>
                    <label className="sd-input-label" style={{ marginBottom: 8 }}>
                      SELECCIONAR COBRO (DIVISIÓN DE CUENTA):
                    </label>
                    <div className="sd-comensales-chips-row">
                      <button
                        type="button"
                        className={`sd-comensal-chip ${selectedComensal === 'TOTAL' ? 'sd-comensal-seleccionado' : 'sd-comensal-pendiente'}`}
                        onClick={() => setSelectedComensal('TOTAL')}
                      >
                        <span>TODA LA MESA</span>
                        <strong>{formatCOP(selectedCuenta.saldo_mesa)}</strong>
                      </button>

                      {(selectedCuenta.comensales || []).map((c, i) => {
                        const owes = Number(c.saldo) > 0
                        const isSelectedChip = selectedComensal === c.comensal

                        return (
                          <button
                            key={i}
                            type="button"
                            className={`sd-comensal-chip ${
                              isSelectedChip
                                ? 'sd-comensal-seleccionado'
                                : !owes
                                ? 'sd-comensal-pagado'
                                : 'sd-comensal-pendiente'
                            }`}
                            onClick={() => owes && setSelectedComensal(c.comensal)}
                            disabled={!owes}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <User size={12} /> {c.comensal}
                            </span>
                            <strong>{owes ? formatCOP(c.saldo) : 'PAGADO ✔'}</strong>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Desglose de ítems solicitados */}
                  <div style={{ marginBottom: 24 }}>
                    <label className="sd-input-label" style={{ marginBottom: 8 }}>
                      ÍTEMS CONSUMIDOS EN SALA:
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                      {loadingDetalles ? (
                        <div style={{ padding: 12, color: 'var(--sd-text-muted)' }}>Cargando consumo...</div>
                      ) : detallesPedido.length > 0 ? (
                        detallesPedido.map((item, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                            <div>
                              <strong style={{ color: 'var(--sd-text)' }}>x{item.cantidad} {item.plato_nombre || item.nombre}</strong>
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--sd-text-muted)' }}>Comensal: {item.comensal || 'General'}</span>
                            </div>
                            <span style={{ fontFamily: 'var(--sd-font-heading)', fontWeight: 700 }}>{formatCOP(item.subtotal)}</span>
                          </div>
                        ))
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                          <span>Consumo registrado en Mesa {selectedCuenta.numero || selectedCuenta.numero_mesa}</span>
                          <strong>{formatCOP(financialDetails.subtotal)}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Desglose / Cálculo */}
                  <div className="sd-breakdown-card">
                    <div className="sd-breakdown-row">
                      <span>COBRO PARA</span>
                      <strong>{financialDetails.comensalNombre.toUpperCase()}</strong>
                    </div>
                    <div className="sd-breakdown-row">
                      <span>TOTAL A LIQUIDAR</span>
                      <strong>{formatCOP(financialDetails.subtotal)}</strong>
                    </div>

                    <div className="sd-breakdown-row">
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={includeTip}
                          onChange={(e) => setIncludeTip(e.target.checked)}
                        />
                        <span>INCLUIR PROPINA VOLUNTARIA SUGERIDA (10%)</span>
                      </label>
                      <span>{formatCOP(financialDetails.tip)}</span>
                    </div>

                    <div className="sd-breakdown-total-row">
                      <span>TOTAL A COBRAR</span>
                      <strong className="sd-total-charge-amount">{formatCOP(financialDetails.total)}</strong>
                    </div>
                  </div>

                  <form onSubmit={handleProcessPayment} className="sd-caja-form">
                    {/* Selector de Método de Pago */}
                    <div style={{ marginBottom: 16 }}>
                      <label className="sd-input-label" style={{ marginBottom: 8 }}>
                        MÉTODO DE PAGO:
                      </label>
                      <div className="sd-payment-methods-row">
                        <button
                          type="button"
                          className={`sd-method-btn ${paymentMethod === 'efectivo' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('efectivo')}
                        >
                          <DollarSign size={18} />
                          <span>EFECTIVO</span>
                        </button>
                        <button
                          type="button"
                          className={`sd-method-btn ${paymentMethod === 'tarjeta_debito' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('tarjeta_debito')}
                        >
                          <CreditCard size={18} />
                          <span>T. DÉBITO</span>
                        </button>
                        <button
                          type="button"
                          className={`sd-method-btn ${paymentMethod === 'tarjeta_credito' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('tarjeta_credito')}
                        >
                          <CreditCard size={18} />
                          <span>T. CRÉDITO</span>
                        </button>
                        <button
                          type="button"
                          className={`sd-method-btn ${paymentMethod === 'transferencia' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('transferencia')}
                        >
                          <Smartphone size={18} />
                          <span>TRANSFERENCIA</span>
                        </button>
                      </div>
                    </div>

                    {/* Detalle interactivo si es efectivo */}
                    {paymentMethod === 'efectivo' && (
                      <div className="sd-cash-details-box" style={{ background: 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 8, marginBottom: 20 }}>
                        <div className="sd-input-group">
                          <label htmlFor="efectivo-input" className="sd-input-label">
                            EFECTIVO RECIBIDO (COP):
                          </label>
                          <input
                            id="efectivo-input"
                            type="number"
                            step="1000"
                            min={financialDetails.total}
                            placeholder={financialDetails.total.toString()}
                            value={cashGiven}
                            onChange={(e) => setCashGiven(e.target.value)}
                            required
                            className="sd-input"
                          />
                        </div>

                        <div className="sd-change-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                          <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 16 }}>CAMBIO / VUELTOS:</span>
                          <strong className="sd-change-amount" style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 24, color: 'var(--sd-white)' }}>
                            {formatCOP(changeDue)}
                          </strong>
                        </div>
                      </div>
                    )}

                    {(paymentMethod === 'tarjeta_debito' || paymentMethod === 'tarjeta_credito') && (
                      <div className="sd-card-details-box" style={{ marginBottom: 20 }}>
                        <div className="sd-input-group">
                          <label htmlFor="auth-code-input" className="sd-input-label">
                            NRO. APROBACIÓN VOUCHER (OPCIONAL):
                          </label>
                          <input
                            id="auth-code-input"
                            type="text"
                            placeholder="Ej. AP-94812"
                            value={authCode}
                            onChange={(e) => setAuthCode(e.target.value)}
                            className="sd-input"
                          />
                        </div>
                      </div>
                    )}

                    {paymentMethod === 'transferencia' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'rgba(224, 165, 38, 0.1)', border: '1px solid var(--sd-gold)', borderRadius: 8, marginBottom: 20, color: 'var(--sd-gold)' }}>
                        <Sparkles size={16} />
                        <span style={{ fontSize: 14 }}>Confirmar abono en App Bancolombia / Nequi / Daviplata antes de emitir recibo.</span>
                      </div>
                    )}

                    {/* Botón rojo REGISTRAR PAGO / COBRAR */}
                    <button
                      type="submit"
                      disabled={processingPayment || financialDetails.total <= 0}
                      className="sd-btn sd-btn-primary sd-btn-block"
                      style={{ minHeight: 54, fontSize: 20 }}
                      aria-label={`Cobrar ${formatCOP(financialDetails.total)}`}
                    >
                      {processingPayment ? (
                        <>
                          <RefreshCw size={18} className="animate-spin" />
                          <span>REGISTRANDO PAGO...</span>
                        </>
                      ) : (
                        <span>COBRAR {formatCOP(financialDetails.total)}</span>
                      )}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="sd-card sd-empty-box">
                  <Receipt size={48} style={{ color: 'var(--sd-text-muted)' }} />
                  <p>SELECCIONA UNA MESA PARA COBRAR</p>
                  <small style={{ color: 'var(--sd-text-muted)' }}>
                    Elige una mesa con saldo en la columna izquierda para registrar el pago.
                  </small>
                </div>
              )}
            </main>
          </div>
        ) : (
          /* Vista de Historial de Transacciones */
          <section className="sd-card history-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 className="sd-card-title" style={{ margin: 0 }}>HISTORIAL DE PAGOS Y CIERRES</h3>
                <span style={{ color: 'var(--sd-text-muted)', fontSize: 14 }}>Transacciones registradas durante la jornada de hoy</span>
              </div>
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                onClick={() => window.print()}
                style={{ minHeight: 38, fontSize: 13 }}
              >
                <Printer size={15} />
                <span>IMPRIMIR CUADRE DE CAJA</span>
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sd-border)', textAlign: 'left', fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)' }}>
                    <th style={{ padding: '10px 14px' }}>N° TRANSACCIÓN</th>
                    <th style={{ padding: '10px 14px' }}>HORA</th>
                    <th style={{ padding: '10px 14px' }}>MESA</th>
                    <th style={{ padding: '10px 14px' }}>COMENSAL</th>
                    <th style={{ padding: '10px 14px' }}>MÉTODO</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>TOTAL COBRADO</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>ESTADO</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((tx, idx) => (
                    <tr key={tx.id_transaccion || idx} style={{ borderBottom: '1px solid var(--sd-border)' }}>
                      <td style={{ padding: '12px 14px', fontFamily: 'var(--sd-font-heading)', fontWeight: 700, color: 'var(--sd-white)' }}>
                        {tx.id_transaccion}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{tx.hora}</td>
                      <td style={{ padding: '12px 14px', fontWeight: 700 }}>{tx.mesa}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--sd-text-muted)' }}>{tx.comensal || tx.cliente || 'Mesa'}</td>
                      <td style={{ padding: '12px 14px', textTransform: 'uppercase' }}>{tx.metodo_pago.replace('_', ' ')}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700 }}>{formatCOP(tx.monto)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span className="sd-badge sd-badge-white">Completada</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Modal de Recibo Impreso / Confirmación */}
      {paidReceipt && (
        <div className="sd-modal-backdrop" onClick={() => setPaidReceipt(null)}>
          <div
            className="sd-card sd-table-detail-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 480 }}
          >
            <div className="sd-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <CheckCircle2 size={24} style={{ color: 'var(--sd-white)' }} />
                <div>
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 24 }}>
                    Pago Procesado con Éxito
                  </h3>
                  <small style={{ color: 'var(--sd-text-muted)' }}>Transacción guardada en base de datos</small>
                </div>
              </div>
              <button
                type="button"
                className="sd-topbar-icon-btn"
                onClick={() => setPaidReceipt(null)}
                aria-label="Cerrar recibo"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ margin: '20px 0', padding: 20, background: 'rgba(0,0,0,0.3)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'center', borderBottom: '1px solid var(--sd-border)', paddingBottom: 12 }}>
                <h4 style={{ fontFamily: 'var(--sd-font-heading)', margin: 0, fontSize: 22 }}>SMARTDINING</h4>
                <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--sd-text-muted)' }}>Comprobante de Pago POS</p>
                <small style={{ fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-white)' }}>{paidReceipt.id_transaccion}</small>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 14 }}>
                <div><span style={{ color: 'var(--sd-text-muted)' }}>Mesa:</span> <strong>{paidReceipt.mesa}</strong></div>
                <div><span style={{ color: 'var(--sd-text-muted)' }}>Comensal:</span> {paidReceipt.comensal}</div>
                <div><span style={{ color: 'var(--sd-text-muted)' }}>Método:</span> {paidReceipt.metodo_pago.toUpperCase()}</div>
                <div><span style={{ color: 'var(--sd-text-muted)' }}>Hora:</span> {paidReceipt.hora}</div>
              </div>

              <div style={{ borderTop: '1px solid var(--sd-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Subtotal:</span>
                  <span>{formatCOP(paidReceipt.subtotal)}</span>
                </div>
                {paidReceipt.tip > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Propina (10%):</span>
                    <span>{formatCOP(paidReceipt.tip)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--sd-font-heading)', fontSize: 20, fontWeight: 800, borderTop: '1px solid var(--sd-border)', paddingTop: 6 }}>
                  <span>TOTAL:</span>
                  <span>{formatCOP(paidReceipt.total)}</span>
                </div>
                {paidReceipt.cashGiven && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--sd-text-muted)' }}>
                      <span>Efectivo:</span>
                      <span>{formatCOP(paidReceipt.cashGiven)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--sd-text-muted)' }}>
                      <span>Cambio:</span>
                      <span>{formatCOP(paidReceipt.changeDue)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="sd-btn sd-btn-primary"
                style={{ flex: 1, minHeight: 44, fontSize: 15 }}
                onClick={() => window.print()}
              >
                <Printer size={16} />
                <span>IMPRIMIR RECIBO</span>
              </button>
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                style={{ minHeight: 44, fontSize: 15 }}
                onClick={() => setPaidReceipt(null)}
              >
                CERRAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

