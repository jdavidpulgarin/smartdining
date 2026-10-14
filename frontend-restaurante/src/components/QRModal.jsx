import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  QrCode,
  Download,
  RefreshCw,
  Copy,
  Check,
  Printer,
  X,
  ExternalLink,
  Wifi,
  Smartphone,
  LogOut,
  Sparkles,
  ShieldCheck,
  Clock,
  Tablet,
  Monitor,
  Play,
  Pause,
  RotateCw,
} from 'lucide-react'
import { StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'
import { useSocketListener, useTables } from '../hooks'

const ROTACION_INTERVALO_SEGUNDOS = 180 // 3 minutos

export function QRModal({
  table,
  onClose,
  onUpdateToken,
  onOpenTable,
  onFreeTable,
}) {
  const [copied, setCopied] = useState(false)
  const [copiedTablet, setCopiedTablet] = useState(false)
  const [token, setToken] = useState(table?.token_qr || '')
  const [prevTableToken, setPrevTableToken] = useState(table?.token_qr)
  if (table?.token_qr !== prevTableToken) {
    setPrevTableToken(table?.token_qr)
    setToken(table?.token_qr || '')
  }

  const [loadingAction, setLoadingAction] = useState(false)
  const [justRotated, setJustRotated] = useState(false)
  const [segundosRestantes, setSegundosRestantes] = useState(ROTACION_INTERVALO_SEGUNDOS)
  const [autoRotacionHabilitada, setAutoRotacionHabilitada] = useState(true)

  const qrRef = useRef(null)
  const { pedidosActivos } = useTables()

  const tableId = Number(table?.id || table?.number)
  const isDisponible = (table?.status || '').toLowerCase() === 'disponible'
  const isOcupada = (table?.status || '').toLowerCase() === 'ocupada'

  // Determinar si hay comensales o pedidos activos en la mesa
  const pedidosMesa = (pedidosActivos || []).filter(
    (p) =>
      (Number(p.id_mesa) === tableId || Number(p.mesa) === tableId) &&
      p.estado !== 'cancelado'
  )
  const tieneComensalesOpedidos =
    pedidosMesa.length > 0 ||
    Boolean(table?.comensales && table.comensales.length > 0)

  // Escuchar en vivo si el backend o la tablet rota el QR de esta mesa (evento qr:actualizado)
  useSocketListener('qr:actualizado', (data) => {
    if (data?.id_mesa && Number(data.id_mesa) === tableId && data.token_qr) {
      setToken(data.token_qr)
      setSegundosRestantes(ROTACION_INTERVALO_SEGUNDOS)
      setJustRotated(true)
      setTimeout(() => setJustRotated(false), 2000)
    }
  })

  // Función para ejecutar la rotación de QR (manual o automática)
  const ejecutarRotacion = useCallback(
    async (esAutomatica = false) => {
      if (loadingAction) return
      setLoadingAction(true)
      try {
        if (onUpdateToken) {
          const res = await onUpdateToken(tableId)
          if (res?.token) {
            setToken(res.token)
          }
        }
        setSegundosRestantes(ROTACION_INTERVALO_SEGUNDOS)
        setJustRotated(true)
        setTimeout(() => setJustRotated(false), 2500)
      } catch (err) {
        console.warn(
          `Aviso: rotación ${esAutomatica ? 'automática' : 'manual'} no completada:`,
          err.message
        )
      } finally {
        setLoadingAction(false)
      }
    },
    [loadingAction, onUpdateToken, tableId]
  )

  // Temporizador de 3 minutos (180s)
  // Rota automáticamente solo mientras la mesa esté abierta y NO tenga comensales/pedidos
  useEffect(() => {
    if (!token || !isOcupada || tieneComensalesOpedidos || !autoRotacionHabilitada) {
      return
    }

    const interval = setInterval(() => {
      setSegundosRestantes((prev) => {
        if (prev <= 1) {
          ejecutarRotacion(true)
          return ROTACION_INTERVALO_SEGUNDOS
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [
    token,
    isOcupada,
    tieneComensalesOpedidos,
    autoRotacionHabilitada,
    ejecutarRotacion,
  ])

  // Formato mm:ss para el temporizador
  const minutos = Math.floor(segundosRestantes / 60)
  const segundos = segundosRestantes % 60
  const tiempoFormateado = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
  const porcentajeTiempo = ((ROTACION_INTERVALO_SEGUNDOS - segundosRestantes) / ROTACION_INTERVALO_SEGUNDOS) * 100

  // Host Wi-Fi o Localhost para probar con celulares en la misma red
  const defaultHost =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
      ? window.location.hostname
      : '192.168.1.22'

  const [useWifiIp, setUseWifiIp] = useState(true)
  const [hostIp, setHostIp] = useState(defaultHost)

  if (!table) return null

  // Decodificar atributos del token firmado
  const infoToken = decodificarTokenQr(token)
  const sid = infoToken.sid || (token ? token.slice(-8) : null)

  const port = typeof window !== 'undefined' ? window.location.port || '5173' : '5173'
  const activeDomain = useWifiIp ? hostIp : 'localhost'

  const diningUrl = token
    ? useWifiIp
      ? `http://${activeDomain}:${port}/?token=${encodeURIComponent(token)}&mesa=${table.number || table.id}`
      : table.qr_url || `http://localhost:${port}/?token=${encodeURIComponent(token)}&mesa=${table.number || table.id}`
    : ''

  const tabletUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/pantalla/mesa/${table.number || table.id}`
      : `/pantalla/mesa/${table.number || table.id}`

  const handleCopy = () => {
    if (!diningUrl) return
    navigator.clipboard.writeText(diningUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Apertura de mesa desde el modal (generación del QR dinámico de sesión)
  const handleAbrirMesa = async () => {
    if (!onOpenTable) return
    setLoadingAction(true)
    try {
      const res = await onOpenTable(table.id || table.number)
      if (res?.token) {
        setToken(res.token)
        setSegundosRestantes(ROTACION_INTERVALO_SEGUNDOS)
      }
    } finally {
      setLoadingAction(false)
    }
  }

  // Liberación manual de la mesa
  const handleLiberarMesa = async () => {
    if (!onFreeTable) return
    if (!window.confirm(`¿Liberar ${table.name}? El QR actual dejará de funcionar de inmediato.`)) {
      return
    }
    setLoadingAction(true)
    try {
      await onFreeTable(table.id || table.number)
      onClose()
    } finally {
      setLoadingAction(false)
    }
  }

  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `QR_Sesion_Mesa_${table.number || table.id}_SmartDining.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <QrCode size={20} />
            </div>
            <div>
              <h3>QR Dinámico por Sesión — {table.name}</h3>
              <p className="modal-subtitle">
                {table.location || 'Salón'} · Capacidad: {table.seats} personas
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body qr-modal-body">
          {/* Tarjeta del Código QR en Pantalla para el Comensal */}
          <div className="printable-qr-card" ref={qrRef}>
            <div className="printable-brand">
              <span className="printable-logo">🍽️ SmartDining</span>
              <span className="printable-mesa">{table.name}</span>
            </div>

            <div
              className={`qr-svg-wrapper ${justRotated ? 'qr-rotated-pulse' : ''}`}
              style={{
                transition: 'all 0.3s ease',
                position: 'relative',
              }}
            >
              {token ? (
                <QRCodeSVG
                  value={diningUrl}
                  size={210}
                  level="H"
                  includeMargin={true}
                  fgColor="#0f172a"
                  bgColor="#ffffff"
                />
              ) : isOcupada ? (
                <div className="qr-placeholder-box" style={{ padding: '20px 12px', textAlign: 'center' }}>
                  <QrCode size={48} className="text-muted" style={{ margin: '0 auto 12px auto' }} />
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', lineHeight: 1.4, color: '#334155' }}>
                    Esta mesa tiene una sesión abierta, pero su QR no está en este dispositivo.
                  </p>
                  <button
                    type="button"
                    className="primary-button qr-open-btn"
                    onClick={() => ejecutarRotacion(false)}
                    disabled={loadingAction}
                    style={{ margin: '0 auto' }}
                  >
                    <RefreshCw size={14} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Generando...' : 'Generar nuevo QR'}</span>
                  </button>
                  <p style={{ margin: '10px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                    El QR anterior dejará de funcionar.
                  </p>
                </div>
              ) : (
                <div className="qr-placeholder-box">
                  <QrCode size={56} className="text-muted" />
                  <p>Mesa disponible. Pulsa "Abrir Mesa" para generar el QR de la sesión.</p>
                </div>
              )}

              {justRotated && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(16, 185, 129, 0.15)',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    color: '#059669',
                    fontSize: '0.85rem',
                    pointerEvents: 'none',
                  }}
                >
                  <Sparkles size={18} style={{ marginRight: '6px' }} />
                  ¡QR Renovado!
                </div>
              )}
            </div>

            <div className="printable-footer">
              {token ? (
                <>
                  <p className="printable-cta">
                    Muestra este código al grupo. Válido durante su estadía.
                  </p>
                  <div className="token-meta-pill">
                    <ShieldCheck size={12} />
                    <span>v1 firmado · sid: {sid || 'activo'}</span>
                  </div>
                </>
              ) : (
                <p className="printable-cta text-muted">Sin sesión activa</p>
              )}
            </div>
          </div>

          {/* Controles de Sesión y Ajustes para el Personal */}
          <div className="qr-controls">
            {/* Estado actual de la mesa */}
            <div className="qr-status-row">
              <span className="qr-label">Estado de la mesa:</span>
              <StatusBadge status={table.status} />
            </div>

            {/* SECCIÓN P-07: Rotación y Temporizador de 3 Minutos */}
            {isOcupada && token && (
              <div
                className="qr-rotacion-card"
                style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock
                      size={16}
                      className={segundosRestantes <= 30 && !tieneComensalesOpedidos ? 'text-amber animate-pulse' : 'text-emerald'}
                    />
                    <strong style={{ fontSize: '0.85rem', color: '#f8fafc' }}>
                      Rotación Automática (3 min)
                    </strong>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAutoRotacionHabilitada((prev) => !prev)}
                    title={autoRotacionHabilitada ? 'Pausar auto-rotación' : 'Activar auto-rotación'}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: autoRotacionHabilitada ? '#34d399' : '#64748b',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {autoRotacionHabilitada ? <Pause size={14} /> : <Play size={14} />}
                    <span>{autoRotacionHabilitada ? 'Pausar' : 'Reanudar'}</span>
                  </button>
                </div>

                {/* Barra de progreso de los 3 minutos */}
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: tieneComensalesOpedidos ? '100%' : `${porcentajeTiempo}%`,
                      background: tieneComensalesOpedidos
                        ? 'linear-gradient(90deg, #3b82f6, #6366f1)'
                        : segundosRestantes <= 30
                          ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                          : 'linear-gradient(90deg, #10b981, #06b6d4)',
                      transition: 'width 1s linear',
                      borderRadius: '999px',
                    }}
                  />
                </div>

                {/* Info del temporizador y Botón Nuevo QR */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {tieneComensalesOpedidos ? (
                      <span style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>⏸️ En pausa:</span>
                        <strong>comensales en mesa</strong>
                      </span>
                    ) : autoRotacionHabilitada ? (
                      <span>
                        Próxima renovación en:{' '}
                        <strong
                          style={{
                            color: segundosRestantes <= 30 ? '#f59e0b' : '#34d399',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                          }}
                        >
                          {tiempoFormateado}
                        </strong>
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Auto-rotación pausada manualmente</span>
                    )}
                  </div>

                  {/* Botón Nuevo QR oficial de P-07 */}
                  <button
                    type="button"
                    onClick={() => ejecutarRotacion(false)}
                    disabled={loadingAction}
                    className="primary-button small"
                    title="Rotar inmediatamente el QR de la mesa (POST /api/mesas/:id/rotar-qr)"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <RefreshCw size={13} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Rotando...' : 'Nuevo QR'}</span>
                  </button>
                </div>

                <div
                  style={{
                    fontSize: '0.7rem',
                    color: '#64748b',
                    lineHeight: '1.3',
                  }}
                >
                  {tieneComensalesOpedidos
                    ? '🔒 Hay pedidos en curso. Los comensales conservan su sesión de mesa sin ser interrumpidos.'
                    : '🛡️ Seguridad: El código rota cada 3 min mientras no haya comensales para invalidar fotos o capturas viejas.'}
                </div>
              </div>
            )}

            {/* Metadatos de la sesión activa */}
            {isOcupada && token && (
              <div className="qr-session-info-card">
                <div className="session-info-item">
                  <span className="session-label">ID Sesión (sid):</span>
                  <strong className="session-sid-code">{sid}</strong>
                </div>
                <div className="session-info-item">
                  <span className="session-label">
                    <Clock size={12} className="inline-icon" /> Expiración estimada:
                  </span>
                  <span>{infoToken.expiraTexto || '4 horas tras apertura'}</span>
                </div>
                <small className="session-security-note">
                  🔒 El backend rechaza peticiones con 401 si el sid no coincide con esta mesa.
                </small>
              </div>
            )}

            {/* Acción de Apertura si la mesa está libre */}
            {isDisponible && (
              <div className="qr-open-table-banner">
                <p>
                  Genera un QR nuevo e inicia la sesión para el grupo que va a ocupar esta mesa.
                </p>
                <button
                  type="button"
                  className="primary-button qr-open-btn"
                  onClick={handleAbrirMesa}
                  disabled={loadingAction}
                >
                  <Sparkles size={16} />
                  <span>{loadingAction ? 'Generando QR...' : 'Abrir Mesa y Generar QR'}</span>
                </button>
              </div>
            )}

            {/* Modo Pantalla Tablet (QR en Vidrio) */}
            <div className="qr-tablet-mode-banner">
              <div className="tablet-mode-left">
                <div className="tablet-mode-badge-icon">
                  <Tablet size={20} />
                </div>
                <div>
                  <h4 className="tablet-mode-title">Modo Pantalla Tablet ("QR en Vidrio")</h4>
                  <p className="tablet-mode-desc">
                    Vista para la tablet fija de la mesa. Se conecta al socket server y se auto-refresca sola cuando el token rota.
                  </p>
                </div>
              </div>
              <div className="tablet-mode-buttons">
                <a
                  href={tabletUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="primary-button small tablet-launch-btn"
                  title="Abrir la interfaz dedicada para la tablet física de la mesa"
                >
                  <Monitor size={14} />
                  <span>Lanzar Pantalla</span>
                </a>
                <button
                  type="button"
                  className={`ghost-button small tablet-copy-btn ${copiedTablet ? 'copied' : ''}`}
                  onClick={() => {
                    navigator.clipboard.writeText(tabletUrl)
                    setCopiedTablet(true)
                    setTimeout(() => setCopiedTablet(false), 2000)
                  }}
                  title="Copiar URL para configurar la tablet del restaurante"
                >
                  {copiedTablet ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedTablet ? 'Copiada' : 'Copiar URL Tablet'}</span>
                </button>
              </div>
            </div>

            {/* Selector de Conexión Wi-Fi vs Local */}
            {token && (
              <div className="qr-network-selector-box">
                <div className="network-toggle-header">
                  <span className="qr-label">
                    <Wifi size={14} className="inline-icon text-teal" /> Destino del Escaneo:
                  </span>
                  <div className="network-pills">
                    <button
                      type="button"
                      className={`net-pill ${useWifiIp ? 'active' : ''}`}
                      onClick={() => setUseWifiIp(true)}
                    >
                      <Smartphone size={13} />
                      <span>Wi-Fi (Móviles)</span>
                    </button>
                    <button
                      type="button"
                      className={`net-pill ${!useWifiIp ? 'active' : ''}`}
                      onClick={() => setUseWifiIp(false)}
                    >
                      <span>Localhost</span>
                    </button>
                  </div>
                </div>

                {useWifiIp && (
                  <div className="ip-input-wrapper">
                    <label>IP del servidor en tu Wi-Fi:</label>
                    <input
                      type="text"
                      value={hostIp}
                      onChange={(e) => setHostIp(e.target.value.trim())}
                      placeholder="192.168.1.X"
                    />
                    <small className="ip-hint">
                      💡 Los comensales deben estar conectados al mismo Wi-Fi del restaurante.
                    </small>
                  </div>
                )}
              </div>
            )}

            {/* Enlace directo codificado en el QR */}
            {token && (
              <div className="qr-url-box">
                <label>Enlace codificado en el QR:</label>
                <div className="qr-url-input-group">
                  <input type="text" readOnly value={diningUrl} />
                  <button
                    type="button"
                    className={`qr-btn-icon ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                    title="Copiar enlace"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Botones de Acción para el Mesero */}
            <div className="qr-actions-grid">
              {isOcupada && onFreeTable && (
                <button
                  type="button"
                  className="ghost-button small qr-action-btn danger-hover"
                  onClick={handleLiberarMesa}
                  disabled={loadingAction}
                  title="Libera la mesa manualmente e invalida el QR actual"
                >
                  <LogOut size={16} />
                  <span>Liberar Mesa</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="ghost-button small qr-action-btn"
                  onClick={() => ejecutarRotacion(false)}
                  disabled={loadingAction}
                  title="Roto el QR con POST /api/mesas/:id/rotar-qr"
                >
                  <RotateCw size={16} className={loadingAction ? 'spin' : ''} />
                  <span>Rotar QR</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="ghost-button small qr-action-btn"
                  onClick={handleDownload}
                >
                  <Download size={16} />
                  <span>Guardar SVG</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="ghost-button small qr-action-btn"
                  onClick={handlePrint}
                >
                  <Printer size={16} />
                  <span>Imprimir</span>
                </button>
              )}

              {token && (
                <a
                  href={tabletUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button small qr-action-btn tablet-link-btn"
                  title="Abrir vista de tablet para esta mesa"
                >
                  <Tablet size={16} />
                  <span>Pantalla Tablet</span>
                </a>
              )}

              {token && (
                <a
                  href={diningUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button small qr-action-btn test-link"
                >
                  <ExternalLink size={16} />
                  <span>Probar comensal</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
