import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Menu } from '../Menu'
import { Home } from '../Home'
import { MenuItem } from '../../components/MenuItem'
import { EditorPasos } from '../../components/admin/EditorPasos'
import { AuthContext } from '../../context/authContextDef'
import { API_URL } from '../../services/api'
import { MENSAJE_URL_IMAGEN } from '../../utils/imagenes'

vi.mock('../../hooks', () => ({
  useSocketListener: () => {},
  useTables: () => ({ tables: [], loading: false, error: null }),
}))

// Imágenes subidas al backend (#209) en el panel: se pintan con el origen de la
// API y la misma lista blanca de la app (#212); al guardar solo va lo que el
// backend acepta.

const ORIGEN_API = new URL(API_URL).origin
const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'
const RUTA = `/imagenes/${UUID}.webp`
const RESPALDO = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
const CAMPO = 'https://… o /imagenes/<código>.webp'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

const categorias = [{ id_categoria: 1, nombre: 'Hamburguesas', descripcion: '' }]
const platos = [
  { id_plato: 501, id_categoria: 1, nombre: 'Subida Burger', precio: 20000, descripcion: '', tiempo_preparacion_estimado: 10, disponible: true, url_imagen: RUTA },
  { id_plato: 502, id_categoria: 1, nombre: 'Http Burger', precio: 20000, descripcion: '', tiempo_preparacion_estimado: 10, disponible: true, url_imagen: 'http://fotos.co/a.png' },
  { id_plato: 503, id_categoria: 1, nombre: 'Script Burger', precio: 20000, descripcion: '', tiempo_preparacion_estimado: 10, disponible: true, url_imagen: 'javascript:alert(1)' },
]
const pasos = [
  { id_paso: 1, nombre: 'Proteína', orden: 1, obligatorio: true, ingredientes: [{ id_ingrediente: 31, nombre: 'Pollo', precio_extra: 0, disponible: true }] },
]

let escritas
function simularBackend() {
  escritas = []
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    if (metodo !== 'GET') {
      escritas.push({ url, metodo, body: JSON.parse(config.body || '{}') })
      return json({ plato: { id_plato: 999 }, ingrediente: { id_ingrediente: 99 } }, metodo === 'POST' ? 201 : 200)
    }
    if (url.includes('/pasos')) return json(pasos)
    if (url.includes('/menu')) return json({ categorias: [{ ...categorias[0], platos }] })
    if (url.includes('/categorias')) return json({ categorias })
    if (url.includes('/platos')) return json({ platos })
    return json({})
  })
}

const ADMIN = { user: { id_usuario: 1, rol: 'admin', nombre: 'Admin' } }
const conAdmin = (ui) => render(<AuthContext.Provider value={ADMIN}><MemoryRouter>{ui}</MemoryRouter></AuthContext.Provider>)

function tarjetaDe(nombre) {
  let nodo = screen.getByText(nombre)
  while (nodo && !within(nodo).queryByTitle('Editar plato')) nodo = nodo.parentElement
  return nodo
}

async function crearPlatoCon(urlImagen) {
  conAdmin(<Menu />)
  await waitFor(() => expect(screen.getByText('Subida Burger')).toBeInTheDocument())
  fireEvent.click(screen.getByText('NUEVO PLATO'))
  fireEvent.change(screen.getByPlaceholderText(/Ej. Bowl Personalizado/i), { target: { value: 'Plato Nuevo' } })
  fireEvent.change(screen.getByPlaceholderText('25000'), { target: { value: '15000' } })
  fireEvent.change(screen.getByPlaceholderText(CAMPO), { target: { value: urlImagen } })
  fireEvent.click(screen.getByText('CREAR PLATO'))
}

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.setItem('smartdining_token', 'test-token')
})

