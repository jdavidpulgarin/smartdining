export function StatusBadge({ status }) {
  const statusClass = status.toLowerCase().replace(' ', '-')

  return (
    <span className={`status ${statusClass}`}>
      {status}
    </span>
  )
}

export function StateBadge({ state }) {
  return (
    <span className="order-state">
      {state}
    </span>
  )
}
