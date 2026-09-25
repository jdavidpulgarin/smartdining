import './App.css'

const stats = [
  { label: 'Mesas ocupadas', value: '14', detail: '+2 hoy' },
  { label: 'Ingresos', value: '$2.480', detail: '+12.4%' },
  { label: 'Pedidos activos', value: '23', detail: '8 en cocina' },
  { label: 'Clientes', value: '126', detail: '96 atendidos' },
]

const tables = [
  { name: 'Mesa 1', status: 'Disponible', seats: 4 },
  { name: 'Mesa 2', status: 'Ocupada', seats: 2, active: true },
  { name: 'Mesa 3', status: 'Reservada', seats: 6 },
  { name: 'Mesa 4', status: 'Ocupada', seats: 4, active: true },
  { name: 'Mesa 5', status: 'Disponible', seats: 2 },
  { name: 'Mesa 6', status: 'Ocupada', seats: 3, active: true },
]

const orders = [
  { id: '#1042', client: 'Ana López', time: '12:35', total: '$84.50', state: 'En cocina' },
  { id: '#1043', client: 'Javier Ruiz', time: '12:42', total: '$58.00', state: 'Por servir' },
  { id: '#1044', client: 'Familia Díaz', time: '12:50', total: '$132.00', state: 'Preparando' },
]

const menu = [
  { name: 'Lomo saltado', price: '$24.00', tag: 'Popular' },
  { name: 'Ceviche mixto', price: '$26.50', tag: 'Fresco' },
  { name: 'Jugo de maracuyá', price: '$8.00', tag: 'Bebida' },
  { name: 'Tiramisu', price: '$12.00', tag: 'Postre' },
]

function App() {
  return (
    <div className="app-shell">
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

      <main className="main-panel">
        <section className="stats-grid">
          {stats.map((item) => (
            <article key={item.label} className="stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h2>Mesas</h2>
              <button className="link-button">Ver todas</button>
            </div>

            <div className="tables-grid">
              {tables.map((table) => (
                <div key={table.name} className={`table-card ${table.active ? 'active' : ''}`}>
                  <div className="table-top">
                    <strong>{table.name}</strong>
                    <span className={`status ${table.status.toLowerCase().replace(' ', '-')}`}>
                      {table.status}
                    </span>
                  </div>
                  <p>{table.seats} personas</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Pedidos</h2>
              <button className="link-button">Actualizar</button>
            </div>

            <div className="orders-list">
              {orders.map((order) => (
                <div key={order.id} className="order-item">
                  <div>
                    <strong>{order.client}</strong>
                    <span>{order.id}</span>
                  </div>
                  <div className="order-meta">
                    <small>{order.time}</small>
                    <small>{order.total}</small>
                  </div>
                  <span className="order-state">{order.state}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel bottom-panel">
          <div className="panel-header">
            <h2>Menú del día</h2>
            <button className="link-button">Agregar</button>
          </div>

          <div className="menu-list">
            {menu.map((item) => (
              <div key={item.name} className="menu-item">
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.tag}</span>
                </div>
                <b>{item.price}</b>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
