import { QrCode, LogOut, Sparkles, Users, MapPin } from 'lucide-react'
import { StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'
import { estadoTarjetaMesa, avisoAbrirMesa } from '../utils/estadoMesa'

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
  // Reservada o en mantenimiento: se puede abrir, pero confirmando (TablesPanel).
  const pideConfirmar = Boolean(avisoAbrirMesa({ estado: tableStatus }))
  // Reservada y mantenimiento tienen su etiqueta (utils/estadoMesa.js): con
  // T12 llegan en vivo y antes salían como «DISPONIBLE».
  const { visual: estadoVisual, etiqueta: estadoLabel } = estadoTarjetaMesa({
    estado: tableStatus === 'libre' ? 'disponible' : tableStatus,
    alerta: table?.alerta?.tipo === 'llamado' ? 'llamado' : null,
    activa: isActive,
  })

  return (
    <div
      role="button"
      tabIndex={0}
      className={`sd-table-card ms-table-card sd-table-${estadoVisual} ms-table-${estadoVisual} ${isActive ? 'active' : ''}`}
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
      <div className="sd-table-card-top ms-card-top">
        <span className="sd-table-card-number ms-card-num"><small>#</small>{tableId}</span>
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
            title={isDisponible ? 'Abrir mesa y generar QR de sesión' : pideConfirmar ? `${tableName} está ${tableStatus === 'reservada' ? 'reservada' : 'en mantenimiento'}: pide confirmación` : `Ver QR de ${tableName}`}
          >
            {isDisponible || pideConfirmar ? <Sparkles size={14} /> : <QrCode size={14} />}
            <span>{isDisponible ? 'Abrir / QR' : pideConfirmar ? 'Abrir igual' : 'Ver QR'}</span>
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
