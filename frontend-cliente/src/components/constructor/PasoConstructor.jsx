import IngredientCard from '../ui/IngredientCard';
import Badge from '../ui/Badge';
import SelectorPorcion from './SelectorPorcion';

function obtenerTextoRegla(paso) {
  const min = Number(paso.min_sel) || 0;
  const max = Number(paso.max_sel) || 0;

  if (min > 0) {
    if (min === max) {
      return `Elige ${min}`;
    }
    if (max > min) {
      return `Elige de ${min} a ${max}`;
    }
    return `Elige al menos ${min}`;
  }

  if (max > 0) {
    return `Opcional, hasta ${max}`;
  }

  return 'Opcional';
}

function PasoConstructor({ paso, seleccionesDelPaso = {}, despachador }) {
  if (!paso) {
    return null;
  }

  const idsElegidos = Object.keys(seleccionesDelPaso);
  const cantidadElegida = idsElegidos.length;
  const esUnica = Number(paso.max_sel) === 1;
  const maxAlcanzado =
    !esUnica && Number(paso.max_sel) > 0 && cantidadElegida >= Number(paso.max_sel);
  const esObligatorio = Boolean(paso.obligatorio || Number(paso.min_sel) > 0);

  return (
    <section aria-labelledby={`paso-titulo-${paso.id_paso}`} className="space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2
            id={`paso-titulo-${paso.id_paso}`}
            className="font-titulo text-xl font-bold text-cafe"
          >
            {paso.nombre}
          </h2>
          <p className="text-xs text-gray-600 font-medium mt-0.5">
            {obtenerTextoRegla(paso)}
          </p>
          {maxAlcanzado && (
            <p className="text-xs text-primary font-medium mt-0.5">
              Máximo alcanzado: quita uno para cambiarlo
            </p>
          )}
        </div>

        <Badge variante={esObligatorio ? 'alerta' : 'neutro'}>
          {esObligatorio ? 'Obligatorio' : 'Opcional'}
        </Badge>
      </div>

      <div className="space-y-2.5">
        {(paso.ingredientes || []).map((ingrediente) => {
          const idIng = ingrediente.id_ingrediente;
          const seleccionado = Object.prototype.hasOwnProperty.call(
            seleccionesDelPaso,
            idIng
          );
          const porcionElegida = seleccionesDelPaso[idIng] || 'normal';
          const agotado = !ingrediente.disponible;
          const deshabilitado = agotado || (maxAlcanzado && !seleccionado);

          return (
            <div key={idIng} className="space-y-1.5">
              <IngredientCard
                nombre={ingrediente.nombre}
                imagen={ingrediente.url_imagen}
                precioExtra={ingrediente.precio_extra}
                calorias={ingrediente.calorias}
                seleccionado={seleccionado}
                agotado={agotado}
                disabled={deshabilitado}
                onToggle={() =>
                  despachador({
                    type: 'ALTERNAR_INGREDIENTE',
                    paso,
                    ingrediente,
                  })
                }
              />
              {seleccionado && (
                <SelectorPorcion
                  nombreIngrediente={ingrediente.nombre}
                  porcionActual={porcionElegida}
                  precioExtra={ingrediente.precio_extra}
                  onCambiar={(nuevaPorcion) =>
                    despachador({
                      type: 'CAMBIAR_PORCION',
                      id_paso: paso.id_paso,
                      id_ingrediente: idIng,
                      porcion: nuevaPorcion,
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default PasoConstructor;
