import {
  LayoutGrid,
  TrendingUp,
  Flame,
  Users,
  ArrowUpRight,
} from 'lucide-react'

const ICON_MAP = {
  'Mesas ocupadas': {
    icon: LayoutGrid,
    gradient: 'linear-gradient(135deg, #059669, #10b981)',
    glow: 'rgba(16, 185, 129, 0.25)',
  },
  Ingresos: {
    icon: TrendingUp,
    gradient: 'linear-gradient(135deg, #4f46e5, #818cf8)',
    glow: 'rgba(99, 102, 241, 0.25)',
  },
  'Pedidos activos': {
    icon: Flame,
    gradient: 'linear-gradient(135deg, #d97706, #f59e0b)',
    glow: 'rgba(245, 158, 11, 0.25)',
  },
  Clientes: {
    icon: Users,
    gradient: 'linear-gradient(135deg, #db2777, #f472b6)',
    glow: 'rgba(236, 72, 153, 0.25)',
  },
}

export function StatCard({ label, value, detail }) {
  const config = ICON_MAP[label] || {
    icon: TrendingUp,
    gradient: 'linear-gradient(135deg, #0f766e, #14b8a6)',
    glow: 'rgba(20, 184, 166, 0.2)',
  }
  const Icon = config.icon

  return (
    <article className="stat-card">
      <div className="stat-card-header">
        <span className="stat-label">{label}</span>
        <div
          className="stat-icon-wrap"
          style={{ background: config.gradient, boxShadow: `0 4px 12px ${config.glow}` }}
        >
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
