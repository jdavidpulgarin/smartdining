import { useNavigate } from 'react-router-dom'
import { LogOut, UserCheck } from 'lucide-react'
import { GhostButton, PrimaryButton } from './ui/Button'
import { useAuth } from '../hooks'

export function Topbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">S</div>
        <div>
          <p className="brand-name">SmartDining</p>
          <span>Panel de Restaurante</span>
        </div>
      </div>

      <div className="topbar-actions">
        <GhostButton>Hoy</GhostButton>
        <PrimaryButton onClick={() => navigate('/pedidos')}>+ Nuevo pedido</PrimaryButton>

        {user ? (
          <div className="user-profile-widget">
            <div className="avatar" title={user.name}>
              {user.avatar || 'U'}
            </div>
            <div className="user-meta-info">
              <strong className="user-name">{user.name}</strong>
              <span className={`user-role-badge role-${user.role}`}>
                {user.roleLabel || user.role}
              </span>
            </div>
            <button
              type="button"
              className="topbar-logout-btn"
              onClick={handleLogout}
              title="Cerrar sesión / Cambiar de usuario"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="primary-button small"
            onClick={() => navigate('/login')}
          >
            <UserCheck size={16} />
            <span>Ingresar</span>
          </button>
        )}
      </div>
    </header>
  )
}
