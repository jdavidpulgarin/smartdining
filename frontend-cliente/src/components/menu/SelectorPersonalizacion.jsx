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
      <legend className="w-full text-sm font-semibold text-gray-900 mb-1">
        <span className="flex items-center justify-between gap-2">
          <span>{grupo.nombre}</span>
          <span className="flex items-center gap-1.5 text-xs font-normal">
            {!esUnica && grupo.max && (
              <span className="text-gray-500">
                Elige hasta {grupo.max}
              </span>
            )}
            {grupo.obligatorio ? (
              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider border border-blue-200">
                Obligatorio
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium border border-gray-200">
                Opcional
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
              className={`flex items-center justify-between w-full min-h-11 px-3 py-2 rounded-lg border transition-colors ${
                estaSeleccionada
                  ? 'border-blue-500 bg-blue-50/40'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              } ${
                opcionDeshabilitada
                  ? 'opacity-50 cursor-not-allowed'
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
                  className="w-4 h-4 accent-blue-600 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="block min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-900 block">
                    {opcion.nombre}
                  </span>
                  {opcion.alergenos && opcion.alergenos.length > 0 && (
                    <span className="text-xs text-gray-600 block mt-0.5">
                      Contiene:{' '}
                      {opcion.alergenos
                        .map((a) => ALERGENOS_MAP[a] ?? a)
                        .join(', ')}
                    </span>
                  )}
                </span>
              </span>

              {opcion.precioExtra > 0 && (
                <span className="text-xs font-semibold text-gray-600 shrink-0 ml-3">
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
