import {
  StatsSection,
  TablesPanel,
  OrderPanel,
  MenuSection,
} from '../components'
import { stats, tables, orders, menu } from '../constants/mockData'

const selectedOrder = orders[0]

export function Home() {
  return (
    <main className="main-panel">
      <StatsSection stats={stats} />

      <section className="content-grid">
        <TablesPanel tables={tables} />
        <OrderPanel order={selectedOrder} />
      </section>

      <MenuSection menu={menu} />
    </main>
  )
}
