import { useId, useState } from 'react';
import Modal from '../ui/Modal';
import { formatearPrecio } from '../../utils/formato';
import { ETIQUETAS_MAP, ALERGENOS_MAP } from '../../constants/dieta';
import SelectorPersonalizacion from './SelectorPersonalizacion';

const NOTAS_MAX = 150;
const CANTIDAD_MIN = 1;
const CANTIDAD_MAX = 20;

function PlatoDetalleModal({ plato, abierto, onCerrar, onAgregar }) {
  const [selecciones, setSelecciones] = useState({});
  const [notas, setNotas] = useState('');
  const [cantidad, setCantidad] = useState(CANTIDAD_MIN);
  const notasId = useId();

  const manejarCambio = (grupoId, ids) =>
    setSelecciones((prev) => ({ ...prev, [grupoId]: ids }));

  // Los hooks deben ir ANTES de este return (reglas de hooks de React)
  if (!plato) {
    return null;
  }

  // Valores derivados
  const personalizaciones = plato.personalizaciones ?? [];

  const extras = personalizaciones.reduce((totalGrupo, grupo) => {
    const seleccionadosGrupo = selecciones[grupo.id] ?? [];
    const sumaGrupo = grupo.opciones.reduce((acc, opcion) => {
      return seleccionadosGrupo.includes(opcion.id)
        ? acc + (opcion.precioExtra ?? 0)
        : acc;
    }, 0);
    return totalGrupo + sumaGrupo;
  }, 0);

  const precioUnitario = plato.precio + extras;
  const subtotal = precioUnitario * cantidad;
  const agotado = plato.disponible === false;

  const gruposFaltantes = personalizaciones.filter((grupo) => {
    if (!grupo.obligatorio) return false;
    const sel = selecciones[grupo.id];
    return !sel || sel.length === 0;
  });

  const puedeAgregar = !agotado && gruposFaltantes.length === 0;

  const textoBoton = agotado
    ? 'No disponible'
    : gruposFaltantes.length > 0
      ? `Elige: ${gruposFaltantes[0].nombre}`
      : `Añadir ${cantidad} · ${formatearPrecio(subtotal)}`;

  const manejarAgregar = () => {
    if (!puedeAgregar) return;

    const seleccionesLimpias = Object.entries(selecciones).reduce(
      (acc, [grupoId, ids]) => {
        if (ids && ids.length > 0) {
          acc[grupoId] = ids;
        }
        return acc;
      },
      {}
    );

    onAgregar?.({
      platoId: plato.id,
      nombre: plato.nombre,
      cantidad,
      selecciones: seleccionesLimpias,
      notas: notas.trim(),
      precioUnitario,
      subtotal,
    });
  };

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
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              Alérgenos
            </h3>
            {plato.alergenos && plato.alergenos.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {plato.alergenos.map((alergeno) => (
                  <span
                    key={alergeno}
                    className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200"
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

          {/* 8. Sección Notas para la cocina */}
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <label
              htmlFor={notasId}
              className="block text-sm font-bold text-gray-900"
            >
              Notas para la cocina
            </label>
            <textarea
              id={notasId}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={NOTAS_MAX}
              rows={3}
              placeholder="Ej: sin cebolla"
              disabled={plato.disponible === false}
              className="w-full text-base border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            />
            <div className="text-right text-xs text-gray-400">
              {notas.length}/{NOTAS_MAX}
            </div>
          </div>
        </div>

        {/* Barra inferior fija con selector de cantidad y botón añadir */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCantidad((c) => Math.max(CANTIDAD_MIN, c - 1))}
              disabled={plato.disponible === false || cantidad === CANTIDAD_MIN}
              aria-label="Disminuir cantidad"
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 text-lg font-bold hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              −
            </button>
            <span
              aria-live="polite"
              className="min-w-8 text-center font-bold text-gray-900 text-base"
            >
              {cantidad}
            </span>
            <button
              type="button"
              onClick={() => setCantidad((c) => Math.min(CANTIDAD_MAX, c + 1))}
              disabled={plato.disponible === false || cantidad === CANTIDAD_MAX}
              aria-label="Aumentar cantidad"
              className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 text-lg font-bold hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={manejarAgregar}
            disabled={!puedeAgregar}
            className="flex-1 min-h-11 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm md:text-base rounded-lg transition-colors flex items-center justify-center text-center disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            {textoBoton}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default PlatoDetalleModal;
