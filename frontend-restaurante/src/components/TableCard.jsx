import { QrCode, LogOut, Sparkles } from 'lucide-react'
import { StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'

export function TableCard({
  table,
  name,
  status,
  seats,
  detail,
  active,
  onOpenQR,
  onFreeTable,
  onClick,
}) {
  const tableName = table?.name || name
  const tableStatus = (table?.status || status || 'Disponible').toLowerCase()
  const tableSeats = table?.seats || seats
  const tableDetail = table?.detail || detail
  const isActive = table?.active ?? active

  // Extraer información de la sesión si tiene token v1
  const sesionInfo = table?.token_qr ? decodificarTokenQr(table.token_qr) : null
  const sid = sesionInfo?.sid && sesionInfo.sid !== 'N/A' ? sesionInfo.sid.slice(0, 8) : null

  const isDisponible = tableStatus === 'disponible'
  const isOcupada = tableStatus === 'ocupada'

  return (
    <div
      className={`table-card ${isActive ? 'active' : ''} status-${tableStatus}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="table-top">
        <div className="table-title-group">
          <strong>{tableName}</strong>
          {sid && isOcupada && (
            <span className="table-sid-badge" title={`Sesión activa: ${sesionInfo?.sid}`}>
              sid: {sid}
            </span>
          )}
        </div>
        <div className="table-top-actions">
          <StatusBadge status={table?.status || status} />
        </div>
      </div>

      <p>
        {tableSeats} personas {table?.location ? `· ${table.location}` : ''}
      </p>
      <small className="table-detail-text">{tableDetail}</small>

      {/* Barra de Acciones de Mesa para el Mesero */}
      <div className="table-card-actions">
        {onOpenQR && (
          <button
            type="button"
            className={`table-action-btn ${isDisponible ? 'primary-glow' : 'secondary-btn'}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenQR(table || { name, status, seats, detail, active })
            }}
            title={isDisponible ? 'Abrir mesa y generar QR dinámico' : `Ver QR de ${tableName}`}
          >
            {isDisponible ? <Sparkles size={13} /> : <QrCode size={13} />}
            <span>{isDisponible ? 'Abrir / QR' : 'Ver QR'}</span>
          </button>
        )}

        {isOcupada && onFreeTable && (
          <button
            type="button"
            className="table-action-btn danger-btn"
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`¿Liberar ${tableName}? Se anulará el QR y el carrito de esta sesión.`)) {
                onFreeTable(table.id || table.number)
              }
            }}
            title="Liberar mesa (para grupos que se van sin pedir o mesa saldada)"
          >
            <LogOut size={13} />
            <span>Liberar</span>
          </button>
        )}
      </div>
    </div>
  )
}
