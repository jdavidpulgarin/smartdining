import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  LayoutGrid,
  UtensilsCrossed,
  BookOpen,
  Receipt,
  BarChart3,
  Clock,
} from 'lucide-react'
import { useTables } from '../hooks'

const navItems = [
  { label: 'Inicio', path: '/', icon: LayoutDashboard },
  { label: 'Mesas', path: '/mesas', icon: LayoutGrid, hasTableBadge: true },
  { label: 'Pedidos', path: '/pedidos', icon: UtensilsCrossed, badgeText: '8 act.' },
  { label: 'Menú & Carta', path: '/menu', icon: BookOpen },
  { label: 'Caja & Cobros', path: '/caja', icon: Receipt },
  { label: 'Métricas', path: '/reportes', icon: BarChart3 },
]

export function Sidebar() {
  const location = useLocation()
  const { tables = [] } = useTables() || {}

  const ocupadasCount = tables.filter((t) => (t.status || '').toLowerCase() === 'ocupada').length

  return (
    <aside className="sidebar">
      <div className="sidebar-section-title">
        <span>NAVEGACIÓN PRINCIPAL</span>
      </div>

      <nav className="nav-menu">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <div className="nav-item-icon-wrap">
                <Icon size={18} className="nav-icon" />
              </div>
              <span className="nav-label">{item.label}</span>

              {item.hasTableBadge && ocupadasCount > 0 && (
                <span className="nav-badge occupied-badge" title={`${ocupadasCount} mesas ocupadas`}>
                  {ocupadasCount}
                </span>
              )}

              {item.badgeText && (
                <span className="nav-badge order-badge">
                  {item.badgeText}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Tarjeta de Turno y Estado del Servicio */}
      <div className="sidebar-footer-card">
        <div className="shift-header">
          <span className="live-status-dot"></span>
          <span className="shift-title">Servicio Activo</span>
        </div>
        <div className="shift-time-row">
          <Clock size={13} className="text-emerald" />
          <strong>12:00 — 16:00</strong>
        </div>
        <p className="shift-team">6 empleados en sala y cocina</p>
        <div className="shift-progress-track">
          <div className="shift-progress-fill" style={{ width: '65%' }}></div>
        </div>
      </div>
    </aside>
  )
}
