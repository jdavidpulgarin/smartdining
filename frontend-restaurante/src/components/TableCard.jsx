import { QrCode, LogOut, Sparkles, Users, MapPin } from 'lucide-react'
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
  const tableId = Number(table?.number || table?.id || 1)
  const tableName = table?.name || name || `Mesa ${tableId}`
  const tableStatus = (table?.status || table?.estado || status || 'Disponible').toLowerCase()
  const tableSeats = table?.seats || table?.capacidad || seats || 4
  const tableLocation = table?.location || table?.ubicacion || 'Principal'
  const tableDetail = table?.detail || detail
  const isActive = table?.active ?? active

  // Extraer información de la sesión si tiene token v1
  const sesionInfo = table?.token_qr ? decodificarTokenQr(table.token_qr) : null
  const sid = sesionInfo?.sid && sesionInfo.sid !== 'N/A' ? sesionInfo.sid.slice(0, 8) : null

  const isDisponible = tableStatus === 'disponible' || tableStatus === 'libre'
  const isOcupada = tableStatus === 'ocupada'
  const isCuenta = tableStatus === 'cuenta' || tableStatus === 'cuenta_pedida'
  const isListo = tableStatus === 'listo' || tableStatus === 'pedido_listo'
  const isLlamado = tableStatus === 'llamado' || table?.alerta?.tipo === 'llamado'

  let estadoVisual = 'disponible'
  let estadoLabel = 'DISPONIBLE'

  if (isLlamado) {
    estadoVisual = 'llamado'
    estadoLabel = 'LLAMA AL MESERO'
  } else if (isCuenta) {
    estadoVisual = 'cuenta'
    estadoLabel = 'PIDE LA CUENTA'
  } else if (isListo) {
    estadoVisual = 'listo'
    estadoLabel = 'PEDIDO LISTO'
  } else if (isOcupada || isActive) {
    estadoVisual = 'ocupada'
    estadoLabel = 'OCUPADA'
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`sd-table-card sd-table-${estadoVisual} ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      aria-label={`Mesa ${tableId}, estado ${estadoLabel}`}
    >
      {/* Cabecera de la mesa */}
      <div className="sd-table-card-top">
        <span className="sd-table-card-number">#{tableId}</span>
        <StatusBadge status={table?.status || status || estadoLabel} />
      </div>

      {/* Indicador de capacidad y sesión */}
      <div className="sd-table-card-meta">
        <span className="sd-table-card-time">
          <MapPin size={12} aria-hidden="true" /> {tableLocation}
        </span>
        <span className="sd-table-card-seats">
          <Users size={12} aria-hidden="true" /> {tableSeats} pers.
        </span>
        {sid && (
          <span className="sd-table-card-sid">
            SESIÓN: {sid}
          </span>
        )}
      </div>

      <div className="sd-table-card-bottom">
        <div className="sd-table-card-title">{tableName}</div>
        {tableDetail && <div className="sd-table-card-detail">{tableDetail}</div>}
      </div>

      {/* Barra de Acciones de Mesa para el Mesero */}
      <div className="sd-table-card-actions">
        {onOpenQR && (
          <button
            type="button"
            className={`sd-table-btn ${isDisponible ? 'sd-table-btn-open' : 'sd-table-btn-qr'}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenQR(table || { name, status, seats, detail, active })
            }}
            title={isDisponible ? 'Abrir mesa y generar QR de sesión' : `Ver QR de ${tableName}`}
          >
            {isDisponible ? <Sparkles size={14} /> : <QrCode size={14} />}
            <span>{isDisponible ? 'Abrir / QR' : 'Ver QR'}</span>
          </button>
        )}

        {isOcupada && onFreeTable && (
          <button
            type="button"
            className="sd-table-btn sd-table-btn-free"
            onClick={(e) => {
              e.stopPropagation()
              if (
                window.confirm(
                  `¿Liberar ${tableName}? Se revocará el QR y se limpiará la comanda de este grupo.`
                )
              ) {
                onFreeTable(table.id || table.number)
              }
            }}
            title="Liberar mesa (para grupos que se van sin pedir o terminaron su estadía)"
          >
            <LogOut size={13} />
            <span>Liberar</span>
          </button>
        )}
      </div>
    </div>
  )
}
