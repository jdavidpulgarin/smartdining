/**
 * Barra de progreso por pasos para el constructor de platos (tema oscuro).
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
      <div className="flex items-center justify-between text-xs text-texto-suave mb-1.5 font-cuerpo">
        <span>
          Paso {pasoSeguro} de {totalSeguro}
        </span>
        {etiqueta && <span>{etiqueta}</span>}
      </div>

      <div
        role="progressbar"
        aria-label={`Paso ${pasoSeguro} de ${totalSeguro}`}
        aria-valuenow={pasoSeguro}
        aria-valuemin={1}
        aria-valuemax={totalSeguro}
        className="w-full h-1.5 bg-borde rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-primario rounded-full transition-all duration-300"
          style={{ width: `${porcentaje}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
