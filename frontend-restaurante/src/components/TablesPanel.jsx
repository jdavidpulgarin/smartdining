import { useState } from 'react'
import { TableCard } from './TableCard'
import { FilterChip } from './ui/FilterChip'
import { QRModal } from './QRModal'
import { useTables } from '../hooks'
import { CheckCircle2, AlertCircle } from 'lucide-react'

export function TablesPanel({ tables: propTables, onSelectTable, selectedTableId }) {
  // Conectar con el contexto centralizado de mesas si está disponible
  const tablesContext = useTables()
  const contextTables = tablesContext?.tables
  const abrirMesa = tablesContext?.abrirMesa
  const liberarMesa = tablesContext?.liberarMesa
  const regenerarQr = tablesContext?.regenerarQr
  const notification = tablesContext?.notification

  const [localTables, setLocalTables] = useState(propTables || [])
  const tablesList = contextTables || propTables || localTables

  const [activeFilter, setActiveFilter] = useState('Todas')
  const [selectedTableIdForQR, setSelectedTableIdForQR] = useState(null)

  // Encontrar la mesa activa para el modal directamente de la lista reactiva
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
    // Fallback local
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
    // Fallback local
    setLocalTables((prev) =>
      prev.map((t) =>
        t.id === idMesa || t.number === idMesa
          ? { ...t, status: 'Disponible', token_qr: null, active: false, detail: 'Lista para asignar' }
          : t
      )
    )
  }

  const handleUpdateTokenAction = async (idMesa) => {
    if (regenerarQr) {
      return await regenerarQr(idMesa)
    }
  }

  const filteredTables = tablesList.filter((table) => {
    const status = (table.status || '').toLowerCase()
    if (activeFilter === 'Todas') return true
    if (activeFilter === 'Disponibles') return status === 'disponible'
    if (activeFilter === 'Ocupadas') return status === 'ocupada'
    if (activeFilter === 'Reservadas') return status === 'reservada'
    return true
  })

  // Conteo rápido para los chips
  const totalDisponibles = tablesList.filter((t) => (t.status || '').toLowerCase() === 'disponible').length
  const totalOcupadas = tablesList.filter((t) => (t.status || '').toLowerCase() === 'ocupada').length

  return (
    <div className="panel">
      {/* Toast de notificación rápida */}
      {notification && (
        <div className={`table-toast-banner ${notification.tipo || 'info'}`}>
          {notification.tipo === 'success' ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          <span>{notification.mensaje}</span>
        </div>
      )}

      <div className="panel-header">
        <div>
          <h2>Mesas del Salón</h2>
          <span className="panel-subtitle">
            Apertura y liberación de mesas con QR dinámico por sesión
          </span>
        </div>
        <div className="table-filters">
          <FilterChip
            label={`Todas (${tablesList.length})`}
            active={activeFilter === 'Todas'}
            onClick={() => setActiveFilter('Todas')}
          />
          <FilterChip
            label={`Disponibles (${totalDisponibles})`}
            active={activeFilter === 'Disponibles'}
            onClick={() => setActiveFilter('Disponibles')}
          />
          <FilterChip
            label={`Ocupadas (${totalOcupadas})`}
            active={activeFilter === 'Ocupadas'}
            onClick={() => setActiveFilter('Ocupadas')}
          />
        </div>
      </div>

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
