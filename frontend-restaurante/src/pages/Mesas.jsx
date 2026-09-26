import { TablesPanel } from '../components'
import { tables } from '../constants/mockData'

export function Mesas() {
  return (
    <main className="main-panel">
      <TablesPanel tables={tables} />
    </main>
  )
}
