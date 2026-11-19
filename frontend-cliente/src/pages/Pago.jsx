import { useState, useEffect, useRef, useMemo } from 'react';
import { useCuentaMesa } from '../hooks/useCuentaMesa';
import { useMesaSocket } from '../context/MesaSocketContext';
import {
  formatoPesos,
  montosPorModo,
  MODOS_PAGO,
  TITULOS_MODO,
  ESTADO_CUENTA_INICIAL,
  ESTADO_CUENTA_ENVIANDO,
  estadoCuentaSolicitada,
  textoCajaSegunEstado,
  avisoPedidoGrupal,
  TEXTO_SUGERENCIA_SIN_CELULAR,
  debeMostrarSugerenciaSinCelular,
  mensajePagoConfirmado,
  avisoExcedentePago,
  eventIdParaIntento,
  infoTuParte,
  montoTuParte,
  transicionPantallaPago,
  decidirSalidaEspera,
  decidirVisibilidadPago,
} from '../utils/cuenta';
import { crearDeduplicador } from '../utils/deduplicador';
import { claveAlias } from '../utils/apodo';
import { crearIntencion } from '../services/pagoService';
import { abrirCheckout, cerrarWidget } from '../services/wompiWidget';
import { uuidV4 } from '../services/clienteMesa';
import {
  esLlaveDePrueba,
  leerModoPrueba,
  marcarModoPrueba,
  decidirApertura,
} from '../utils/modoPago';
import AvisoModoDemostracion from '../components/pago/AvisoModoDemostracion';

/**
 * Pantalla principal de La Cuenta y Pagos (J-08).
 *
 * Muestra el desglose de la cuenta de la mesa, el estado de cada comensal,
 * las opciones para pagar (Pagar lo mío, Pagar toda la cuenta), y los flujos
 * de confirmación y pago en caja.
 */
