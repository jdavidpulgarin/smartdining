export function FilterChip({ label, active = false, className = '', ...props }) {
  return (
    <button className={`filter-chip chip ${active ? 'active' : ''} ${className}`.trim()} {...props}>
      {label}
    </button>
  )
}
