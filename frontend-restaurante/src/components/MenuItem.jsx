import { Utensils } from 'lucide-react'

export function MenuItem({ name, tag, price }) {
  return (
    <div className="menu-highlight-card">
      <div className="menu-item-icon-wrap">
        <Utensils size={16} />
      </div>
      <div className="menu-item-info">
        <div className="menu-item-header">
          <strong className="menu-item-title">{name}</strong>
          {tag && <span className="menu-item-tag">{tag}</span>}
        </div>
      </div>
      <b className="menu-item-price font-mono">{price}</b>
    </div>
  )
}
