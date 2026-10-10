import { StatCard } from './StatCard'

export function StatsSection({ stats }) {
  return (
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
  )
}
