import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { formatearPrecio } from '../../utils/formato.js';
import { ALERGENOS_MAP } from '../../constants/dieta.js';
import {
  describirReglaPaso,
  leerPreferenciasVideoNavegador,
  debeCargarVideo,
} from '../../utils/sitioPublico.js';
import restaurante from '../../datos/restaurante.js';

export function calcularCaloriasArmable(pasos = []) {
  if (!Array.isArray(pasos) || pasos.length === 0) return null;
  let sumaMinima = 0;
  let hayObligatoriosConCalorias = false;

  for (const paso of pasos) {
    const esObligatorio = Boolean(
      paso.obligatorio || Number(paso.min_sel) > 0 || Number(paso.minimo) > 0
    );
    if (!esObligatorio) continue;

    const ings = Array.isArray(paso.ingredientes) ? paso.ingredientes : [];
    const cals = ings
      .map((i) =>
        i.calorias != null && !isNaN(Number(i.calorias))
          ? Number(i.calorias)
          : null
      )
      .filter((c) => c !== null);

    if (cals.length > 0) {
      hayObligatoriosConCalorias = true;
      sumaMinima += Math.min(...cals);
    }
  }

  return hayObligatoriosConCalorias ? sumaMinima : null;
}

/**
 * Modal de detalle de plato al estilo póster de restaurante.
 * Papel crema (bg-papel, texto tinta), foto/video a la izquierda y texto a la derecha,
 * precio en primario, descripción, chips punteados de ingredientes y chips rojos de alérgenos.
 */
