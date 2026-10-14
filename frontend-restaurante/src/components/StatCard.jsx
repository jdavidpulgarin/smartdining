import {
  LayoutGrid,
  TrendingUp,
  Flame,
  UtensilsCrossed,
  ArrowUpRight,
} from 'lucide-react'

const ICON_MAP = {
  'mesas ocupadas': LayoutGrid,
  'comandas en cocina': Flame,
  'pedidos activos': UtensilsCrossed,
  'total acumulado turno': TrendingUp,
  'total del turno': TrendingUp,
  'ingresos': TrendingUp,
}

export function StatCard({ label, value, detail }) {
  const normalized = (label || '').toLowerCase().trim()
  const Icon = ICON_MAP[normalized] || TrendingUp

  return (
    <article className="stat-card">
      <div className="stat-card-header">
        <span className="stat-label">{label}</span>
        <div className="stat-icon-wrap">
          <Icon size={16} className="stat-icon" />
        </div>
      </div>

      <div className="stat-value-row">
        <strong className="stat-value">{value}</strong>
        {detail && (
          <div className="stat-trend-tag">
            <ArrowUpRight size={12} />
            <span>{detail}</span>
          </div>
        )}
      </div>

      <div className="stat-card-sparkline">
        <div className="sparkline-bar b1" style={{ height: '35%' }}></div>
        <div className="sparkline-bar b2" style={{ height: '65%' }}></div>
        <div className="sparkline-bar b3" style={{ height: '45%' }}></div>
        <div className="sparkline-bar b4" style={{ height: '80%' }}></div>
        <div className="sparkline-bar b5" style={{ height: '60%' }}></div>
        <div className="sparkline-bar b6" style={{ height: '95%' }}></div>
        <div className="sparkline-bar b7" style={{ height: '100%' }}></div>
      </div>
    </article>
  )
}
