import { useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Imagen from '../ui/Imagen.jsx';
import { formatearPrecio } from '../../utils/formato.js';
import { ETIQUETAS_MAP, ALERGENOS_MAP } from '../../constants/dieta.js';
import SelectorPersonalizacion from './SelectorPersonalizacion.jsx';

function PlatoDetalleModal({
  plato,
  abierto,
  onCerrar,
  soloLectura = true,
}) {
  const [selecciones, setSelecciones] = useState({});

  const manejarCambio = (grupoId, ids) =>
    setSelecciones((prev) => ({ ...prev, [grupoId]: ids }));

  if (!plato) {
    return null;
  }

  const personalizaciones = plato.personalizaciones ?? [];

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={plato.nombre}>
      <div>
        {/* Imagen grande: proporción 4:3 */}
        <Imagen
          src={plato.imagen}
          alt={plato.nombre}
          width={640}
          height={480}
          aspecto="4/3"
          className="w-full border-b border-borde"
        />

        <div className="p-4 space-y-4 text-texto">
          {/* Aviso de agotado si disponible === false */}
          {plato.disponible === false && (
            <div className="bg-primario/15 text-primario-texto border border-primario/30 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primario shrink-0" />
              <span>Agotado: este plato no está disponible por ahora</span>
            </div>
          )}

          {/* Precio formateado */}
          <div>
            <span className="font-etiqueta font-bold text-texto text-2xl tracking-wide">
              {formatearPrecio(plato.precio)}
            </span>
          </div>

          {/* Badges dietéticos */}
          {plato.etiquetas && plato.etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {plato.etiquetas.map((tag) => {
                const conf = ETIQUETAS_MAP[tag] || {
                  label: tag.replace('_', ' '),
                  style:
                    'bg-superficie-2 text-texto-suave border border-borde font-etiqueta text-[10px] uppercase font-semibold',
                };
                return (
                  <span
                    key={tag}
                    className={`px-1.5 py-0.5 rounded ${conf.style}`}
                  >
                    {conf.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Descripción completa */}
          {plato.descripcion && (
            <p className="text-sm text-texto-suave leading-relaxed font-cuerpo">
              {plato.descripcion}
            </p>
          )}

          {/* Sección de Alérgenos */}
          <div>
            <h3 className="text-xs font-etiqueta uppercase tracking-wider text-texto-suave mb-2 font-bold">
              Alérgenos
            </h3>
            {plato.alergenos && plato.alergenos.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {plato.alergenos.map((alergeno) => (
                  <span
                    key={alergeno}
                    className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-superficie-2 text-texto-suave border border-borde font-cuerpo"
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

          {/* Sección Personalizaciones (informativo en sitio público) */}
          {personalizaciones.length > 0 && (
            <div className="border-t border-borde pt-4 space-y-4">
              <h3 className="text-sm font-etiqueta uppercase tracking-wider font-bold text-texto">
                Opciones y Personalización
              </h3>
              <div className="space-y-4">
                {personalizaciones.map((grupo) => (
                  <SelectorPersonalizacion
                    key={grupo.id}
                    grupo={grupo}
                    seleccionadas={selecciones[grupo.id] ?? []}
                    onCambiar={(ids) => manejarCambio(grupo.id, ids)}
                    deshabilitado={soloLectura || plato.disponible === false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Barra inferior fija de solo lectura */}
        <div className="sticky bottom-0 bg-superficie border-t border-borde px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-texto-suave font-cuerpo leading-snug">
            Para pedir este plato, escanea el código QR en tu mesa o pídelo al mesero.
          </p>
          <Button
            type="button"
            variante="secundario"
            onClick={onCerrar}
            className="shrink-0"
          >
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default PlatoDetalleModal;
