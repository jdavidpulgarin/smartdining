import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, LogOut } from 'lucide-react'
import { useAuth, useTables } from '../hooks'
import { ROLES_CAJA } from '../utils/caja'
import { ROLES_DESPACHO, ROL_REPARTIDOR, esRepartidor, enlaceVisible } from '../utils/domicilios'

const navLinks = [
  { label: 'MESAS', path: '/mesas' },
  { label: 'PEDIDOS', path: '/pedidos' },
  // Solo admin y cajero (el backend da 403 al mesero y a cocina).
  { label: 'CAJA', path: '/caja', roles: ROLES_CAJA },
  // P-24: despacho de domicilios (admin y cajero) y las entregas del repartidor.
  { label: 'DESPACHO', path: '/despacho', roles: ROLES_DESPACHO },
  { label: 'ENTREGAS', path: '/entregas', roles: [ROL_REPARTIDOR] },
  { label: 'MENÚ', path: '/menu' },
  { label: 'REPORTES', path: '/reportes' },
  // P-21: solo para admin (el backend también lo exige).
  { label: 'INVENTARIO', path: '/inventario', soloAdmin: true },
  { label: 'CONFIGURACIÓN', path: '/configuracion', soloAdmin: true },
]

export function Topbar() {
  const { user, logout } = useAuth()
  const { alertas, atenderAlerta, limpiarAlertas } = useTables()
  void atenderAlerta
  void limpiarAlertas
  const location = useLocation()
  const navigate = useNavigate()
  const [_currentTime, setCurrentTime] = useState('')

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const pendientesCount = (alertas || []).filter((a) => !a.atendida).length

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="sd-topbar">
      {/* 1. Logo y Marca a la izquierda */}
      <Link
        to={esRepartidor(user?.rol) ? '/entregas' : '/mesas'}
        className="sd-topbar-brand"
        aria-label={esRepartidor(user?.rol) ? 'Ir a mis entregas' : 'Ir a Mesas SmartDining'}
      >
        <div className="sd-brand-badge" aria-hidden="true">
          <span>SD</span>
        </div>
        <span className="sd-brand-text">SMARTDINING</span>
      </Link>

      {/* 2. Menú de navegación principal en el centro */}
      <nav className="sd-topbar-nav" aria-label="Navegación principal del restaurante">
        {navLinks.filter((item) => enlaceVisible(item, user?.rol)).map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path === '/mesas' && location.pathname === '/')

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`sd-nav-link ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* 3. Campana de alertas y datos de usuario autenticado a la derecha */}
      <div className="sd-topbar-actions">
        <Link
          to="/mesas"
          className="sd-topbar-bell-btn"
          aria-label={pendientesCount > 0 ? `${pendientesCount} alertas activas` : 'Sin alertas activas'}
          title="Ver alertas en mesas"
        >
          <Bell size={20} />
          {pendientesCount > 0 && (
            <span className="sd-topbar-bell-badge">{pendientesCount}</span>
          )}
        </Link>

        {user && (
          <div className="sd-user-info-pill">
            <span className="sd-user-name">{user.name}</span>
            <span className="sd-user-role">{user.roleLabel || user.role}</span>
            <button
              type="button"
              className="sd-topbar-icon-btn"
              onClick={handleLogout}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
