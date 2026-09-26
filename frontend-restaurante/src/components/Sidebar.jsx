export function Sidebar() {
  return (
    <aside className="sidebar">
      <nav className="nav-menu">
        <button className="nav-item active">Inicio</button>
        <button className="nav-item">Mesas</button>
        <button className="nav-item">Pedidos</button>
        <button className="nav-item">Menú</button>
        <button className="nav-item">Caja</button>
        <button className="nav-item">Reportes</button>
      </nav>

      <div className="sidebar-card">
        <span className="card-label">Turno actual</span>
        <strong>12:00 - 15:00</strong>
        <p>6 empleados activos</p>
      </div>
    </aside>
  )
}
