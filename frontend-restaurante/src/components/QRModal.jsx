import { useState, useRef } from 'react'
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
} from 'lucide-react'
import { StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'

export function QRModal({
  table,
  onClose,
  onUpdateToken,
  onOpenTable,
  onFreeTable,
}) {
  const [copied, setCopied] = useState(false)
  const [token, setToken] = useState(table?.token_qr || '')
  const [loadingAction, setLoadingAction] = useState(false)
  const qrRef = useRef(null)

  // Detectar la IP del host actual o usar la IP Wi-Fi de la máquina
  const defaultHost =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
      ? window.location.hostname
      : '192.168.1.22'

  const [useWifiIp, setUseWifiIp] = useState(true)
  const [hostIp, setHostIp] = useState(defaultHost)

  if (!table) return null

  const isDisponible = (table.status || '').toLowerCase() === 'disponible'
  const isOcupada = (table.status || '').toLowerCase() === 'ocupada'

  // Decodificar atributos del token firmado
  const infoToken = decodificarTokenQr(token)
  const sid = infoToken.sid || (token ? token.slice(-8) : null)

  // Puerto actual donde está corriendo la aplicación del cliente o restaurante
  const port = typeof window !== 'undefined' ? window.location.port || '5173' : '5173'
  const activeDomain = useWifiIp ? hostIp : 'localhost'

  // URL para el comensal: Juan acordó https://<app>/?token=<qr> o /menu?token=<qr>
  const diningUrl = token
    ? `http://${activeDomain}:${port}/?token=${token}&mesa=${table.number || table.id}`
    : ''

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
      }
    } finally {
      setLoadingAction(false)
    }
  }

  // Liberación manual de la mesa (por si el grupo se fue sin pedir)
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

  // Regeneración forzada de QR (nueva sesión)
  const handleRegenerate = async () => {
    if (!window.confirm(`¿Regenerar código QR para ${table.name}? Se invalidarán las sesiones anteriores.`)) {
      return
    }
    setLoadingAction(true)
    try {
      if (onUpdateToken) {
        const res = await onUpdateToken(table.id || table.number)
        if (res?.token) setToken(res.token)
      }
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

            <div className="qr-svg-wrapper">
              {token ? (
                <QRCodeSVG
                  value={diningUrl}
                  size={210}
                  level="H"
                  includeMargin={true}
                  fgColor="#0f172a"
                  bgColor="#ffffff"
                />
              ) : (
                <div className="qr-placeholder-box">
                  <QrCode size={56} className="text-muted" />
                  <p>Mesa disponible. Pulsa "Abrir Mesa" para generar el QR de la sesión.</p>
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
                  onClick={handleRegenerate}
                  disabled={loadingAction}
                  title="Genera un token nuevo con sid diferente"
                >
                  <RefreshCw size={16} className={loadingAction ? 'spin' : ''} />
                  <span>Regenerar QR</span>
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
                  href={diningUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button small qr-action-btn test-link"
                >
                  <ExternalLink size={16} />
                  <span>Probar en pestaña</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
