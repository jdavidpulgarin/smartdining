import './App.css'
import { StatCard } from './components/StatCard'
import { TableCard } from './components/TableCard'
import { OrderPanel } from './components/OrderPanel'
import { MenuItem } from './components/MenuItem'

const stats = [
  { label: 'Mesas ocupadas', value: '14', detail: '+2 hoy' },
  { label: 'Ingresos', value: '$2.480', detail: '+12.4%' },
  { label: 'Pedidos activos', value: '23', detail: '8 en cocina' },
  { label: 'Clientes', value: '126', detail: '96 atendidos' },
]

const tables = [
  { name: 'Mesa 1', status: 'Disponible', seats: 4, detail: 'Lista para asignar' },
  { name: 'Mesa 2', status: 'Ocupada', seats: 2, active: true, detail: '2 personas · Pedido #1042' },
  { name: 'Mesa 3', status: 'Reservada', seats: 6, detail: 'Reserva 13:30' },
  { name: 'Mesa 4', status: 'Ocupada', seats: 4, active: true, detail: '4 personas · Cuenta abierta' },
  { name: 'Mesa 5', status: 'Disponible', seats: 2, detail: 'Pendiente limpieza' },
  { name: 'Mesa 6', status: 'Ocupada', seats: 3, active: true, detail: '3 personas · Pedido #1044' },
]

const orders = [
  {
    id: '#1042',
    client: 'Ana López',
    table: 'Mesa 2',
    time: '12:35',
    total: '$84.50',
    state: 'En cocina',
    items: [
      { name: 'Lomo saltado', qty: 1, subtotal: '$24.00' },
      { name: 'Inca Kola', qty: 2, subtotal: '$16.00' },
      { name: 'Tiramisú', qty: 1, subtotal: '$12.00' },
    ],
  },
  {
    id: '#1043',
    client: 'Javier Ruiz',
    table: 'Mesa 5',
    time: '12:42',
    total: '$58.00',
    state: 'Por servir',
    items: [
      { name: 'Ceviche mixto', qty: 1, subtotal: '$26.50' },
      { name: 'Agua mineral', qty: 1, subtotal: '$4.00' },
      { name: 'Helado', qty: 1, subtotal: '$9.50' },
    ],
  },
  {
    id: '#1044',
    client: 'Familia Díaz',
    table: 'Mesa 6',
    time: '12:50',
    total: '$132.00',
    state: 'Preparando',
    items: [
      { name: 'Arroz con pollo', qty: 2, subtotal: '$52.00' },
      { name: 'Ensalada', qty: 1, subtotal: '$14.00' },
      { name: 'Jugo de maracuyá', qty: 2, subtotal: '$16.00' },
    ],
  },
]

const selectedOrder = orders[0]

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
            <StatCard
              key={item.label}
              label={item.label}
              value={item.value}
              detail={item.detail}
            />
          ))}
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h2>Mesas</h2>
              <div className="table-filters">
                <button className="filter-chip active">Todas</button>
                <button className="filter-chip">Disponibles</button>
                <button className="filter-chip">Ocupadas</button>
              </div>
            </div>

            <div className="tables-grid">
              {tables.map((table) => (
                <TableCard
                  key={table.name}
                  name={table.name}
                  status={table.status}
                  seats={table.seats}
                  detail={table.detail}
                  active={table.active}
                />
              ))}
            </div>
          </div>

          <OrderPanel order={selectedOrder} />
        </section>

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
      </main>
    </div>
  )
}

export default App
