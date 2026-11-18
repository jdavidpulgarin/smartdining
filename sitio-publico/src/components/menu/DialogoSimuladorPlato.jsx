import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import { formatearPrecio } from '../../utils/formato.js';
import {
  inicializarSeleccion,
  alternarOpcion,
  calcularTotalSimulador,
  calcularCaloriasSimulador,
  reglaTextoPaso,
} from '../../utils/simuladorPlato.js';

function BotonOpcionIngrediente({
  ing,
  estaMarcado,
  agotado,
  onClick,
}) {
  const [errorImagen, setErrorImagen] = useState(false);
  const extra = Number(ing.precio_extra) || 0;
  const tieneImagen = Boolean(ing.url_imagen && !errorImagen);

  return (
    <button
      type="button"
      aria-pressed={estaMarcado}
      disabled={agotado}
      onClick={onClick}
      className={`relative flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto ${
        agotado
          ? 'bg-fondo/40 border-papel/10 opacity-40 cursor-not-allowed'
          : estaMarcado
          ? 'bg-ambar/10 border-ambar shadow-[inset_0_0_0_1px_rgba(255,184,28,1)]'
          : 'bg-fondo border-papel/15 hover:border-papel/50'
      }`}
    >
      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-gradient-to-br from-[#43201a] to-[#150c0c] flex items-center justify-center mb-2">
        {tieneImagen ? (
          <img
            src={ing.url_imagen}
            alt=""
            width={160}
            height={160}
            loading="lazy"
            decoding="async"
            onError={() => setErrorImagen(true)}
            className="w-full h-full object-cover"
          />
        ) : null}

        <span
          aria-hidden="true"
          className="font-titulo text-2xl text-papel/20"
        >
          {ing.nombre?.charAt(0)}
        </span>

        {!agotado && (
          <span
            aria-hidden="true"
            className={`absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              estaMarcado
                ? 'bg-primario text-white border-2 border-primario'
                : 'bg-black/60 text-transparent border-2 border-papel/40'
            }`}
          >
            ✓
          </span>
        )}
      </div>

      <div className="flex-1 flex flex-col justify-between w-full">
        <div>
          <strong className="block font-cuerpo-poster font-semibold text-xs sm:text-sm text-papel leading-snug line-clamp-2">
            {ing.nombre}
          </strong>
          {ing.calorias != null &&
            !isNaN(Number(ing.calorias)) && (
              <small className="block text-[11px] text-papel/60 font-cuerpo-poster mt-0.5">
                {ing.calorias} kcal
              </small>
            )}
        </div>

        <div className="mt-2 pt-1.5 border-t border-dashed border-papel/15">
          {agotado ? (
            <span className="text-xs font-bold text-primario-texto block">
              Agotado
            </span>
          ) : extra > 0 ? (
            <span className="font-titulo text-base text-ambar tracking-wide block">
              +{formatearPrecio(extra)}
            </span>
          ) : (
            <span className="text-xs font-semibold text-papel/60 block font-cuerpo-poster">
              Incluido
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * Diálogo interactivo del simulador 'Arma tu plato'.
 * Permite explorar los ingredientes de un plato personalizable,
 * simular la selección paso a paso respetando reglas min/max/agotados,
 * y visualizar el total calculado y las calorías aproximadas.
 */
function DialogoSimuladorPlato({ plato, abierto = false, onCerrar }) {
  const [sel, setSel] = useState([]);
  const [mensajeTope, setMensajeTope] = useState('');

  const pasos = Array.isArray(plato?.pasos) ? plato.pasos : [];

  useEffect(() => {
    if (abierto && plato) {
      setSel(inicializarSeleccion(pasos));
      setMensajeTope('');
    }
  }, [abierto, plato]);

  useEffect(() => {
    if (!mensajeTope) return undefined;
    const timer = setTimeout(() => {
      setMensajeTope('');
    }, 2500);
    return () => clearTimeout(timer);
  }, [mensajeTope]);

  if (!plato) return null;

  const manejarOpcionClick = (pasoIndex, opcionIndex) => {
    const { nuevaSel, mensajeTope: nuevoMensaje } = alternarOpcion({
      pasos,
      sel,
      pasoIndex,
      opcionIndex,
    });
    setSel(nuevaSel);
    if (nuevoMensaje) {
      setMensajeTope(nuevoMensaje);
    }
  };

  const total = calcularTotalSimulador({
    precioBase: plato.precio,
    pasos,
    sel,
  });

  const caloriasTotal = calcularCaloriasSimulador({
    pasos,
    sel,
  });

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={plato.nombre}
      tamano="grande"
      className="bg-[#1b1313] text-papel border border-papel/15"
    >
      <div className="flex-1 flex flex-col justify-between overflow-hidden bg-[#1b1313] text-papel">
        {/* Cuerpo con scroll */}
        <div className="overflow-y-auto p-4 sm:p-6 lg:p-7 space-y-7 flex-1">
          {plato.descripcion && (
            <p className="font-cuerpo-poster text-sm sm:text-base text-papel/70 leading-relaxed m-0">
              {plato.descripcion} Toca los ingredientes para ver el precio y las calorías de tu plato.
            </p>
          )}

          <div className="space-y-7">
            {pasos.map((paso, si) => {
              const ingredientes = Array.isArray(paso.ingredientes)
                ? paso.ingredientes
                : [];
              const regla = reglaTextoPaso(paso);
              const seleccionadosPaso = sel[si] || [];
              const esObligatorio =
                Boolean(paso.obligatorio) || Number(paso.min_sel) > 0;

              return (
                <section key={paso.id_paso ?? si} className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-dashed border-papel/20 pb-2">
                    <h4 className="font-titulo text-xl sm:text-2xl uppercase tracking-wider text-papel m-0">
                      <b className="text-ambar font-normal mr-2">
                        Paso {si + 1}
                      </b>
                      {paso.nombre}
                    </h4>
                    <span
                      className={`text-xs font-cuerpo-poster font-semibold ${
                        esObligatorio ? 'text-ambar' : 'text-papel/70'
                      }`}
                    >
                      {regla}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                    {ingredientes.map((ing, ii) => {
                      const estaMarcado = seleccionadosPaso.includes(ii);
                      const agotado = ing.disponible === false;

                      return (
                        <BotonOpcionIngrediente
                          key={ing.id_ingrediente ?? ii}
                          ing={ing}
                          estaMarcado={estaMarcado}
                          agotado={agotado}
                          onClick={() => manejarOpcionClick(si, ii)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        {/* Pie fijo con total, calorías y mensaje de tope */}
        <div className="sticky bottom-0 bg-[#150d0d] border-t border-papel/15 px-4 py-3 sm:px-6 sm:py-4 shrink-0 space-y-1">
          <div className="flex justify-between items-center gap-4">
            <span className="text-sm sm:text-base font-cuerpo-poster text-papel/70">
              Tu plato
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-titulo text-3xl sm:text-4xl text-ambar tracking-wide">
                {formatearPrecio(total)}
              </span>
              {caloriasTotal != null && (
                <span className="text-xs sm:text-sm text-papel/70 font-cuerpo-poster">
                  ≈ {caloriasTotal} kcal
                </span>
              )}
            </div>
          </div>

          <p
            id="hint-tope"
            role="status"
            aria-live="polite"
            className="min-h-[1.25em] text-xs sm:text-sm font-semibold text-ambar m-0"
          >
            {mensajeTope}
          </p>

          <p className="text-xs text-papel/60 font-cuerpo-poster m-0">
            Para pedir, escanea el código QR de tu mesa.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default DialogoSimuladorPlato;
