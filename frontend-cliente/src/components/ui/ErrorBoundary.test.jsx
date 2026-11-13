import { describe, it, expect, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

describe('ErrorBoundary (recuperación de vistas lazy)', () => {
  it('getDerivedStateFromError devuelve { tieneError: true }', () => {
    const error = new Error('Fallo simulado al importar chunk')
    const estado = ErrorBoundary.getDerivedStateFromError(error)
    expect(estado).toEqual({ tieneError: true })
  })

  it('componentDidCatch registra el error en console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const instancia = new ErrorBoundary({})
    const error = new Error('ChunkLoadError: /assets/Menu.js')

    instancia.componentDidCatch(error)

    expect(errorSpy).toHaveBeenCalledWith(
      'Error capturado por ErrorBoundary:',
      error,
    )
    errorSpy.mockRestore()
  })

  it('renderiza fallback de error cuando el estado tieneError es true', () => {
    const instancia = new ErrorBoundary({ children: 'contenido-normal' })
    instancia.state = { tieneError: true }
    const resultado = instancia.render()

    expect(resultado).not.toBe('contenido-normal')
    expect(resultado?.props?.role).toBe('alert')
  })

  it('renderiza children cuando el estado tieneError es false', () => {
    const instancia = new ErrorBoundary({ children: 'contenido-normal' })
    instancia.state = { tieneError: false }
    const resultado = instancia.render()

    expect(resultado).toBe('contenido-normal')
  })
})
