import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks'
import { TabInsumos } from '../components/inventario/TabInsumos'

/**
 * Inventario (P-22), solo admin: lo que hay en bodega y cómo entra y sale.
 * Contrato: backend/docs/api-spec.md, "Inventario: insumos, movimientos y
 * recetas" (D-17 PR 2), donde todas las rutas son solo admin; esconder la página
 * a los demás roles es solo para no mostrarles algo que siempre daría 403.
 *
 * Por ahora solo la pestaña de insumos. Las recetas llegan cuando el backend
 * exponga la carta con su estado de stock y si tiene receta (GET
 * /inventario/carta).
 */
export function Inventario() {
  const { user } = useAuth()
  if (user?.rol !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="sd-page-wrapper">
      <div className="sd-page-header">
        <div>
          <h1 className="sd-page-title">INVENTARIO</h1>
          <p className="sd-page-subtitle">Insumos, entradas, mermas y ajustes</p>
        </div>
      </div>
      <div className="sd-page-container">
        <TabInsumos />
      </div>
    </div>
  )
}
