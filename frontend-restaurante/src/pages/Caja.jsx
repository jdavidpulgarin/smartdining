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
import { mesasApi, pedidosApi, transaccionesApi, excedentesApi, getAuthToken } from '../services/api'
import { useAuth, useSocketListener, useTables } from '../hooks'
import { crearUltimaPeticion } from '../utils/ultimaPeticion'
import {
  puedeUsarCaja,
  mesaConSesionActiva,
  comensalDelCobro,
  idCobroParaEnviar,
  mensajeDeErrorCobro,
  recargarCuentasTrasError,
  descartarIdCobro,
  agruparCobros,
  horaBogota,
  usaVoucher,
  voucherDelCobro,
  VOUCHER_MAX,
} from '../utils/caja'
import { listaExcedentes, textoExcedente, yaNoPendiente, mensajeErrorDevuelto } from '../utils/excedentes'
import '../styles/caja.css'

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
  const { cargarMesas, tables } = useTables()
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
      const mesasOcupadas = listaMesas.filter(mesaConSesionActiva)

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

  // T4 (§8.7): excedentes del pago en línea por devolver en efectivo. Se cargan
  // al montar, al (re)conectar y con cada pago:excedente (solo llega al panel).
  const [excedentes, setExcedentes] = useState([])
  const [avisoExcedente, setAvisoExcedente] = useState(null)
  const [devolviendo, setDevolviendo] = useState(null)
  const cargarExcedentes = useCallback(async () => {
    try {
      setExcedentes(listaExcedentes(await excedentesApi.pendientes()))
    } catch {
      // Sin respuesta se queda la lista que había; el próximo aviso la recarga.
    }
  }, [])
  useEffect(() => {
    let cancel = false
    excedentesApi
      .pendientes()
      .then((r) => {
        if (!cancel) setExcedentes(listaExcedentes(r))
      })
      .catch(() => {
        // Sin respuesta: la lista vacía; el próximo aviso o la reconexión la cargan.
      })
    return () => {
      cancel = true
    }
  }, [])
  useSocketListener('pago:excedente', () => cargarExcedentes())
  const numeroMesa = useCallback(
    (id) => (tables || []).find((t) => Number(t.id_mesa ?? t.id) === Number(id))?.numero ?? id,
    [tables]
  )
  const marcarDevuelto = async (x) => {
    setDevolviendo(x.id)
    setAvisoExcedente(null)
    try {
      await excedentesApi.marcarDevuelto(x.id)
      setExcedentes((l) => l.filter((e) => e.id !== x.id))
    } catch (err) {
      setAvisoExcedente(mensajeErrorDevuelto(err))
      if (yaNoPendiente(err)) setExcedentes((l) => l.filter((e) => e.id !== x.id))
    } finally {
      setDevolviendo(null)
      cargarExcedentes()
    }
  }

  // Al (re)conectar el socket se recargan las cuentas y lo cobrado hoy: los
  // avisos que llegaron con el socket caído se perdieron (T4).
  useSocketListener('connect', () => {
    cargarCuentas()
    cargarDia()
    cargarExcedentes()
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
      if (recargarCuentasTrasError(err)) await cargarCuentas()
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
    <div className="caja-pagina tema-comanda">
      <div className="caja-cont">
        {/* Encabezado: título, resumen del día y acciones */}
        <header className="caja-cab">
          <div>
            <h1 className="caja-titulo">CAJA REGISTRADORA</h1>
            <p className="caja-sub">Cobros y cierres del turno</p>
          </div>
          <div className="caja-acciones">
            <span className="caja-saldo-salon">
              SALDO SALÓN: <strong>{formatCOP(totalSaldoSalon)}</strong>
            </span>
            <button
              type="button"
              className="caja-btn caja-btn-claro"
              onClick={() => { cargarCuentas(); cargarDia() }}
              disabled={loading}
              title="Actualizar cuentas y lo recaudado hoy"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span>ACTUALIZAR</span>
            </button>
          </div>
        </header>

        <div className="caja-resumen">
          <span data-testid="recaudado-hoy" title={errorDia ? `No se pudo cargar lo recaudado hoy: ${errorDia}` : undefined}>
            {textoRecaudadoHoy} RECAUDADO HOY
          </span>
          <span className="caja-resumen-sep" aria-hidden="true">·</span>
          <span>{cuentasMesas.length} CUENTAS PENDIENTES</span>
          <span className="caja-resumen-sep" aria-hidden="true">·</span>
          <span className="caja-resumen-alerta">{formatCOP(totalSaldoSalon)} POR COBRAR</span>
        </div>

        {/* Pestañas: cuentas por cobrar e historial del día */}
        <div className="caja-tabs">
          <button
            type="button"
            className={`caja-tab ${activeTab === 'pendientes' ? 'activa' : ''}`}
            onClick={() => setActiveTab('pendientes')}
          >
            CUENTAS POR COBRAR <span>{cuentasMesas.length}</span>
          </button>
          <button
            type="button"
            className={`caja-tab ${activeTab === 'historial' ? 'activa' : ''}`}
            onClick={() => setActiveTab('historial')}
          >
            HISTORIAL DE PAGOS <span>{cobrosDelDia.length}</span>
          </button>
        </div>

        {(excedentes.length > 0 || avisoExcedente) && (
          <section
            aria-labelledby="titulo-excedentes"
            data-testid="caja-excedentes"
            className="caja-excedentes"
            role="alert"
          >
            {excedentes.length > 0 && (
              <h2 id="titulo-excedentes" className="caja-excedentes-titulo">
                Devolver en efectivo ({excedentes.length})
              </h2>
            )}
            {excedentes.map((x) => (
              <div key={x.id} className="caja-excedente">
                <span>{textoExcedente(x, formatCOP, numeroMesa)}</span>
                <button
                  type="button"
                  className="caja-btn caja-btn-mini"
                  onClick={() => marcarDevuelto(x)}
                  disabled={devolviendo === x.id}
                >
                  {devolviendo === x.id ? 'Marcando…' : 'Devuelto en efectivo'}
                </button>
              </div>
            ))}
            {avisoExcedente && <span>{avisoExcedente}</span>}
          </section>
        )}

        {errorMessage && (
          <div className="caja-aviso">
            <span>{errorMessage}</span>
          </div>
        )}

        {activeTab === 'pendientes' ? (
          <div className="caja-layout">
            {/* Cuentas pendientes (ticket de papel) */}
            <aside className="caja-ticket caja-cuentas">
              <h2 className="caja-banda">
                MESAS CON SALDO ({cuentasMesas.length})
              </h2>

              {loading && cuentasMesas.length === 0 ? (
                <div className="caja-vacio">
                  <RefreshCw size={28} className="animate-spin" />
                  <p>CONSULTANDO CUENTAS DEL SALÓN...</p>
                </div>
              ) : cuentasMesas.length === 0 ? (
                <div className="caja-vacio">
                  <CheckCircle2 size={36} />
                  <p>NO HAY CUENTAS PENDIENTES</p>
                  <small>Todas las mesas están al día o libres</small>
                </div>
              ) : (
                <div className="caja-cuentas-lista">
                  {cuentasMesas.map((cuenta) => {
                    const isSelected = cuenta.id_mesa === selectedMesaId
                    const mesaNum = cuenta.numero || cuenta.numero_mesa

                    return (
                      <button
                        key={cuenta.id_mesa}
                        type="button"
                        className={`caja-cuenta ${isSelected ? 'activa' : ''}`}
                        onClick={() => handleSelectMesa(cuenta.id_mesa)}
                      >
                        <div>
                          <strong className="caja-cuenta-mesa">
                            Mesa {mesaNum}
                          </strong>
                          <span className="caja-cuenta-meta">
                            <Users size={12} /> {cuenta.comensales?.length || 1} COMENSALES · {cuenta.ubicacion || cuenta.ubicacion_mesa || 'SALÓN'}
                          </span>
                        </div>
                        <strong className="caja-cuenta-saldo">
                          {formatCOP(cuenta.saldo_mesa)}
                        </strong>
                      </button>
                    )
                  })}
                </div>
              )}
            </aside>

            {/* Cobro de la mesa elegida (ticket de papel) */}
            <section className="caja-cobro">
              {selectedCuenta ? (
                <div className="caja-ticket">
                  <header className="caja-cobro-cab">
                    <h2 className="caja-banda caja-cobro-titulo">
                      COBRAR / MESA {selectedCuenta.numero || selectedCuenta.numero_mesa}
                    </h2>
                    <span className="caja-cobro-meta">
                      {selectedCuenta.pedidos?.length === 1 && selectedCuenta.pedidos[0].codigo_pedido
                        ? `PEDIDO ${selectedCuenta.pedidos[0].codigo_pedido} · `
                        : selectedCuenta.pedidos?.length > 1
                        ? `${selectedCuenta.pedidos.length} PEDIDOS · `
                        : ''}
                      UBICACIÓN: {(selectedCuenta.ubicacion || selectedCuenta.ubicacion_mesa || 'PRINCIPAL').toUpperCase()}
                    </span>
                  </header>

                  <div className="caja-cuerpo">
                    {/* Saldo grande de la mesa */}
                    <div className="caja-saldo">
                      <span className="caja-lbl">SALDO PENDIENTE MESA</span>
                      <strong className="caja-saldo-monto">
                        {formatCOP(selectedCuenta.saldo_mesa)}
                      </strong>
                    </div>

                    {/* División de la cuenta: toda la mesa o por comensal */}
                    <div className="caja-campo">
                      <label className="caja-lbl">
                        SELECCIONAR COBRO (DIVISIÓN DE CUENTA):
                      </label>
                      <div className="caja-comensales">
                        <button
                          type="button"
                          className={`caja-comensal ${selectedComensal === 'TOTAL' ? 'activa' : ''}`}
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
                              className={`caja-comensal ${
                                isSelectedChip
                                  ? 'activa'
                                  : !owes
                                  ? 'pagado'
                                  : ''
                              }`}
                              onClick={() => owes && setSelectedComensal(c.comensal)}
                              disabled={!owes}
                            >
                              <span>
                                <User size={12} /> {c.comensal}
                              </span>
                              <strong>{owes ? formatCOP(c.saldo) : 'PAGADO ✔'}</strong>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Ítems consumidos */}
                    <div className="caja-campo">
                      <label className="caja-lbl">
                        ÍTEMS CONSUMIDOS EN SALA:
                      </label>
                      <div className="caja-items">
                        {loadingDetalles ? (
                          <div className="caja-item caja-item-carga">Cargando consumo...</div>
                        ) : detallesPedido.length > 0 ? (
                          detallesPedido.map((item, idx) => (
                            <div key={idx} className="caja-item">
                              <div>
                                <strong>x{item.cantidad} {item.plato_nombre || item.nombre}</strong>
                                <span>Comensal: {item.comensal || 'General'}</span>
                              </div>
                              <b>{formatCOP(item.subtotal)}</b>
                            </div>
                          ))
                        ) : (
                          <div className="caja-item">
                            <span>Consumo registrado en Mesa {selectedCuenta.numero || selectedCuenta.numero_mesa}</span>
                            <b>{formatCOP(financialDetails.subtotal)}</b>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="caja-corte" aria-hidden="true"></div>

                    {/* Desglose del cobro */}
                    <div className="caja-desglose">
                      <div className="caja-desglose-fila">
                        <span>COBRO PARA</span>
                        <strong>{financialDetails.comensalNombre.toUpperCase()}</strong>
                      </div>
                      <div className="caja-desglose-fila">
                        <span>TOTAL A LIQUIDAR</span>
                        <strong>{formatCOP(financialDetails.subtotal)}</strong>
                      </div>

                      <div className="caja-desglose-fila">
                        <label className="caja-propina">
                          <input
                            type="checkbox"
                            checked={includeTip}
                            onChange={(e) => setIncludeTip(e.target.checked)}
                          />
                          <span>INCLUIR PROPINA VOLUNTARIA SUGERIDA (10%)</span>
                        </label>
                        <span>{formatCOP(financialDetails.tip)}</span>
                      </div>

                      <div className="caja-total">
                        <span>TOTAL A COBRAR</span>
                        <strong>{formatCOP(financialDetails.total)}</strong>
                      </div>
                    </div>

                    <form onSubmit={handleProcessPayment} className="caja-form">
                      {/* Método de pago */}
                      <div className="caja-campo">
                        <label className="caja-lbl">
                          MÉTODO DE PAGO:
                        </label>
                        <div className="caja-metodos">
                          <button
                            type="button"
                            className={`caja-metodo ${paymentMethod === 'efectivo' ? 'activa' : ''}`}
                            onClick={() => setPaymentMethod('efectivo')}
                          >
                            <DollarSign size={18} />
                            <span>EFECTIVO</span>
                          </button>
                          <button
                            type="button"
                            className={`caja-metodo ${paymentMethod === 'tarjeta_debito' ? 'activa' : ''}`}
                            onClick={() => setPaymentMethod('tarjeta_debito')}
                          >
                            <CreditCard size={18} />
                            <span>T. DÉBITO</span>
                          </button>
                          <button
                            type="button"
                            className={`caja-metodo ${paymentMethod === 'tarjeta_credito' ? 'activa' : ''}`}
                            onClick={() => setPaymentMethod('tarjeta_credito')}
                          >
                            <CreditCard size={18} />
                            <span>T. CRÉDITO</span>
                          </button>
                          <button
                            type="button"
                            className={`caja-metodo ${paymentMethod === 'transferencia' ? 'activa' : ''}`}
                            onClick={() => setPaymentMethod('transferencia')}
                          >
                            <Smartphone size={18} />
                            <span>TRANSFERENCIA</span>
                          </button>
                        </div>
                      </div>

                      {/* Efectivo: recibido y vueltos */}
                      {paymentMethod === 'efectivo' && (
                        <div className="caja-efectivo">
                          <div className="caja-campo">
                            <label htmlFor="efectivo-input" className="caja-lbl">
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
                              className="caja-inp"
                            />
                          </div>

                          <div className="caja-cambio">
                            <span>CAMBIO / VUELTOS:</span>
                            <strong>{formatCOP(changeDue)}</strong>
                          </div>
                        </div>
                      )}

                      {usaVoucher(paymentMethod) && (
                        <div className="caja-campo">
                          <label htmlFor="auth-code-input" className="caja-lbl">
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
                            className="caja-inp"
                          />
                        </div>
                      )}

                      {paymentMethod === 'transferencia' && (
                        <div className="caja-nota">
                          <Sparkles size={16} />
                          <span>Confirmar abono en App Bancolombia / Nequi / Daviplata antes de emitir recibo.</span>
                        </div>
                      )}

                      {errorCobro && (
                        <div className="caja-error" role="alert">
                          <span>{errorCobro}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={processingPayment || financialDetails.total <= 0}
                        className="caja-btn caja-btn-cobrar"
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
                </div>
              ) : (
                <div className="caja-ticket caja-vacio caja-vacio-cobro">
                  <Receipt size={44} />
                  <p>SELECCIONA UNA MESA PARA COBRAR</p>
                  <small>
                    Elige una mesa con saldo en la columna izquierda para registrar el pago.
                  </small>
                </div>
              )}
            </section>
          </div>
        ) : (
          /* Historial de pagos del día */
          <section className="caja-ticket caja-historial history-panel">
            <div className="caja-banda caja-historial-cab">
              <div>
                <h3 className="caja-historial-titulo">HISTORIAL DE PAGOS Y CIERRES</h3>
                <span>Transacciones registradas durante la jornada de hoy</span>
              </div>
              <button
                type="button"
                className="caja-btn caja-btn-mini caja-btn-ambar"
                onClick={() => window.print()}
              >
                <Printer size={15} />
                <span>IMPRIMIR CUADRE DE CAJA</span>
              </button>
            </div>

            <div className="caja-tabla">
              <table>
                <thead>
                  <tr>
                    <th>N° TRANSACCIÓN</th>
                    <th>HORA</th>
                    <th>MESA</th>
                    <th>COMENSAL</th>
                    <th>MÉTODO</th>
                    <th className="der">TOTAL COBRADO</th>
                    <th className="centro">ESTADO</th>
                  </tr>
                </thead>
                <tbody>
                  {errorDia && !dia && (
                    <tr>
                      <td colSpan={7} role="alert" className="caja-tabla-error">
                        No se pudo cargar el historial de hoy: {errorDia}. Pulsa ACTUALIZAR.
                      </td>
                    </tr>
                  )}
                  {dia && cobrosDelDia.length === 0 && (
                    <tr>
                      <td colSpan={7} className="caja-tabla-vacia">Todavía no hay cobros hoy.</td>
                    </tr>
                  )}
                  {cobrosDelDia.map((cobro) => (
                    <tr key={cobro.clave}>
                      <td className="caja-trx">
                        {cobro.ids.map((id) => `TRX-${id}`).join(' · ')}
                      </td>
                      <td>{horaBogota(cobro.fecha)}</td>
                      <td className="caja-tabla-mesa">Mesa {cobro.numero_mesa}</td>
                      <td className="caja-tabla-suave">{cobro.comensal || 'Mesa'}</td>
                      <td className="caja-tabla-metodo">
                        {String(cobro.metodo_pago || '').replace('_', ' ')}
                        {cobro.voucher && (
                          <small>
                            Voucher {cobro.voucher}
                          </small>
                        )}
                      </td>
                      <td className="der caja-tabla-monto">{formatCOP(cobro.monto)}</td>
                      <td className="centro">
                        <span className="caja-estado">Completada</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {dia && cobrosDelDia.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={5}>Total del día</td>
                      <td data-testid="total-historial" className="der">{formatCOP(dia.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Recibo del cobro */}
      {paidReceipt && (
        <div className="caja-velo" onClick={() => setPaidReceipt(null)}>
          <div
            className="caja-ticket caja-recibo"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="caja-banda caja-recibo-cab">
              <div className="caja-recibo-titulo">
                <CheckCircle2 size={22} />
                <div>
                  <h3>
                    Pago Procesado con Éxito
                  </h3>
                  <small>
                    {paidReceipt.duplicado
                      ? 'Este cobro ya estaba registrado: no se cobró otra vez'
                      : 'Transacción guardada en base de datos'}
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="caja-recibo-cerrar"
                onClick={() => setPaidReceipt(null)}
                aria-label="Cerrar recibo"
              >
                <X size={18} />
              </button>
            </div>

            <div className="caja-recibo-cuerpo">
              <div className="caja-recibo-marca">
                <h4>SMARTDINING</h4>
                <p>Comprobante de Pago POS</p>
                <small>{paidReceipt.id_transaccion}</small>
              </div>

              <div className="caja-recibo-datos">
                <div><span>Mesa:</span> <strong>{paidReceipt.mesa}</strong></div>
                <div><span>Comensal:</span> {paidReceipt.comensal}</div>
                <div><span>Método:</span> {paidReceipt.metodo_pago.toUpperCase()}</div>
                <div><span>Hora:</span> {paidReceipt.hora}</div>
                {paidReceipt.pedidos?.length > 0 && (
                  <div className="ancho"><span>Pedidos:</span> {paidReceipt.pedidos.join(', ')}</div>
                )}
                {paidReceipt.voucher && (
                  <div className="ancho"><span>Voucher:</span> {paidReceipt.voucher}</div>
                )}
                <div className="ancho">
                  <span>Saldo de la mesa:</span>{' '}
                  <strong>{paidReceipt.mesaLiberada ? 'PAGADA · mesa liberada' : formatCOP(paidReceipt.saldoRestante)}</strong>
                </div>
              </div>

              <div className="caja-recibo-cuentas">
                <div>
                  <span>Subtotal:</span>
                  <span>{formatCOP(paidReceipt.subtotal)}</span>
                </div>
                {paidReceipt.tip > 0 && (
                  <div>
                    <span>Propina (10%):</span>
                    <span>{formatCOP(paidReceipt.tip)}</span>
                  </div>
                )}
                <div className="caja-recibo-total">
                  <span>TOTAL:</span>
                  <span>{formatCOP(paidReceipt.total)}</span>
                </div>
                {paidReceipt.cashGiven && (
                  <>
                    <div className="caja-recibo-suave">
                      <span>Efectivo:</span>
                      <span>{formatCOP(paidReceipt.cashGiven)}</span>
                    </div>
                    <div className="caja-recibo-suave">
                      <span>Cambio:</span>
                      <span>{formatCOP(paidReceipt.changeDue)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="caja-recibo-botones">
              <button
                type="button"
                className="caja-btn"
                onClick={() => window.print()}
              >
                <Printer size={16} />
                <span>IMPRIMIR RECIBO</span>
              </button>
              <button
                type="button"
                className="caja-btn caja-btn-claro"
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
