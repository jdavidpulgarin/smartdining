export function FilterChip({ label, active = false, ...props }) {
  return (
    <button className={`filter-chip ${active ? 'active' : ''}`} {...props}>
      {label}
    </button>
  )
}