function PlatoDetalleModal({
  plato,
  abierto,
  onCerrar,
  errorImagenInicial = false,
}) {
  const [desactivarVideo, setDesactivarVideo] = useState(false);
  const [errorImagen, setErrorImagen] = useState(errorImagenInicial);

  useEffect(() => {
    setErrorImagen(errorImagenInicial);
  }, [plato?.id, plato?.id_plato, plato?.imagen, plato?.url_imagen, errorImagenInicial]);

  const esArmable = Boolean(
    plato?.personalizable === true ||
      (Array.isArray(plato?.pasos) && plato.pasos.length > 0)
  );

  const videoInfo = plato ? restaurante.videosPlatos?.[plato.nombre] : null;

  useEffect(() => {
    if (!abierto || !videoInfo) return;
    const prefs = leerPreferenciasVideoNavegador();
    if (!debeCargarVideo(prefs)) {
      setDesactivarVideo(true);
    }
  }, [abierto, videoInfo]);

  const mostrarVideo = Boolean(videoInfo && !desactivarVideo);

  const caloriasTexto = useMemo(() => {
    if (!plato) return null;
    if (esArmable) {
      const minCals = calcularCaloriasArmable(plato.pasos);
      return minCals != null ? `Desde ${minCals} kcal` : null;
    }
    if (plato.calorias != null && !isNaN(Number(plato.calorias))) {
      return `${plato.calorias} kcal`;
    }
    return null;
  }, [plato, esArmable]);

  const pasos = useMemo(
    () => (Array.isArray(plato?.pasos) ? plato.pasos : []),
    [plato]
  );

  // Extraer ingredientes (de plato.ingredientes o de los pasos si es armable)
  const listaIngredientes = useMemo(() => {
    if (!plato) return [];
    if (Array.isArray(plato?.ingredientes) && plato.ingredientes.length > 0) {
      return plato.ingredientes.map((i) => (typeof i === 'string' ? i : i.nombre));
    }
    if (pasos.length > 0) {
      return pasos.flatMap((p) =>
        (p.ingredientes || []).map((i) => i.nombre)
      );
    }
    return [];
  }, [plato, pasos]);

  // Extraer alérgenos declarados
  const listaAlergenos = useMemo(() => {
    if (!plato) return [];
    if (Array.isArray(plato?.alergenos) && plato.alergenos.length > 0) {
      return plato.alergenos;
    }
    // Si los pasos traen alérgenos en sus ingredientes
    if (pasos.length > 0) {
      const alergs = new Set();
      pasos.forEach((p) => {
        (p.ingredientes || []).forEach((i) => {
          (i.alergenos || []).forEach((a) => alergs.add(a));
        });
      });
      return Array.from(alergs);
    }
    return [];
  }, [plato, pasos]);

  if (!plato) {
    return null;
  }

  const imagenUrl = plato.imagen || plato.url_imagen;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={plato.nombre}
      tamano="grande"
      tema="papel"
      mostrarCabecera={false}
      className="bg-papel text-tinta"
    >
      <div className="flex-1 flex flex-col justify-between bg-papel text-tinta">
        <div className="p-5 sm:p-7 lg:p-8 space-y-6">
          {/* Estructura en 2 columnas: Foto/Video a la izquierda, Texto a la derecha */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-start">
            {/* Foto o Video */}
            <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[320px] w-full rounded-xl overflow-hidden bg-gradient-to-br from-[#43201a] to-[#150c0c] shrink-0 shadow-md">
              {mostrarVideo ? (
                <video
                  src={videoInfo.archivo}
                  poster={videoInfo.poster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="none"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="w-full h-full object-cover"
                />
              ) : videoInfo?.poster && !errorImagen ? (
                <img
                  src={videoInfo.poster}
                  alt={plato.nombre}
                  width={640}
                  height={480}
                  loading="lazy"
                  decoding="async"
                  onError={() => setErrorImagen(true)}
                  className="w-full h-full object-cover"
                />
              ) : imagenUrl && !errorImagen ? (
                <img
                  src={imagenUrl}
                  alt={plato.nombre}
                  width={640}
                  height={480}
                  loading="lazy"
                  decoding="async"
                  onError={() => setErrorImagen(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="w-full h-full bg-gradient-to-br from-[#43201a] to-[#150c0c] flex items-center justify-center font-titulo text-2xl uppercase tracking-wider text-papel/40 select-none p-4 text-center"
                >
                  {plato.nombre}
                </div>
              )}
            </div>

            {/* Información del plato */}
            <div className="space-y-4">
              <h3 className="font-titulo text-3xl sm:text-4xl text-tinta uppercase tracking-wide leading-tight m-0">
                {plato.nombre}
              </h3>

              <div className="font-titulo text-2xl sm:text-3xl text-primario tracking-wide">
                {esArmable ? `Desde ${formatearPrecio(plato.precio)}` : formatearPrecio(plato.precio)}
              </div>

              {plato.descripcion && (
                <p className="font-cuerpo-poster text-base text-tinta/85 leading-relaxed m-0">
                  {plato.descripcion}
                </p>
              )}

              {/* Fichas adicionales: calorías y tiempo estimado */}
              {(caloriasTexto || plato.tiempo_estimado) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {caloriasTexto && (
                    <span className="px-3 py-1 rounded-full text-xs font-titulo tracking-wider uppercase bg-tinta/10 text-tinta">
                      {caloriasTexto}
                    </span>
                  )}
                  {plato.tiempo_estimado && (
                    <span className="px-3 py-1 rounded-full text-xs font-titulo tracking-wider uppercase bg-tinta/10 text-tinta">
                      {plato.tiempo_estimado} min
                    </span>
                  )}
                </div>
              )}

              {/* Ingredientes como chips punteados */}
              {listaIngredientes.length > 0 && (
                <div className="pt-2 space-y-2">
                  <h4 className="font-titulo text-lg uppercase tracking-wide text-tinta m-0">
                    Ingredientes
                  </h4>
                  <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                    {listaIngredientes.map((ing) => (
                      <li
                        key={ing}
                        className="px-3 py-1 rounded-full text-xs font-cuerpo-poster font-medium border border-dashed border-tinta/40 text-tinta"
                      >
                        {ing}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Alérgenos */}
              <div className="pt-2 space-y-2">
                <h4 className="font-titulo text-lg uppercase tracking-wide text-tinta m-0">
                  Alérgenos
                </h4>
                {listaAlergenos.length > 0 ? (
                  <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                    {listaAlergenos.map((alergeno) => (
                      <li
                        key={alergeno}
                        className="px-3 py-1 rounded-full text-xs font-cuerpo-poster font-semibold border border-primario text-primario"
                      >
                        {ALERGENOS_MAP[alergeno] ?? alergeno}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-cuerpo-poster text-sm text-tinta/80 m-0">
                    Si tienes alguna alergia, pregúntale a nuestro equipo antes de pedir.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Sección 'Así lo armas' para platos armables */}
          {esArmable && pasos.length > 0 && (
            <div className="border-t border-tinta/15 pt-6 space-y-6">
              <div>
                <span className="font-titulo tracking-widest text-sm text-ambar uppercase block">
                  Paso a paso
                </span>
                <h4 className="font-titulo text-3xl uppercase tracking-wider text-tinta m-0">
                  Así lo armas
                </h4>
              </div>

              <div className="space-y-5">
                {pasos.map((paso, idx) => {
                  const ingredientes = Array.isArray(paso.ingredientes)
                    ? paso.ingredientes
                    : [];
                  const regla = describirReglaPaso(paso);

                  return (
                    <div
                      key={paso.id_paso ?? idx}
                      className="bg-tinta/5 rounded-xl border border-tinta/10 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-tinta/25 pb-2">
                        <h5 className="font-titulo text-xl uppercase tracking-wide text-tinta m-0">
                          <span className="text-primario mr-2">Paso {idx + 1}.</span>
                          {paso.nombre}
                        </h5>
                        {regla && (
                          <span className="text-xs font-cuerpo-poster font-semibold text-tinta/80">
                            {regla}
                          </span>
                        )}
                      </div>

                      {ingredientes.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                          {ingredientes.map((ing) => {
                            const extra = Number(ing.precio_extra) || 0;
                            const agotado = ing.disponible === false;

                            return (
                              <div
                                key={ing.id_ingrediente ?? ing.nombre}
                                className={`p-2.5 rounded-xl border flex flex-col justify-between gap-2 bg-papel ${
                                  agotado
                                    ? 'border-tinta/20 opacity-60'
                                    : 'border-tinta/20'
                                }`}
                              >
                                <div className="space-y-1.5">
                                  <div className="aspect-square w-full rounded-lg overflow-hidden bg-tinta/10 relative">
                                    {ing.url_imagen ? (
                                      <img
                                        src={ing.url_imagen}
                                        alt=""
                                        width={160}
                                        height={160}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center font-titulo text-xl text-tinta/30">
                                        {ing.nombre?.charAt(0)}
                                      </div>
                                    )}
                                  </div>
                                  <h6 className="font-cuerpo-poster font-semibold text-xs text-tinta line-clamp-2 m-0">
                                    {ing.nombre}
                                  </h6>
                                  {ing.calorias != null &&
                                    !isNaN(Number(ing.calorias)) && (
                                      <span className="text-[11px] text-tinta/60 font-cuerpo-poster block">
                                        {ing.calorias} kcal
                                      </span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-dashed border-tinta/20 text-xs">
                                  {extra > 0 ? (
                                    <span className="font-titulo text-base text-primario tracking-wide">
                                      +{formatearPrecio(extra)}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-tinta/60 font-cuerpo-poster font-medium">
                                      Incluido
                                    </span>
                                  )}
                                  {agotado && (
                                    <span className="text-[10px] font-bold uppercase text-primario">
                                      Agotado
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Pie del modal */}
        <div className="sticky bottom-0 bg-papel border-t border-tinta/15 px-4 py-3 sm:px-6 sm:py-4 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <p className="text-xs sm:text-sm text-tinta/80 font-cuerpo-poster text-center sm:text-left m-0">
            Para pedir, escanea el código QR de tu mesa.
          </p>
          <Button
            type="button"
            variante="secundario"
            onClick={onCerrar}
            className="w-full sm:w-auto min-h-11 px-6 text-sm font-bold uppercase tracking-wider border-tinta text-tinta hover:bg-tinta/10"
          >
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default PlatoDetalleModal;
