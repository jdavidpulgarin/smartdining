import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Mail, Lock, LogIn, ArrowRight } from 'lucide-react'
import { useAuth } from '../hooks'
import { DEMO_USERS } from '../constants/demoUsers'

export function Login() {
  const { login, loginAsDemo } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email) {
      setError('Por favor ingresa tu correo corporativo')
      return
    }
    login(email, password)
    navigate('/')
  }

  const handleQuickDemo = (role) => {
    loginAsDemo(role)
    navigate('/')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Header */}
        <div className="login-header">
          <div className="brand-mark large">S</div>
          <div>
            <h2>SmartDining POS</h2>
            <p>Portal de Acceso para Personal de Sala y Gerencia</p>
          </div>
        </div>

        {error && <div className="login-error-banner">{error}</div>}

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Correo Electrónico:</label>
            <div className="input-with-icon">
              <Mail size={16} />
              <input
                type="email"
                placeholder="admin@smartdining.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError('')
                }}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Contraseña:</label>
            <div className="input-with-icon">
              <Lock size={16} />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="primary-button login-submit-btn">
            <LogIn size={18} />
            <span>Ingresar al Sistema</span>
          </button>
        </form>

        {/* Acceso Rápido Demo (Exposoftware / Evaluación) */}
        <div className="quick-access-section">
          <div className="quick-access-divider">
            <span>o ingresar con perfil demo</span>
          </div>

          <div className="demo-roles-grid">
            {DEMO_USERS.map((demo) => (
              <button
                key={demo.role}
                type="button"
                className="demo-role-btn"
                onClick={() => handleQuickDemo(demo.role)}
              >
                <div className="demo-role-avatar">{demo.avatar}</div>
                <div className="demo-role-info">
                  <strong>{demo.name}</strong>
                  <span>{demo.roleLabel}</span>
                </div>
                <ArrowRight size={14} className="demo-arrow" />
              </button>
            ))}
          </div>
        </div>

        <div className="login-footer">
          <ShieldCheck size={14} />
          <span>Acceso protegido con Control de Roles (RBAC) y PostgreSQL</span>
        </div>
      </div>
    </div>
  )
}
