import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { useTables } from '../hooks'
import { solicitarTokenPantalla, notificarQrRotado, decodificarTokenQr } from '../services/qrService'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

export function PantallaMesa() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tables } = useTables()

  const numMesa = Number(id) || 1
  const tableData = tables?.find((t) => t.id === numMesa || t.number === numMesa)

  // Token QR activo mostrado en pantalla (inicia con el de la mesa o un fallback)
  const [tokenQr, setTokenQr] = useState(() => tableData?.token_qr || `qr-mesa-${numMesa}-demo`)
  const [justRotated, setJustRotated] = useState(false)

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

  // Hora actual para el reloj de la pantalla
  const [currentTime, setCurrentTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Inicializar conexión Socket.io con rol 'pantalla' para esta mesa
  useEffect(() => {
    let socket = null
    let isCancelled = false

    async function initSocketPantalla() {
      // 1. Obtener credencial JWT para esta tablet de mesa (POST /qr/pantalla)
      const cred = await solicitarTokenPantalla(numMesa)
      if (isCancelled) return
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
        console.log(`[Tablet Mesa ${numMesa}] Conectado a socket server. Sala: room:mesa-${numMesa}`)
      })

      socket.on('disconnect', (reason) => {
        if (isCancelled) return
        setSocketStatus('desconectado')
        console.log(`[Tablet Mesa ${numMesa}] Desconectado:`, reason)
      })

      socket.on('connect_error', (err) => {
        if (isCancelled) return
        setSocketStatus('reconectando')
        console.warn(`[Tablet Mesa ${numMesa}] Error de socket:`, err.message)
      })

      // 3. Escuchar evento específico de Roberto: 'qr:actualizado'
      socket.on('qr:actualizado', (data) => {
        if (isCancelled) return
        console.log(`[Tablet Mesa ${numMesa}] Evento qr:actualizado recibido:`, data)
        if (data?.token_qr) {
          setTokenQr(data.token_qr)
          setTokenUpdatedAt(Date.now())
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
        setJustRotated(true)
        setTimeout(() => setJustRotated(false), 2000)
      }
    } catch (err) {
      setErrorPantalla(`No se pudo rotar el QR: ${err.message}`)
    } finally {
      setLoadingAction(false)
    }
  }

  return (
    <div className="tablet-screen-root">
      {/* Fondo ambiental decorativo con auras esmeralda */}
      <div className="tablet-ambient-bg">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-grid-overlay" />
      </div>

      {/* Barra superior de la tablet */}
      <header className="tablet-header">
        <div className="tablet-brand-group">
          <div className="tablet-logo-icon">
            <UtensilsCrossed size={24} className="text-emerald" />
          </div>
          <div>
            <h1 className="tablet-brand-name">SmartDining</h1>
            <span className="tablet-brand-subtitle">Experiencia Gastronómica Digital</span>
          </div>
        </div>

        <div className="tablet-header-center">
          <div className="tablet-table-badge">
            <span className="table-badge-label">MESA</span>
            <span className="table-badge-number">{String(numMesa).padStart(2, '0')}</span>
            {tableData?.location && <span className="table-badge-loc">· {tableData.location}</span>}
          </div>
        </div>

        <div className="tablet-header-right">
          {/* Indicador de conexión en vivo */}
          <div className={`tablet-socket-pill ${socketStatus}`}>
            <span className="socket-dot" />
            <span className="socket-text">
              {socketStatus === 'conectado'
                ? 'Pantalla en vivo'
                : socketStatus === 'reconectando'
                  ? 'Reconectando...'
                  : 'Sin conexión'}
            </span>
          </div>

          {/* Reloj en vivo */}
          <div className="tablet-clock">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

          {/* Botón de pantalla completa */}
          <button
            type="button"
            className="tablet-icon-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>

          {/* Botón de configuración/staff */}
          <button
            type="button"
            className={`tablet-icon-btn ${showConfig ? 'active' : ''}`}
            onClick={() => setShowConfig(!showConfig)}
            title="Ajustes técnicos"
          >
            <Sliders size={20} />
          </button>
        </div>
      </header>

      {/* Notificación de rotación / actualización en vivo */}
      {justRotated && (
        <div className="tablet-rotation-banner animate-fade-in">
          <Sparkles size={18} className="text-emerald" />
          <span>¡Código QR renovado automáticamente para tu mesa!</span>
        </div>
      )}

      {errorPantalla && (
        <div className="tablet-rotation-banner animate-fade-in" role="alert">
          <Info size={18} />
          <span>{errorPantalla}</span>
        </div>
      )}

      {/* Contenido principal de la tablet */}
      <main className="tablet-main-stage">
        <div className="tablet-content-card">
          {/* Columna Izquierda: Instrucciones elegantes */}
          <div className="tablet-intro-col">
            <div className="tablet-welcome-tag">
              <Sparkles size={14} />
              <span>Bienvenido a tu mesa</span>
            </div>

            <h2 className="tablet-headline">
              Ordena y disfruta sin esperas
            </h2>
            <p className="tablet-lead">
              Apunta la cámara de tu teléfono al código QR de la derecha. Podrás navegar nuestra carta,
              pedir al ritmo que desees y compartir la comanda con tus acompañantes.
            </p>

            <div className="tablet-features-list">
              <div className="tablet-feature-item">
                <div className="feature-icon-circle">
                  <Smartphone size={18} />
                </div>
                <div>
                  <strong>Sin instalar aplicaciones</strong>
                  <p>Funciona directo desde la cámara o navegador de tu celular.</p>
                </div>
              </div>

              <div className="tablet-feature-item">
                <div className="feature-icon-circle">
                  <UtensilsCrossed size={18} />
                </div>
                <div>
                  <strong>Comanda compartida</strong>
                  <p>Todos los comensales de la mesa pueden sumar platillos a la misma cuenta.</p>
                </div>
              </div>

              <div className="tablet-feature-item">
                <div className="feature-icon-circle">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <strong>Seguridad garantizada</strong>
                  <p>Sesión protegida y rotación automática al finalizar tu consumo.</p>
                </div>
              </div>
            </div>

            {/* Datos de Wi-Fi para comodidad del cliente */}
            <div className="tablet-wifi-card">
              <div className="wifi-card-header">
                <Wifi size={18} className="text-emerald" />
                <span className="wifi-title">Red Wi-Fi del Restaurante</span>
              </div>
              <div className="wifi-credentials">
                <div className="wifi-row">
                  <span className="wifi-label">Red:</span>
                  <span className="wifi-value">SmartDining_Invitados</span>
                </div>
                <div className="wifi-row">
                  <span className="wifi-label">Clave:</span>
                  <span className="wifi-value font-mono">Gourmet2026</span>
                </div>
              </div>
            </div>
          </div>

          {/* Columna Derecha: Tarjeta del Código QR Ultra-Premium */}
          <div className="tablet-qr-col">
            <div className={`tablet-qr-display-box ${justRotated ? 'pulse-update' : ''}`}>
              <div className="qr-box-header">
                <div className="qr-box-pill">
                  <span className="pill-dot" />
                  <span>CÓDIGO DE ACCESO OFICIAL</span>
                </div>
                <span className="qr-mesa-indicator">MESA {numMesa}</span>
              </div>

              {/* El código QR renderizado con SVG vectorial */}
              <div className="tablet-qr-svg-holder">
                <QRCodeSVG
                  value={diningUrl}
                  size={260}
                  level="H"
                  includeMargin={true}
                  fgColor="#0a0f1d"
                  bgColor="#ffffff"
                />
              </div>

              <div className="qr-box-footer">
                <div className="qr-callout-action">
                  <span className="camera-emoji">📸</span>
                  <span>Escanea con tu cámara para ver la carta</span>
                </div>
                <div className="qr-token-hash-pill">
                  <ShieldCheck size={13} />
                  <span>ID Sesión: {sid}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Barra de pie de la tablet */}
      <footer className="tablet-footer">
        <div className="tablet-footer-info">
          <Info size={15} />
          <span>Si necesitas asistencia de nuestro equipo, avisa a cualquier mesero en salón.</span>
        </div>
        <div className="tablet-footer-meta">
          <span>SmartDining Kiosk v2.4</span>
          <span>·</span>
          <span>{socketId ? `Socket: ${socketId.substring(0, 8)}...` : 'Conectando'}</span>
        </div>
      </footer>

      {/* Modal / Cajón de Configuración para el Personal */}
      {showConfig && (
        <div className="tablet-config-drawer animate-slide-up">
          <div className="config-drawer-header">
            <h3>⚙️ Ajustes de Pantalla de Mesa #{numMesa}</h3>
            <button
              type="button"
              className="tablet-close-config"
              onClick={() => setShowConfig(false)}
            >
              ✕
            </button>
          </div>

          <div className="config-drawer-body">
            <div className="config-section">
              <label className="config-label">Destino de conexión (para celulares):</label>
              <div className="config-pills-row">
                <button
                  type="button"
                  className={`config-pill ${useWifiIp ? 'active' : ''}`}
                  onClick={() => setUseWifiIp(true)}
                >
                  <Wifi size={14} />
                  <span>IP Wi-Fi ({hostIp})</span>
                </button>
                <button
                  type="button"
                  className={`config-pill ${!useWifiIp ? 'active' : ''}`}
                  onClick={() => setUseWifiIp(false)}
                >
                  <span>Localhost</span>
                </button>
              </div>
            </div>

            {useWifiIp && (
              <div className="config-field">
                <label>IP de esta máquina en la red local Wi-Fi:</label>
                <input
                  type="text"
                  value={hostIp}
                  onChange={(e) => setHostIp(e.target.value.trim())}
                  placeholder="192.168.1.XX"
                  className="config-input"
                />
              </div>
            )}

            <div className="config-field">
              <label>Puerto de la aplicación del cliente (PWA):</label>
              <input
                type="text"
                value={clientPort}
                onChange={(e) => setClientPort(e.target.value.trim())}
                placeholder="5173"
                className="config-input"
              />
            </div>

            <div className="config-field">
              <label>Credencial JWT de la tablet (rol pantalla):</label>
              <input
                type="text"
                readOnly
                value={pantallaToken ? `${pantallaToken.slice(0, 32)}...` : 'Autenticando tablet...'}
                className="config-input read-only"
              />
            </div>

            <div className="config-field">
              <label>Enlace codificado actualmente:</label>
              <input type="text" readOnly value={diningUrl} className="config-input read-only" />
            </div>

            <div className="config-actions">
              <a
                href={diningUrl}
                target="_blank"
                rel="noreferrer"
                className="config-action-btn primary"
              >
                <ExternalLink size={15} />
                <span>Probar enlace de comensal en nueva pestaña</span>
              </a>

              <button
                type="button"
                className="config-action-btn secondary"
                onClick={handleSimularRotacion}
                disabled={loadingAction}
              >
                <RefreshCw size={15} className={loadingAction ? 'spin' : ''} />
                <span>Simular evento qr:actualizado en vivo</span>
              </button>

              <button
                type="button"
                className="config-action-btn ghost"
                onClick={() => navigate('/mesas')}
              >
                <ChevronLeft size={15} />
                <span>Regresar al Panel de Meseros</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
