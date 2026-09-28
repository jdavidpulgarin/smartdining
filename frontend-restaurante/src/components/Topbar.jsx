import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, UserCheck, Plus, Radio, Clock } from 'lucide-react'
import { useAuth } from '../hooks'

export function Topbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [currentTime, setCurrentTime] = useState('')
  const [currentDate, setCurrentDate] = useState('')

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      )
      setCurrentDate(
        now.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
      )
    }

    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark-glow">
          <span className="brand-icon">🍽️</span>
        </div>
        <div>
          <div className="brand-title-wrap">
            <h1 className="brand-name">SmartDining</h1>
            <span className="brand-badge-pro">PRO SALA</span>
          </div>
          <span className="brand-sub">Control de Sala & Terminal POS</span>
        </div>
      </div>

      <div className="topbar-center-info">
        <div className="live-clock-widget">
          <Clock size={14} className="text-emerald clock-pulse" />
          <span className="live-time">{currentTime || '12:00:00'}</span>
          <span className="live-date">{currentDate}</span>
        </div>

        <div className="socket-status-pill" title="Conectado al servidor en tiempo real (puerto 4001)">
          <Radio size={12} className="socket-beacon" />
          <span>Socket en vivo</span>
        </div>
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-btn-primary"
          onClick={() => navigate('/pedidos')}
          title="Tomar nueva orden en mesa"
        >
          <Plus size={16} />
          <span>Nuevo Pedido</span>
        </button>

        {user ? (
          <div className="user-profile-widget">
            <div className={`avatar role-avatar-${user.role}`} title={user.name}>
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
              title="Cerrar sesión / Cambiar de rol"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="topbar-btn-login"
            onClick={() => navigate('/login')}
          >
            <UserCheck size={16} />
            <span>Ingresar Staff</span>
          </button>
        )}
      </div>
    </header>
  )
}
