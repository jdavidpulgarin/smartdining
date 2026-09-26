export function Topbar() {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">S</div>
        <div>
          <p className="brand-name">SmartDining</p>
          <span>Restaurante</span>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="ghost-button">Hoy</button>
        <button className="primary-button">+ Nuevo pedido</button>
        <div className="avatar">JP</div>
      </div>
    </header>
  )
}
