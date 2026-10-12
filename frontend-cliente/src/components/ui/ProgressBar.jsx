/**
 * Barra de progreso por pasos para el constructor de platos.
 *
 * Props:
 * - pasoActual: número del paso actual (1-indexado)
 * - totalPasos: cantidad total de pasos
 * - etiqueta: descripción opcional de la etapa actual
 * - className: clases adicionales de Tailwind CSS
 */
function ProgressBar({ pasoActual = 1, totalPasos = 1, etiqueta, className = '' }) {
  const totalSeguro = Math.max(1, totalPasos);
  const pasoSeguro = Math.min(Math.max(1, pasoActual), totalSeguro);
  const porcentaje = Math.round((pasoSeguro / totalSeguro) * 100);

  return (
    <div className={`w-full ${className}`.trim()}>
      <div className="flex items-center justify-between text-xs font-semibold text-cafe mb-1.5">
        <span>
          Paso {pasoSeguro} de {totalSeguro}
        </span>
        {etiqueta && <span className="text-gray-600">{etiqueta}</span>}
      </div>

      <div
        role="progressbar"
        aria-label={`Paso ${pasoSeguro} de ${totalSeguro}`}
        aria-valuenow={pasoSeguro}
        aria-valuemin={1}
        aria-valuemax={totalSeguro}
        className="w-full h-2.5 bg-cafe/15 rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${porcentaje}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
