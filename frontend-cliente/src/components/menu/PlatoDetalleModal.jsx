import { useState } from 'react';
import Modal from '../ui/Modal';
import { formatearPrecio } from '../../utils/formato';
import { ETIQUETAS_MAP, ALERGENOS_MAP } from '../../constants/dieta';
import SelectorPersonalizacion from './SelectorPersonalizacion';

function PlatoDetalleModal({ plato, abierto, onCerrar }) {
  const [selecciones, setSelecciones] = useState({});

  const manejarCambio = (grupoId, ids) =>
    setSelecciones((prev) => ({ ...prev, [grupoId]: ids }));

  // Los hooks deben ir ANTES de este return (reglas de hooks de React)
  if (!plato) {
    return null;
  }

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={plato.nombre}>
      <div>
        {/* 1. Imagen grande: ancho completo, proporción 4:3, object-cover */}
        {plato.imagen && (
          <div className="relative w-full aspect-[4/3] bg-gray-100 overflow-hidden">
            <img
              src={plato.imagen}
              alt={plato.nombre}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="p-4 space-y-4">
          {/* 2. Aviso de agotado si disponible === false */}
          {plato.disponible === false && (
            <div className="bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span>Agotado: este plato no está disponible por ahora</span>
            </div>
          )}

          {/* 3. Precio formateado */}
          <div>
            <span className="font-extrabold text-blue-600 text-xl">
              {formatearPrecio(plato.precio)}
            </span>
          </div>

          {/* 4. Badges dietéticos */}
          {plato.etiquetas && plato.etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {plato.etiquetas.map((tag) => {
                const conf = ETIQUETAS_MAP[tag] || {
                  label: tag.replace('_', ' '),
                  style: 'bg-gray-50 text-gray-600 border-gray-200',
                };
                return (
                  <span
                    key={tag}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${conf.style}`}
                  >
                    {conf.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* 5. Descripción completa */}
          {plato.descripcion && (
            <p className="text-sm text-gray-600 leading-relaxed">
              {plato.descripcion}
            </p>
          )}

          {/* 6. Sección de Alérgenos */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              Alérgenos
            </h4>
            {plato.alergenos && plato.alergenos.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {plato.alergenos.map((alergeno) => (
                  <span
                    key={alergeno}
                    className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200"
                  >
                    {ALERGENOS_MAP[alergeno] ?? alergeno}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                Sin alérgenos declarados
              </p>
            )}
          </div>

          {/* 7. Sección Personaliza tu plato */}
          {plato.personalizaciones && plato.personalizaciones.length > 0 && (
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <h3 className="text-sm font-bold text-gray-900">
                Personaliza tu plato
              </h3>
              <div className="space-y-4">
                {plato.personalizaciones.map((grupo) => (
                  <SelectorPersonalizacion
                    key={grupo.id}
                    grupo={grupo}
                    seleccionadas={selecciones[grupo.id] ?? []}
                    onCambiar={(ids) => manejarCambio(grupo.id, ids)}
                    deshabilitado={plato.disponible === false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default PlatoDetalleModal;
