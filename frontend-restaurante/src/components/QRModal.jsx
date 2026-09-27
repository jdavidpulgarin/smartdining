import { useState, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, Download, RefreshCw, Copy, Check, Printer, X, ExternalLink } from 'lucide-react'
import { StatusBadge } from './ui/Badge'

export function QRModal({ table, onClose, onUpdateToken }) {
  const [copied, setCopied] = useState(false)
  const [token, setToken] = useState(table?.token_qr || `qr-token-mesa-0${table?.number || 1}`)
  const [regenerating, setRegenerating] = useState(false)
  const qrRef = useRef(null)

  if (!table) return null

  // URL del cliente comensal para la mesa
  const clientBaseUrl = import.meta.env.VITE_CLIENT_URL || 'http://localhost:5174'
  const diningUrl = `${clientBaseUrl}/menu?mesa=${table.number || table.id}&token=${token}`

  const handleCopy = () => {
    navigator.clipboard.writeText(diningUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRegenerate = () => {
    setRegenerating(true)
    const randomHex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
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

          <div className="qr-controls">
            <div className="qr-status-row">
              <span className="qr-label">Estado actual de la mesa:</span>
              <StatusBadge status={table.status} />
            </div>

            <div className="qr-url-box">
              <label>Enlace directo del comensal:</label>
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
                <span>Probar PWA</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
