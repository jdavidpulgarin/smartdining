import { useState } from 'react'
import {
  StatsSection,
  TablesPanel,
  OrderPanel,
  MenuSection,
} from '../components'
import { stats, tables, orders, menu } from '../constants/mockData'

export function Home() {
  const [selectedOrder, setSelectedOrder] = useState(orders[0])

  const handleSelectTable = (table) => {
    const tableId = table.id || table.number
    const tableName = table.name || `Mesa ${tableId}`
    const foundOrder = orders.find(
      (o) =>
        o.table.toLowerCase() === tableName.toLowerCase() ||
        o.tableId === tableId
    )

    if (foundOrder) {
      setSelectedOrder(foundOrder)
    } else {
      // Si la mesa no tiene comanda activa en mockData, mostramos una comanda sintética o null
      setSelectedOrder({
        id: `#10${tableId || 99}`,
        tableId: tableId,
        table: tableName,
        client: 'Mesa Ocupada',
        time: 'Reciente',
        total: '$0.00',
        state: table.status || 'Disponible',
        items: [],
      })
    }
  }

  return (
    <main className="main-panel">
      <StatsSection stats={stats} />

      <section className="content-grid">
        <TablesPanel tables={tables} onSelectTable={handleSelectTable} />
        <OrderPanel order={selectedOrder} />
      </section>

      <MenuSection menu={menu} />
    </main>
  )
}