describe('Menú: pintar url_imagen con la lista blanca', () => {
  it('una imagen subida (/imagenes/<uuid>.webp) se pinta con el origen de la API', async () => {
    simularBackend()
    conAdmin(<Menu />)
    await waitFor(() => expect(screen.getByAltText('Subida Burger')).toBeInTheDocument())
    expect(screen.getByAltText('Subida Burger')).toHaveAttribute('src', `${ORIGEN_API}${RUTA}`)
  })

  it('http:// y javascript: no se pintan: sale la foto de respaldo', async () => {
    simularBackend()
    conAdmin(<Menu />)
    await waitFor(() => expect(screen.getByAltText('Http Burger')).toBeInTheDocument())
    expect(screen.getByAltText('Http Burger')).toHaveAttribute('src', RESPALDO)
    expect(screen.getByAltText('Script Burger')).toHaveAttribute('src', RESPALDO)
  })

  it('editar un plato con imagen subida muestra y conserva la ruta relativa, no la resuelta', async () => {
    simularBackend()
    conAdmin(<Menu />)
    await waitFor(() => expect(screen.getByText('Subida Burger')).toBeInTheDocument())
    fireEvent.click(within(tarjetaDe('Subida Burger')).getByTitle('Editar plato'))
    expect(screen.getByPlaceholderText(CAMPO)).toHaveValue(RUTA)
    fireEvent.click(screen.getByText('GUARDAR CAMBIOS'))
    await waitFor(() => expect(escritas.length).toBe(1))
    expect(escritas[0].body.url_imagen).toBe(RUTA)
  })
})

describe('Menú: al guardar solo va lo que acepta el backend', () => {
  it('crear con /imagenes/<uuid>.webp la manda tal cual (el campo ya no es type="url")', async () => {
    simularBackend()
    await crearPlatoCon(RUTA)
    await waitFor(() => expect(escritas.length).toBe(1))
    expect(escritas[0].body.url_imagen).toBe(RUTA)
  })

  it.each([['http://fotos.co/a.png'], ['javascript:alert(1)'], ['../x.webp'], ['/imagenes/x.png'], [`${ORIGEN_API}${RUTA}`]])(
    'crear con %s no llama al backend y avisa', async (valor) => {
      simularBackend()
      await crearPlatoCon(valor)
      expect(await screen.findByText(MENSAJE_URL_IMAGEN)).toBeInTheDocument()
      expect(escritas).toHaveLength(0)
    }
  )
})

describe('Inicio: destacados del menú', () => {
  it('Home pinta la imagen subida con el origen de la API y una http:// no se pinta', async () => {
    simularBackend()
    conAdmin(<Home />)
    await waitFor(() => expect(screen.getByAltText('Subida Burger')).toBeInTheDocument())
    expect(screen.getByAltText('Subida Burger')).toHaveAttribute('src', `${ORIGEN_API}${RUTA}`)
    expect(screen.queryByAltText('Http Burger')).not.toBeInTheDocument()
  })

  it('MenuItem: si la imagen no carga, pinta el ícono en vez de la imagen rota', () => {
    render(<MenuItem name="Rota" price="$1" imageUrl="https://fotos.co/borrada.png" />)
    fireEvent.error(screen.getByAltText('Rota'))
    expect(screen.queryByAltText('Rota')).not.toBeInTheDocument()
  })
})

describe('EditorPasos: imagen del ingrediente', () => {
  async function guardarIngredienteCon(valor) {
    render(<EditorPasos dish={{ id: 501, name: 'Subida Burger' }} onClose={() => {}} onDishUpdated={() => {}} />)
    expect(await screen.findByText('Pollo')).toBeInTheDocument()
    fireEvent.click(screen.getByText('INGREDIENTE'))
    fireEvent.change(screen.getByPlaceholderText('Ej: Aguacate Hass, Pollo a la plancha'), { target: { value: 'Aguacate' } })
    fireEvent.change(screen.getByPlaceholderText(CAMPO), { target: { value: valor } })
    fireEvent.click(screen.getByText('GUARDAR INGREDIENTE'))
  }

  it('una http:// no se manda y avisa', async () => {
    simularBackend()
    await guardarIngredienteCon('http://fotos.co/a.png')
    expect(await screen.findByText(MENSAJE_URL_IMAGEN)).toBeInTheDocument()
    expect(escritas).toHaveLength(0)
  })

  it('una imagen subida se manda tal cual', async () => {
    simularBackend()
    await guardarIngredienteCon(RUTA)
    await waitFor(() => expect(escritas.length).toBe(1))
    expect(escritas[0].body.url_imagen).toBe(RUTA)
  })
})
