import { TablesPanel } from '../components'
import { useTables } from '../hooks'

export function Mesas() {
  const { tables } = useTables()

  return (
    <main className="main-panel">
      <TablesPanel tables={tables} />
    </main>
  )
}

