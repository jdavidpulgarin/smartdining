import './App.css'
import { Topbar } from './components/Topbar'
import { Sidebar } from './components/Sidebar'
import { StatsSection } from './components/StatsSection'
import { TablesPanel } from './components/TablesPanel'
import { OrderPanel } from './components/OrderPanel'
import { MenuSection } from './components/MenuSection'
import { stats, tables, orders, menu } from './constants/mockData'

const selectedOrder = orders[0]

function App() {
  return (
    <div className="app-shell">
      <Topbar />
      <Sidebar />

      <main className="main-panel">
        <StatsSection stats={stats} />

        <section className="content-grid">
          <TablesPanel tables={tables} />
          <OrderPanel order={selectedOrder} />
        </section>

        <MenuSection menu={menu} />
      </main>
    </div>
  )
}

export default App
