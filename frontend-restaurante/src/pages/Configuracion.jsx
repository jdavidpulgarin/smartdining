import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks'
import { TabMesas } from '../components/configuracion/TabMesas'
import { TabPersonal } from '../components/configuracion/TabPersonal'
import { TabRestaurante } from '../components/configuracion/TabRestaurante'
import '../styles/configuracion.css'

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
    <div className="configuracion-pagina tema-comanda">
      <div className="conf-cont">
        <div className="conf-cab">
          <h1 className="conf-titulo">CONFIGURACIÓN</h1>
          <span className="conf-sub">Mesas, personal y datos del restaurante</span>
        </div>

        <div role="tablist" aria-label="Secciones de configuración" className="conf-tabs">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`tab-${p.id}`}
              aria-selected={activa === p.id}
              aria-controls={`panel-${p.id}`}
              className="conf-tab"
              onClick={() => setActiva(p.id)}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="conf-panel" id={`panel-${activa}`} aria-labelledby={`tab-${activa}`}>
          <Contenido />
        </div>
      </div>
    </div>
  )
}
