import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { SoloCocina } from './SoloCocina'
import { ShieldAlert, Mail, Lock, Clock } from 'lucide-react'
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
  const location = useLocation()
  // Rol cocina: aviso y paso al KDS, sin sesión en el panel. Llega por el login
  // ({ cocina: true }) o desde AppContent, si había una sesión de cocina vieja.
  const [avisoCocina, setAvisoCocina] = useState(() => Boolean(location.state?.cocina))
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
      const resultado = await login(email, password)
      clearStoredRateLimit()
      if (resultado?.cocina) {
        setAvisoCocina(true)
        return
      }
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

  if (avisoCocina) return <SoloCocina />

  return (
    <div className="ingreso-pagina tema-comanda">
      {/* Franja rayada arriba */}
      <div className="franja" aria-hidden="true"></div>

      <main className="ingreso-principal">
        {/* Lado izquierdo */}
        <section className="ingreso-lado">
          <div className="ingreso-marca">
            <div className="sd" aria-hidden="true">
              <span>SD</span>
            </div>
            <b>SMARTDINING</b>
          </div>

          <h1 className="ingreso-titulo">
            ABRE TU<br />
            <em>TURNO.</em>
          </h1>

          <p className="ingreso-desc">
            Mesas, pedidos, cocina y caja en un solo lugar. Entra con tu cuenta y SmartDining te lleva directo a tu pantalla.
          </p>

          <ul className="ingreso-roles" aria-label="Roles con acceso">
            <li><b>01</b> Administrador</li>
            <li><b>02</b> Caja</li>
            <li><b>03</b> Cocina</li>
            <li><b>04</b> Mesero</li>
          </ul>
        </section>

        {/* Lado derecho: Ticket */}
        <section className="ingreso-ticket" aria-labelledby="ingreso-ticket-titulo">
          <div className="ingreso-ticket-cab">
            <h2 id="ingreso-ticket-titulo" className="ingreso-ticket-h2">
              INICIAR<br />SESIÓN
            </h2>
            <span className="ingreso-ticket-pos">SmartDining POS</span>
          </div>

          <div className="ingreso-ticket-sub">
            Acceso solo para el personal del restaurante.
          </div>

          {/* Mensaje de sesión inválida / cuenta desactivada (401) */}
          {authNotice && (
            <div className="ingreso-alerta ingreso-alerta-aviso" role="alert">
              <ShieldAlert size={18} className="ingreso-alerta-ico" />
              <span>{authNotice}</span>
            </div>
          )}

          {/* Mensaje de rate limit con cuenta regresiva (429) */}
          {countdown > 0 && (
            <div className="ingreso-alerta ingreso-alerta-aviso" role="alert">
              <Clock size={18} className="ingreso-alerta-ico" />
              <span>
                {rateLimitMessage || MENSAJE_DEMASIADOS_INTENTOS} ({countdown}s)
              </span>
            </div>
          )}

          {/* Error regular de validación o credenciales */}
          {error && countdown === 0 && (
            <div className="ingreso-alerta ingreso-alerta-error" role="alert">
              <ShieldAlert size={18} className="ingreso-alerta-ico" />
              <span>{error}</span>
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="ingreso-form" noValidate>
            <div className={`ingreso-campo ${error ? 'ingreso-campo-mal' : ''}`}>
              <label htmlFor="login-email" className="ingreso-lbl">
                Correo
              </label>
              <div className="ingreso-caja">
                <Mail size={18} className="ingreso-ico" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@smartdining.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError('')
                  }}
                  disabled={loading || countdown > 0}
                  required
                  className="ingreso-input"
                />
              </div>
            </div>

            <div className={`ingreso-campo ${error ? 'ingreso-campo-mal' : ''}`}>
              <label htmlFor="login-password" className="ingreso-lbl">
                Contraseña
              </label>
              <div className="ingreso-caja">
                <Lock size={18} className="ingreso-ico" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || countdown > 0}
                  required
                  className="ingreso-input"
                />
              </div>
            </div>

            <button
              type="submit"
              className="ingreso-btn"
              disabled={loading || countdown > 0}
              aria-label="Ingresar al Sistema"
            >
              {loading ? (
                <>
                  <span>ENTRAR</span>
                  <i className="ingreso-giro" aria-hidden="true"></i>
                </>
              ) : countdown > 0 ? (
                <>
                  <Clock size={18} />
                  <span>Espera {countdown}s para reintentar</span>
                </>
              ) : (
                <>
                  <span>ENTRAR</span>
                  <svg
                    className="ingreso-flecha"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="ingreso-ticket-pie">
            <span>Conexión segura</span>
          </div>
        </section>
      </main>

      <footer className="ingreso-footer">
        <span>© SmartDining · Valledupar</span>
      </footer>
    </div>
  )
}
