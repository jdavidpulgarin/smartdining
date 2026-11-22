import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks'
import { TabInsumos } from '../components/inventario/TabInsumos'
import { TabRecetas } from '../components/inventario/TabRecetas'
import '../styles/inventario.css'

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
    <div className="inventario-pagina tema-comanda">
      <div className="inv-cont">
        <div className="inv-cab">
          <h1 className="inv-titulo">INVENTARIO</h1>
          <span className="inv-sub">Insumos, movimientos y recetas</span>
        </div>
        <div role="tablist" aria-label="Secciones de inventario" className="inv-tabs">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`tab-${p.id}`}
              aria-selected={activa === p.id}
              aria-controls={`panel-${p.id}`}
              className="inv-tab"
              onClick={() => setActiva(p.id)}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="inv-panel" id={`panel-${activa}`} aria-labelledby={`tab-${activa}`}>
          <Contenido />
        </div>
      </div>
    </div>
  )
}
