import { TableCard } from './TableCard'
import { FilterChip } from './ui/FilterChip'

export function TablesPanel({ tables }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Mesas</h2>
        <div className="table-filters">
          <FilterChip label="Todas" active />
          <FilterChip label="Disponibles" />
          <FilterChip label="Ocupadas" />
        </div>
      </div>

      <div className="tables-grid">
        {tables.map((table) => (
          <TableCard
            key={table.name}
            name={table.name}
            status={table.status}
            seats={table.seats}
            detail={table.detail}
            active={table.active}
          />
        ))}
      </div>
    </div>
  )
}
