import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks'
import { TabInsumos } from '../components/inventario/TabInsumos'
import { TabRecetas } from '../components/inventario/TabRecetas'

/**
 * Inventario (P-22), solo admin: lo que hay en bodega, cómo entra y sale, y qué
 * consume cada plato y cada opción del constructor.
 * Contrato: backend/docs/api-spec.md, "Inventario: insumos, movimientos y
 * recetas" (D-17 PR 2 y PR 3), donde todas las rutas son solo admin; esconder la
 * página a los demás roles es solo para no mostrarles algo que siempre daría 403.
 */
const PESTANAS = [
  { id: 'insumos', etiqueta: 'INSUMOS' },
  { id: 'recetas', etiqueta: 'RECETAS' },
]

const CONTENIDO = { insumos: TabInsumos, recetas: TabRecetas }

export function Inventario() {
  const { user } = useAuth()
  const [activa, setActiva] = useState('insumos')

  if (user?.rol !== 'admin') return <Navigate to="/" replace />

  const Contenido = CONTENIDO[activa]

  return (
    <div className="sd-page-wrapper">
      <div className="sd-page-header">
        <div>
          <h1 className="sd-page-title">INVENTARIO</h1>
          <p className="sd-page-subtitle">Insumos, movimientos y recetas</p>
        </div>
      </div>
      <div className="sd-page-container">
        <div role="tablist" aria-label="Secciones de inventario" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`tab-${p.id}`}
              aria-selected={activa === p.id}
              aria-controls={`panel-${p.id}`}
              className={`sd-btn ${activa === p.id ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
              onClick={() => setActiva(p.id)}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${activa}`} aria-labelledby={`tab-${activa}`}>
          <Contenido />
        </div>
      </div>
    </div>
  )
}
