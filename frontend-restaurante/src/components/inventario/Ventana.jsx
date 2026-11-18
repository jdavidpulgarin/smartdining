import { useEffect, useId } from 'react'
import { X } from 'lucide-react'

/**
 * Ventana de la pantalla de Inventario: el mismo marcado que las de
 * EditorPasos (sd-modal-backdrop + sd-card), con título accesible y cierre con
 * Escape o con un clic fuera.
 */
export function Ventana({ titulo, onClose, children, ancho = 560 }) {
  const idTitulo = useId()

  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onClose])

  return (
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div
        className="sd-card sd-table-detail-modal"
        style={{ maxWidth: ancho, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
      >
        <div className="sd-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id={idTitulo} className="sd-card-title" style={{ margin: 0 }}>{titulo}</h2>
          <button type="button" className="sd-topbar-icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
