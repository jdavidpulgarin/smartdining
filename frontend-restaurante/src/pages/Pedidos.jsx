import { OrderPanel } from '../components'
import { orders } from '../constants/mockData'

const selectedOrder = orders[0]

export function Pedidos() {
  return (
    <main className="main-panel">
      <OrderPanel order={selectedOrder} />
    </main>
  )
}
