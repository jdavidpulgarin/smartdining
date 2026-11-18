import { useId } from 'react';
import Button from '../ui/Button';

/**
 * Aviso de modo demostración para pagos de prueba con Wompi (llaves pub_test_).
 *
 * Props:
 * - onContinuar: función opcional. Si se proporciona, muestra el botón para proceder al pago
 *   y utiliza role="alertdialog". Si no, se renderiza como tarjeta informativa con role="note".
 */
function AvisoModoDemostracion({ onContinuar }) {
  const tituloId = useId();
  const tieneAccion = typeof onContinuar === 'function';

  return (
    <div
      role={tieneAccion ? 'alertdialog' : 'note'}
      aria-labelledby={tieneAccion ? tituloId : undefined}
      className="bg-superficie border border-acento rounded-2xl p-4 flex flex-col gap-3 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <svg
          width="20"
          height="20"
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

        <div className="flex flex-col gap-1 min-w-0">
          <h2
            id={tituloId}
            className="m-0 font-titulo text-xl sm:text-2xl text-acento uppercase tracking-wide leading-tight"
          >
            Modo demostración
          </h2>
          <p className="m-0 text-xs sm:text-sm text-white leading-relaxed">
            Este pago es de prueba: no uses tu tarjeta real. Para probar, usa la tarjeta <strong>4242 4242 4242 4242</strong>, cualquier fecha futura y cualquier CVC.
          </p>
        </div>
      </div>

      {tieneAccion && (
        <div className="pt-1">
          <Button
            variante="primario"
            onClick={onContinuar}
            className="w-full text-base font-bold uppercase tracking-wider"
          >
            Entendido, continuar al pago
          </Button>
        </div>
      )}
    </div>
  );
}

export default AvisoModoDemostracion;
