import { useState } from 'react'
import { OrderPanel } from '../components'
import { orders } from '../constants/mockData'
import { useSocketListener } from '../hooks'

export function Pedidos() {
  const [activeOrder, setActiveOrder] = useState(orders[0])

  useSocketListener('order:status', (data) => {
    console.log('📦 Estado de pedido actualizado:', data)
    if (data.id_pedido === activeOrder.id) {
      setActiveOrder((prev) => ({
        ...prev,
        state: data.estado,
      }))
    }
  })

  return (
    <main className="main-panel">
      <OrderPanel order={activeOrder} />
    </main>
  )
}
