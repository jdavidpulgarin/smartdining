import { useEffect, useState } from 'react'
import { ChefHat } from 'lucide-react'
import { urlDelKds } from '../utils/kds'

/** Segundos antes de llevar al KDS solo. */
export const SEGUNDOS_PARA_IR_AL_KDS = 5

const irConElNavegador = (url) => window.location.assign(url)

/**
 * El aviso para un usuario de COCINA que inicia sesión en el panel. No hay
 * sesión que cerrar: AuthContext.login() no guarda nada ni conecta el socket
 * con el rol cocina. Solo explica y lleva a la pantalla de cocina (KDS), que
 * tiene su propio inicio de sesión.
 */
export function SoloCocina({ irA = irConElNavegador }) {
  const url = urlDelKds()
  const [faltan, setFaltan] = useState(SEGUNDOS_PARA_IR_AL_KDS)

  useEffect(() => {
    if (faltan <= 0) {
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
        <a href={url} className="sd-btn sd-btn-primary" style={{ minHeight: 44, fontSize: 15 }}>
          IR A LA PANTALLA DE COCINA
        </a>
      </div>
    </div>
  )
}
