import { useEffect, useState } from 'react';
import {
  estadoTarjetaPush,
  marcarPreguntoPushEnSesion,
  soportePush,
  suscribir,
  yaPreguntoPushEnSesion,
} from '../../services/push';

function leerPermisoInicial() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission) {
      return Notification.permission;
    }
  } catch {
    // Ignorar si Notification no está disponible
  }
  return 'default';
}

/**
 * Tarjeta discreta en seguimiento que solicita permiso para avisos push
 * adaptada al estilo comanda.
 */
function TarjetaPermisoPush({ tienePedidoConfirmado = false }) {
  const [soporte] = useState(() => soportePush());
  const [permiso, setPermiso] = useState(leerPermisoInicial);
  const [yaPregunto, setYaPregunto] = useState(() =>
    yaPreguntoPushEnSesion()
  );
  const [solicitando, setSolicitando] = useState(false);

  const estado = estadoTarjetaPush({
    soporte,
    permiso,
    yaPregunto,
    tienePedidoConfirmado,
  });

  useEffect(() => {
    if (estado !== 'suscribir_silencio') return undefined;
    suscribir({ permisoActual: 'granted' });
    return undefined;
  }, [estado]);

  if (estado === 'oculto' || estado === 'suscribir_silencio') {
    return null;
  }

  const manejarAceptar = async () => {
    if (solicitando) return;
    setSolicitando(true);

    try {
      const resultado =
        typeof Notification !== 'undefined' &&
        typeof Notification.requestPermission === 'function'
          ? await Notification.requestPermission()
          : 'denied';

      setPermiso(resultado);
      marcarPreguntoPushEnSesion();
      setYaPregunto(true);

      if (resultado === 'granted') {
        await suscribir({ permisoActual: resultado });
      }
    } catch {
      marcarPreguntoPushEnSesion();
      setYaPregunto(true);
    } finally {
      setSolicitando(false);
    }
  };

  const manejarDescartar = () => {
    marcarPreguntoPushEnSesion();
    setYaPregunto(true);
  };

  if (estado === 'ios_sin_instalar') {
    return (
      <aside
        aria-label="Aviso de notificaciones en iPhone"
        className="ticket-comanda mt-6 p-4 flex flex-col gap-3 shadow-sm anim-sube"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="w-10 h-10 rounded-xl bg-carbon text-ambar flex items-center justify-center shrink-0"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
          </span>
          <p className="text-xs sm:text-sm text-carbon leading-relaxed">
            En iPhone, para recibir avisos agrega SmartDining a tu pantalla de
            inicio (Compartir → Agregar a inicio).
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={manejarDescartar}
            className="min-h-11 px-4 py-2 rounded-xl border-2 border-carbon bg-papel hover:bg-carbon hover:text-ambar text-carbon font-titulo text-base uppercase tracking-wider transition-colors cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Activar notificaciones"
      className="ticket-comanda mt-6 p-4 flex flex-col gap-3 shadow-sm anim-sube"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="w-10 h-10 rounded-xl bg-carbon text-ambar flex items-center justify-center shrink-0"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
          </svg>
        </span>
        <p className="text-sm font-semibold text-carbon leading-snug pt-1">
          ¿Te avisamos cuando tu plato esté listo?
        </p>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={manejarDescartar}
          disabled={solicitando}
          className="min-h-11 px-4 py-2 rounded-xl border border-carbon/30 bg-papel hover:bg-carbon/10 text-[#5B4A46] font-titulo text-base uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={manejarAceptar}
          disabled={solicitando}
          className="min-h-11 px-5 py-2 rounded-xl bg-carbon hover:bg-carbon/90 text-ambar font-titulo text-base uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
        >
          {solicitando ? 'Activando…' : 'Sí, avísame'}
        </button>
      </div>
    </aside>
  );
}

export default TarjetaPermisoPush;
