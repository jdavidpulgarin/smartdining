import { useState, useEffect, useRef, useMemo } from 'react';
import { useCuentaMesa } from '../hooks/useCuentaMesa';
import { useMesaSocket } from '../context/MesaSocketContext';
import {
  formatoPesos,
  montosPorModo,
  personasDividir,
  TITULOS_MODO,
  ESTADO_CUENTA_INICIAL,
  ESTADO_CUENTA_ENVIANDO,
  estadoCuentaSolicitada,
  textoCajaSegunEstado,
  avisoPedidoGrupal,
  TEXTO_SUGERENCIA_SIN_CELULAR,
  debeMostrarSugerenciaSinCelular,
  mensajePagoConfirmado,
  eventIdParaIntento,
  estadoSelectorPago,
  infoTuParte,
  montoTuParte,
  transicionPantallaPago,
  decidirSalidaEspera,
} from '../utils/cuenta';
import { crearDeduplicador } from '../utils/deduplicador';
import { crearIntencion } from '../services/pagoService';
import { abrirCheckout, cerrarWidget } from '../services/wompiWidget';
import { uuidV4 } from '../services/clienteMesa';

/**
 * Pantalla principal de La Cuenta y Pagos (J-08).
 *
 * Muestra el desglose de la cuenta de la mesa, el estado de cada comensal,
 * las opciones para pagar (LO MÍO, DIVIDIR, TODA LA MESA), y los flujos
 * de confirmación y pago en caja.
 */
