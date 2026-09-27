import { useState } from 'react'
import { TableCard } from './TableCard'
import { FilterChip } from './ui/FilterChip'
import { QRModal } from './QRModal'

export function TablesPanel({ tables: initialTables = [], onSelectTable, selectedTableId }) {
  const [tablesList, setTablesList] = useState(initialTables)
  const [activeFilter, setActiveFilter] = useState('Todas')
  const [selectedTableForQR, setSelectedTableForQR] = useState(null)

  const handleUpdateToken = (tableId, newToken) => {
    setTablesList((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, token_qr: newToken } : t))
    )
  }

  const filteredTables = tablesList.filter((table) => {
    if (activeFilter === 'Todas') return true
    if (activeFilter === 'Disponibles') return table.status.toLowerCase() === 'disponible'
    if (activeFilter === 'Ocupadas') return table.status.toLowerCase() === 'ocupada'
    if (activeFilter === 'Reservadas') return table.status.toLowerCase() === 'reservada'
    return true
  })

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Mesas del Salón</h2>
          <span className="panel-subtitle">Monitoreo en vivo y acceso mediante QR dinámico</span>
        </div>
        <div className="table-filters">
          <FilterChip
            label="Todas"
            active={activeFilter === 'Todas'}
            onClick={() => setActiveFilter('Todas')}
          />
          <FilterChip
            label="Disponibles"
            active={activeFilter === 'Disponibles'}
            onClick={() => setActiveFilter('Disponibles')}
          />
          <FilterChip
            label="Ocupadas"
            active={activeFilter === 'Ocupadas'}
            onClick={() => setActiveFilter('Ocupadas')}
          />
        </div>
      </div>

      <div className="tables-grid">
        {filteredTables.map((table) => (
          <TableCard
            key={table.id || table.name}
            table={table}
            active={selectedTableId ? selectedTableId === table.id : table.active}
            onClick={onSelectTable ? () => onSelectTable(table) : undefined}
            onOpenQR={(tbl) => setSelectedTableForQR(tbl)}
          />
        ))}
      </div>

      {selectedTableForQR && (
        <QRModal
          table={selectedTableForQR}
          onClose={() => setSelectedTableForQR(null)}
          onUpdateToken={handleUpdateToken}
        />
      )}
    </div>
  )
}
