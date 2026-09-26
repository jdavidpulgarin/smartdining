import { MenuItem } from './MenuItem'
import { LinkButton } from './ui/Button'

export function MenuSection({ menu }) {
  return (
    <section className="panel bottom-panel">
      <div className="panel-header">
        <h2>Menú del día</h2>
        <LinkButton>Agregar</LinkButton>
      </div>

      <div className="menu-list">
        {menu.map((item) => (
          <MenuItem
            key={item.name}
            name={item.name}
            tag={item.tag}
            price={item.price}
          />
        ))}
      </div>
    </section>
  )
}
