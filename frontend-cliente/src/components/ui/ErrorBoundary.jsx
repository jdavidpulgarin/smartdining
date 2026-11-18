import { Component } from 'react'
import Button from './Button'

/**
 * ErrorBoundary con el estilo visual de SmartDining (fondo oscuro, acento y botón del tema).
 * Captura fallas de render o de carga de componentes perezosos (lazy) y ofrece
 * un botón claro para recargar la aplicación.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { tieneError: false }
  }

  static getDerivedStateFromError() {
    return { tieneError: true }
  }

  componentDidCatch(error) {
    // Solo registrar el error en consola, sin datos de sesión ni tokens
    console.error('Error capturado por ErrorBoundary:', error)
  }

  render() {
    if (this.state.tieneError) {
      return (
        <div
          role="alert"
          className="min-h-screen bg-fondo text-texto flex flex-col items-center justify-center p-6 text-center"
        >
          <div className="w-16 h-16 rounded-full bg-primario/10 text-primario-texto flex items-center justify-center mb-4">
            <svg
              aria-hidden="true"
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold font-titulo tracking-wide mb-2 text-texto">
            Algo salió mal al cargar esta pantalla
          </h1>
          <p className="text-sm font-cuerpo text-texto-suave mb-6 max-w-sm">
            Puede que haya una versión nueva de la app.
          </p>
          <Button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 min-h-11"
          >
            Recargar
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
