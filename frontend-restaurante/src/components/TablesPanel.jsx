import { TableCard } from './TableCard'

export function TablesPanel({ tables }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Mesas</h2>
        <div className="table-filters">
          <button className="filter-chip active">Todas</button>
          <button className="filter-chip">Disponibles</button>
          <button className="filter-chip">Ocupadas</button>
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
