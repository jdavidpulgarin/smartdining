import { useState } from 'react'
import {
  StatsSection,
  TablesPanel,
  OrderPanel,
  MenuSection,
} from '../components'
import { stats, menu } from '../constants/mockData'
import { useTables } from '../hooks'

export function Home() {
  const { tables, pedidosActivos, marcarEntregado } = useTables()
  const [selectedOrder, setSelectedOrder] = useState(null)


  const handleSelectTable = (table) => {
    const tableId = Number(table.id || table.number)
    const tableName = table.name || `Mesa ${tableId}`

    const liveOrder = pedidosActivos?.find((p) => Number(p.id_mesa) === tableId)

    if (liveOrder) {
      setSelectedOrder({
        id: liveOrder.codigo_pedido || `#${liveOrder.id_pedido}`,
        id_pedido: liveOrder.id_pedido,
        tableId: tableId,
        table: tableName,
        client: liveOrder.detalles?.[0]?.comensal || 'Comensales en mesa',
        time: liveOrder.creado_en
          ? new Date(liveOrder.creado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'En vivo',
        total: `$${Number(liveOrder.total || 0).toLocaleString('es-CO')}`,
        state: liveOrder.estado || 'recibido',
        items: (liveOrder.detalles || []).map((d) => ({
          name: d.plato_nombre || d.nombre || 'Plato',
          qty: d.cantidad || 1,
          subtotal: `$${Number(d.subtotal || 0).toLocaleString('es-CO')}`,
          notes: d.notas_especiales || null,
        })),
      })
    } else {
      setSelectedOrder({
        id: `#MESA-${tableId}`,
        tableId: tableId,
        table: tableName,
        client: table.status === 'Ocupada' ? 'Grupo en estadía' : 'Sin comanda',
        time: 'En vivo',
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

        <OrderPanel order={selectedOrder} onDeliver={marcarEntregado} />
      </section>

      <MenuSection menu={menu} />
    </main>
  )
}
