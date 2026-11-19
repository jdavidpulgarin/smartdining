import { useEffect, useId, useRef, useState } from 'react';
import Button from '../ui/Button';
import { crearUnaVez } from '../../utils/modoPago';

/**
 * Maneja las pulsaciones de teclado en el aviso de modo demostración.
 * Llama a onCancelar únicamente cuando la tecla presionada es 'Escape'.
 *
 * @param {KeyboardEvent|object} evento
 * @param {object} opciones
 * @param {() => void} [opciones.onCancelar]
 */
// oxlint-disable-next-line react/only-export-components
export function manejarTeclaAviso(evento, { onCancelar } = {}) {
  if (evento?.key === 'Escape' && typeof onCancelar === 'function') {
    onCancelar();
  }
}

/**
 * Aviso de modo demostración para pagos de prueba con Wompi (llaves pub_test_).
 *
 * Props:
 * - onContinuar: función opcional. Si se proporciona, muestra los botones para proceder
 *   o cancelar el pago y utiliza role="alertdialog" con aria-modal="true". Si no, se
 *   renderiza como tarjeta informativa con role="note".
 * - onCancelar: función opcional llamada al cancelar o presionar la tecla Escape.
 */
function AvisoModoDemostracion({ onContinuar, onCancelar }) {
  const tituloId = useId();
  const descripcionId = useId();
  const botonContinuarRef = useRef(null);
  const [continuando, setContinuando] = useState(false);

  const tieneAccion = typeof onContinuar === 'function';

  // Guarda con useRef para impedir llamar onContinuar dos veces
  const unaVezRef = useRef(null);
  useEffect(() => {
    if (tieneAccion) {
      unaVezRef.current = crearUnaVez(() => {
        setContinuando(true);
        onContinuar();
      });
    } else {
      unaVezRef.current = null;
    }
  }, [tieneAccion, onContinuar]);

  // Al montarse, el foco va al botón "Entendido, continuar al pago"
  useEffect(() => {
    if (tieneAccion && botonContinuarRef.current) {
      botonContinuarRef.current.focus();
    }
  }, [tieneAccion]);

  const handleContinuar = () => {
    if (continuando) return;
    if (unaVezRef.current) {
      unaVezRef.current();
    } else if (tieneAccion) {
      setContinuando(true);
      onContinuar();
    }
  };

  return (
    <div
      role={tieneAccion ? 'alertdialog' : 'note'}
      aria-modal={tieneAccion ? 'true' : undefined}
      aria-labelledby={tieneAccion ? tituloId : undefined}
      aria-describedby={tieneAccion ? descripcionId : undefined}
      tabIndex={tieneAccion ? -1 : undefined}
      onKeyDown={(e) => manejarTeclaAviso(e, { onCancelar })}
      className="bg-papel text-tinta border-2 border-carbon/20 rounded-2xl p-4 flex flex-col gap-3 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full bg-ambar/30 border border-ambar flex items-center justify-center shrink-0 mt-0.5">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#92400E"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>

        <div className="flex flex-col gap-1 min-w-0">
          <h2
            id={tituloId}
            className="m-0 font-titulo text-xl sm:text-2xl text-carbon uppercase tracking-wide leading-tight"
          >
            Modo demostración
          </h2>
          <p
            id={descripcionId}
            className="m-0 text-xs sm:text-sm text-tinta/80 leading-relaxed font-sans"
          >
            Este pago es de prueba: no uses tu tarjeta real. Para probar, usa la tarjeta <strong>4242 4242 4242 4242</strong>, cualquier fecha futura y cualquier CVC.
          </p>
        </div>
      </div>

      {tieneAccion && (
        <div className="pt-1 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <Button
            variante="secundario"
            onClick={onCancelar}
            disabled={continuando}
            className="w-full sm:flex-1 text-base font-titulo tracking-wider !border-carbon !text-carbon hover:!bg-carbon/10 active:!bg-carbon/20"
          >
            Cancelar
          </Button>
          <Button
            ref={botonContinuarRef}
            variante="primario"
            onClick={handleContinuar}
            disabled={continuando}
            className="w-full sm:flex-1 text-base font-titulo tracking-wider !bg-carbon !text-papel hover:!bg-carbon/90 active:!bg-carbon/80"
          >
            Entendido, continuar al pago
          </Button>
        </div>
      )}
    </div>
  );
}

export default AvisoModoDemostracion;
