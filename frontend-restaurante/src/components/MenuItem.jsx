import { Utensils } from 'lucide-react'

export function MenuItem({ name, tag, price, imageUrl }) {
  const isArepa = name?.toLowerCase().includes('arepa rellena')
  const imgSource = imageUrl || (isArepa ? '/img/arepa-rellena.png' : null)

  return (
    <div className="menu-highlight-card">
      <div className="menu-item-icon-wrap">
        {imgSource ? (
          <img
            src={imgSource}
            alt={name}
            className="menu-item-icon-img"
          />
        ) : (
          <Utensils size={16} />
        )}
      </div>
      <div className="menu-item-info">
        <div className="menu-item-header">
          <strong className="menu-item-title">{name}</strong>
          {tag && <span className="menu-item-tag">{tag}</span>}
        </div>
      </div>
      <b className="menu-item-price">{price}</b>
    </div>
  )
}
