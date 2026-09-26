export function MenuItem({ name, tag, price }) {
  return (
    <div className="menu-item">
      <div>
        <strong>{name}</strong>
        <span>{tag}</span>
      </div>
      <b>{price}</b>
    </div>
  )
}
