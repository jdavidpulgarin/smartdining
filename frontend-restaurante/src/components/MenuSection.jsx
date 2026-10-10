import { Link } from 'react-router-dom'
import { ArrowRight, UtensilsCrossed } from 'lucide-react'
import { MenuItem } from './MenuItem'

export function MenuSection({ menu = [] }) {
  return (
    <section className="panel bottom-panel">
      <div className="panel-header">
        <div className="panel-title-with-badge">
          <UtensilsCrossed size={18} className="text-emerald" />
          <h2>Destacados del Menú de Hoy</h2>
          <span className="live-pulse-badge">Carta Activa</span>
        </div>
        <Link to="/menu" className="link-button inline-flex-center">
          <span>Gestionar Catálogo</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="menu-cards-grid">
        {menu.map((item, index) => (
          <MenuItem
            key={`${item.name}-${index}`}
            name={item.name}
            tag={item.tag}
            price={item.price}
          />
        ))}
      </div>
    </section>
  )
}
