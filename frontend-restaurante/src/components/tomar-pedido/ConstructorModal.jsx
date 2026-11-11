// Copiado y adaptado desde frontend-cliente/src/pages/Constructor.jsx
// Adaptado para frontend-restaurante en J-16

import { useReducer, useMemo } from 'react'
import { X, Plus, AlertCircle } from 'lucide-react'
import { constructorReducer, estadoInicial } from './constructorReducer'
import { PasoConstructor } from './PasoConstructor'
import { calcularPlato, pasosPendientes } from './calcularPlato'

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
      className="qr-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
    >
      <div
        className="constructor-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--sd-surface)',
          border: '1px solid var(--sd-border)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '650px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Encabezado */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--sd-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--sd-text)' }}>
                {plato.nombre}
              </h2>
              <span
                style={{
                  background: 'rgba(238, 28, 37, 0.15)',
                  color: 'var(--sd-red)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                Personalizable
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--sd-text-muted)' }}>
              Para: <strong style={{ color: 'var(--sd-text)' }}>{comensal}</strong> · Base: ${Number(plato.precio).toLocaleString('es-CO')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--sd-text-muted)',
              cursor: 'pointer',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Cuerpo con los pasos del constructor */}
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {(plato.pasos || []).map((paso) => (
            <PasoConstructor
              key={paso.id_paso}
              paso={paso}
              seleccionesDelPaso={estado.selecciones[paso.id_paso] || {}}
              despachador={despachador}
            />
          ))}

          {/* Notas para cocina */}
          <div style={{ marginTop: '8px' }}>
            <label
              htmlFor="notas-cocina-constructor"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                color: 'var(--sd-text-muted)',
                marginBottom: '6px',
              }}
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
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--sd-surface-2)',
                border: '1px solid var(--sd-border)',
                color: 'var(--sd-text)',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Barra inferior de confirmación */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--sd-border)',
            background: 'var(--sd-surface-2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--sd-text-muted)' }}>Precio total ítem</div>
            <strong style={{ fontSize: '1.25rem', color: 'var(--sd-text)' }}>
              ${calculo.precio.toLocaleString('es-CO')}
            </strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {!esValido && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--sd-gold)',
                  fontSize: '0.8rem',
                }}
              >
                <AlertCircle size={16} />
                <span>Faltan: {pendientes.join(', ')}</span>
              </div>
            )}

            <button
              type="button"
              disabled={!esValido}
              onClick={handleAgregar}
              className="table-btn-primary"
              style={{
                minHeight: '48px',
                padding: '10px 20px',
                background: esValido ? 'var(--sd-red)' : 'var(--sd-border)',
                borderColor: esValido ? 'var(--sd-red)' : 'var(--sd-border)',
                cursor: esValido ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                opacity: esValido ? 1 : 0.6,
              }}
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
