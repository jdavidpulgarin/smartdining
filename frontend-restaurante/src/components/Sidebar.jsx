import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { label: 'Inicio', path: '/' },
  { label: 'Mesas', path: '/mesas' },
  { label: 'Pedidos', path: '/pedidos' },
  { label: 'Menú', path: '/menu' },
  { label: 'Caja', path: '/caja' },
  { label: 'Reportes', path: '/reportes' },
]

export function Sidebar() {
  const location = useLocation()

  return (
    <aside className="sidebar">
      <nav className="nav-menu">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-card">
        <span className="card-label">Turno actual</span>
        <strong>12:00 - 15:00</strong>
        <p>6 empleados activos</p>
      </div>
    </aside>
  )
}
