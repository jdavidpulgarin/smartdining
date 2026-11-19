/**
 * Barra de progreso por pasos para el constructor de platos (estilo comanda).
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
      <div className="flex items-center justify-between text-xs font-titulo uppercase tracking-wider text-carbon mb-1.5">
        <span>
          Paso {pasoSeguro} de {totalSeguro}
        </span>
        {etiqueta && <span className="truncate max-w-[60%] text-right">{etiqueta}</span>}
      </div>

      <div
        role="progressbar"
        aria-label={`Paso ${pasoSeguro} de ${totalSeguro}`}
        aria-valuenow={pasoSeguro}
        aria-valuemin={1}
        aria-valuemax={totalSeguro}
        className="w-full h-2.5 bg-carbon rounded-full overflow-hidden p-0.5"
      >
        <div
          className="h-full bg-ambar rounded-full transition-all duration-300"
          style={{ width: `${porcentaje}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
