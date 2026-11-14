import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let rolSesion = 'admin'
vi.mock('../../hooks', () => ({
  useAuth: () => ({ user: { nombre: 'Prueba', rol: rolSesion, roleLabel: rolSesion }, logout: vi.fn() }),
  useTables: () => ({ alertas: [], atenderAlerta: vi.fn(), limpiarAlertas: vi.fn() }),
}))

import { Topbar } from '../Topbar'

const enlaces = () => {
  render(<MemoryRouter><Topbar /></MemoryRouter>)
  return within(screen.getByRole('navigation', { name: /Navegación principal/ })).getAllByRole('link').map((a) => a.textContent.trim())
}

describe('Topbar: cada rol ve solo lo que el backend le permite', () => {
  it('admin ve todo, también REPORTES', () => {
    rolSesion = 'admin'
    expect(enlaces()).toEqual(['MESAS', 'PEDIDOS', 'CAJA', 'MENÚ', 'REPORTES', 'INVENTARIO', 'CONFIGURACIÓN'])
  })

  it('cajero: sin REPORTES (GET /api/reportes es solo admin)', () => {
    rolSesion = 'cajero'
    expect(enlaces()).toEqual(['MESAS', 'PEDIDOS', 'CAJA', 'MENÚ'])
  })

  it('mesero: sin CAJA ni REPORTES', () => {
    rolSesion = 'mesero'
    expect(enlaces()).toEqual(['MESAS', 'PEDIDOS', 'MENÚ'])
  })
})
