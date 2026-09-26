export function TableCard({ name, status, seats, detail, active }) {
  const statusClass = status.toLowerCase().replace(' ', '-')

  return (
    <div className={`table-card ${active ? 'active' : ''}`}>
      <div className="table-top">
        <strong>{name}</strong>
        <span className={`status ${statusClass}`}>
          {status}
        </span>
      </div>
      <p>{seats} personas</p>
      <small>{detail}</small>
    </div>
  )
}
