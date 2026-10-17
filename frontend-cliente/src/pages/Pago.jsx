import { useState } from 'react';
import { useCuentaMesa } from '../hooks/useCuentaMesa';
import { formatoPesos, montosPorModo, TITULOS_MODO } from '../utils/cuenta';

/**
 * Pantalla principal de La Cuenta y Pagos (J-08).
 *
 * Muestra el desglose de la cuenta de la mesa, el estado de cada comensal,
 * las opciones para pagar (LO MÍO, DIVIDIR, TODA LA MESA), y los flujos
 * de confirmación y pago en caja.
 */
function Pago() {
  const { cuenta, cargando, error, recargar, idMesa } = useCuentaMesa();

  const [modo, setModo] = useState('propio');
  const [cuentaPedida, setCuentaPedida] = useState(false);
  const [avisoMesero, setAvisoMesero] = useState(null);

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
        <div className="bg-superficie border border-borde rounded-2xl p-6 space-y-3">
          <h2 className="font-titulo text-2xl text-primario uppercase tracking-wide">
            No pudimos cargar la cuenta
          </h2>
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

  const mesaNumero = cuenta?.numero || idMesa || 5;
  const ubicacion = cuenta?.ubicacion || 'Terraza';
  const total = cuenta?.total ?? 0;
  const pagado = cuenta?.pagado ?? 0;
  const saldo = cuenta?.saldo ?? 0;
  const miSaldo = cuenta?.mia?.saldo ?? 0;
  const miSubtotal = cuenta?.mia?.subtotal ?? 0;

  const comensales = cuenta?.comensales || [];
  const personas = Math.max(1, comensales.filter((c) => !c.esGeneral).length || 1);

  const montos = montosPorModo(cuenta, personas);
  const montoModo = montos[modo] ?? miSaldo;

  const puedoPagar = saldo > 0 && montoModo > 0;
  const yaPague = miSaldo === 0 && saldo > 0;
  const progreso = total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 0;

  const ayudas = {
    propio: 'Pagas solo lo que tú pediste.',
    igual: `La cuenta total dividida entre las ${personas} personas de la mesa.`,
    total: 'Pagas todo lo que le falta a la mesa (invitas tú).',
  };

  const handlePedirCuenta = () => {
    setCuentaPedida(true);
    setAvisoMesero('Le avisamos al mesero que quieres la cuenta');
    setTimeout(() => setAvisoMesero(null), 4000);
  };

  return (
    <div className="flex flex-col gap-3.5 pb-8">
      {/* Aviso toast local */}
      {avisoMesero && (
        <div
          role="status"
          aria-live="polite"
          className="bg-superficie border border-exito text-white px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-lg toast-entra"
        >
          <span className="w-2 h-2 rounded-full bg-exito shrink-0" />
          <span>{avisoMesero}</span>
        </div>
      )}

      {/* 1. SECCIÓN LA CUENTA */}
      <section className="bg-superficie border border-borde rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h1 className="m-0 font-titulo text-[40px] tracking-wider leading-none text-white">
            LA CUENTA
          </h1>
          <span className="text-xs text-texto-suave">
            Mesa {mesaNumero} · {ubicacion}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-etiqueta font-bold text-sm tracking-widest text-texto-suave uppercase">
            TU PARTE
          </span>
          <span
            className="font-titulo text-[64px] tracking-wider leading-[0.95]"
            style={{ color: miSaldo === 0 ? '#2FA35A' : '#FFFFFF' }}
          >
            {formatoPesos(miSaldo)}
          </span>
          <span className="text-xs text-texto-suave">
            {miSaldo === 0
              ? 'Ya pagaste lo tuyo. ¡Gracias!'
              : `Consumiste ${formatoPesos(miSubtotal)}`}
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

      {/* 2. SECCIÓN QUIÉN DEBE QUÉ */}
      <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-1">
        <h2 className="m-0 mb-2 font-etiqueta font-bold text-sm tracking-wider text-white uppercase">
          QUIÉN DEBE QUÉ
        </h2>
        <div className="flex flex-col divide-y divide-[#222222]">
          {comensales.map((c, idx) => {
            const deb = Math.max(0, c.saldo);
            const yaPago = deb === 0;
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

      {/* 3. SECCIÓN ¿CÓMO QUIERES PAGAR? (si hay saldo por pagar) */}
      {puedoPagar && (
        <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="m-0 font-etiqueta font-bold text-sm tracking-wider text-white uppercase">
            ¿CÓMO QUIERES PAGAR?
          </h2>

          {/* Radiogroup selector de modo */}
          <div
            role="radiogroup"
            aria-label="Modo de pago"
            className="grid grid-cols-3 gap-1.5 bg-[#0B0B0B] border border-borde rounded-xl p-1"
          >
            {['propio', 'igual', 'total'].map((k) => {
              const activo = modo === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => setModo(k)}
                  className={`min-h-[48px] rounded-lg cursor-pointer flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    activo
                      ? 'bg-primario text-white shadow-sm'
                      : 'bg-transparent text-texto-suave hover:text-white'
                  }`}
                >
                  <span className="font-etiqueta font-bold text-sm tracking-wider uppercase">
                    {TITULOS_MODO[k]}
                  </span>
                  <span className="text-[11px] opacity-85">
                    {formatoPesos(montos[k])}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="m-0 text-xs text-texto-suave">
            {ayudas[modo]}
          </p>

          {/* Botón Pagar Wompi */}
          <button
            type="button"
            className="min-h-[56px] rounded-2xl bg-primario hover:bg-primario-hover text-white font-etiqueta font-bold text-[19px] tracking-wider cursor-pointer flex items-center justify-center gap-2.5 transition-colors shadow-sm"
          >
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
            PAGAR {formatoPesos(montoModo)}
          </button>

          {/* Botón Pagar en Caja */}
          <button
            type="button"
            className="min-h-[52px] rounded-xl border border-borde bg-superficie-2 hover:bg-[#252525] text-white font-etiqueta font-bold text-base tracking-wider cursor-pointer flex items-center justify-center gap-2 transition-colors"
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

      {/* 4. YA PAGASTE TU PARTE (si mi saldo es 0 pero la mesa aún debe) */}
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

      {/* 5. PEDIR LA CUENTA AL MESERO (botón punteado) */}
      <button
        type="button"
        onClick={handlePedirCuenta}
        disabled={cuentaPedida}
        className={`min-h-[48px] rounded-xl border border-dashed border-[#3A3A3A] bg-transparent text-texto-suave text-sm flex items-center justify-center gap-2 transition-colors ${
          cuentaPedida ? 'opacity-70 cursor-not-allowed' : 'hover:border-texto-suave hover:text-white cursor-pointer'
        }`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#A3A3A3"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        <span>
          {cuentaPedida
            ? 'Ya le avisamos al mesero que quieres la cuenta'
            : 'Pedir la cuenta al mesero'}
        </span>
      </button>
    </div>
  );
}

export default Pago;
