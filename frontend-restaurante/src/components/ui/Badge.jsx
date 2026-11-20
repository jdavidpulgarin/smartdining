export function StatusBadge({ status, className = '' }) {
  const statusClass = status.toLowerCase().replace(' ', '-')

  return (
    <span className={`status est ${statusClass} ${className}`.trim()}>
      {status}
    </span>
  )
}

export function StateBadge({ state, className = '' }) {
  return (
    <span className={`order-state est ${className}`.trim()}>
      {state}
    </span>
  )
}
