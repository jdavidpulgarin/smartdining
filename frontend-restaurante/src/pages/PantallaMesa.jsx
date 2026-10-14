import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { io } from 'socket.io-client'
import {
  Wifi,
  Sparkles,
  RefreshCw,
  Maximize2,
  Minimize2,
  ExternalLink,
  ShieldCheck,
  Smartphone,
  ChevronLeft,
  Sliders,
  UtensilsCrossed,
  Info,
  RotateCw,
} from 'lucide-react'
import { useTables } from '../hooks'
import {
  solicitarTokenPantalla,
  notificarQrRotado,
  rotarTokenQrMesa,
  decodificarTokenQr,
} from '../services/qrService'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'
const ROTACION_INTERVALO = 180 // 3 minutos

export function PantallaMesa() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tables, pedidosActivos } = useTables()

  const numMesa = Number(id) || 1
  const tableData = tables?.find((t) => t.id === numMesa || t.number === numMesa)

  // Token QR activo mostrado en pantalla (inicia con el de la mesa o un fallback)
  const [tokenQr, setTokenQr] = useState(() => tableData?.token_qr || `qr-mesa-${numMesa}-demo`)
  const [justRotated, setJustRotated] = useState(false)

  // Temporizador de 3 minutos de rotación de seguridad
  const [segundosRestantes, setSegundosRestantes] = useState(ROTACION_INTERVALO)
  const [autoRotacionHabilitada, setAutoRotacionHabilitada] = useState(true)

  // Estado del socket exclusivo de la tablet (rol: 'pantalla')
  const [socketStatus, setSocketStatus] = useState('conectando') // 'conectado' | 'reconectando' | 'desconectado'
  const [socketId, setSocketId] = useState('')
  const [pantallaToken, setPantallaToken] = useState('')

  // Pantalla completa y configuración
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  // Configuración de red para comensales con celular
  const defaultHost =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
      ? window.location.hostname
      : '192.168.1.22'

  const [useWifiIp, setUseWifiIp] = useState(true)
  const [hostIp, setHostIp] = useState(defaultHost)
  const [clientPort, setClientPort] = useState('5173')
  const [loadingAction, setLoadingAction] = useState(false)
  // Error visible en la tablet (rotación o credencial de pantalla fallidas)
  const [errorPantalla, setErrorPantalla] = useState('')

  const activeHost = useWifiIp ? hostIp : 'localhost'
  const diningUrl = tokenQr
    ? `http://${activeHost}:${clientPort}/?token=${tokenQr}&mesa=${numMesa}`
    : `http://${activeHost}:${clientPort}/?mesa=${numMesa}`

  const infoToken = decodificarTokenQr(tokenQr)
  const sid = infoToken?.sid || (tokenQr ? tokenQr.slice(-8) : 'activo')

  // Detectar si la mesa tiene pedidos activos o comensales
  const pedidosMesa = (pedidosActivos || []).filter(
    (p) => (Number(p.id_mesa) === numMesa || Number(p.mesa) === numMesa) && p.estado !== 'cancelado'
  )
  const tieneComensales = pedidosMesa.length > 0 || Boolean(tableData?.comensales?.length > 0)

  // Hora actual para el reloj de la pantalla
  const [currentTime, setCurrentTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Rotar el QR de la mesa usando el endpoint o fallback con notificación al socket
  const handleRotarQr = useCallback(async () => {
    if (loadingAction) return
    setLoadingAction(true)
    try {
      const res = await rotarTokenQrMesa(numMesa)
      if (res?.token) {
        setTokenQr(res.token)
      }
      setSegundosRestantes(ROTACION_INTERVALO)
      setJustRotated(true)
      setTimeout(() => setJustRotated(false), 2500)
    } catch (err) {
      console.warn('Error al rotar QR:', err.message)
    } finally {
      setLoadingAction(false)
    }
  }, [loadingAction, numMesa])

  // Temporizador de rotación automática cada 3 minutos (solo si no hay comensales)
  useEffect(() => {
    if (!tokenQr || tieneComensales || !autoRotacionHabilitada) {
      return
    }

    const timer = setInterval(() => {
      setSegundosRestantes((prev) => {
        if (prev <= 1) {
          handleRotarQr()
          return ROTACION_INTERVALO
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [tokenQr, tieneComensales, autoRotacionHabilitada, handleRotarQr])

  // Inicializar conexión Socket.io con rol 'pantalla' para esta mesa
  useEffect(() => {
    let socket = null
    let isCancelled = false

    async function initSocketPantalla() {
      // 1. Obtener credencial JWT para esta tablet de mesa (POST /qr/pantalla)
      let cred
      try {
        cred = await solicitarTokenPantalla(numMesa)
      } catch (err) {
        if (isCancelled) return
        setSocketStatus('desconectado')
        setErrorPantalla(err.message)
        return
      }
      if (isCancelled) return
      setErrorPantalla('')
      setPantallaToken(cred.token)

      // 2. Conectar al socket server con el token emitido
      socket = io(SOCKET_URL, {
        auth: { token: cred.token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 20,
      })

      socket.on('connect', () => {
        if (isCancelled) return
        setSocketStatus('conectado')
        setSocketId(socket.id)
      })

      socket.on('disconnect', () => {
        if (isCancelled) return
        setSocketStatus('desconectado')
      })

      socket.on('connect_error', (err) => {
        if (isCancelled) return
        setSocketStatus('reconectando')
        console.warn(`[Tablet Mesa ${numMesa}] Error de socket:`, err.message)
      })

      // 3. Escuchar evento de Roberto: 'qr:actualizado'
      socket.on('qr:actualizado', (data) => {
        if (isCancelled) return
        if (data?.token_qr) {
          setTokenQr(data.token_qr)
          setSegundosRestantes(ROTACION_INTERVALO)
          setJustRotated(true)
          setTimeout(() => setJustRotated(false), 3000)
        }
      })

      // También escuchar mesa liberada
      socket.on('mesa:liberada', () => {
        if (isCancelled) return
        setJustRotated(true)
        setTimeout(() => setJustRotated(false), 2000)
      })
    }

    initSocketPantalla()

    return () => {
      isCancelled = true
      if (socket) {
        socket.disconnect()
      }
    }
  }, [numMesa])

  // Manejo de pantalla completa
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  // Rotación manual: la hace el backend (POST /api/mesas/:id/rotar-qr) con el
  // JWT del personal; la tablet también recibirá qr:actualizado por el socket.
  const handleSimularRotacion = async () => {
    setLoadingAction(true)
    setErrorPantalla('')
    try {
      const { token } = await notificarQrRotado(numMesa)
      if (token) {
        setTokenQr(token)
        setSegundosRestantes(ROTACION_INTERVALO)
        setJustRotated(true)
        setTimeout(() => setJustRotated(false), 2000)
      }
    } catch (err) {
      setErrorPantalla(`No se pudo rotar el QR: ${err.message}`)
    } finally {
      setLoadingAction(false)
    }
  }

  // Formato mm:ss
  const minutos = Math.floor(segundosRestantes / 60)
  const segundos = segundosRestantes % 60
  const tiempoFormateado = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
  const porcentajeTiempo = ((ROTACION_INTERVALO - segundosRestantes) / ROTACION_INTERVALO) * 100

  return (
    <div className="sd-pantalla-page">
      {/* Fondo con foto del plato y viñeta oscura */}
      <img
        src="/img/fondo.jpg"
        alt=""
        aria-hidden="true"
        className="sd-bg-photo"
        style={{ opacity: 0.35, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', zIndex: 0 }}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />

      {/* Barra superior de la tablet */}
      <header className="sd-pantalla-topbar">
        <button
          type="button"
          className="sd-pantalla-btn-icon"
          onClick={() => navigate('/mesas')}
          title="Volver al panel"
        >
          <ChevronLeft size={20} />
          <span>SALIR</span>
        </button>

        <div className="sd-pantalla-brand">
          <div className="sd-brand-badge" aria-hidden="true">
            <span>SD</span>
          </div>
          <span className="sd-brand-text">SMARTDINING</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Socket status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontFamily: 'var(--sd-font-heading)',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 4,
              background: socketStatus === 'conectado' ? 'rgba(255,255,255,0.1)' : 'rgba(238,28,37,0.2)',
              color: socketStatus === 'conectado' ? 'var(--sd-white)' : 'var(--sd-red-text)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: socketStatus === 'conectado' ? 'var(--sd-white)' : 'var(--sd-red)',
              }}
            />
            <span>{socketStatus === 'conectado' ? 'EN VIVO' : 'SIN CONEXIÓN'}</span>
          </div>

          <span className="sd-pantalla-clock">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>

          <button
            type="button"
            className="sd-pantalla-btn-icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          <button
            type="button"
            className="sd-pantalla-btn-icon"
            onClick={() => setShowConfig(!showConfig)}
            title="Ajustes técnicos"
          >
            <Sliders size={18} />
          </button>
        </div>
      </header>

      {/* Banner de Rotación o Error */}
      {justRotated && (
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            background: 'var(--sd-red)',
            color: '#fff',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'var(--sd-font-heading)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Sparkles size={16} />
          <span>¡Código QR renovado automáticamente para tu mesa!</span>
        </div>
      )}

      {errorPantalla && (
        <div
          role="alert"
          style={{
            position: 'relative',
            zIndex: 10,
            background: 'rgba(238,28,37,0.9)',
            color: '#fff',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'var(--sd-font-heading)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Info size={16} />
          <span>{errorPantalla}</span>
        </div>
      )}

      {/* Contenido Central: Número de mesa en rojo gigante y QR sobre blanco */}
      <main className="sd-pantalla-center-container">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 20,
              background: 'rgba(238,28,37,0.15)',
              color: 'var(--sd-red-text)',
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            <Sparkles size={14} />
            <span>BIENVENIDO A TU MESA</span>
          </div>

          <span className="sd-pantalla-pre-title">SMARTDINING EXPERIENCIA DIGITAL</span>

          <h1 className="sd-page-title sd-pantalla-giant-number">
            MESA {numMesa}
          </h1>

          {tableData?.location && (
            <p style={{ color: 'var(--sd-text-muted)', fontSize: 14, margin: '4px 0 0 0' }}>
              Sector: {tableData.location}
            </p>
          )}

          <p className="sd-pantalla-subtitle">
            Escanea el código QR con la cámara de tu teléfono para ver la carta, ordenar y compartir comanda
          </p>
        </div>

        {/* QR sobre blanco en el centro */}
        <div className="sd-pantalla-qr-card">
          <div className="sd-pantalla-qr-white-frame">
            <QRCodeSVG
              value={diningUrl}
              size={260}
              level="M"
              includeMargin={false}
              fgColor="#0a0f1d"
              bgColor="#ffffff"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
            <div className="sd-pantalla-sid-meta">
              <span>Sesión activa · sid: {sid}</span>
            </div>

            <div
              style={{
                width: '100%',
                height: 4,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 2,
                overflow: 'hidden',
                marginTop: 4,
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: 'var(--sd-red)',
                  width: `${porcentajeTiempo}%`,
                  transition: 'width 1s linear',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="sd-pantalla-btn-rotate"
                onClick={handleRotarQr}
                disabled={loadingAction}
                title="Rotar código QR"
              >
                <RotateCw size={16} className={loadingAction ? 'spin' : ''} />
                <span>ROTAR QR ({tiempoFormateado})</span>
              </button>
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                style={{ padding: '8px 12px', fontSize: 13 }}
                onClick={() => setAutoRotacionHabilitada((prev) => !prev)}
                title={autoRotacionHabilitada ? 'Pausar rotación automática' : 'Reanudar rotación automática'}
              >
                <span>{autoRotacionHabilitada ? '⏸️ PAUSA' : '▶️ AUTO'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Instrucciones y Beneficios de comensal */}
        <div className="sd-pantalla-features-row" style={{ marginTop: 20 }}>
          <div className="sd-card sd-pantalla-feature-card">
            <Smartphone size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">SIN INSTALAR APPS</strong>
            <p className="sd-feature-desc">Funciona directo desde la cámara o navegador de tu celular.</p>
          </div>
          <div className="sd-card sd-pantalla-feature-card">
            <UtensilsCrossed size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">COMANDA COMPARTIDA</strong>
            <p className="sd-feature-desc">Todos los comensales pueden sumar platillos a la misma cuenta.</p>
          </div>
          <div className="sd-card sd-pantalla-feature-card">
            <ShieldCheck size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">SEGURIDAD GARANTIZADA</strong>
            <p className="sd-feature-desc">
              {tieneComensales
                ? 'Sesión en curso: los pedidos y comensales conservan su cuenta activa.'
                : 'Rotación periódica automática cada 3 min mientras no haya comensales.'}
            </p>
          </div>
          <div className="sd-card sd-pantalla-feature-card">
            <Wifi size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">RED WI-FI INVITADOS</strong>
            <p className="sd-feature-desc">
              Red: <strong>SmartDining_Invitados</strong> · Clave: <span style={{ fontFamily: 'monospace' }}>Gourmet2026</span>
            </p>
          </div>
        </div>
      </main>

      {/* Pie de pantalla de la tablet */}
      <footer
        style={{
          position: 'relative',
          zIndex: 5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          borderTop: '1px solid var(--sd-border)',
          background: 'rgba(18, 14, 13, 0.95)',
          fontSize: 13,
          color: 'var(--sd-text-muted)',
          fontFamily: 'var(--sd-font-body)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={15} style={{ color: 'var(--sd-text)' }} />
          <span>Si necesitas asistencia de nuestro equipo, avisa a cualquier mesero en salón.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>SmartDining Kiosk v2.4</span>
          <span>·</span>
          <span>{socketId ? `Socket: ${socketId.substring(0, 8)}...` : 'Conectando'}</span>
        </div>
      </footer>

      {/* Cajón de Configuración para el Personal */}
      {showConfig && (
        <div
          className="sd-modal-backdrop"
          onClick={() => setShowConfig(false)}
        >
          <div
            className="sd-card sd-table-detail-modal"
            style={{ maxWidth: 540 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="sd-modal-header">
              <h3 className="sd-card-title" style={{ margin: 0, fontSize: 22 }}>
                ⚙️ Ajustes de Pantalla de Mesa #{numMesa}
              </h3>
              <button
                type="button"
                className="sd-topbar-icon-btn"
                onClick={() => setShowConfig(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
              <div>
                <label className="sd-input-label">DESTINO DE CONEXIÓN (PARA CELULARES):</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className={`sd-btn ${useWifiIp ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
                    onClick={() => setUseWifiIp(true)}
                    style={{ fontSize: 13, flex: 1 }}
                  >
                    <Wifi size={14} />
                    <span>IP WI-FI ({hostIp})</span>
                  </button>
                  <button
                    type="button"
                    className={`sd-btn ${!useWifiIp ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
                    onClick={() => setUseWifiIp(false)}
                    style={{ fontSize: 13, flex: 1 }}
                  >
                    <span>LOCALHOST</span>
                  </button>
                </div>
              </div>

              {useWifiIp && (
                <div>
                  <label className="sd-input-label">IP EN LA RED LOCAL WI-FI:</label>
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value.trim())}
                    placeholder="192.168.1.XX"
                    className="sd-input"
                  />
                </div>
              )}

              <div>
                <label className="sd-input-label">PUERTO DEL CLIENTE (PWA):</label>
                <input
                  type="text"
                  value={clientPort}
                  onChange={(e) => setClientPort(e.target.value.trim())}
                  placeholder="5173"
                  className="sd-input"
                />
              </div>

              <div>
                <label className="sd-input-label">CREDENCIAL JWT PANTALLA:</label>
                <input
                  type="text"
                  readOnly
                  value={pantallaToken ? `${pantallaToken.slice(0, 32)}...` : 'Autenticando tablet...'}
                  className="sd-input"
                  style={{ opacity: 0.7 }}
                />
              </div>

              <div>
                <label className="sd-input-label">ENLACE CODIFICADO:</label>
                <input type="text" readOnly value={diningUrl} className="sd-input" style={{ opacity: 0.7 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <a
                  href={diningUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sd-btn sd-btn-primary"
                  style={{ textDecoration: 'none', justifyContent: 'center' }}
                >
                  <ExternalLink size={15} />
                  <span>PROBAR ENLACE EN NUEVA PESTAÑA</span>
                </a>

                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={handleRotarQr}
                  disabled={loadingAction}
                  style={{ justifyContent: 'center' }}
                >
                  <RotateCw size={15} className={loadingAction ? 'spin' : ''} />
                  <span>Rotar QR oficial (POST /api/mesas/:id/rotar-qr)</span>
                </button>

                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={handleSimularRotacion}
                  disabled={loadingAction}
                  style={{ justifyContent: 'center' }}
                >
                  <RefreshCw size={15} className={loadingAction ? 'spin' : ''} />
                  <span>Simular evento qr:actualizado en vivo</span>
                </button>

                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={() => navigate('/mesas')}
                  style={{ justifyContent: 'center' }}
                >
                  <ChevronLeft size={15} />
                  <span>REGRESAR AL PANEL DE MESEROS</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
