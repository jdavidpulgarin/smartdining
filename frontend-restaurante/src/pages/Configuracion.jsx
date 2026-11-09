import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks'
import { TabMesas } from '../components/configuracion/TabMesas'
import { TabPersonal } from '../components/configuracion/TabPersonal'
import { TabRestaurante } from '../components/configuracion/TabRestaurante'

/**
 * Configuración (P-21), solo admin: que el administrador opere mesas, personal
 * y los datos del local (nombre, horario, moneda, propina…) sin tocar la base.
 *
 * El backend ya exige admin en todas estas rutas; esconder la página a los
 * demás roles es solo para no mostrarles botones que siempre darían 403.
 */
const PESTANAS = [
  { id: 'mesas', etiqueta: 'MESAS' },
  { id: 'personal', etiqueta: 'PERSONAL' },
  { id: 'restaurante', etiqueta: 'RESTAURANTE' },
]


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
          <p className="sd-page-subtitle">Mesas, personal y datos del restaurante</p>
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
