import { MenuItem } from './MenuItem'

export function MenuSection({ menu }) {
  return (
    <section className="panel bottom-panel">
      <div className="panel-header">
        <h2>Menú del día</h2>
        <button className="link-button">Agregar</button>
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
