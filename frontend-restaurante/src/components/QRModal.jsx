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
} from 'lucide-react'
import { StatusBadge } from './ui/Badge'

export function QRModal({ table, onClose, onUpdateToken }) {
  const [copied, setCopied] = useState(false)
  const [token, setToken] = useState(table?.token_qr || `qr-token-mesa-0${table?.number || 1}`)
  const [regenerating, setRegenerating] = useState(false)
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

  // Puerto actual donde está corriendo la aplicación
  const port = typeof window !== 'undefined' ? window.location.port || '5173' : '5173'
  const activeDomain = useWifiIp ? hostIp : 'localhost'
  const diningUrl = `http://${activeDomain}:${port}/menu?mesa=${table.number || table.id}&token=${token}`

  const handleCopy = () => {
    navigator.clipboard.writeText(diningUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRegenerate = () => {
    setRegenerating(true)
    const randomHex =
      Math.random().toString(36).substring(2, 10) +
      Math.random().toString(36).substring(2, 10)
    const newToken = `qr-token-mesa-${String(table.number || table.id).padStart(2, '0')}-${randomHex}`
    setTimeout(() => {
      setToken(newToken)
      if (onUpdateToken) {
        onUpdateToken(table.id, newToken)
      }
      setRegenerating(false)
    }, 400)
  }

  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `QR_Mesa_${table.number || table.id}_SmartDining.svg`
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
              <h3>Código QR Dinámico — {table.name}</h3>
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
          {/* Tarjeta Imprimible */}
          <div className="printable-qr-card" ref={qrRef}>
            <div className="printable-brand">
              <span className="printable-logo">🍽️ SmartDining</span>
              <span className="printable-mesa">{table.name}</span>
            </div>

            <div className="qr-svg-wrapper">
              <QRCodeSVG
                value={diningUrl}
                size={210}
                level="H"
                includeMargin={true}
                fgColor="#0f172a"
                bgColor="#ffffff"
              />
            </div>

            <div className="printable-footer">
              <p className="printable-cta">Escanea con tu celular para ver el menú y pedir</p>
              <small className="printable-token">Token: {token.substring(0, 24)}...</small>
            </div>
          </div>

          {/* Controles y Ajustes */}
          <div className="qr-controls">
            <div className="qr-status-row">
              <span className="qr-label">Estado actual de la mesa:</span>
              <StatusBadge status={table.status} />
            </div>

            {/* Selector de Conexión Móvil vs Local */}
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
                    <span>Red Wi-Fi (Celular)</span>
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
                  <label>IP de tu PC en la red Wi-Fi:</label>
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value.trim())}
                    placeholder="192.168.1.X"
                  />
                  <small className="ip-hint">
                    💡 Asegúrate de que tu celular esté conectado al mismo Wi-Fi que este computador.
                  </small>
                </div>
              )}
            </div>

            {/* Enlace directo codificado en el QR */}
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

            {/* Botones de Acción */}
            <div className="qr-actions-grid">
              <button
                type="button"
                className="primary-button small qr-action-btn"
                onClick={handleDownload}
              >
                <Download size={16} />
                <span>Descargar SVG</span>
              </button>

              <button
                type="button"
                className="ghost-button small qr-action-btn"
                onClick={handlePrint}
              >
                <Printer size={16} />
                <span>Imprimir Tarjeta</span>
              </button>

              <button
                type="button"
                className="ghost-button small qr-action-btn danger-hover"
                onClick={handleRegenerate}
                disabled={regenerating}
                title="Regenera el token para invalidar accesos previos al cerrar la mesa"
              >
                <RefreshCw size={16} className={regenerating ? 'spin' : ''} />
                <span>{regenerating ? 'Regenerando...' : 'Regenerar QR'}</span>
              </button>

              <a
                href={diningUrl}
                target="_blank"
                rel="noreferrer"
                className="link-button small qr-action-btn test-link"
              >
                <ExternalLink size={16} />
                <span>Probar Enlace</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
