import { useId } from 'react';
import { formatearPrecio } from '../../utils/formato';
import { ALERGENOS_MAP } from '../../constants/dieta';

function SelectorPersonalizacion({
  grupo,
  seleccionadas = [],
  onCambiar,
  deshabilitado = false,
}) {
  const baseId = useId();

  if (!grupo || !grupo.opciones) {
    return null;
  }

  const esUnica = grupo.tipo === 'unica';
  const radioName = `${baseId}-${grupo.id}`;
  const maxAlcanzado = !esUnica && grupo.max && seleccionadas.length >= grupo.max;

  return (
    <fieldset className="space-y-2">
      <legend className="w-full text-sm font-etiqueta uppercase tracking-wide font-bold text-texto mb-1">
        <span className="flex items-center justify-between gap-2">
          <span>{grupo.nombre}</span>
          <span className="flex items-center gap-1.5 text-xs font-normal font-cuerpo">
            {!esUnica && grupo.max && (
              <span className="text-texto-suave">
                Elige hasta {grupo.max}
              </span>
            )}
            {grupo.obligatorio ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-etiqueta uppercase font-bold tracking-wider bg-primario text-white">
                OBLIGATORIO
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-etiqueta uppercase font-semibold tracking-wider bg-superficie-2 text-texto-suave border border-borde">
                OPCIONAL
              </span>
            )}
          </span>
        </span>
      </legend>

      <div className="space-y-2 mt-2">
        {grupo.opciones.map((opcion) => {
          const estaSeleccionada = seleccionadas.includes(opcion.id);
          const opcionDeshabilitada =
            deshabilitado || (!estaSeleccionada && maxAlcanzado);

          return (
            <label
              key={opcion.id}
              className={`flex items-center justify-between w-full min-h-12 px-3 py-2 rounded-xl border transition-colors ${
                estaSeleccionada
                  ? 'border-2 border-primario bg-superficie-2'
                  : 'border-borde hover:border-primario/40 bg-superficie-2'
              } ${
                opcionDeshabilitada
                  ? 'opacity-40 cursor-not-allowed'
                  : 'cursor-pointer'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0 flex-1">
                <input
                  type={esUnica ? 'radio' : 'checkbox'}
                  name={radioName}
                  value={opcion.id}
                  checked={estaSeleccionada}
                  disabled={opcionDeshabilitada}
                  onChange={() => {
                    if (esUnica) {
                      onCambiar?.([opcion.id]);
                    } else {
                      if (estaSeleccionada) {
                        onCambiar?.(seleccionadas.filter((id) => id !== opcion.id));
                      } else {
                        onCambiar?.([...seleccionadas, opcion.id]);
                      }
                    }
                  }}
                  className="w-4 h-4 accent-primario shrink-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="block min-w-0 flex-1">
                  <span className="text-sm font-etiqueta uppercase tracking-wide font-semibold text-texto block">
                    {opcion.nombre}
                  </span>
                  {opcion.alergenos && opcion.alergenos.length > 0 && (
                    <span className="text-xs text-texto-suave block mt-0.5 font-cuerpo">
                      Contiene:{' '}
                      {opcion.alergenos
                        .map((a) => ALERGENOS_MAP[a] ?? a)
                        .join(', ')}
                    </span>
                  )}
                </span>
              </span>

              {opcion.precioExtra > 0 && (
                <span className="text-xs font-semibold text-primario-texto shrink-0 ml-3">
                  + {formatearPrecio(opcion.precioExtra)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default SelectorPersonalizacion;
