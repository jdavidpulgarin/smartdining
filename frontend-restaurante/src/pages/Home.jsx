import { useState, useEffect } from 'react'
import {
  StatsSection,
  TablesPanel,
  OrderPanel,
  MenuSection,
} from '../components'
import { menuApi } from '../services/api'
import { useTables } from '../hooks'

export function Home() {
  const { tables, pedidosActivos, marcarEntregado, cargarMesas, cargarPedidosActivos } = useTables()
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [menuItems, setMenuItems] = useState([])

  useEffect(() => {
    if (cargarMesas) cargarMesas()
    if (cargarPedidosActivos) cargarPedidosActivos()
  }, [cargarMesas, cargarPedidosActivos])

  useEffect(() => {
    let isMounted = true
    menuApi
      .obtenerMenu()
      .then((data) => {
        if (!isMounted) return
        const cats = data?.categorias || []
        const platos = cats.flatMap((cat) =>
          (cat.platos || []).map((p) => {
            const isArepa = p.nombre?.toLowerCase().includes('arepa rellena')
            return {
              name: p.nombre,
              price: `$${Number(p.precio || 0).toLocaleString('es-CO')}`,
              tag: cat.nombre || 'Menú',
              imageUrl: isArepa ? '/img/arepa-rellena.png' : p.url_imagen,
            }
          })
        )
        setMenuItems(platos.slice(0, 4))
      })
      .catch(() => {
        if (isMounted) setMenuItems([])
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Derivar estadísticas de mesas y pedidos activos en tiempo real
  const totalMesas = tables?.length || 0
  const mesasOcupadas =
    tables?.filter((t) => t.status === 'Ocupada' || t.estado === 'ocupada').length || 0
  const pedidosEnCocina =
    pedidosActivos?.filter((p) => p.estado === 'recibido' || p.estado === 'en_preparacion')
      .length || 0
  const totalTurno =
    pedidosActivos?.reduce((acc, p) => acc + Number(p.total || 0), 0) || 0

  const stats = [
    {
      label: 'Mesas Ocupadas',
      value: `${mesasOcupadas}/${totalMesas}`,
      detail:
        totalMesas > 0
          ? `${Math.round((mesasOcupadas / totalMesas) * 100)}% de ocupación`
          : '0%',
    },
    {
      label: 'Comandas en Cocina',
      value: `${pedidosEnCocina}`,
      detail: 'En preparación o recibidas',
    },
    {
      label: 'Pedidos Activos',
      value: `${pedidosActivos?.length || 0}`,
      detail: 'En curso en sala',
    },
    {
      label: 'Total Acumulado Turno',
      value: `$${totalTurno.toLocaleString('es-CO')}`,
      detail: 'Suma de comandas vivas',
    },
  ]

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
          ? new Date(liveOrder.creado_en).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
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

      <MenuSection menu={menuItems} />
    </main>
  )
}
