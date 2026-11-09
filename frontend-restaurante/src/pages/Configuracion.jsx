import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks'
import { TabMesas } from '../components/configuracion/TabMesas'
import { TabPersonal } from '../components/configuracion/TabPersonal'

/**
 * Configuración (P-21), solo admin: que el administrador opere mesas y personal
 * sin tocar la base. La pestaña Restaurante (datos del local) es P2: por ahora
 * solo avisa que el formulario llega en un PR aparte. No muestra datos de
 * ejemplo ni un formulario que no guarde.
 *
 * El backend ya exige admin en todas estas rutas; esconder la página a los
 * demás roles es solo para no mostrarles botones que siempre darían 403.
 */
const PESTANAS = [
  { id: 'mesas', etiqueta: 'MESAS' },
  { id: 'personal', etiqueta: 'PERSONAL' },
  { id: 'restaurante', etiqueta: 'RESTAURANTE' },
]

function TabRestaurante() {
  return (
    <div className="sd-card" role="status" style={{ padding: 24 }}>
      <h3 className="sd-card-title" style={{ marginTop: 0 }}>Datos del restaurante: pendiente</h3>
      <p style={{ color: 'var(--sd-text-muted)', margin: 0 }}>
        El formulario de nombre, logo, horario, moneda y propina sugerida todavía no está en el
        panel (P2). La API ya existe (D-16 parte B: <code>GET /api/configuracion/completa</code> y{' '}
        <code>PUT /api/configuracion</code>); el formulario llega en un PR aparte.
      </p>
    </div>
  )
}

const CONTENIDO = { mesas: TabMesas, personal: TabPersonal, restaurante: TabRestaurante }

export function Configuracion() {
  const { user } = useAuth()
  const [activa, setActiva] = useState('mesas')

  if (user?.rol !== 'admin') return <Navigate to="/" replace />

  const Contenido = CONTENIDO[activa]

  return (
    <div className="sd-page-wrapper">
      <div className="sd-page-header">
        <div>
          <h1 className="sd-page-title">CONFIGURACIÓN</h1>
          <p className="sd-page-subtitle">Mesas y personal del restaurante</p>
        </div>
      </div>

      <div className="sd-page-container">
        <div role="tablist" aria-label="Secciones de configuración" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
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
