export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button className={`primary-button btn ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}

export function GhostButton({ children, className = '', ...props }) {
  return (
    <button className={`ghost-button btn claro ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}

export function LinkButton({ children, className = '', ...props }) {
  return (
    <button className={`link-button ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}
