import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Mail, Lock, LogIn } from 'lucide-react'
import { useAuth } from '../hooks'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email) {
      setError('Por favor ingresa tu correo corporativo')
      return
    }
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
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
                required
              />
            </div>
          </div>

          <button type="submit" className="primary-button login-submit-btn" disabled={loading}>
            <LogIn size={18} />
            <span>{loading ? 'Verificando credenciales...' : 'Ingresar al Sistema'}</span>
          </button>
        </form>

        <div className="login-footer">
          <ShieldCheck size={14} />
          <span>Acceso autenticado con PostgreSQL y JWT</span>
        </div>
      </div>
    </div>
  )
}