function Pago({ errorPagoInicial = null } = {}) {
  const { cuenta, cargando, error, recargar, idMesa, comensal } = useCuentaMesa();
  const { on: socketOn, enviar, presencia, estado: estadoSocket } = useMesaSocket();

  const [pantalla, setPantalla] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      const search = window.location.search;
      if (search.includes('id=') || search.includes('env=')) {
        return 'espera';
      }
    }
    return 'cuenta';
  });
  const [origenEspera, setOrigenEspera] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      const search = window.location.search;
      if (search.includes('id=') || search.includes('env=')) {
        return 'redireccion';
      }
    }
    return null;
  });
  const [widgetAbierto, setWidgetAbierto] = useState(false);
  const [modo, setModo] = useState('propio');
  const [avisoCuenta, setAvisoCuenta] = useState(ESTADO_CUENTA_INICIAL);
  const [avisoMesero, setAvisoMesero] = useState(null);
  const [iniciandoPago, setIniciandoPago] = useState(false);
  const [errorPago, setErrorPago] = useState(errorPagoInicial);
  const [avisoExcedente, setAvisoExcedente] = useState(null);
  const [intencionActual, setIntencionActual] = useState(null);
  const [intencionPendienteDemo, setIntencionPendienteDemo] = useState(null);
  const [modoPrueba, setModoPrueba] = useState(() => leerModoPrueba());
  const [ultimoPago, setUltimoPago] = useState(0);
  const [tipoConfirmado, setTipoConfirmado] = useState('mesa');
  const intentoPrevioRef = useRef(null);
  const cuentaAnteriorRef = useRef(cuenta);

  const esErrorEnRevision =
    Boolean(
      errorPago && typeof errorPago === 'object' && errorPago.tipo === 'en_revision'
    ) || errorPago === 'en_revision';
  const textoErrorPago =
    typeof errorPago === 'object' ? errorPago?.mensaje : errorPago;

  const estadoEsperaRef = useRef({ pantalla, origenEspera, widgetAbierto, intencionActual });
  useEffect(() => {
    estadoEsperaRef.current = { pantalla, origenEspera, widgetAbierto, intencionActual };
  }, [pantalla, origenEspera, widgetAbierto, intencionActual]);

  const deduplicador = useMemo(
    () => crearDeduplicador({ capacidad: 200 }),
    []
  );

  // Cleanup al desmontar: cerrar cualquier widget remanente
  useEffect(() => {
    return () => {
      cerrarWidget();
    };
  }, []);

  // Escuchar eventos de socket (payment:confirmed y cuenta:solicitada)
  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaPayment = socketOn('payment:confirmed', (evento) => {
      if (!evento || deduplicador.visto(evento.eventId)) return;

      const saldoRestante = evento.saldo_restante_centavos != null
        ? Number(evento.saldo_restante_centavos) / 100
        : (evento.saldo_restante != null ? Number(evento.saldo_restante) : null);

      const tipo = mensajePagoConfirmado({
        comensal: evento.comensal,
        yo: comensal,
        saldoRestante,
      });

      // Si estoy en espera, consultar decidirSalidaEspera
      const { pantalla: pActual, origenEspera: oEspera, widgetAbierto: wAbierto, intencionActual: iActual } =
        estadoEsperaRef.current;

      if (pActual === 'espera') {
        const tipoEvt = tipo === 'propio' ? 'pago_propio' : (tipo === 'mesa' ? 'pago_mesa' : 'pago_otro');
        const decision = decidirSalidaEspera({
          origen: oEspera,
          widgetAbierto: wAbierto || Boolean(iActual),
          saldoAntes: intentoPrevioRef.current?.saldo,
          saldoAhora: saldoRestante,
          tipoEvento: tipoEvt,
        });

        if (decision === 'mantener') {
          // No cerrar widget ni salir de la pantalla de espera
          return;
        }
      }

      const trans = transicionPantallaPago({
        tipo: 'pago_confirmado',
        tipoConfirmado: tipo,
        saldoMesa: saldoRestante,
      });

      if (trans.cerrarWidget) {
        setWidgetAbierto(false);
        setOrigenEspera(null);
        cerrarWidget();
      }
      if (trans.limpiarAlmacenamiento && typeof window !== 'undefined' && window.sessionStorage) {
        sessionStorage.removeItem('smartdining_saldo_antes_pago');
      }
      if (trans.apagarEspera) {
        setIniciandoPago(false);
      }
      setErrorPago(null);

      if (tipo === 'propio' || tipo === 'mesa') {
        if (intentoPrevioRef.current) {
          intentoPrevioRef.current.confirmado = true;
        }
        const monto = evento.monto != null
          ? Number(evento.monto)
          : (evento.monto_centavos != null ? Number(evento.monto_centavos) / 100 : 0);
        setUltimoPago(monto);
        setTipoConfirmado(tipo);
        const esMio = Boolean(
          claveAlias(comensal) &&
          claveAlias(evento.comensal) === claveAlias(comensal)
        );
        if (tipo === 'propio' || (tipo === 'mesa' && esMio)) {
          setAvisoExcedente(avisoExcedentePago(evento));
        } else {
          setAvisoExcedente(null);
        }
        setPantalla(trans.pantalla);
      }
      // 'otro' con saldo restante > 0: solo el aviso "X pagó", sin cambiar de pantalla
    });

    const bajaCuenta = socketOn('cuenta:solicitada', () => {
      setAvisoCuenta((prev) => {
        if (prev.estado === 'ok') return prev;
        return estadoCuentaSolicitada({ ok: true });
      });
    });

    return () => {
      bajaPayment?.();
      bajaCuenta?.();
    };
  }, [socketOn, comensal, deduplicador]);

  // Limpiar parámetros de retorno de Wompi de la URL sin recargar
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      const search = window.location.search;
      if (search.includes('id=') || search.includes('env=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  // Al montar Pago o reconectar el socket mientras está en espera, recargar la cuenta
  const estadoSocketAnteriorRef = useRef(estadoSocket);
  useEffect(() => {
    if (pantalla === 'espera') {
      recargar?.();
    }
  }, [pantalla, recargar]);

  useEffect(() => {
    if (
      estadoSocketAnteriorRef.current !== 'conectado' &&
      estadoSocket === 'conectado' &&
      pantalla === 'espera'
    ) {
      recargar?.();
    }
    estadoSocketAnteriorRef.current = estadoSocket;
  }, [estadoSocket, pantalla, recargar]);

  // Limpiar error de pago al recargar la cuenta (useCuentaMesa ya recarga con payment:confirmed)
  useEffect(() => {
    if (cuentaAnteriorRef.current && cuenta !== cuentaAnteriorRef.current) {
      setErrorPago(null);
    }
    cuentaAnteriorRef.current = cuenta;
  }, [cuenta]);

  // Si el saldo de la mesa bajó respecto al que había antes del pago, salir de espera
  useEffect(() => {
    if (pantalla !== 'espera' || !cuenta) return;
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    const saldoAntesRaw = sessionStorage.getItem('smartdining_saldo_antes_pago');
    if (saldoAntesRaw != null) {
      const saldoAntes = Number(saldoAntesRaw);
      const decision = decidirSalidaEspera({
        origen: origenEspera,
        widgetAbierto: widgetAbierto || Boolean(intencionActual),
        saldoAntes,
        saldoAhora: cuenta.saldo,
        tipoEvento: 'salida_espera',
      });

      if (decision === 'mantener') {
        return;
      }

      const trans = transicionPantallaPago({
        tipo: 'salida_espera',
        saldoMesa: cuenta.saldo,
      });

      if (trans.cerrarWidget) {
        cerrarWidget();
      }
      if (trans.limpiarAlmacenamiento) {
        sessionStorage.removeItem('smartdining_saldo_antes_pago');
      }
      if (intentoPrevioRef.current) {
        intentoPrevioRef.current.confirmado = true;
      }
      queueMicrotask(() => {
        setWidgetAbierto(false);
        setOrigenEspera(null);
        if (trans.apagarEspera) {
          setIniciandoPago(false);
        }
        if (decision === 'confirmado_mesa' || trans.pantalla === 'confirmado') {
          setTipoConfirmado((prev) => (prev === 'propio' ? 'propio' : 'mesa'));
          setPantalla('confirmado');
        } else {
          setPantalla('cuenta');
        }
      });
    }
  }, [pantalla, cuenta, origenEspera, widgetAbierto, intencionActual]);

  // Si la cuenta tiene saldo 0 (y total > 0) al montar o recargar sin un evento propio, mostrar pantalla de mesa pagada
  useEffect(() => {
    if (!cuenta) return;
    if (cuenta.saldo === 0 && (cuenta.total ?? 0) > 0 && pantalla !== 'confirmado') {
      if (pantalla === 'espera') {
        const decision = decidirSalidaEspera({
          origen: origenEspera,
          widgetAbierto: widgetAbierto || Boolean(intencionActual),
          saldoAhora: 0,
          tipoEvento: 'saldo_cero',
        });
        if (decision === 'mantener') {
          return;
        }
      }

      const trans = transicionPantallaPago({
        tipo: 'saldo_cero',
        saldoMesa: 0,
      });

      if (trans.cerrarWidget) {
        cerrarWidget();
      }
      if (trans.limpiarAlmacenamiento && typeof window !== 'undefined' && window.sessionStorage) {
        sessionStorage.removeItem('smartdining_saldo_antes_pago');
      }
      queueMicrotask(() => {
        setWidgetAbierto(false);
        setOrigenEspera(null);
        if (trans.apagarEspera) {
          setIniciandoPago(false);
        }
        setTipoConfirmado((prev) => (prev === 'propio' ? 'propio' : 'mesa'));
        setPantalla(trans.pantalla);
      });
    }
  }, [cuenta, pantalla, origenEspera, widgetAbierto, intencionActual]);

  const mesaNumero = cuenta?.numero || idMesa || null;
  const ubicacion = cuenta?.ubicacion || null;
  const total = cuenta?.total ?? 0;
  const pagado = cuenta?.pagado ?? 0;
  const saldo = cuenta?.saldo ?? 0;
  const miSaldo = cuenta?.mia?.saldo ?? 0;
  const miSubtotal = cuenta?.mia?.subtotal ?? 0;
  const miPagado = cuenta?.mia?.pagado ?? 0;

  const visibilidadPago = decidirVisibilidadPago({
    saldoMesa: saldo,
    miSaldo,
    miPagado,
    cuenta,
  });
  const { mostrarSeccionPago, mostrarSelector, selector } = visibilidadPago;
  const {
    yaPague,
    modoInicial,
    modosDisponibles,
    textoBoton,
  } = selector;

  // Si el modo actual no está entre los permitidos (p. ej. 'propio' cuando mi saldo es 0 o mesa de 1 sola persona),
  // cambia al modo recomendado ('total')
  useEffect(() => {
    if (!cuenta) return;
    if (modoInicial && (!modosDisponibles || !modosDisponibles.includes(modo))) {
      queueMicrotask(() => {
        setModo(modoInicial);
      });
    }
  }, [cuenta, modoInicial, modosDisponibles, modo]);

  if (cargando && !cuenta) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-10 h-10 border-4 border-carbon/20 border-t-granate rounded-full animate-spin mb-4" />
        <p className="text-carbon/70 font-titulo text-xl tracking-wider uppercase">
          Cargando la cuenta de la mesa...
        </p>
      </div>
    );
  }

  if (error && !cuenta) {
    return (
      <div className="py-12 px-4 max-w-md mx-auto text-center space-y-4">
        <div
          role="alert"
          className="ticket-comanda p-6 space-y-3"
        >
          <h1 className="font-titulo text-3xl text-granate uppercase tracking-wide">
            No pudimos cargar la cuenta
          </h1>
          <p className="text-sm text-tinta/80">
            {error.mensaje || error.message || 'Ocurrió un error al consultar los pedidos de la mesa.'}
          </p>
          <button
            type="button"
            onClick={recargar}
            className="min-h-[44px] px-6 py-2 rounded-xl bg-carbon hover:bg-carbon/90 text-crema font-titulo text-lg tracking-wider uppercase transition-colors cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const tuParte = infoTuParte({
    miSaldo,
    miPagado,
    miSubtotal,
    yaPague,
  });

  const tuParteMonto = montoTuParte({ saldoMesa: saldo, miSaldo });

  const comensales = cuenta?.comensales || [];

  const montos = montosPorModo(cuenta);
  const montoModo = montos[modo] ?? miSaldo;
  const progreso = total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 0;

  const ayudas = {
    propio: 'Pagas solo lo que tú pediste.',
    total: 'Pagas todo lo que le falta a la mesa (invitas tú).',
  };

  const avisoGrupal = avisoPedidoGrupal({
    cuenta,
    presencia,
    yo: comensal,
    modo,
  });

  const mostrarSinCelular = debeMostrarSugerenciaSinCelular(cuenta);

  const handlePedirCuenta = async () => {
    if (avisoCuenta.deshabilitado && avisoCuenta.estado !== 'inicial') return;
    setAvisoCuenta(ESTADO_CUENTA_ENVIANDO);

    if (!enviar) {
      const res = estadoCuentaSolicitada(new Error('SIN_CONEXION'), true);
      setAvisoCuenta(res);
      return;
    }

    try {
      const eventId = uuidV4();
      const ack = await enviar('cuenta:solicitada', { eventId });
      const res = estadoCuentaSolicitada(ack ?? { ok: true }, false);
      setAvisoCuenta(res);
      setAvisoMesero({ mensaje: res.mensaje, tipo: res.tipo });
      setTimeout(() => setAvisoMesero(null), 4000);
    } catch (err) {
      const res = estadoCuentaSolicitada(err, true);
      setAvisoCuenta(res);
      if (res.estado === 'rate_limit') {
        setAvisoMesero({ mensaje: res.mensaje, tipo: res.tipo });
        setTimeout(() => setAvisoMesero(null), 4000);
      }
    }
  };

  const handlePagarCaja = () => {
    if (avisoCuenta.estado === 'inicial' || avisoCuenta.estado === 'error') {
      handlePedirCuenta();
    }
    setPantalla('caja');
  };

  const ejecutarAperturaCheckout = (intencion) => {
    setOrigenEspera('widget');
    setWidgetAbierto(true);
    setPantalla('espera');

    // En modo real, abrir el widget emergente de Wompi
    if (!(import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true')) {
      abrirCheckout(intencion, (resultado) => {
        setWidgetAbierto(false);
        setOrigenEspera(null);
        setIntencionActual(null);

        const trans = transicionPantallaPago({
          tipo: 'widget_resultado',
          resultadoWidget: resultado,
        });

        if (trans.cerrarWidget) {
          cerrarWidget();
        }
        if (trans.limpiarAlmacenamiento && typeof window !== 'undefined' && window.sessionStorage) {
          sessionStorage.removeItem('smartdining_saldo_antes_pago');
        }
        if (trans.apagarEspera) {
          setIniciandoPago(false);
        }
        if (trans.errorPago) {
          setErrorPago(trans.errorPago);
        }
        if (trans.pantalla !== 'espera') {
          setPantalla(trans.pantalla);
        }
      }).catch((err) => {
        setWidgetAbierto(false);
        setOrigenEspera(null);
        setIntencionActual(null);
        cerrarWidget();
        if (typeof window !== 'undefined' && window.sessionStorage) {
          sessionStorage.removeItem('smartdining_saldo_antes_pago');
        }
        setIniciandoPago(false);
        setPantalla('cuenta');
        setErrorPago(err.message || 'No se pudo abrir la ventana de Wompi');
      });
    }
  };

  const handlePagarWompi = async () => {
    if (esErrorEnRevision) return;
    setIniciandoPago(true);
    setErrorPago(null);

    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        sessionStorage.setItem('smartdining_saldo_antes_pago', String(cuenta?.saldo ?? 0));
      }
      const eventId = eventIdParaIntento(
        intentoPrevioRef.current,
        { modo, saldo: cuenta?.saldo },
        uuidV4
      );
      intentoPrevioRef.current = {
        eventId,
        modo,
        saldo: cuenta?.saldo,
        confirmado: false,
      };

      const intencion = await crearIntencion(modo, eventId, {
        presenciaSim: presencia,
        yoSim: comensal,
      });
      setIntencionActual(intencion);

      const llave = intencion?.llave_publica;
      const avisoVisto = leerModoPrueba();
      const decision = decidirApertura({
        llave,
        avisoVisto,
      });

      if (decision === 'aviso') {
        setIntencionPendienteDemo(intencion);
        return;
      }

      if (esLlaveDePrueba(llave)) {
        marcarModoPrueba();
        setModoPrueba(true);
      }

      ejecutarAperturaCheckout(intencion);
    } catch (err) {
      if (err?.tipo === 'en_revision' || err?.codigo === 'PAGO_EN_REVISION') {
        setErrorPago({
          tipo: 'en_revision',
          mensaje:
            err.mensaje ||
            'Tu pago anterior está en revisión. No vuelvas a pagar; pregúntale al mesero.',
        });
      } else {
        setErrorPago(err.mensaje || err.message || 'No pudimos iniciar el pago');
      }
    } finally {
      setIniciandoPago(false);
    }
  };

  const handleVolverCuenta = () => {
    setWidgetAbierto(false);
    setOrigenEspera(null);
    setIntencionActual(null);
    setIntencionPendienteDemo(null);
    const trans = transicionPantallaPago({ tipo: 'volver_cuenta' });
    if (trans.cerrarWidget) {
      cerrarWidget();
    }
    if (trans.limpiarAlmacenamiento && typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.removeItem('smartdining_saldo_antes_pago');
    }
    setIniciandoPago(false);
    setPantalla(trans.pantalla);
    setErrorPago(null);
    setAvisoExcedente(null);
    setTipoConfirmado('mesa');
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden flex flex-col gap-3.5 pb-8">
      {/* Aviso toast local */}
      {avisoMesero && (
        <div
          role="status"
          aria-live="polite"
          className={`bg-papel border-2 ${
            avisoMesero?.tipo === 'advertencia'
              ? 'border-ambar text-carbon'
              : avisoMesero?.tipo === 'error'
              ? 'border-granate text-granate'
              : 'border-[#15803D] text-[#15803D]'
          } px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-comanda toast-entra font-sans`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              avisoMesero?.tipo === 'advertencia'
                ? 'bg-ambar'
                : avisoMesero?.tipo === 'error'
                ? 'bg-granate'
                : 'bg-[#15803D]'
            }`}
          />
          <span>{avisoMesero?.mensaje || avisoMesero}</span>
        </div>
      )}

      {/* Banner de error de pago si ocurre */}
      {errorPago && (
        <div
          role="alert"
          className="bg-papel border-2 border-granate text-granate px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-comanda toast-entra font-sans"
        >
          <span className="w-2 h-2 rounded-full bg-granate shrink-0" />
          <span>{textoErrorPago}</span>
        </div>
      )}

      {/* ──────────────── PANTALLA 1: LA CUENTA ──────────────── */}
      {pantalla === 'cuenta' && (
        <div className="entra flex flex-col gap-3.5">
          {/* Encabezado visual estilo comanda */}
          <div className="flex justify-between items-end px-1 pt-1">
            <div>
              <span className="font-manuscrita text-granate text-xl block leading-none -rotate-2">
                Resumen del consumo
              </span>
              <h1 className="m-0 font-titulo text-4xl sm:text-5xl tracking-wider leading-none text-carbon drop-shadow-[0_2px_0_rgba(255,255,255,0.4)]">
                LA CUENTA
              </h1>
            </div>
            {(mesaNumero || ubicacion) && (
              <span className="font-titulo text-sm sm:text-base tracking-wider bg-carbon text-crema px-3 py-1 rounded-full shadow-sm">
                {[mesaNumero ? `Mesa ${mesaNumero}` : null, ubicacion].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>

          {/* Tarjeta principal con saldo personal y barra de progreso */}
          <section className="ticket-comanda p-5 flex flex-col gap-4">
            <div className="border-b-2 border-dashed border-tinta/15 pb-2.5 flex justify-between items-center">
              <span className="font-titulo text-xs tracking-widest text-carbon/70 uppercase">
                SMARTDINING · COMANDA DE PAGO
              </span>
              <span className="font-manuscrita text-granate text-base">
                mesa #{mesaNumero || '—'}
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="font-titulo text-sm tracking-widest text-carbon/70 uppercase">
                TU PARTE
              </span>
              <span
                className="font-titulo text-5xl sm:text-6xl tracking-wider leading-[0.95]"
                style={{ color: tuParte.color || '#8B1E13' }}
              >
                {formatoPesos(tuParteMonto)}
              </span>
              <span className="text-xs text-carbon/70 font-sans">
                {tuParte.mensaje}
              </span>
            </div>

            {/* Barra de progreso */}
            <div className="flex flex-col gap-2 pt-1 border-t border-dashed border-tinta/15">
              <div className="h-3 rounded-full bg-carbon/10 p-0.5 overflow-hidden border border-carbon/15">
                <div
                  className="barra h-full rounded-full bg-[#15803D]"
                  style={{ width: `${progreso}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-sans">
                <span className="text-[#15803D] font-bold">
                  Pagado {formatoPesos(pagado)}
                </span>
                <span className="text-carbon/70 font-medium">
                  Falta {formatoPesos(saldo)} de {formatoPesos(total)}
                </span>
              </div>
            </div>
          </section>

          {/* Tarjeta QUIÉN DEBE QUÉ */}
          <section className="ticket-comanda p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between pb-2 mb-1 border-b border-dashed border-tinta/15">
              <h2 className="m-0 font-titulo text-lg tracking-wider text-carbon uppercase">
                QUIÉN DEBE QUÉ
              </h2>
              <span className="text-xs text-carbon/60 font-sans">
                {comensales.length} {comensales.length === 1 ? 'persona' : 'personas'}
              </span>
            </div>
            <div className="flex flex-col divide-y divide-dashed divide-tinta/15">
              {comensales.map((c, idx) => {
                const deb = Math.max(0, c.saldo);
                const yaPago = c.esMio ? yaPague : (c.pagado > 0 && deb === 0);
                const inicial = c.nombre ? c.nombre.charAt(0).toUpperCase() : '?';

                return (
                  <div
                    key={c.nombre || idx}
                    className="flex items-center justify-between gap-2.5 py-2.5 first:pt-1 last:pb-1"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center font-titulo text-lg shrink-0 ${
                          c.esMio ? 'bg-granate text-crema shadow-sm' : 'bg-carbon/10 text-carbon border border-carbon/20'
                        }`}
                      >
                        {inicial}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[15px] font-bold text-carbon truncate">
                          {c.esMio ? `${c.nombre} (tú)` : c.nombre}
                        </span>
                        <span className="text-xs text-carbon/65 font-sans">
                          Consumió {formatoPesos(c.subtotal)}
                        </span>
                      </div>
                    </div>

                    {yaPago ? (
                      <span className="flex items-center gap-1.5 font-titulo text-sm tracking-wider text-crema bg-[#15803D] px-2.5 py-1 rounded-lg shrink-0 shadow-sm rotate-[-2deg]">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                        PAGÓ
                      </span>
                    ) : (
                      <span
                        className={`font-titulo text-2xl tracking-wide shrink-0 ${
                          c.esMio ? 'text-granate font-bold' : 'text-carbon/75'
                        }`}
                      >
                        {formatoPesos(deb)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Opciones y acciones de pago si hay saldo pendiente */}
          {mostrarSeccionPago && (
            <section className="ticket-comanda p-4 flex flex-col gap-3">
              {modoPrueba && <AvisoModoDemostracion />}

              {mostrarSelector && (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="m-0 font-titulo text-lg tracking-wider text-carbon uppercase">
                      ¿CÓMO QUIERES PAGAR?
                    </h2>
                    <span className="font-manuscrita text-granate text-sm">elige tu modo</span>
                  </div>

                  <div
                    role="radiogroup"
                    aria-label="Modo de pago"
                    className="grid grid-cols-2 gap-2 bg-crema-oscura/60 border-2 border-carbon/15 rounded-xl p-1.5"
                  >
                    {MODOS_PAGO.map((k) => {
                      const activo = modo === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          role="radio"
                          aria-checked={activo}
                          onClick={() => {
                            setModo(k);
                            if (!esErrorEnRevision) {
                              setErrorPago(null);
                            }
                          }}
                          className={`min-h-[52px] rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                            activo
                              ? 'bg-carbon text-crema shadow-md scale-[1.01]'
                              : 'bg-transparent text-carbon/70 hover:text-carbon hover:bg-carbon/5'
                          }`}
                        >
                          <span className="font-titulo text-base tracking-wider uppercase">
                            {TITULOS_MODO[k]}
                          </span>
                          <span className={`text-xs ${activo ? 'text-ambar font-semibold' : 'text-carbon/60'}`}>
                            {formatoPesos(montos[k])}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="m-0 text-xs text-carbon/70 font-sans">
                    {ayudas[modo]}
                  </p>

                  {mostrarSinCelular && (
                    <p className="m-0 text-xs text-carbon/60 italic font-sans">
                      {TEXTO_SUGERENCIA_SIN_CELULAR}
                    </p>
                  )}
                </>
              )}

              {/* Tarjeta de aviso si pidió para varios (J-15) */}
              {avisoGrupal && (
                <div
                  role="note"
                  className="min-h-[44px] bg-crema border border-ambar/50 rounded-xl p-3 flex flex-col gap-2.5 text-carbon"
                >
                  <div className="flex items-start gap-2.5">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#B45309"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 mt-0.5"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p className="m-0 text-xs text-carbon leading-relaxed font-sans">
                      {avisoGrupal.mensaje}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-carbon/10">
                    <button
                      type="button"
                      onClick={() => {
                        setModo('total');
                        if (!esErrorEnRevision) {
                          setErrorPago(null);
                        }
                      }}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-lg bg-carbon hover:bg-carbon/90 active:bg-carbon/80 text-crema font-titulo text-sm tracking-wider uppercase transition-colors cursor-pointer flex items-center justify-center shadow-sm"
                    >
                      Pagar toda la cuenta
                    </button>
                  </div>
                </div>
              )}

              {/* Aviso de error de pago junto al botón */}
              {errorPago && (
                <div
                  role="alert"
                  className="bg-crema border-2 border-granate text-granate px-4 py-3 rounded-xl flex items-center gap-2.5 text-xs font-semibold shadow-sm toast-entra font-sans"
                >
                  <span className="w-2 h-2 rounded-full bg-granate shrink-0" />
                  <span>{textoErrorPago}</span>
                </div>
              )}

              {/* Botón Pagar Wompi */}
              <button
                type="button"
                onClick={handlePagarWompi}
                disabled={iniciandoPago || montoModo <= 0 || esErrorEnRevision}
                className={`min-h-[56px] rounded-2xl bg-carbon hover:bg-carbon/90 text-crema font-titulo text-2xl tracking-wider flex items-center justify-center gap-2.5 transition-colors shadow-comanda ${
                  iniciandoPago || montoModo <= 0 || esErrorEnRevision
                    ? 'opacity-60 cursor-not-allowed'
                    : 'cursor-pointer active:translate-y-0.5'
                }`}
              >
                {iniciandoPago ? (
                  <div className="w-5 h-5 border-2 border-crema border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M2 10h20" />
                    <path d="M6 15h4" />
                  </svg>
                )}
                <span>
                  {!mostrarSelector && textoBoton
                    ? `${textoBoton.toUpperCase()} ${formatoPesos(montoModo)}`
                    : `PAGAR ${formatoPesos(montoModo)}`}
                </span>
              </button>

              {/* Botón Pagar en Caja */}
              <button
                type="button"
                onClick={handlePagarCaja}
                disabled={montoModo <= 0}
                className={`min-h-[52px] rounded-xl border-2 border-carbon bg-transparent text-carbon hover:bg-carbon/5 font-titulo text-xl tracking-wider flex items-center justify-center gap-2 transition-colors ${
                  montoModo <= 0 ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="10" width="18" height="10" rx="2" />
                  <path d="M7 10V6h10v4" />
                  <path d="M9 14h6" />
                </svg>
                PAGAR EN CAJA (EFECTIVO)
              </button>

              <span className="text-[12px] text-carbon/60 text-center pt-0.5 font-sans">
                Pago seguro con Wompi · tarjeta, PSE o Nequi
              </span>
            </section>
          )}

          {/* Tarjeta YA PAGASTE TU PARTE */}
          {yaPague && (
            <section className="ticket-comanda p-4 flex items-center gap-3 border-2 border-[#15803D]/40">
              <span className="w-10 h-10 rounded-full bg-[#15803D] text-crema flex items-center justify-center shrink-0 shadow-sm">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="font-titulo text-xl tracking-wider text-carbon uppercase">
                  YA PAGASTE TU PARTE
                </span>
                <span className="text-xs text-carbon/70 font-sans">
                  Cuando la mesa termine de pagar, la cerramos sola.
                </span>
              </div>
            </section>
          )}

          {/* Botón punteado Pedir cuenta al mesero */}
          <button
            type="button"
            onClick={handlePedirCuenta}
            disabled={avisoCuenta.deshabilitado}
            className={`min-h-[48px] rounded-xl border-2 border-dashed text-sm font-sans flex items-center justify-center gap-2 transition-colors ${
              avisoCuenta.estado === 'error'
                ? 'border-granate text-granate hover:bg-granate/10 cursor-pointer'
                : avisoCuenta.estado === 'rate_limit'
                ? 'border-carbon/30 bg-carbon/5 text-carbon/50 cursor-not-allowed'
                : avisoCuenta.deshabilitado
                ? 'border-carbon/25 bg-transparent text-carbon/50 cursor-not-allowed'
                : 'border-carbon/40 bg-papel text-carbon hover:border-carbon hover:bg-papel-oscuro cursor-pointer shadow-sm'
            }`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
            <span className="font-medium">{avisoCuenta.mensaje}</span>
          </button>
        </div>
      )}

      {/* ──────────────── PANTALLA 2: CONFIRMANDO TU PAGO ──────────────── */}
      {pantalla === 'espera' && (
        <section
          className="entra ticket-comanda p-6 flex flex-col items-center gap-4 text-center"
          aria-live="polite"
        >
          {/* Banda superior de la comanda */}
          <div className="w-full bg-carbon text-crema py-1.5 px-4 rounded-lg font-titulo tracking-widest text-sm flex items-center justify-between">
            <span>PAGO EN CURSO</span>
            <span className="font-manuscrita text-ambar text-base">wompi</span>
          </div>

          {/* Disco crema con anillo punteado giratorio e ilustración */}
          <div className="relative w-44 h-44 rounded-full bg-crema-oscura/40 border-4 border-carbon/15 flex items-center justify-center shadow-inner">
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none motion-safe:animate-spin"
              style={{ animationDuration: '10s' }}
              viewBox="0 0 176 176"
              aria-hidden="true"
            >
              <circle
                cx="88"
                cy="88"
                r="80"
                fill="none"
                stroke="#B45309"
                strokeWidth="3"
                strokeDasharray="8 8"
                opacity="0.6"
              />
            </svg>
            <svg className="ilu" width="160" height="130" viewBox="0 0 220 180" aria-hidden="true">
              <circle className="onda" cx="110" cy="90" r="60" fill="none" stroke="#D97706" strokeWidth="3" />
              <circle className="onda o2" cx="110" cy="90" r="60" fill="none" stroke="#D97706" strokeWidth="3" />
              <circle className="onda o3" cx="110" cy="90" r="60" fill="none" stroke="#D97706" strokeWidth="3" />
              <g className="tarjeta-flota">
                <rect x="62" y="62" width="96" height="60" rx="8" fill="#1C1917" stroke="#44403C" strokeWidth="2" />
                <rect x="62" y="76" width="96" height="10" fill="#292524" />
                <rect x="72" y="96" width="22" height="14" rx="3" fill="#D97706" />
                <rect x="100" y="104" width="44" height="5" rx="2" fill="#78716C" />
              </g>
              <circle
                className="gira"
                cx="110"
                cy="90"
                r="78"
                fill="none"
                stroke="#8B1E13"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="80 410"
              />
            </svg>
          </div>

          <h1 className="m-0 font-titulo text-4xl sm:text-5xl leading-[0.95] tracking-wider text-carbon drop-shadow-[0_2px_0_rgba(255,255,255,0.4)]">
            CONFIRMANDO TU PAGO
          </h1>

          <p className="m-0 text-[15px] text-carbon/90 font-sans">
            Termina el pago de{' '}
            <strong className="font-bold text-granate">
              {formatoPesos(
                intencionActual?.monto_en_centavos
                  ? intencionActual.monto_en_centavos / 100
                  : montoModo
              )}
            </strong>{' '}
            en la ventana de Wompi.
          </p>

          <p className="m-0 text-xs text-carbon/70 font-sans">
            Te avisamos apenas el banco lo confirme. No cierres esta pantalla.
          </p>

          {/* Bloque de referencia y expiración */}
          <div className="w-full box-border flex items-center gap-2.5 bg-crema-oscura/50 border border-carbon/15 rounded-xl p-3 text-xs text-carbon/75 text-left font-sans">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-carbon/60"
              aria-hidden="true"
            >
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <span className="truncate">
              Ref. {intencionActual?.referencia || (mesaNumero ? `SD-${mesaNumero}-PENDIENTE` : 'SD-PENDIENTE')} · expira en 30 min
            </span>
          </div>

          <button
            type="button"
            onClick={handleVolverCuenta}
            className="min-h-[44px] border-none bg-transparent text-granate hover:text-granate/80 text-sm font-titulo tracking-wider cursor-pointer transition-colors"
          >
            Volver a la cuenta
          </button>
        </section>
      )}

      {/* ──────────────── PANTALLA 3: ¡PAGO CONFIRMADO! ──────────────── */}
      {pantalla === 'confirmado' && (
        <section
          className="entra ticket-comanda p-6 flex flex-col items-center gap-3.5 text-center relative overflow-hidden"
          aria-live="polite"
        >
          {/* Banda superior de la comanda */}
          <div className="w-full bg-carbon text-crema py-1.5 px-4 rounded-lg font-titulo tracking-widest text-sm flex items-center justify-between">
            <span>CUENTA</span>
            <span className="font-manuscrita text-ambar text-base">comprobante</span>
          </div>

          {/* Sello de PAGADO */}
          <div
            className="absolute top-12 right-6 border-4 border-[#15803D] text-[#15803D] font-titulo text-2xl tracking-widest px-3 py-1 rounded-lg uppercase rotate-[-12deg] pointer-events-none opacity-85 shadow-sm"
            aria-hidden="true"
          >
            PAGADO
          </div>

          {/* Ilustración de check verde con rebote y chispitas */}
          <div className="relative w-40 h-40 rounded-full bg-crema-oscura/40 border-4 border-carbon/15 flex items-center justify-center shadow-inner my-1">
            <svg className="ilu" width="180" height="140" viewBox="0 0 220 170" aria-hidden="true">
              <circle className="circulo-ok" cx="110" cy="85" r="56" fill="#15803D" />
              <path
                className="check"
                d="M84 86 l18 18 l36 -38"
                fill="none"
                stroke="#FAF7F0"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path className="chispa" d="M36 40 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z" fill="#D97706" />
              <path className="chispa c2" d="M184 34 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" fill="#15803D" />
              <path className="chispa c3" d="M180 120 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" fill="#8B1E13" />
              <path className="chispa c4" d="M42 124 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#D97706" />
            </svg>
          </div>

          <h1 className="m-0 font-titulo text-4xl sm:text-5xl leading-[0.95] tracking-wider text-carbon drop-shadow-[0_2px_0_rgba(255,255,255,0.4)]">
            ¡PAGO CONFIRMADO!
          </h1>

          {tipoConfirmado === 'propio' ? (
            <div className="flex flex-col gap-1 font-sans">
              <p className="m-0 text-[15px] text-carbon/90">
                Pagaste <strong>{formatoPesos(ultimoPago || montoModo)}</strong>. Te llegará el comprobante de Wompi.
              </p>
              {avisoExcedente && (
                <p className="m-0 text-sm text-granate font-semibold">
                  {avisoExcedente}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 font-sans">
              <p className="m-0 text-[15px] text-carbon/90">
                La mesa quedó pagada.
              </p>
              {avisoExcedente && (
                <p className="m-0 text-sm text-granate font-semibold">
                  {avisoExcedente}
                </p>
              )}
            </div>
          )}

          <div className="w-full box-border bg-crema-oscura/50 border border-carbon/15 rounded-xl p-3.5 flex justify-between items-center text-sm font-sans">
            <span className="text-carbon/70">Le falta a la mesa</span>
            <span className="font-titulo text-xl tracking-wider text-carbon">{formatoPesos(saldo)}</span>
          </div>

          <button
            type="button"
            onClick={handleVolverCuenta}
            className="w-full min-h-[52px] rounded-xl bg-carbon hover:bg-carbon/90 active:bg-carbon/80 text-crema font-titulo text-xl tracking-wider cursor-pointer transition-colors shadow-sm"
          >
            VER LA CUENTA
          </button>
        </section>
      )}

      {/* ──────────────── PANTALLA 4: PAGA EN LA CAJA ──────────────── */}
      {pantalla === 'caja' && (
        <section
          className="entra ticket-comanda p-6 flex flex-col items-center gap-3.5 text-center"
          aria-live="polite"
        >
          {/* Banda superior de la comanda */}
          <div className="w-full bg-carbon text-crema py-1.5 px-4 rounded-lg font-titulo tracking-widest text-sm flex items-center justify-between">
            <span>CAJA</span>
            <span className="font-manuscrita text-ambar text-base">efectivo</span>
          </div>

          {/* Ilustración de caja registradora con recibo animado adaptada */}
          <div className="relative w-40 h-40 rounded-full bg-crema-oscura/40 border-4 border-carbon/15 flex items-center justify-center shadow-inner my-1">
            <svg className="ilu" width="180" height="140" viewBox="0 0 200 170" aria-hidden="true">
              <rect x="40" y="70" width="120" height="70" rx="10" fill="#1C1917" stroke="#44403C" strokeWidth="2" />
              <rect x="54" y="82" width="56" height="22" rx="4" fill="#0C0A09" />
              <text x="82" y="98" textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="16" fill="#15803D">
                {formatoPesos(montoModo)}
              </text>
              <rect x="120" y="84" width="10" height="8" rx="2" fill="#44403C" />
              <rect x="134" y="84" width="10" height="8" rx="2" fill="#44403C" />
              <rect x="120" y="96" width="10" height="8" rx="2" fill="#44403C" />
              <rect x="134" y="96" width="10" height="8" rx="2" fill="#D97706" />
              <rect x="30" y="140" width="140" height="10" rx="4" fill="#292524" />
              <g className="recibo">
                <rect x="74" y="22" width="52" height="48" fill="#FAF7F0" stroke="#E7E0D3" strokeWidth="1" />
                <rect x="82" y="32" width="36" height="4" rx="2" fill="#A8A29E" />
                <rect x="82" y="42" width="28" height="4" rx="2" fill="#A8A29E" />
                <rect x="82" y="52" width="32" height="4" rx="2" fill="#8B1E13" />
              </g>
            </svg>
          </div>

          <h1 className="m-0 font-titulo text-4xl sm:text-5xl leading-[0.95] tracking-wider text-carbon drop-shadow-[0_2px_0_rgba(255,255,255,0.4)]">
            PAGA EN LA CAJA
          </h1>

          <p
            className={`m-0 text-[15px] font-sans ${
              avisoCuenta.estado === 'error' ? 'text-granate font-semibold' : 'text-carbon/90'
            }`}
            role={avisoCuenta.estado === 'error' ? 'alert' : undefined}
          >
            {textoCajaSegunEstado(avisoCuenta)}
          </p>
          {avisoCuenta.estado === 'error' && (
            <button
              type="button"
              onClick={handlePedirCuenta}
              className="min-h-[44px] px-3 rounded-lg border-2 border-granate bg-transparent text-granate text-xs font-semibold hover:bg-granate/10 cursor-pointer transition-colors"
            >
              Reintentar aviso al mesero
            </button>
          )}

          <div className="w-full box-border bg-crema-oscura/60 border-2 border-dashed border-carbon/25 rounded-2xl p-3.5 flex flex-col gap-1 text-center">
            <span className="font-titulo text-xs tracking-widest text-carbon/60 uppercase">
              DILE AL CAJERO
            </span>
            <span className="font-titulo text-3xl tracking-wider text-carbon">
              {mesaNumero ? `MESA ${mesaNumero}` : 'MESA'} · {(comensal || 'MESA').toUpperCase()}
            </span>
            <span className="font-titulo text-2xl tracking-wide text-granate font-bold">
              {formatoPesos(montoModo)}
            </span>
          </div>

          <p className="m-0 text-xs text-carbon/70 font-sans">
            Cuando el cajero registre tu pago, esta pantalla se actualiza sola.
          </p>

          <button
            type="button"
            onClick={handleVolverCuenta}
            className="min-h-[44px] border-none bg-transparent text-granate hover:text-granate/80 text-sm font-titulo tracking-wider cursor-pointer transition-colors"
          >
            Prefiero pagar con Wompi
          </button>
        </section>
      )}

      {/* Modal alertdialog de modo demostración */}
      {intencionPendienteDemo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md">
            <AvisoModoDemostracion
              onContinuar={() => {
                const intencion = intencionPendienteDemo;
                marcarModoPrueba();
                setModoPrueba(true);
                setIntencionPendienteDemo(null);
                ejecutarAperturaCheckout(intencion);
              }}
              onCancelar={handleVolverCuenta}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default Pago;
