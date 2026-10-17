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

  const defaultClientPort = (import.meta.env && import.meta.env.VITE_CLIENTE_PORT) || '5174'
  const activeDomain = useWifiIp ? hostIp : 'localhost'

  // Priorizar table.qr_url enviada por el backend (apunta a frontend-cliente).
  // Si se prueba con Wi-Fi en red local, se sustituye localhost por hostIp manteniendo el puerto del comensal.
  let diningUrl = ''
  if (table.qr_url) {
    diningUrl = useWifiIp && hostIp !== 'localhost'
      ? table.qr_url.replace(/localhost|127\.0\.0\.1/, hostIp)
      : table.qr_url
  } else if (token) {
    diningUrl = `http://${activeDomain}:${defaultClientPort}/?token=${encodeURIComponent(token)}&mesa=${table.number || table.id}`
  }

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
    <div className="modal-backdrop sd-modal-backdrop" onClick={onClose}>
      <div className="modal-card qr-modal sd-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <QrCode size={20} />
            </div>
            <div>
              <h3>QR · MESA {table.number || table.id}</h3>
              <p className="modal-subtitle">
                {table.location || 'Salón'} · Capacidad: {table.seats || table.capacidad || 4} personas
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    background: 'var(--sd-red)',
                    color: '#ffffff',
                    fontFamily: 'var(--sd-font-heading)',
                    fontWeight: 800,
                    fontSize: 13,
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  SD
                </span>
                <span
                  style={{
                    fontFamily: 'var(--sd-font-heading)',
                    fontWeight: 800,
                    fontSize: 17,
                    letterSpacing: '0.04em',
                    color: '#120E0D',
                  }}
                >
                  SMARTDINING
                </span>
              </div>
              <span className="printable-mesa">MESA {table.number || table.id}</span>
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
                  fgColor="#120E0D"
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
                    className="sd-qr-btn sd-qr-btn-gold"
                    onClick={() => ejecutarRotacion(false)}
                    disabled={loadingAction}
                    style={{ margin: '0 auto' }}
                  >
                    <RefreshCw size={14} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Generando...' : 'Generar nuevo QR'}</span>
                  </button>
                  <p style={{ margin: '10px 0 0 0', fontSize: '0.75rem', color: '#8E827B' }}>
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
                    background: 'rgba(238, 28, 37, 0.15)',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    color: 'var(--sd-red)',
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
              <span className={`sd-qr-status-chip ${isOcupada ? 'ocupada' : isDisponible ? 'disponible' : 'cuenta_pedida'}`}>
                {isOcupada ? 'OCUPADA' : isDisponible ? 'DISPONIBLE' : (table.status || 'ESTADO').toUpperCase()}
              </span>
            </div>

            {/* SECCIÓN P-07: Rotación y Temporizador de 3 Minutos */}
            {isOcupada && token && (
              <div
                className="qr-rotacion-card"
                style={{
                  background: 'var(--sd-bg)',
                  border: '1px solid var(--sd-border)',
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
                      style={{ color: 'var(--sd-gold)' }}
                    />
                    <strong style={{ fontSize: '0.85rem', color: 'var(--sd-text)', fontFamily: 'var(--sd-font-heading)', textTransform: 'uppercase' }}>
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
                      color: autoRotacionHabilitada ? 'var(--sd-text)' : '#8E827B',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--sd-font-heading)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
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
                        ? 'rgba(255, 255, 255, 0.2)'
                        : segundosRestantes <= 30
                          ? 'var(--sd-red)'
                          : 'linear-gradient(90deg, var(--sd-gold), var(--sd-red))',
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
                  <div style={{ fontSize: '0.78rem', color: 'var(--sd-text-muted)' }}>
                    {tieneComensalesOpedidos ? (
                      <span style={{ color: 'var(--sd-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>⏸️ En pausa:</span>
                        <strong>comensales en mesa</strong>
                      </span>
                    ) : autoRotacionHabilitada ? (
                      <span>
                        Próxima renovación en:{' '}
                        <strong
                          style={{
                            color: 'var(--sd-gold)',
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                          }}
                        >
                          {tiempoFormateado}
                        </strong>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--sd-text-muted)' }}>Auto-rotación pausada manualmente</span>
                    )}
                  </div>

                  {/* Botón Nuevo QR oficial de P-07 */}
                  <button
                    type="button"
                    onClick={() => ejecutarRotacion(false)}
                    disabled={loadingAction}
                    className="sd-qr-btn sd-qr-btn-secondary"
                    title="Rotar inmediatamente el QR de la mesa (POST /api/mesas/:id/rotar-qr)"
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.8rem',
                    }}
                  >
                    <RefreshCw size={13} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Rotando...' : 'Nuevo QR'}</span>
                  </button>
                </div>

                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--sd-text-muted)',
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
                <p style={{ color: 'var(--sd-text-muted)', fontSize: 13, margin: '0 0 10px 0' }}>
                  Genera un QR nuevo e inicia la sesión para el grupo que va a ocupar esta mesa.
                </p>
                <button
                  type="button"
                  className="sd-qr-btn sd-qr-btn-gold qr-open-btn"
                  onClick={handleAbrirMesa}
                  disabled={loadingAction}
                  style={{ width: '100%' }}
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
                  className="sd-qr-btn sd-qr-btn-primary tablet-launch-btn"
                  title="Abrir la interfaz dedicada para la tablet física de la mesa"
                >
                  <Monitor size={14} />
                  <span>Lanzar Pantalla</span>
                </a>
                <button
                  type="button"
                  className={`sd-qr-btn sd-qr-btn-secondary tablet-copy-btn ${copiedTablet ? 'copied' : ''}`}
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
                    <Wifi size={14} className="inline-icon" style={{ color: 'var(--sd-red)' }} /> Destino del Escaneo:
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
                      className="sd-input"
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
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--sd-text-muted)', textTransform: 'uppercase', fontFamily: 'var(--sd-font-heading)' }}>
                  Enlace codificado en el QR:
                </label>
                <div className="qr-url-input-group" style={{ display: 'flex', marginTop: 4 }}>
                  <input type="text" readOnly value={diningUrl} className="sd-input" style={{ borderRadius: '6px 0 0 6px' }} />
                  <button
                    type="button"
                    className={`sd-qr-btn sd-qr-btn-secondary qr-btn-icon ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                    title="Copiar enlace"
                    style={{ borderRadius: '0 6px 6px 0', borderLeft: 'none', minWidth: 90 }}
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
                  className="sd-qr-btn sd-qr-btn-danger qr-action-btn danger-hover"
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
                  className="sd-qr-btn sd-qr-btn-sec qr-action-btn"
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
                  className="sd-qr-btn sd-qr-btn-sec qr-action-btn"
                  onClick={handleDownload}
                >
                  <Download size={16} />
                  <span>Guardar SVG</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="sd-qr-btn sd-qr-btn-sec qr-action-btn"
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
                  className="sd-qr-btn sd-qr-btn-sec qr-action-btn tablet-link-btn"
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
                  className="sd-qr-btn sd-qr-btn-sec qr-action-btn test-link"
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
