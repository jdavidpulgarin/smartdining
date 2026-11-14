import { useState } from 'react'
import { Utensils } from 'lucide-react'

export function MenuItem({ name, tag, price, imageUrl }) {
  const isArepa = name?.toLowerCase().includes('arepa rellena')
  const imgSource = imageUrl || (isArepa ? '/img/arepa-rellena.png' : null)
  // Si la imagen no carga (borrada, sin red), se pinta el ícono en vez de la
  // imagen rota. Se recuerda para qué URL falló: si cambia, se vuelve a probar.
  const [fallo, setFallo] = useState(null)
  const mostrarImagen = imgSource && fallo !== imgSource

  return (
    <div className="menu-highlight-card">
      <div className="menu-item-icon-wrap">
        {mostrarImagen ? (
          <img
            src={imgSource}
            alt={name}
            className="menu-item-icon-img"
            onError={() => setFallo(imgSource)}
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
