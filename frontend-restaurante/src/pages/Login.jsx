import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, ShieldAlert, Mail, Lock, LogIn, Clock } from 'lucide-react'
import { useAuth } from '../hooks'
import {
  getStoredAuthMessage,
  getStoredRateLimit,
  clearStoredRateLimit,
  EVENT_RATE_LIMITED,
  EVENT_UNAUTHORIZED,
  MENSAJE_DEMASIADOS_INTENTOS,
} from '../services/api'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Mensaje de sesión expirada o cuenta desactivada (401)
  const [authNotice, setAuthNotice] = useState(() => getStoredAuthMessage())

  // Estado de tasa de intentos excedida (429 con Retry-After)
  const [countdown, setCountdown] = useState(() => {
    const rl = getStoredRateLimit()
    return rl ? rl.remainingSeconds : 0
  })
  const [rateLimitMessage, setRateLimitMessage] = useState(() => {
    const rl = getStoredRateLimit()
    return rl ? rl.message : ''
  })

  // Temporizador de cuenta regresiva para el rate limit
  useEffect(() => {
    if (countdown <= 0) {
      clearStoredRateLimit()
      return
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearStoredRateLimit()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [countdown])

  // Escuchar eventos globales de rate limit y unauthorized
  useEffect(() => {
    const handleRateLimit = (e) => {
      const segs = e.detail?.segundos || 60
      const msg = e.detail?.mensaje || MENSAJE_DEMASIADOS_INTENTOS
      setCountdown(segs)
      setRateLimitMessage(msg)
      setError('')
    }

    const handleUnauthorized = (e) => {
      if (e.detail?.mensaje) {
        setAuthNotice(e.detail.mensaje)
      }
    }

    window.addEventListener(EVENT_RATE_LIMITED, handleRateLimit)
    window.addEventListener(EVENT_UNAUTHORIZED, handleUnauthorized)
    return () => {
      window.removeEventListener(EVENT_RATE_LIMITED, handleRateLimit)
      window.removeEventListener(EVENT_UNAUTHORIZED, handleUnauthorized)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (countdown > 0) return

    if (!email) {
      setError('Por favor ingresa tu correo corporativo')
      return
    }
    setError('')
    setAuthNotice(null)
    setLoading(true)

    try {
      await login(email, password)
      clearStoredRateLimit()
      navigate('/')
    } catch (err) {
      if (err.status === 429 || err.retryAfter) {
        const segs = err.retryAfter || 60
        setCountdown(segs)
        setRateLimitMessage(err.message || MENSAJE_DEMASIADOS_INTENTOS)
      } else {
        setError(err.message || 'Error al iniciar sesión')
      }
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

        {/* Mensaje de sesión inválida / cuenta desactivada (401) */}
        {authNotice && (
          <div className="login-warning-banner" role="alert">
            <ShieldAlert size={16} />
            <span>{authNotice}</span>
          </div>
        )}

        {/* Mensaje de rate limit con cuenta regresiva (429) */}
        {countdown > 0 && (
          <div className="login-rate-limit-banner" role="alert">
            <Clock size={16} />
            <span>
              {rateLimitMessage || MENSAJE_DEMASIADOS_INTENTOS} ({countdown}s)
            </span>
          </div>
        )}

        {/* Error regular de validación o credenciales */}
        {error && countdown === 0 && (
          <div className="login-error-banner" role="alert">
            {error}
          </div>
        )}

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
                disabled={loading || countdown > 0}
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
                disabled={loading || countdown > 0}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="primary-button login-submit-btn"
            disabled={loading || countdown > 0}
          >
            {loading ? (
              <span>Verificando credenciales...</span>
            ) : countdown > 0 ? (
              <>
                <Clock size={18} />
                <span>Espera {countdown}s para reintentar</span>
              </>
            ) : (
              <>
                <LogIn size={18} />
                <span>Ingresar al Sistema</span>
              </>
            )}
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
