import { useState, useMemo } from 'react'
import { TableCard } from './TableCard'
import { QRModal } from './QRModal'
import { useTables } from '../hooks'
import {
  CheckCircle2,
  AlertCircle,
  Search,
  SlidersHorizontal,
  Flame,
  LayoutGrid,
} from 'lucide-react'

export function TablesPanel({ tables: propTables, onSelectTable, selectedTableId }) {
  const tablesContext = useTables()
  const contextTables = tablesContext?.tables
  const abrirMesa = tablesContext?.abrirMesa
  const liberarMesa = tablesContext?.liberarMesa
  const regenerarQr = tablesContext?.regenerarQr
  const notification = tablesContext?.notification

  const [localTables, setLocalTables] = useState(propTables || [])
  const tablesList = contextTables || propTables || localTables

  const [statusFilter, setStatusFilter] = useState('Todas')
  const [zoneFilter, setZoneFilter] = useState('Todas')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTableIdForQR, setSelectedTableIdForQR] = useState(null)

  // Encontrar la mesa activa para el modal
  const selectedTableForQR = selectedTableIdForQR
    ? tablesList.find(
        (t) => t.id === selectedTableIdForQR || t.number === selectedTableIdForQR
      )
    : null

  const handleOpenQRModal = (table) => {
    setSelectedTableIdForQR(table.id || table.number)
  }

  const handleOpenTableAction = async (idMesa) => {
    if (abrirMesa) {
      return await abrirMesa(idMesa)
    }
    setLocalTables((prev) =>
      prev.map((t) =>
        t.id === idMesa || t.number === idMesa
          ? { ...t, status: 'Ocupada', active: true, detail: 'Sesión activa' }
          : t
      )
    )
  }

  const handleFreeTableAction = async (idMesa) => {
    if (liberarMesa) {
      return await liberarMesa(idMesa)
    }
    setLocalTables((prev) =>
      prev.map((t) =>
        t.id === idMesa || t.number === idMesa
          ? {
              ...t,
              status: 'Disponible',
              token_qr: null,
              active: false,
              detail: 'Lista para asignar',
            }
          : t
      )
    )
  }

  const handleUpdateTokenAction = async (idMesa) => {
    if (regenerarQr) {
      return await regenerarQr(idMesa)
    }
  }

  // Zonas únicas disponibles
  const zones = useMemo(() => {
    const list = Array.from(new Set(tablesList.map((t) => t.location || 'Principal')))
    return ['Todas', ...list]
  }, [tablesList])

  // Filtrado compuesto
  const filteredTables = useMemo(() => {
    return tablesList.filter((table) => {
      const status = (table.status || '').toLowerCase()
      const location = table.location || 'Principal'
      const query = searchQuery.trim().toLowerCase()

      // Filtro de estado
      if (statusFilter === 'Disponibles' && status !== 'disponible') return false
      if (statusFilter === 'Ocupadas' && status !== 'ocupada') return false
      if (statusFilter === 'Reservadas' && status !== 'reservada') return false

      // Filtro de zona
      if (zoneFilter !== 'Todas' && location !== zoneFilter) return false

      // Filtro de búsqueda
      if (query) {
        const matchesName = (table.name || '').toLowerCase().includes(query)
        const matchesNumber = String(table.number || table.id).includes(query)
        const matchesLocation = location.toLowerCase().includes(query)
        if (!matchesName && !matchesNumber && !matchesLocation) return false
      }

      return true
    })
  }, [tablesList, statusFilter, zoneFilter, searchQuery])

  // Métricas rápidas de ocupación de sala
  const totalMesas = tablesList.length
  const totalOcupadas = tablesList.filter((t) => (t.status || '').toLowerCase() === 'ocupada').length
  const totalDisponibles = tablesList.filter(
    (t) => (t.status || '').toLowerCase() === 'disponible'
  ).length
  const porcentajeOcupacion = totalMesas > 0 ? Math.round((totalOcupadas / totalMesas) * 100) : 0

  return (
    <div className="panel tables-dashboard-panel">
      {/* Toast de notificación rápida */}
      {notification && (
        <div className={`table-toast-banner ${notification.tipo || 'info'}`}>
          {notification.tipo === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald" />
          ) : (
            <AlertCircle size={16} />
          )}
          <span>{notification.mensaje}</span>
        </div>
      )}

      {/* Cabecera Interactiva con Medidor de Ocupación */}
      <div className="panel-header-interactive">
        <div>
          <div className="panel-title-row">
            <LayoutGrid size={22} className="text-emerald" />
            <h2>Plano de Sala & Mesas</h2>
          </div>
          <span className="panel-subtitle">
            Monitoreo en vivo de comensales y códigos QR por sesión
          </span>
        </div>

        {/* Medidor de Ocupación en Vivo */}
        <div className="occupancy-meter-widget">
          <div className="meter-label-row">
            <span className="meter-title">
              <Flame size={14} className="text-amber inline-icon" /> Ocupación:
            </span>
            <strong className="meter-percent">{porcentajeOcupacion}%</strong>
            <span className="meter-count">
              ({totalOcupadas}/{totalMesas} mesas)
            </span>
          </div>
          <div className="meter-track">
            <div
              className={`meter-bar-fill ${
                porcentajeOcupacion > 75
                  ? 'fill-high'
                  : porcentajeOcupacion > 40
                  ? 'fill-medium'
                  : 'fill-normal'
              }`}
              style={{ width: `${Math.max(porcentajeOcupacion, 5)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="tables-filter-toolbar">
        {/* Chips de Estado */}
        <div className="filter-chips-group">
          <button
            type="button"
            className={`filter-tab-pill ${statusFilter === 'Todas' ? 'active' : ''}`}
            onClick={() => setStatusFilter('Todas')}
          >
            Todas <span>{totalMesas}</span>
          </button>
          <button
            type="button"
            className={`filter-tab-pill chip-disponibles ${
              statusFilter === 'Disponibles' ? 'active' : ''
            }`}
            onClick={() => setStatusFilter('Disponibles')}
          >
            Disponibles <span>{totalDisponibles}</span>
          </button>
          <button
            type="button"
            className={`filter-tab-pill chip-ocupadas ${
              statusFilter === 'Ocupadas' ? 'active' : ''
            }`}
            onClick={() => setStatusFilter('Ocupadas')}
          >
            Ocupadas <span>{totalOcupadas}</span>
          </button>
        </div>

        {/* Selector de Zona y Buscador Rápido */}
        <div className="toolbar-secondary-group">
          <div className="zone-select-wrap">
            <SlidersHorizontal size={13} className="zone-icon" />
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="zone-select-dropdown"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z === 'Todas' ? '📍 Todas las Zonas' : `Zona: ${z}`}
                </option>
              ))}
            </select>
          </div>

          <div className="table-search-input-wrap">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Buscar mesa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="table-search-field"
            />
          </div>
        </div>
      </div>

      {/* Grid de Mesas */}
      {filteredTables.length > 0 ? (
        <div className="tables-grid">
          {filteredTables.map((table) => (
            <TableCard
              key={table.id || table.number || table.name}
              table={table}
              active={selectedTableId ? selectedTableId === table.id : table.active}
              onClick={onSelectTable ? () => onSelectTable(table) : undefined}
              onOpenQR={handleOpenQRModal}
              onFreeTable={handleFreeTableAction}
            />
          ))}
        </div>
      ) : (
        <div className="tables-empty-state">
          <p>No se encontraron mesas que coincidan con los filtros seleccionados.</p>
          <button
            type="button"
            className="ghost-button small"
            onClick={() => {
              setStatusFilter('Todas')
              setZoneFilter('Todas')
              setSearchQuery('')
            }}
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Modal QR Dinámico */}
      {selectedTableForQR && (
        <QRModal
          key={selectedTableForQR.id || selectedTableForQR.number}
          table={selectedTableForQR}
          onClose={() => setSelectedTableIdForQR(null)}
          onOpenTable={handleOpenTableAction}
          onFreeTable={handleFreeTableAction}
          onUpdateToken={handleUpdateTokenAction}
        />
      )}
    </div>
  )
}