function Pago() {
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
  const [errorPago, setErrorPago] = useState(null);
  const [intencionActual, setIntencionActual] = useState(null);
  const [ultimoPago, setUltimoPago] = useState(0);
  const [tipoConfirmado, setTipoConfirmado] = useState('mesa');
  const intentoPrevioRef = useRef(null);

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

      if (tipo === 'propio' || tipo === 'mesa') {
        if (intentoPrevioRef.current) {
          intentoPrevioRef.current.confirmado = true;
        }
        const monto = evento.monto != null
          ? Number(evento.monto)
          : (evento.monto_centavos != null ? Number(evento.monto_centavos) / 100 : 0);
        setUltimoPago(monto);
        setTipoConfirmado(tipo);
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

  const saldoMesa = cuenta?.saldo ?? 0;
  const miSaldoCuenta = cuenta?.mia?.saldo ?? 0;
  const loMioHabilitado = miSaldoCuenta > 0;

  // Si la cuenta se actualiza y mi saldo pasa a 0 estando en 'propio', cambia a 'igual' solo si la mesa aún debe
  useEffect(() => {
    if (!cuenta) return;
    if (modo === 'propio' && !loMioHabilitado && saldoMesa > 0) {
      queueMicrotask(() => {
        setModo('igual');
      });
    }
  }, [cuenta, modo, loMioHabilitado, saldoMesa]);

  if (cargando && !cuenta) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-10 h-10 border-4 border-borde border-t-primario rounded-full animate-spin mb-4" />
        <p className="text-texto-suave font-etiqueta text-base tracking-wider uppercase">
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
          className="bg-superficie border border-borde rounded-2xl p-6 space-y-3"
        >
          <h1 className="font-titulo text-2xl text-primario uppercase tracking-wide">
            No pudimos cargar la cuenta
          </h1>
          <p className="text-sm text-texto-suave">
            {error.mensaje || error.message || 'Ocurrió un error al consultar los pedidos de la mesa.'}
          </p>
          <button
            type="button"
            onClick={recargar}
            className="min-h-[44px] px-6 py-2 rounded-xl bg-primario hover:bg-primario-hover text-white font-etiqueta font-bold text-sm tracking-wider uppercase transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const mesaNumero = cuenta?.numero || idMesa || null;
  const ubicacion = cuenta?.ubicacion || null;
  const total = cuenta?.total ?? 0;
  const pagado = cuenta?.pagado ?? 0;
  const saldo = cuenta?.saldo ?? 0;
  const miSaldo = cuenta?.mia?.saldo ?? 0;
  const miSubtotal = cuenta?.mia?.subtotal ?? 0;
  const miPagado = cuenta?.mia?.pagado ?? 0;

  const { mostrarSelector, yaPague } = estadoSelectorPago({
    saldoMesa: saldo,
    miSaldo,
    miPagado,
  });

  const tuParte = infoTuParte({
    miSaldo,
    miPagado,
    miSubtotal,
    yaPague,
  });

  const tuParteMonto = montoTuParte({ saldoMesa: saldo, miSaldo });

  const comensales = cuenta?.comensales || [];
  const numPersonasDividir = personasDividir(cuenta, { presencia, yo: comensal });

  const montos = montosPorModo(cuenta, { presencia, yo: comensal });
  const montoModo = montos[modo] ?? miSaldo;
  const progreso = total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 0;

  const textoAyudaDividir = numPersonasDividir === 1
    ? 'Eres el último: pagas lo que falta.'
    : `El saldo que falta, dividido entre las ${numPersonasDividir} personas que aún no han pagado (contándote).`;

  const ayudas = {
    propio: 'Pagas solo lo que tú pediste.',
    igual: textoAyudaDividir,
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

  const handlePagarWompi = async () => {
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
    } catch (err) {
      setErrorPago(err.mensaje || err.message || 'No pudimos iniciar el pago');
    } finally {
      setIniciandoPago(false);
    }
  };

  const handleVolverCuenta = () => {
    setWidgetAbierto(false);
    setOrigenEspera(null);
    setIntencionActual(null);
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
    setTipoConfirmado('mesa');
  };

  return (
    <div className="flex flex-col gap-3.5 pb-8">
      {/* Aviso toast local */}
      {avisoMesero && (
        <div
          role="status"
          aria-live="polite"
          className={`bg-superficie border ${
            avisoMesero?.tipo === 'advertencia'
              ? 'border-[#2A2A2A] text-[#969696]'
              : avisoMesero?.tipo === 'error'
              ? 'border-primario text-white'
              : 'border-exito text-white'
          } px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-lg toast-entra`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              avisoMesero?.tipo === 'advertencia'
                ? 'bg-[#969696]'
                : avisoMesero?.tipo === 'error'
                ? 'bg-primario'
                : 'bg-exito'
            }`}
          />
          <span>{avisoMesero?.mensaje || avisoMesero}</span>
        </div>
      )}

      {/* Banner de error de pago si ocurre */}
      {errorPago && (
        <div
          role="alert"
          className="bg-superficie border border-primario text-white px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-lg toast-entra"
        >
          <span className="w-2 h-2 rounded-full bg-primario shrink-0" />
          <span>{errorPago}</span>
        </div>
      )}

      {/* ──────────────── PANTALLA 1: LA CUENTA ──────────────── */}
      {pantalla === 'cuenta' && (
        <div className="entra flex flex-col gap-3.5">
          {/* Tarjeta principal con saldo personal y barra de progreso */}
          <section className="bg-superficie border border-borde rounded-3xl p-5 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h1 className="m-0 font-titulo text-[40px] tracking-wider leading-none text-white">
                LA CUENTA
              </h1>
              {(mesaNumero || ubicacion) && (
                <span className="text-xs text-texto-suave">
                  {[mesaNumero ? `Mesa ${mesaNumero}` : null, ubicacion].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-etiqueta font-bold text-sm tracking-widest text-texto-suave uppercase">
                TU PARTE
              </span>
              <span
                className="font-titulo text-[64px] tracking-wider leading-[0.95]"
                style={{ color: tuParte.color }}
              >
                {formatoPesos(tuParteMonto)}
              </span>
              <span className="text-xs text-texto-suave">
                {tuParte.mensaje}
              </span>
            </div>

            {/* Barra de progreso */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="h-2.5 rounded-full bg-[#2A2A2A] overflow-hidden">
                <div
                  className="barra h-full rounded-full bg-exito"
                  style={{ width: `${progreso}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-exito font-semibold">
                  Pagado {formatoPesos(pagado)}
                </span>
                <span className="text-texto-suave">
                  Falta {formatoPesos(saldo)} de {formatoPesos(total)}
                </span>
              </div>
            </div>
          </section>

          {/* Tarjeta QUIÉN DEBE QUÉ */}
          <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-1">
            <h2 className="m-0 mb-2 font-etiqueta font-bold text-sm tracking-wider text-white uppercase">
              QUIÉN DEBE QUÉ
            </h2>
            <div className="flex flex-col divide-y divide-[#222222]">
              {comensales.map((c, idx) => {
                const deb = Math.max(0, c.saldo);
                const yaPago = c.esMio ? yaPague : (c.pagado > 0 && deb === 0);
                const inicial = c.nombre ? c.nombre.charAt(0).toUpperCase() : '?';

                return (
                  <div
                    key={c.nombre || idx}
                    className="flex items-center justify-between gap-2.5 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center font-etiqueta font-bold text-base shrink-0 text-white ${
                          c.esMio ? 'bg-primario' : 'bg-[#2A2A2A]'
                        }`}
                      >
                        {inicial}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[15px] font-semibold text-white truncate">
                          {c.esMio ? `${c.nombre} (tú)` : c.nombre}
                        </span>
                        <span className="text-xs text-texto-tenue">
                          Consumió {formatoPesos(c.subtotal)}
                        </span>
                      </div>
                    </div>

                    {yaPago ? (
                      <span className="flex items-center gap-1.5 font-etiqueta font-bold text-xs tracking-wider text-[#0B0B0B] bg-exito px-2.5 py-1 rounded-lg shrink-0">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#0B0B0B"
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
                        className={`font-titulo text-[22px] tracking-wide shrink-0 ${
                          c.esMio ? 'text-white' : 'text-texto-suave'
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

          {/* Opciones de pago si hay saldo pendiente */}
          {mostrarSelector && (
            <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-3">
              <h2 className="m-0 font-etiqueta font-bold text-sm tracking-wider text-white uppercase">
                ¿CÓMO QUIERES PAGAR?
              </h2>

              <div
                role="radiogroup"
                aria-label="Modo de pago"
                className="grid grid-cols-3 gap-1.5 bg-[#0B0B0B] border border-borde rounded-xl p-1"
              >
                {['propio', 'igual', 'total'].map((k) => {
                  const activo = modo === k;
                  const deshabilitado = k === 'propio' && !loMioHabilitado;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={activo}
                      aria-disabled={deshabilitado || undefined}
                      disabled={deshabilitado}
                      onClick={() => {
                        if (deshabilitado) return;
                        setModo(k);
                        setErrorPago(null);
                      }}
                      className={`min-h-[48px] rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors ${
                        deshabilitado
                          ? 'opacity-40 cursor-not-allowed bg-transparent text-texto-tenue'
                          : activo
                          ? 'bg-primario text-white shadow-sm cursor-pointer'
                          : 'bg-transparent text-texto-suave hover:text-white cursor-pointer'
                      }`}
                    >
                      <span className="font-etiqueta font-bold text-sm tracking-wider uppercase">
                        {TITULOS_MODO[k]}
                      </span>
                      <span className="text-[11px]">
                        {formatoPesos(montos[k])}
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="m-0 text-xs text-texto-suave">
                {ayudas[modo]}
              </p>

              {mostrarSinCelular && (
                <p className="m-0 text-xs text-texto-tenue">
                  {TEXTO_SUGERENCIA_SIN_CELULAR}
                </p>
              )}

              {/* Tarjeta de aviso si pidió para varios (J-15) */}
              {avisoGrupal && (
                <div
                  role="note"
                  className="min-h-[44px] bg-[#1F1F1F] border border-[#2A2A2A] rounded-xl p-3 flex flex-col gap-2.5 text-[#FFFFFF]"
                >
                  <div className="flex items-start gap-2.5">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#F2B705"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 mt-0.5"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p className="m-0 text-xs text-[#FFFFFF] leading-relaxed">
                      {avisoGrupal.mensaje}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-[#2A2A2A]">
                    <button
                      type="button"
                      onClick={() => {
                        setModo('igual');
                        setErrorPago(null);
                      }}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] active:bg-[#3a3a3a] text-white font-etiqueta font-bold text-xs tracking-wider uppercase transition-colors cursor-pointer border border-[#3A3A3A] flex items-center justify-center"
                    >
                      Dividir
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModo('total');
                        setErrorPago(null);
                      }}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] active:bg-[#3a3a3a] text-white font-etiqueta font-bold text-xs tracking-wider uppercase transition-colors cursor-pointer border border-[#3A3A3A] flex items-center justify-center"
                    >
                      Toda la mesa
                    </button>
                  </div>
                </div>
              )}

              {/* Aviso de error de pago junto al botón */}
              {errorPago && (
                <div
                  role="alert"
                  className="bg-superficie border border-primario text-white px-4 py-3 rounded-xl flex items-center gap-2.5 text-xs font-semibold shadow-md toast-entra"
                >
                  <span className="w-2 h-2 rounded-full bg-primario shrink-0" />
                  <span>{errorPago}</span>
                </div>
              )}

              {/* Botón Pagar Wompi */}
              <button
                type="button"
                onClick={handlePagarWompi}
                disabled={iniciandoPago || montoModo <= 0}
                className={`min-h-[56px] rounded-2xl bg-primario hover:bg-primario-hover text-white font-etiqueta font-bold text-[19px] tracking-wider flex items-center justify-center gap-2.5 transition-colors shadow-sm ${
                  iniciandoPago || montoModo <= 0
                    ? 'opacity-70 cursor-not-allowed'
                    : 'cursor-pointer'
                }`}
              >
                {iniciandoPago ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#FFFFFF"
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
                <span>PAGAR {formatoPesos(montoModo)}</span>
              </button>

              {/* Botón Pagar en Caja */}
              <button
                type="button"
                onClick={handlePagarCaja}
                disabled={montoModo <= 0}
                className={`min-h-[52px] rounded-xl border border-borde bg-superficie-2 text-white font-etiqueta font-bold text-base tracking-wider flex items-center justify-center gap-2 transition-colors ${
                  montoModo <= 0 ? 'opacity-70 cursor-not-allowed' : 'hover:bg-[#252525] cursor-pointer'
                }`}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#F2B705"
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

              <span className="text-[12px] text-texto-tenue text-center pt-0.5">
                Pago seguro con Wompi · tarjeta, PSE o Nequi
              </span>
            </section>
          )}

          {/* Tarjeta YA PAGASTE TU PARTE */}
          {yaPague && (
            <section className="bg-superficie border border-exito rounded-2xl p-4 flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-exito flex items-center justify-center shrink-0">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0B0B0B"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="font-etiqueta font-bold text-base tracking-wider text-white uppercase">
                  YA PAGASTE TU PARTE
                </span>
                <span className="text-xs text-texto-suave">
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
            className={`min-h-[48px] rounded-xl border border-dashed text-sm flex items-center justify-center gap-2 transition-colors ${
              avisoCuenta.estado === 'error'
                ? 'border-primario text-primario hover:bg-primario/10 cursor-pointer'
                : avisoCuenta.estado === 'rate_limit'
                ? 'border-[#3A3A3A] bg-[#1A1A1A] text-[#969696] cursor-not-allowed'
                : avisoCuenta.deshabilitado
                ? 'border-[#3A3A3A] bg-transparent text-texto-suave cursor-not-allowed'
                : 'border-[#3A3A3A] bg-transparent text-texto-suave hover:border-texto-suave hover:text-white cursor-pointer'
            }`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={
                avisoCuenta.estado === 'error'
                  ? '#E3242B'
                  : avisoCuenta.estado === 'rate_limit'
                  ? '#969696'
                  : '#B5B5B5'
              }
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
            <span>{avisoCuenta.mensaje}</span>
          </button>
        </div>
      )}

      {/* ──────────────── PANTALLA 2: CONFIRMANDO TU PAGO ──────────────── */}
      {pantalla === 'espera' && (
        <section
          className="entra bg-superficie border border-borde rounded-3xl p-6 flex flex-col items-center gap-4 text-center"
          aria-live="polite"
        >
          {/* Ilustración de ondas, tarjeta flotante y anillo giratorio */}
          <svg className="ilu" width="220" height="180" viewBox="0 0 220 180" aria-hidden="true">
            <circle className="onda" cx="110" cy="90" r="60" fill="none" stroke="#F2B705" strokeWidth="3" />
            <circle className="onda o2" cx="110" cy="90" r="60" fill="none" stroke="#F2B705" strokeWidth="3" />
            <circle className="onda o3" cx="110" cy="90" r="60" fill="none" stroke="#F2B705" strokeWidth="3" />
            <g className="tarjeta-flota">
              <rect x="62" y="62" width="96" height="60" rx="8" fill="#1F1F1F" stroke="#3A3A3A" strokeWidth="2" />
              <rect x="62" y="76" width="96" height="10" fill="#2A2A2A" />
              <rect x="72" y="96" width="22" height="14" rx="3" fill="#F2B705" />
              <rect x="100" y="104" width="44" height="5" rx="2" fill="#6B6B6B" />
            </g>
            <circle
              className="gira"
              cx="110"
              cy="90"
              r="78"
              fill="none"
              stroke="#E3242B"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="80 410"
            />
          </svg>

          <h1 className="m-0 font-titulo text-[46px] leading-[0.95] tracking-wider text-acento">
            CONFIRMANDO TU PAGO
          </h1>

          <p className="m-0 text-[15px] text-white">
            Termina el pago de{' '}
            <strong>
              {formatoPesos(
                intencionActual?.monto_en_centavos
                  ? intencionActual.monto_en_centavos / 100
                  : montoModo
              )}
            </strong>{' '}
            en la ventana de Wompi.
          </p>

          <p className="m-0 text-xs text-texto-suave">
            Te avisamos apenas el banco lo confirme. No cierres esta pantalla.
          </p>

          {/* Bloque de referencia y expiración */}
          <div className="w-full box-border flex items-center gap-2.5 bg-superficie-2 border border-borde rounded-xl p-3 text-xs text-texto-suave text-left">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#A3A3A3"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
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
            className="min-h-[44px] border-none bg-transparent text-primario-texto hover:text-primario text-sm font-semibold cursor-pointer transition-colors"
          >
            Volver a la cuenta
          </button>
        </section>
      )}

      {/* ──────────────── PANTALLA 3: ¡PAGO CONFIRMADO! ──────────────── */}
      {pantalla === 'confirmado' && (
        <section
          className="entra bg-superficie border border-borde rounded-3xl p-6 flex flex-col items-center gap-3.5 text-center"
          aria-live="polite"
        >
          {/* Ilustración de check verde con rebote y chispitas */}
          <svg className="ilu" width="220" height="170" viewBox="0 0 220 170" aria-hidden="true">
            <circle className="circulo-ok" cx="110" cy="85" r="56" fill="#2FA35A" />
            <path
              className="check"
              d="M84 86 l18 18 l36 -38"
              fill="none"
              stroke="#0B0B0B"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path className="chispa" d="M36 40 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z" fill="#F2B705" />
            <path className="chispa c2" d="M184 34 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" fill="#2FA35A" />
            <path className="chispa c3" d="M180 120 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" fill="#FF5A5F" />
            <path className="chispa c4" d="M42 124 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#F2B705" />
          </svg>

          <h1 className="m-0 font-titulo text-[50px] leading-[0.95] tracking-wider text-exito">
            ¡PAGO CONFIRMADO!
          </h1>

          {tipoConfirmado === 'propio' ? (
            <p className="m-0 text-[15px] text-white">
              Pagaste <strong>{formatoPesos(ultimoPago || montoModo)}</strong>. Te llegará el comprobante de Wompi.
            </p>
          ) : (
            <p className="m-0 text-[15px] text-white">
              La mesa quedó pagada.
            </p>
          )}

          <div className="w-full box-border bg-superficie-2 border border-borde rounded-xl p-3 flex justify-between items-center text-sm">
            <span className="text-texto-suave">Le falta a la mesa</span>
            <span className="font-semibold text-white">{formatoPesos(saldo)}</span>
          </div>

          <button
            type="button"
            onClick={handleVolverCuenta}
            className="w-full min-h-[52px] rounded-xl border border-borde bg-superficie-2 hover:bg-[#252525] text-white font-etiqueta font-bold text-base tracking-wider cursor-pointer transition-colors"
          >
            VER LA CUENTA
          </button>
        </section>
      )}

      {/* ──────────────── PANTALLA 4: PAGA EN LA CAJA ──────────────── */}
      {pantalla === 'caja' && (
        <section
          className="entra bg-superficie border border-borde rounded-3xl p-6 flex flex-col items-center gap-3.5 text-center"
          aria-live="polite"
        >
          {/* Ilustración de caja registradora con recibo animado */}
          <svg className="ilu" width="200" height="170" viewBox="0 0 200 170" aria-hidden="true">
            <rect x="40" y="70" width="120" height="70" rx="10" fill="#1F1F1F" stroke="#3A3A3A" strokeWidth="2" />
            <rect x="54" y="82" width="56" height="22" rx="4" fill="#0B0B0B" />
            <text x="82" y="98" textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="16" fill="#2FA35A">
              {formatoPesos(montoModo)}
            </text>
            <rect x="120" y="84" width="10" height="8" rx="2" fill="#3A3A3A" />
            <rect x="134" y="84" width="10" height="8" rx="2" fill="#3A3A3A" />
            <rect x="120" y="96" width="10" height="8" rx="2" fill="#3A3A3A" />
            <rect x="134" y="96" width="10" height="8" rx="2" fill="#F2B705" />
            <rect x="30" y="140" width="140" height="10" rx="4" fill="#2A2A2A" />
            <g className="recibo">
              <rect x="74" y="22" width="52" height="48" fill="#F4F1EA" />
              <rect x="82" y="32" width="36" height="4" rx="2" fill="#BDBDBD" />
              <rect x="82" y="42" width="28" height="4" rx="2" fill="#BDBDBD" />
              <rect x="82" y="52" width="32" height="4" rx="2" fill="#E3242B" />
            </g>
          </svg>

          <h1 className="m-0 font-titulo text-[48px] leading-[0.95] tracking-wider text-acento">
            PAGA EN LA CAJA
          </h1>

          <p
            className={`m-0 text-[15px] ${
              avisoCuenta.estado === 'error' ? 'text-primario-texto font-semibold' : 'text-white'
            }`}
            role={avisoCuenta.estado === 'error' ? 'alert' : undefined}
          >
            {textoCajaSegunEstado(avisoCuenta)}
          </p>
          {avisoCuenta.estado === 'error' && (
            <button
              type="button"
              onClick={handlePedirCuenta}
              className="min-h-[44px] px-3 rounded-lg border border-primario bg-transparent text-primario-texto text-xs font-semibold hover:bg-primario/10 cursor-pointer transition-colors"
            >
              Reintentar aviso al mesero
            </button>
          )}

          <div className="w-full box-border bg-[#0B0B0B] border border-dashed border-acento rounded-2xl p-3.5 flex flex-col gap-1 text-center">
            <span className="font-etiqueta font-bold text-xs tracking-widest text-texto-suave uppercase">
              DILE AL CAJERO
            </span>
            <span className="font-titulo text-[34px] tracking-wider text-white">
              {mesaNumero ? `MESA ${mesaNumero}` : 'MESA'} · {(comensal || 'MESA').toUpperCase()}
            </span>
            <span className="text-[15px] text-acento font-semibold">
              {formatoPesos(montoModo)}
            </span>
          </div>

          <p className="m-0 text-xs text-texto-tenue">
            Cuando el cajero registre tu pago, esta pantalla se actualiza sola.
          </p>

          <button
            type="button"
            onClick={handleVolverCuenta}
            className="min-h-[44px] border-none bg-transparent text-primario-texto hover:text-primario text-sm font-semibold cursor-pointer transition-colors"
          >
            Prefiero pagar con Wompi
          </button>
        </section>
      )}
    </div>
  );
}

export default Pago;
