import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
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
import { useAuth, useSocketListener, useTables } from '../hooks'
import { crearUltimaPeticion } from '../utils/ultimaPeticion'
import {
  puedeUsarCaja,
  comensalDelCobro,
  idCobroParaEnviar,
  mensajeDeErrorCobro,
  descartarIdCobro,
  agruparCobros,
  horaBogota,
  usaVoucher,
  voucherDelCobro,
  VOUCHER_MAX,
} from '../utils/caja'

function formatCOP(monto) {
  const num = Number(monto) || 0
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(num)
}

function getCurrentTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * La Caja es de admin y cajero (el backend da 403 al resto). Al mesero ni se le
 * muestra el enlace; si llega por la URL, vuelve al inicio.
 */
export function Caja() {
  const { user } = useAuth()
  if (!puedeUsarCaja(user?.rol)) return <Navigate to="/" replace />
  return <CajaRegistradora />
}

function CajaRegistradora() {
  const { cargarMesas } = useTables()
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(() => Boolean(getAuthToken()))
  const [errorMessage, setErrorMessage] = useState(null)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [errorCobro, setErrorCobro] = useState(null)

  // El cobro en curso: { clave, id_cobro }. Se guarda ANTES de enviar y solo se
  // borra cuando el backend confirma (201 o 200 duplicado). Así un doble clic o
  // un reintento tras un error de red repite el MISMO id_cobro y el backend no
  // cobra dos veces; un cobro distinto (otra mesa, persona, monto o método)
  // lleva un id nuevo.
  const cobroPendiente = useRef(null)
  // Bloqueo síncrono: el estado `processingPayment` tarda un render en llegar,
  // y un doble clic dispara dos submit antes.
  const enviando = useRef(false)

  // Cuentas reales cargadas desde el backend
  const [cuentasMesas, setCuentasMesas] = useState([])
  // "Cobrar en Caja" desde el detalle de una mesa llega con ?mesa=ID.
  const [selectedMesaId, setSelectedMesaId] = useState(() => Number(searchParams.get('mesa')) || null)
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

  // Lo cobrado hoy, del BACKEND (GET /transacciones?desde=hoy, #158): "Recaudado
  // hoy" es su `total` y el Historial sus filas. Antes salían de sessionStorage,
  // así que en otra pestaña, otro equipo, otro cajero o al reabrir la Caja se
  // veía $0 aunque ya se hubiera cobrado. null = todavía no se sabe.
  const [dia, setDia] = useState(null)
  const [errorDia, setErrorDia] = useState(null)

  const cargarDia = useCallback(async () => {
    try {
      const d = await transaccionesApi.delDia('hoy')
      setDia(d)
      setErrorDia(null)
    } catch (err) {
      setErrorDia(err?.message || 'error desconocido')
    }
  }, [])

  useEffect(() => {
    let cancel = false
    // El historial viejo de la pestaña ya no se usa.
    try {
      sessionStorage.removeItem('smartdining_caja_history')
    } catch {
      // Sin almacenamiento no hay nada que borrar.
    }
    transaccionesApi
      .delDia('hoy')
      .then((d) => {
        if (!cancel) {
          setDia(d)
          setErrorDia(null)
        }
      })
      .catch((err) => {
        if (!cancel) setErrorDia(err?.message || 'error desconocido')
      })
    return () => {
      cancel = true
    }
  }, [])

  const cobrosDelDia = useMemo(() => agruparCobros(dia?.transacciones || []), [dia])

  // Solo cuenta la última recarga de cuentas (T4): ver utils/ultimaPeticion.
  const [ultimaCarga] = useState(() => crearUltimaPeticion())

  /**
   * Carga las cuentas de todas las mesas ocupadas desde la API.
   *
   * Varias recargas pueden salir seguidas (quitar dos platos, un cobro, el
   * pedido que pasa a cancelado...) y responder en otro orden. Solo se aplica
   * la respuesta de la ÚLTIMA: una vieja que llega tarde ya no pisa el saldo.
   */
  const cargarCuentas = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    const peticion = ultimaCarga.nueva()
    setLoading(true)
    setErrorMessage(null)

    try {
      // 1. Estado actual de las mesas
      const mesasRes = await mesasApi.listar()
      const listaMesas = mesasRes?.mesas || []

      // 2. Para cada mesa ocupada, su cuenta desglosada
      const mesasOcupadas = listaMesas.filter(
        (m) => m.estado === 'ocupada' || Boolean(m.sesion_abierta)
      )

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

      if (!peticion.vigente()) return
      setCuentasMesas(cuentas)

      // Seleccionar automáticamente la primera mesa si no hay una elegida
      setSelectedMesaId((prev) => {
        if (prev && cuentas.some((c) => c.id_mesa === prev)) return prev
        return cuentas[0]?.id_mesa || null
      })
    } catch (err) {
      if (!peticion.vigente()) return
      console.warn('Aviso al cargar cuentas de caja:', err.message)
      setErrorMessage('No se pudieron consultar las cuentas del salón.')
    } finally {
      if (peticion.vigente()) setLoading(false)
    }
  }, [ultimaCarga])

  const handleSelectMesa = useCallback((mesaId) => {
    setSelectedMesaId(mesaId)
    setSelectedComensal('TOTAL')
    setErrorCobro(null)
  }, [])

  // Cargar cuentas al montar, en la microtarea siguiente (fuera del cuerpo del
  // efecto: el estado inicial ya es «cargando»). Al desmontar, lo que esté en
  // vuelo se descarta.
  useEffect(() => {
    let montada = true
    Promise.resolve().then(() => {
      if (montada) cargarCuentas()
    })
    return () => {
      montada = false
      ultimaCarga.invalidar()
    }
  }, [cargarCuentas, ultimaCarga])

  // Al (re)conectar el socket se recargan las cuentas y lo cobrado hoy: los
  // avisos que llegaron con el socket caído se perdieron (T4).
  useSocketListener('connect', () => {
    cargarCuentas()
    cargarDia()
  })

  // Escuchar eventos de WebSockets en tiempo real para mantener la caja sincronizada
  useSocketListener('order:created', () => cargarCuentas())
  useSocketListener('order:status', () => cargarCuentas())
  // Un plato cancelado (D-13 o el comensal) baja el saldo de la mesa.
  useSocketListener('item:cancelado', () => cargarCuentas())
  useSocketListener('payment:confirmed', (data) => {
    cargarCuentas()
    // Cualquier cobro (esta caja, otra, o un pago en línea) cambia lo recaudado.
    cargarDia()
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

  // Ítems de TODOS los pedidos de la mesa (antes solo los del primero)
  useEffect(() => {
    let cancel = false

    async function cargarItemsPedido() {
      if (!selectedCuenta || !selectedCuenta.pedidos || selectedCuenta.pedidos.length === 0) {
        setDetallesPedido([])
        return
      }

      setLoadingDetalles(true)
      try {
        const respuestas = await Promise.all(
          selectedCuenta.pedidos.map((p) => pedidosApi.obtener(p.id_pedido).catch(() => null))
        )
        if (!cancel) setDetallesPedido(respuestas.flatMap((r) => r?.detalles || []))
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

  // Cobro de MESA: un solo POST /api/transacciones/mesa; el backend reparte el
  // monto entre los pedidos de la mesa (antes iba entero al primer pedido).
  const handleProcessPayment = async (e) => {
    e.preventDefault()
    if (!selectedCuenta || enviando.current) return
    setErrorCobro(null)

    if (paymentMethod === 'efectivo' && numericCash < financialDetails.total) {
      setErrorCobro(
        `El efectivo recibido (${formatCOP(numericCash)}) es menor al total a pagar (${formatCOP(financialDetails.total)}).`
      )
      return
    }

    // Voucher del datáfono (script 35): solo con tarjeta; se revisa el formato
    // antes de enviar para no gastar un intento en un 400.
    const voucher = voucherDelCobro(paymentMethod, authCode)
    if (voucher.error) {
      setErrorCobro(voucher.error)
      return
    }

    // La propina no entra en el monto: el backend solo cubre el saldo de los
    // pedidos (un monto mayor es 409 excede). Queda en el recibo.
    const datos = {
      id_mesa: selectedCuenta.id_mesa,
      comensal: comensalDelCobro(selectedComensal),
      monto: financialDetails.subtotal,
      metodo_pago: paymentMethod,
    }
    // Mismo cobro que el intento anterior sin confirmar → mismo id_cobro.
    const cobro = idCobroParaEnviar(cobroPendiente.current, datos)
    cobroPendiente.current = cobro
    enviando.current = true
    setProcessingPayment(true)

    try {
      const res = await transaccionesApi.cobrarMesa({ ...datos, id_cobro: cobro.id_cobro, voucher: voucher.voucher })
      // Confirmado (201, o 200 si ya se había cobrado): el próximo cobro es otro.
      cobroPendiente.current = null

      const transacciones = res?.transacciones || []
      const codigos = transacciones
        .map((t) => selectedCuenta.pedidos?.find((p) => p.id_pedido === t.id_pedido)?.codigo_pedido || `#${t.id_pedido}`)
      const receipt = {
        id_transaccion: transacciones.length
          ? transacciones.map((t) => `TRX-${t.id_transaccion}`).join(' · ')
          : `COBRO ${cobro.id_cobro.slice(0, 8).toUpperCase()}`,
        duplicado: Boolean(res?.duplicado),
        pedidos: codigos,
        mesa: `Mesa ${selectedCuenta.numero || selectedCuenta.numero_mesa}`,
        comensal: financialDetails.comensalNombre,
        metodo_pago: paymentMethod,
        subtotal: financialDetails.subtotal,
        tip: financialDetails.tip,
        total: financialDetails.total,
        cashGiven: paymentMethod === 'efectivo' ? numericCash : null,
        changeDue: paymentMethod === 'efectivo' ? changeDue : null,
        // El que guardó el backend. En un duplicado vale el del primer envío,
        // que esta respuesta no trae: no se muestra uno que quizá no se guardó.
        voucher: transacciones.find((t) => t.voucher)?.voucher
          ?? (res?.duplicado ? null : voucher.voucher),
        saldoRestante: Number(res?.saldo_restante) || 0,
        mesaLiberada: Boolean(res?.mesa_liberada),
        hora: getCurrentTime(),
      }

      setPaidReceipt(receipt)
      setCashGiven('')
      setAuthCode('')
      // Los avisos de tiempo real (payment:confirmed, order:status,
      // mesa:liberada) los manda el backend después del COMMIT. "Recaudado hoy"
      // y el Historial se vuelven a pedir aquí también, sin esperar al aviso
      // (también tras un duplicado: no cambia nada, pero queda al día).
      await Promise.all([cargarCuentas(), cargarDia()])
      await cargarMesas()
    } catch (err) {
      // 409 id_cobro_en_uso: no se cobró nada y ese id es de otro cobro; el
      // siguiente clic lleva un id_cobro nuevo.
      if (descartarIdCobro(err)) cobroPendiente.current = null
      setErrorCobro(mensajeDeErrorCobro(err, formatCOP))
      // El saldo cambió por otro lado: se recarga para que el cajero vea el real.
      if (err?.motivo === 'excede' || err?.motivo === 'sin_cuenta') await cargarCuentas()
    } finally {
      enviando.current = false
      setProcessingPayment(false)
    }
  }

  // "Recaudado hoy": el total que da el backend (la propina no se registra, así
  // que no entra). Mientras carga, "…"; si no se pudo, "—" y no un $0 engañoso.
  const textoRecaudadoHoy = dia ? formatCOP(dia.total) : errorDia ? '—' : '…'

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
              HISTORIAL DE PAGOS <span>{cobrosDelDia.length}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 16, textTransform: 'uppercase' }}>
              SALDO SALÓN: <strong>{formatCOP(totalSaldoSalon)}</strong>
            </span>
            <button
              type="button"
              className="sd-red-band-btn"
              onClick={() => { cargarCuentas(); cargarDia() }}
              disabled={loading}
              title="Actualizar cuentas y lo recaudado hoy"
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
            <span data-testid="recaudado-hoy" title={errorDia ? `No se pudo cargar lo recaudado hoy: ${errorDia}` : undefined}>
              {textoRecaudadoHoy} RECAUDADO HOY
            </span>
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
                      {selectedCuenta.pedidos?.length === 1 && selectedCuenta.pedidos[0].codigo_pedido
                        ? `PEDIDO ${selectedCuenta.pedidos[0].codigo_pedido} · `
                        : selectedCuenta.pedidos?.length > 1
                        ? `${selectedCuenta.pedidos.length} PEDIDOS · `
                        : ''}
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
                          {/* Sin min/step/required: con step=1000 y min=total, un total
                              que no es múltiplo de 1.000 (con propina, o un saldo de
                              34.500) hacía que el navegador rechazara 50.000 en
                              silencio. El mínimo lo comprueba handleProcessPayment. */}
                          <input
                            id="efectivo-input"
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="any"
                            placeholder={financialDetails.total.toString()}
                            value={cashGiven}
                            onChange={(e) => setCashGiven(e.target.value)}
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

                    {usaVoucher(paymentMethod) && (
                      <div className="sd-card-details-box" style={{ marginBottom: 20 }}>
                        <div className="sd-input-group">
                          <label htmlFor="auth-code-input" className="sd-input-label">
                            NRO. APROBACIÓN VOUCHER (OPCIONAL):
                          </label>
                          {/* Se guarda en mayúsculas, como lo deja el backend.
                              Letras, números y guiones; el formato se revisa
                              al cobrar (handleProcessPayment). */}
                          <input
                            id="auth-code-input"
                            type="text"
                            placeholder="Ej. AP-94812"
                            maxLength={VOUCHER_MAX}
                            autoComplete="off"
                            spellCheck={false}
                            value={authCode}
                            onChange={(e) => setAuthCode(e.target.value.toUpperCase())}
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

                    {errorCobro && (
                      <div className="table-toast-banner error" role="alert" style={{ marginBottom: 16 }}>
                        <span>{errorCobro}</span>
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
                  {errorDia && !dia && (
                    <tr>
                      <td colSpan={7} role="alert" style={{ padding: '12px 14px', color: 'var(--sd-red)' }}>
                        No se pudo cargar el historial de hoy: {errorDia}. Pulsa ACTUALIZAR.
                      </td>
                    </tr>
                  )}
                  {dia && cobrosDelDia.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: '12px 14px', color: 'var(--sd-text-muted)' }}>Todavía no hay cobros hoy.</td>
                    </tr>
                  )}
                  {cobrosDelDia.map((cobro) => (
                    <tr key={cobro.clave} style={{ borderBottom: '1px solid var(--sd-border)' }}>
                      <td style={{ padding: '12px 14px', fontFamily: 'var(--sd-font-heading)', fontWeight: 700, color: 'var(--sd-white)' }}>
                        {cobro.ids.map((id) => `TRX-${id}`).join(' · ')}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{horaBogota(cobro.fecha)}</td>
                      <td style={{ padding: '12px 14px', fontWeight: 700 }}>Mesa {cobro.numero_mesa}</td>
                      <td style={{ padding: '12px 14px', color: 'var(--sd-text-muted)' }}>{cobro.comensal || 'Mesa'}</td>
                      <td style={{ padding: '12px 14px', textTransform: 'uppercase' }}>
                        {String(cobro.metodo_pago || '').replace('_', ' ')}
                        {cobro.voucher && (
                          <small style={{ display: 'block', color: 'var(--sd-text-muted)', textTransform: 'none' }}>
                            Voucher {cobro.voucher}
                          </small>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700 }}>{formatCOP(cobro.monto)}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span className="sd-badge sd-badge-white">Completada</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {dia && cobrosDelDia.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ padding: '12px 14px', fontFamily: 'var(--sd-font-heading)', textTransform: 'uppercase' }}>Total del día</td>
                      <td data-testid="total-historial" style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800 }}>{formatCOP(dia.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
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
                  <small style={{ color: 'var(--sd-text-muted)' }}>
                    {paidReceipt.duplicado
                      ? 'Este cobro ya estaba registrado: no se cobró otra vez'
                      : 'Transacción guardada en base de datos'}
                  </small>
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
                {paidReceipt.pedidos?.length > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--sd-text-muted)' }}>Pedidos:</span> {paidReceipt.pedidos.join(', ')}</div>
                )}
                {paidReceipt.voucher && (
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--sd-text-muted)' }}>Voucher:</span> {paidReceipt.voucher}</div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--sd-text-muted)' }}>Saldo de la mesa:</span>{' '}
                  <strong>{paidReceipt.mesaLiberada ? 'PAGADA · mesa liberada' : formatCOP(paidReceipt.saldoRestante)}</strong>
                </div>
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

