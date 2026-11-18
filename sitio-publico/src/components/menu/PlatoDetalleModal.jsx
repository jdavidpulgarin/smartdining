import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Imagen from '../ui/Imagen.jsx';
import { formatearPrecio } from '../../utils/formato.js';
import { ETIQUETAS_MAP, ALERGENOS_MAP } from '../../constants/dieta.js';
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

function PlatoDetalleModal({ plato, abierto, onCerrar }) {
  const [desactivarVideo, setDesactivarVideo] = useState(false);

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

  if (!plato) {
    return null;
  }

  const pasos = Array.isArray(plato.pasos) ? plato.pasos : [];
  const imagenUrl = plato.imagen || plato.url_imagen;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={plato.nombre}
      tamano="grande"
    >
      <div className="flex-1 flex flex-col justify-between">
        <div className="p-4 sm:p-6 lg:p-8 space-y-8">
          {/* Cabecera en 2 columnas: Columna izquierda: foto/video 4:3; Columna derecha: información */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-start">
            {/* Columna Izquierda: Foto o Video grande 4:3 */}
            <div className="relative aspect-[4/3] w-full rounded-2xl md:rounded-3xl overflow-hidden bg-superficie-2 border border-borde shrink-0 shadow-inner">
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
              ) : videoInfo ? (
                <Imagen
                  src={videoInfo.poster}
                  alt={plato.nombre}
                  width={640}
                  height={480}
                  aspecto="4/3"
                  className="w-full h-full object-cover"
                />
              ) : imagenUrl ? (
                <Imagen
                  src={imagenUrl}
                  alt={plato.nombre}
                  width={640}
                  height={480}
                  aspecto="4/3"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-texto-tenue font-etiqueta uppercase tracking-wider text-sm">
                  Sin imagen
                </div>
              )}
            </div>

            {/* Columna Derecha: Información del plato */}
            <div className="space-y-4">
              <div>
                {esArmable && (
                  <span className="inline-block px-2.5 py-0.5 rounded-full bg-acento text-fondo font-etiqueta font-bold text-xs uppercase tracking-wider mb-2">
                    Personalizable en mesa
                  </span>
                )}
                <h3 className="font-titulo text-3xl sm:text-4xl text-texto uppercase tracking-wide leading-tight">
                  {plato.nombre}
                </h3>
              </div>

              {/* Precio formateado */}
              <div className="flex items-baseline gap-2">
                <span className="font-etiqueta font-bold text-acento text-2xl sm:text-3xl tracking-wide">
                  {esArmable
                    ? `Desde ${formatearPrecio(plato.precio)}`
                    : formatearPrecio(plato.precio)}
                </span>
              </div>

              {/* Aviso de agotado si disponible === false */}
              {plato.disponible === false && (
                <div className="bg-primario/15 text-primario-texto border border-primario/30 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primario shrink-0" />
                  <span>Agotado: este plato no está disponible por ahora</span>
                </div>
              )}

              {/* Badges dietéticos */}
              {Array.isArray(plato.etiquetas) && plato.etiquetas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {plato.etiquetas.map((tag) => {
                    const conf = ETIQUETAS_MAP[tag] || {
                      label: tag.replace('_', ' '),
                      style:
                        'bg-superficie-2 text-texto-suave border border-borde font-etiqueta text-xs uppercase font-semibold',
                    };
                    return (
                      <span
                        key={tag}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-etiqueta uppercase ${conf.style}`}
                      >
                        {conf.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Descripción completa sin truncar */}
              {plato.descripcion && (
                <p className="text-sm sm:text-base text-texto-suave leading-relaxed font-cuerpo pt-1">
                  {plato.descripcion}
                </p>
              )}

              {/* Fichas informativas: Calorías, Tiempo estimado y Alérgenos */}
              <div className="pt-2 space-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  {caloriasTexto && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-superficie-2 border border-borde font-etiqueta text-xs uppercase font-bold text-texto">
                      <svg
                        className="w-3.5 h-3.5 text-acento"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
                        />
                      </svg>
                      {caloriasTexto}
                    </span>
                  )}

                  {plato.tiempo_estimado && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-superficie-2 border border-borde font-etiqueta text-xs uppercase font-bold text-texto">
                      <svg
                        className="w-3.5 h-3.5 text-acento"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      {plato.tiempo_estimado} min
                    </span>
                  )}
                </div>

                {/* Alérgenos */}
                <div>
                  <h4 className="text-xs font-etiqueta uppercase tracking-wider text-texto-suave mb-2 font-bold">
                    Alérgenos
                  </h4>
                  {Array.isArray(plato.alergenos) &&
                  plato.alergenos.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {plato.alergenos.map((alergeno) => (
                        <span
                          key={alergeno}
                          className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-lg bg-superficie-2 text-texto-suave border border-borde font-cuerpo"
                        >
                          {ALERGENOS_MAP[alergeno] ?? alergeno}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-texto-tenue italic font-cuerpo">
                      Sin alérgenos declarados
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sección Exclusiva para platos armables: 'Así lo armas' */}
          {esArmable && pasos.length > 0 && (
            <div className="border-t border-borde pt-6 space-y-6">
              <div>
                <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
                  Paso a paso
                </span>
                <h4 className="font-titulo text-2xl sm:text-3xl uppercase tracking-wider text-texto">
                  Así lo armas
                </h4>
              </div>

              <div className="space-y-6">
                {pasos.map((paso, idx) => {
                  const ingredientes = Array.isArray(paso.ingredientes)
                    ? paso.ingredientes
                    : [];
                  const regla = describirReglaPaso(paso);

                  return (
                    <div
                      key={paso.id_paso ?? idx}
                      className="bg-superficie-2/50 rounded-2xl border border-borde p-4 sm:p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h5 className="font-etiqueta font-bold text-base uppercase tracking-wide text-texto">
                          <span className="text-acento mr-2">
                            Paso {idx + 1}.
                          </span>
                          {paso.nombre}
                        </h5>
                        {regla && (
                          <span className="text-xs font-etiqueta uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-superficie text-texto-suave border border-borde font-semibold">
                            {regla}
                          </span>
                        )}
                      </div>

                      {ingredientes.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
                          {ingredientes.map((ing) => {
                            const extra = Number(ing.precio_extra) || 0;
                            const agotado = ing.disponible === false;

                            return (
                              <div
                                key={ing.id_ingrediente ?? ing.nombre}
                                className={`p-2.5 rounded-2xl border flex flex-col justify-between gap-2 transition-colors ${
                                  agotado
                                    ? 'bg-superficie-2/40 border-borde/60 opacity-60'
                                    : 'bg-superficie border-borde'
                                }`}
                              >
                                <div className="space-y-2">
                                  <div className="aspect-square w-full rounded-xl overflow-hidden bg-superficie-2 border border-borde">
                                    <Imagen
                                      src={ing.url_imagen}
                                      alt={ing.nombre}
                                      aspecto="cuadrada"
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                  <div>
                                    <h6 className="font-cuerpo font-semibold text-xs text-texto leading-snug line-clamp-2">
                                      {ing.nombre}
                                    </h6>
                                    {ing.calorias != null &&
                                      !isNaN(Number(ing.calorias)) && (
                                        <span className="text-[11px] text-texto-tenue font-cuerpo">
                                          {ing.calorias} kcal
                                        </span>
                                      )}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-borde/40 text-xs">
                                  {extra > 0 ? (
                                    <span className="font-etiqueta font-bold text-acento">
                                      +{formatearPrecio(extra)}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-texto-tenue font-etiqueta uppercase">
                                      Incluido
                                    </span>
                                  )}
                                  {agotado && (
                                    <span className="text-[10px] font-etiqueta font-bold uppercase tracking-wider text-primario-texto bg-primario/15 px-1.5 py-0.5 rounded">
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
        <div className="sticky bottom-0 bg-superficie border-t border-borde px-4 py-3 sm:px-6 sm:py-4 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <p className="text-xs sm:text-sm text-texto-suave font-cuerpo text-center sm:text-left">
            Para pedir, escanea el código QR de tu mesa.
          </p>
          <Button
            type="button"
            variante="secundario"
            onClick={onCerrar}
            className="w-full sm:w-auto min-h-11 px-6 text-sm font-bold uppercase tracking-wider"
          >
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default PlatoDetalleModal;