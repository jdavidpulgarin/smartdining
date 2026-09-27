import { QrCode } from 'lucide-react'
import { StatusBadge } from './ui/Badge'

export function TableCard({ table, name, status, seats, detail, active, onOpenQR, onClick }) {
  const tableName = table?.name || name
  const tableStatus = table?.status || status
  const tableSeats = table?.seats || seats
  const tableDetail = table?.detail || detail
  const isActive = table?.active ?? active

  return (
    <div
      className={`table-card ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="table-top">
        <strong>{tableName}</strong>
        <div className="table-top-actions">
          <StatusBadge status={tableStatus} />
          {onOpenQR && (
            <button
              type="button"
              className="table-qr-btn"
              onClick={(e) => {
                e.stopPropagation()
                onOpenQR(table || { name, status, seats, detail, active })
              }}
              title={`Ver código QR de ${tableName}`}
            >
              <QrCode size={14} />
              <span>QR</span>
            </button>
          )}
        </div>
      </div>
      <p>{tableSeats} personas {table?.location ? `· ${table.location}` : ''}</p>
      <small>{tableDetail}</small>
    </div>
  )
}
