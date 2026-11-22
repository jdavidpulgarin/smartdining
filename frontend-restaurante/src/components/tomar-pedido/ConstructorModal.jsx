// Copiado y adaptado desde frontend-cliente/src/pages/Constructor.jsx
// Adaptado para frontend-restaurante en J-16

import { useReducer, useMemo } from 'react'
import { X, Plus, AlertCircle } from 'lucide-react'
import { constructorReducer, estadoInicial } from '../../utils/tomar-pedido/constructorReducer'
import { PasoConstructor } from './PasoConstructor'
import { calcularPlato, pasosPendientes } from '../../utils/tomar-pedido/calcularPlato'

export function ConstructorModal({ plato, comensal, onAgregar, onClose }) {
  const [estado, despachador] = useReducer(constructorReducer, estadoInicial)

  const calculo = useMemo(() => {
    return calcularPlato(plato, estado.selecciones)
  }, [plato, estado.selecciones])

  const pendientes = useMemo(() => {
    return pasosPendientes(plato, estado.selecciones)
  }, [plato, estado.selecciones])

  const esValido = pendientes.length === 0 && plato?.disponible !== false

  const handleAgregar = () => {
    if (!esValido) return

    onAgregar({
      id_plato: plato.id_plato,
      nombre: plato.nombre,
      precio: calculo.precio,
      precio_base: Number(plato.precio) || 0,
      cantidad: 1,
      comensal,
      notas: estado.notas.trim() || undefined,
      ingredientes: calculo.ingredientes.map((ig) => ({
        id_ingrediente: ig.id_ingrediente,
        nombre: ig.nombre,
        porcion: ig.porcion,
        precio_extra: ig.precio_extra,
      })),
      detalleIngredientes: calculo.detalle,
    })
    onClose()
  }

  return (
    <div
      className="tema-comanda cm-fondo"
      onClick={onClose}
    >
      <div
        className="constructor-modal-card cm-tarjeta"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cm-franja" aria-hidden="true" />
        {/* Encabezado */}
        <div className="cm-cabecera">
          <div className="cm-cabecera-izq">
            <div className="cm-titulo-fila">
              <h2 className="cm-titulo">
                {plato.nombre}
              </h2>
              <span className="cm-etiqueta">
                Personalizable
              </span>
            </div>
            <p className="cm-subtitulo">
              Para: <strong className="cm-subtitulo-nombre">{comensal}</strong> · Base: ${Number(plato.precio).toLocaleString('es-CO')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="cm-cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Cuerpo con los pasos del constructor */}
        <div className="cm-cuerpo">
          {(plato.pasos || []).map((paso) => (
            <PasoConstructor
              key={paso.id_paso}
              paso={paso}
              seleccionesDelPaso={estado.selecciones[paso.id_paso] || {}}
              despachador={despachador}
            />
          ))}

          {/* Notas para cocina */}
          <div className="cm-notas">
            <label
              htmlFor="notas-cocina-constructor"
              className="cm-label"
            >
              Notas para cocina (opcional, máx. 200 caracteres)
            </label>
            <input
              id="notas-cocina-constructor"
              type="text"
              maxLength={200}
              value={estado.notas}
              onChange={(e) => despachador({ type: 'CAMBIAR_NOTAS', notas: e.target.value })}
              placeholder="Ej. Sin cebolla, término medio..."
              className="cm-input"
            />
          </div>
        </div>

        {/* Barra inferior de confirmación */}
        <div className="cm-pie">
          <div>
            <div className="cm-pie-rotulo">Precio total ítem</div>
            <strong className="cm-pie-precio">
              ${calculo.precio.toLocaleString('es-CO')}
            </strong>
          </div>

          <div className="cm-pie-acciones">
            {!esValido && (
              <div className="cm-faltan">
                <AlertCircle size={16} />
                <span>Faltan: {pendientes.join(', ')}</span>
              </div>
            )}

            <button
              type="button"
              disabled={!esValido}
              onClick={handleAgregar}
              className="cm-btn cm-btn-ambar"
            >
              <Plus size={18} />
              <span>Agregar a la comanda</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
