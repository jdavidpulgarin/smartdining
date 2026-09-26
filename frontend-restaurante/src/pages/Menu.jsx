import { MenuSection } from '../components'
import { menu } from '../constants/mockData'

export function Menu() {
  return (
    <main className="main-panel">
      <MenuSection menu={menu} />
    </main>
  )
}
