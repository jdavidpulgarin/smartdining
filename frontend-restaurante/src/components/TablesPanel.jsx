import { useState, useMemo } from 'react'
import { TableCard } from './TableCard'
import { QRModal } from './QRModal'
import { TableDetailModal } from './TableDetailModal'
import { BandejaAlertas } from './BandejaAlertas'
import { useTables } from '../hooks'
import {
  CheckCircle2,
  AlertCircle,
  Search,
} from 'lucide-react'

export function TablesPanel({ tables: propTables, onSelectTable, selectedTableId }) {
  const tablesContext = useTables()
  const contextTables = tablesContext?.tables
  const pedidosActivos = tablesContext?.pedidosActivos || []
  const rawAlertas = tablesContext?.alertas
  const alertas = rawAlertas || []
  const marcarEntregado = tablesContext?.marcarEntregado
  const abrirMesa = tablesContext?.abrirMesa
  const liberarMesa = tablesContext?.liberarMesa
  const regenerarQr = tablesContext?.regenerarQr
  const notification = tablesContext?.notification

  const [localTables, setLocalTables] = useState(propTables || [])
  const tablesList = (contextTables && contextTables.length > 0) ? contextTables : (propTables || localTables)

  const [filter, setFilter] = useState('TODAS')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTableIdForQR, setSelectedTableIdForQR] = useState(null)
  const [selectedTableForDetail, setSelectedTableForDetail] = useState(null)

  // Encontrar la mesa activa para el modal QR
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

  // Identificar mesas con alerta
  const mesasConAlertaIds = useMemo(() => {
    const ids = new Set()
    ;(rawAlertas || []).forEach((a) => {
      if (!a.atendida) {
        const id = Number(a.idMesa || a.mesa)
        if (id) ids.add(id)
      }
    })
    return ids
  }, [rawAlertas])

  // Contadores
  const totalOcupadas = tablesList.filter(
    (t) => (t.status || t.estado || '').toLowerCase() === 'ocupada' || t.active
  ).length

  const totalDisponibles = tablesList.filter(
    (t) => (t.status || t.estado || '').toLowerCase() === 'disponible' && !t.active
  ).length

  const totalConAlerta = mesasConAlertaIds.size

  // Filtrado compuesto
  const filteredTables = useMemo(() => {
    return tablesList.filter((table) => {
      const id = Number(table.id || table.number)
      const st = (table.status || table.estado || '').toLowerCase()
      const isOcupada = st === 'ocupada' || table.active
      const isDisponible = (st === 'disponible' || st === 'libre') && !table.active
      const hasAlerta = mesasConAlertaIds.has(id)
      const query = searchQuery.trim().toLowerCase()

      // Filtro de pestañas
      if (filter === 'DISPONIBLES' && !isDisponible) return false
      if (filter === 'OCUPADAS' && !isOcupada) return false
      if (filter === 'CON ALERTA' && !hasAlerta) return false

      // Búsqueda
      if (query) {
        const matchesName = (table.name || '').toLowerCase().includes(query)
        const matchesNumber = String(table.number || table.id).includes(query)
        const matchesLocation = (table.location || table.ubicacion || '').toLowerCase().includes(query)
        if (!matchesName && !matchesNumber && !matchesLocation) return false
      }

      return true
    })
  }, [tablesList, filter, mesasConAlertaIds, searchQuery])

  return (
    <div className="sd-mesas-page-wrap">
      {/* Franja roja con los filtros */}
      <div className="sd-red-band">
        <div className="sd-red-band-content">
          <div className="sd-red-band-filters">
            <button
              type="button"
              className={`sd-red-band-btn ${filter === 'TODAS' ? 'active' : ''}`}
              onClick={() => setFilter('TODAS')}
            >
              TODAS <span>{tablesList.length}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${filter === 'DISPONIBLES' ? 'active' : ''}`}
              onClick={() => setFilter('DISPONIBLES')}
            >
              DISPONIBLES <span>{totalDisponibles}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${filter === 'OCUPADAS' ? 'active' : ''}`}
              onClick={() => setFilter('OCUPADAS')}
            >
              OCUPADAS <span>{totalOcupadas}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${filter === 'CON ALERTA' ? 'active' : ''}`}
              onClick={() => setFilter('CON ALERTA')}
            >
              CON ALERTA <span>{totalConAlerta}</span>
            </button>
          </div>

          <div className="sd-band-search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Buscar mesa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sd-band-search-input"
            />
          </div>
        </div>
      </div>

      <div className="sd-page-container sd-mesas-container">
        {/* Toast de notificación rápida */}
        {notification && (
          <div className={`table-toast-banner ${notification.tipo || 'info'}`} style={{ marginBottom: 20 }}>
            {notification.tipo === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald" />
            ) : (
              <AlertCircle size={16} />
            )}
            <span>{notification.mensaje}</span>
          </div>
        )}

        {/* Encabezado con título editorial y contadores */}
        <header className="sd-mesas-header">
          <h1 className="sd-page-title">
            MESAS<br />
            EN VIVO
          </h1>
          <div className="sd-tables-counters">
            <span>{totalOcupadas} OCUPADAS</span>
            <span className="sd-counter-sep">·</span>
            <span>{totalDisponibles} DISPONIBLES</span>
            <span className="sd-counter-sep">·</span>
            <span className="sd-counter-alert">{totalConAlerta} CON ALERTA</span>
          </div>
        </header>

        {/* Layout 2 columnas: Grilla de mesas + Tarjeta ALERTAS */}
        <div className="sd-mesas-layout">
          <main className="sd-mesas-col-main">
            {filteredTables.length > 0 ? (
              <div className="sd-tables-grid">
                {filteredTables.map((table) => (
                  <TableCard
                    key={table.id || table.number || table.name}
                    table={table}
                    active={selectedTableId ? selectedTableId === table.id : table.active}
                    onClick={() => {
                      if (onSelectTable) onSelectTable(table)
                      setSelectedTableForDetail(table)
                    }}
                    onOpenQR={handleOpenQRModal}
                    onFreeTable={handleFreeTableAction}
                  />
                ))}
              </div>
            ) : (
              <div className="sd-card sd-empty-box">
                <p>No se encontraron mesas que coincidan con los filtros seleccionados ({filter}).</p>
                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={() => {
                    setFilter('TODAS')
                    setSearchQuery('')
                  }}
                >
                  VER TODAS LAS MESAS
                </button>
              </div>
            )}
          </main>

          <div className="sd-mesas-col-side">
            <BandejaAlertas
              alertas={alertas}
              onAtender={tablesContext?.atenderAlerta}
              onLimpiarTodas={tablesContext?.limpiarAlertas}
            />
          </div>
        </div>
      </div>

      {/* Modal Detalle Completo de Mesa con Comensales y Saldo */}
      {selectedTableForDetail && (
        <TableDetailModal
          key={`detail-${selectedTableForDetail.id || selectedTableForDetail.number}`}
          table={selectedTableForDetail}
          pedidos={pedidosActivos}
          onClose={() => setSelectedTableForDetail(null)}
          onOpenQR={handleOpenQRModal}
          onFreeTable={handleFreeTableAction}
          onDeliverOrder={marcarEntregado}
        />
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

