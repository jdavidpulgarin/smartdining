import { TablesPanel } from '../components'
import { useTables } from '../hooks'

export function Mesas() {
  const { tables } = useTables()

  return (
    <div className="sd-page-wrapper">
      <TablesPanel tables={tables} />
    </div>
  )
}

