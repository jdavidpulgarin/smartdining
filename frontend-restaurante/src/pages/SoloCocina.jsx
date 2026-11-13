import { useEffect, useState } from 'react'
import { ChefHat } from 'lucide-react'
import { useAuth } from '../hooks'
import { urlDelKds } from '../utils/kds'

/** Segundos antes de llevar al KDS solo. */
export const SEGUNDOS_PARA_IR_AL_KDS = 5

/**
 * Lo que ve un usuario de COCINA en el panel: un aviso y el paso a la pantalla
 * de cocina. No ve el panel (el backend le negaría casi todo con 403). La
 * sesión del panel se cierra al salir: el KDS tiene su propio inicio de sesión.
 */
const irConElNavegador = (url) => window.location.assign(url)

export function SoloCocina({ irA = irConElNavegador }) {
  const { logout } = useAuth()
  const url = urlDelKds()
  const [faltan, setFaltan] = useState(SEGUNDOS_PARA_IR_AL_KDS)

  useEffect(() => {
    if (faltan <= 0) {
      cerrarSesionGuardada()
      irA(url)
      return undefined
    }
    const t = setTimeout(() => setFaltan((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [faltan, irA, url])

  return (
    <div className="sd-page-container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="sd-card sd-empty-box" role="alert" style={{ maxWidth: 520, textAlign: 'center', gap: 14 }}>
        <ChefHat size={48} style={{ color: 'var(--sd-red)' }} />
        <h1 className="sd-card-title" style={{ margin: 0, fontSize: 28 }}>ESTE PANEL ES DE SALA Y CAJA</h1>
        <p style={{ margin: 0 }}>
          Tu usuario es de <strong>cocina</strong>: las comandas se trabajan en la pantalla de cocina (KDS).
        </p>
        <small style={{ color: 'var(--sd-text-muted)' }}>
          Te llevamos allá en {Math.max(faltan, 0)} s. Ahí inicias sesión con el mismo usuario.
        </small>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <a
            href={url}
            className="sd-btn sd-btn-primary"
            style={{ minHeight: 44, fontSize: 15 }}
            onClick={cerrarSesionGuardada}
          >
            IR A LA PANTALLA DE COCINA
          </a>
          <button type="button" className="sd-btn sd-btn-secondary" style={{ minHeight: 44, fontSize: 15 }} onClick={logout}>
            CERRAR SESIÓN
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Borra la sesión del panel sin re-renderizar (la página se va al KDS). Con
 * logout() el panel saltaría a /login antes de salir.
 */
function cerrarSesionGuardada() {
  try {
    sessionStorage.removeItem('smartdining_staff_user')
    sessionStorage.removeItem('smartdining_token')
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}
