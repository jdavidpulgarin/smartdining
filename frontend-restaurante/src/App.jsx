import './App.css'
import { Topbar } from './components/Topbar'
import { Sidebar } from './components/Sidebar'
import { StatsSection } from './components/StatsSection'
import { TablesPanel } from './components/TablesPanel'
import { OrderPanel } from './components/OrderPanel'
import { MenuSection } from './components/MenuSection'

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
      <Topbar />
      <Sidebar />

      <main className="main-panel">
        <StatsSection stats={stats} />

        <section className="content-grid">
          <TablesPanel tables={tables} />
          <OrderPanel order={selectedOrder} />
        </section>

        <MenuSection menu={menu} />
      </main>
    </div>
  )
}

export default App
