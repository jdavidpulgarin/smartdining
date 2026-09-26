import { GhostButton, PrimaryButton } from './ui/Button'

export function Topbar() {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">S</div>
        <div>
          <p className="brand-name">SmartDining</p>
          <span>Restaurante</span>
        </div>
      </div>

      <div className="topbar-actions">
        <GhostButton>Hoy</GhostButton>
        <PrimaryButton>+ Nuevo pedido</PrimaryButton>
        <div className="avatar">JP</div>
      </div>
    </header>
  )
}
