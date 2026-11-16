import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Menu } from '../Menu'
import { Home } from '../Home'
import { AuthContext } from '../../context/authContextDef'
import { fotoDePlato, FOTO_AREPA } from '../../utils/imagenes'

vi.mock('../../hooks', () => ({
  useSocketListener: () => {},
  useTables: () => ({ tables: [], loading: false, error: null }),
}))

// Regresión: el panel pintaba la Arepa Rellena SIEMPRE con la foto local
// (/img/arepa-rellena.png). El admin le cambiaba la imagen y la base la
// guardaba, pero el panel seguía pintando la misma, ni recargando.

const FOTO_NUEVA = 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=600'
const RESPALDO = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
const json = (body) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })

let platos
function simularBackend() {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const categorias = [{ id_categoria: 100, nombre: 'Arma tu plato', descripcion: '' }]
    if (url.includes('/menu')) return json({ categorias: [{ ...categorias[0], categoria: 'Arma tu plato', platos }] })
    if (url.includes('/categorias')) return json({ categorias })
    if (url.includes('/platos')) return json({ platos })
    return json({})
  })
}
const arepa = (url_imagen) => ({
  id_plato: 1003, id_categoria: 100, nombre: 'Arepa Rellena', precio: 15000, descripcion: '',
  tiempo_preparacion_estimado: 12, disponible: true, personalizable: true, url_imagen,
})
const ADMIN = { user: { id_usuario: 1, rol: 'admin', nombre: 'Admin' } }
const conAdmin = (ui) => render(<AuthContext.Provider value={ADMIN}><MemoryRouter>{ui}</MemoryRouter></AuthContext.Provider>)

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.setItem('smartdining_token', 'test-token')
})

describe('fotoDePlato', () => {
  it('la foto propia del plato manda; la local de la arepa es solo si no tiene', () => {
    expect(fotoDePlato('Arepa Rellena', FOTO_NUEVA)).toBe(FOTO_NUEVA)
    expect(fotoDePlato('Arepa Rellena 85708', FOTO_NUEVA)).toBe(FOTO_NUEVA)
    expect(fotoDePlato('Arepa Rellena', null)).toBe(FOTO_AREPA)
    expect(fotoDePlato('Arepa Rellena', 'http://fotos.co/a.png')).toBe(FOTO_AREPA) // fuera de la lista blanca
    expect(fotoDePlato('Bandeja', null, RESPALDO)).toBe(RESPALDO)
    expect(fotoDePlato('Bandeja', null)).toBeNull()
  })
})

describe('Panel: la Arepa Rellena con imagen propia', () => {
  it('Menú pinta la imagen que el admin le puso, no la foto local', async () => {
    platos = [arepa(FOTO_NUEVA)]
    simularBackend()
    conAdmin(<Menu />)
    await waitFor(() => expect(screen.getByAltText('Arepa Rellena')).toBeInTheDocument())
    expect(screen.getByAltText('Arepa Rellena')).toHaveAttribute('src', FOTO_NUEVA)
  })

  it('Inicio (destacados) pinta la imagen propia; sin imagen, la local de la arepa', async () => {
    platos = [arepa(FOTO_NUEVA)]
    simularBackend()
    const { unmount } = conAdmin(<Home />)
    await waitFor(() => expect(screen.getByAltText('Arepa Rellena')).toBeInTheDocument())
    expect(screen.getByAltText('Arepa Rellena')).toHaveAttribute('src', FOTO_NUEVA)
    unmount()
    platos = [arepa(null)]
    conAdmin(<Home />)
    await waitFor(() => expect(screen.getByAltText('Arepa Rellena')).toBeInTheDocument())
    expect(screen.getByAltText('Arepa Rellena')).toHaveAttribute('src', FOTO_AREPA)
  })
})
