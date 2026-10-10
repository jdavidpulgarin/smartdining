export function PrimaryButton({ children, ...props }) {
  return (
    <button className="primary-button" {...props}>
      {children}
    </button>
  )
}

export function GhostButton({ children, ...props }) {
  return (
    <button className="ghost-button" {...props}>
      {children}
    </button>
  )
}

export function LinkButton({ children, ...props }) {
  return (
    <button className="link-button" {...props}>
      {children}
    </button>
  )
}
