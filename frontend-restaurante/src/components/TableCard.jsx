import { StatusBadge } from './ui/Badge'

export function TableCard({ name, status, seats, detail, active }) {
  return (
    <div className={`table-card ${active ? 'active' : ''}`}>
      <div className="table-top">
        <strong>{name}</strong>
        <StatusBadge status={status} />
      </div>
      <p>{seats} personas</p>
      <small>{detail}</small>
    </div>
  )
}
