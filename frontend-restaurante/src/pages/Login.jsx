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
    <div className="sd-login-page">
      {/* Fondo fotográfico con opacidad y capa oscura */}
      <img
        src="/img/fondo.jpg"
        alt=""
        aria-hidden="true"
        className="sd-bg-photo sd-bg-photo-login"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />

      {/* Encabezado sin Topbar con branding oficial SD */}
      <header className="sd-login-topbar">
        <div className="sd-brand-badge" aria-hidden="true">
          <span>SD</span>
        </div>
        <div className="sd-login-brand-meta">
          <span className="sd-brand-text">SMARTDINING</span>
          <span className="sd-login-badge-sub">PANEL DEL RESTAURANTE</span>
          <span
            style={{
              fontFamily: 'var(--sd-font-heading)',
              fontWeight: 700,
              fontSize: 14,
              color: 'var(--sd-red-text)',
              letterSpacing: '0.08em',
              padding: '2px 8px',
              borderRadius: 4,
              background: 'rgba(238,28,37,0.15)',
            }}
          >
            SmartDining POS
          </span>
        </div>
      </header>

      {/* Franja roja exclusiva de personal */}
      <div className="sd-red-band sd-login-strip">
        <span>SOLO PARA EL PERSONAL · MESEROS, CAJA Y ADMINISTRACIÓN</span>
      </div>

      <main className="sd-login-container">
        {/* Columna Izquierda: Título editorial */}
        <div className="sd-login-hero">
          <h1 className="sd-page-title sd-login-title">
            EMPIEZA<br />
            TU<br />
            TURNO
          </h1>
          <p className="sd-login-desc">
            Mesas, pedidos y pagos de todo el salón en una sola pantalla, actualizados en tiempo real.
          </p>
        </div>

        {/* Columna Derecha: Tarjeta de Login */}
        <div className="sd-card sd-login-card">
          <h2 className="sd-card-title">INICIAR SESIÓN</h2>
          <p style={{ color: 'var(--sd-text-muted)', fontSize: 14, marginTop: -8, marginBottom: 20 }}>
            Portal de Acceso para Personal de Sala y Gerencia
          </p>

          {/* Mensaje de sesión inválida / cuenta desactivada (401) */}
          {authNotice && (
            <div className="sd-login-banner sd-banner-warning" role="alert">
              <ShieldAlert size={16} />
              <span>{authNotice}</span>
            </div>
          )}

          {/* Mensaje de rate limit con cuenta regresiva (429) */}
          {countdown > 0 && (
            <div className="sd-login-banner sd-banner-warning" role="alert">
              <Clock size={16} />
              <span>
                {rateLimitMessage || MENSAJE_DEMASIADOS_INTENTOS} ({countdown}s)
              </span>
            </div>
          )}

          {/* Error regular de validación o credenciales */}
          {error && countdown === 0 && (
            <div className="sd-login-banner sd-banner-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="sd-login-form">
            <div className="sd-input-group">
              <label htmlFor="login-email" className="sd-input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={14} style={{ color: 'var(--sd-red-text)' }} />
                <span>CORREO ELECTRÓNICO</span>
              </label>
              <input
                id="login-email"
                type="email"
                placeholder="admin@smartdining.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError('')
                }}
                disabled={loading || countdown > 0}
                required
                className={`sd-input ${error ? 'error' : ''}`}
              />
            </div>

            <div className="sd-input-group">
              <label htmlFor="login-password" className="sd-input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={14} style={{ color: 'var(--sd-red-text)' }} />
                <span>CONTRASEÑA</span>
              </label>
              <input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || countdown > 0}
                required
                className={`sd-input ${error ? 'error' : ''}`}
              />
            </div>

            <button
              type="submit"
              className="sd-btn sd-btn-primary sd-btn-block"
              disabled={loading || countdown > 0}
              aria-label="Ingresar al Sistema"
              style={{ width: '100%', justifyContent: 'center', padding: '14px 20px', marginTop: 8 }}
            >
              {loading ? (
                <span>VERIFICANDO CREDENCIALES...</span>
              ) : countdown > 0 ? (
                <>
                  <Clock size={18} />
                  <span>Espera {countdown}s para reintentar</span>
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  <span>INGRESAR AL SISTEMA</span>
                </>
              )}
            </button>
          </form>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 24,
              paddingTop: 16,
              borderTop: '1px solid var(--sd-border)',
              color: 'var(--sd-text-muted)',
              fontSize: 13,
              fontFamily: 'var(--sd-font-body)',
            }}
          >
            <ShieldCheck size={14} style={{ color: 'var(--sd-white)' }} />
            <span>Acceso autenticado con PostgreSQL y JWT</span>
          </div>
        </div>
      </main>
    </div>
  )
}
