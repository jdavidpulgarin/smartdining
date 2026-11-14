import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Menu } from '../Menu'
import { SubirImagen } from '../../components/admin/SubirImagen'
import { AuthContext } from '../../context/authContextDef'
import { API_URL, imagenesApi } from '../../services/api'

vi.mock('../../hooks', () => ({ useSocketListener: () => {} }))

// Botón SUBIR IMAGEN (D-23, #209): POST /imagenes con el archivo en el campo
// "imagen", vista previa y los mismos límites del backend antes de subir.

const ORIGEN_API = new URL(API_URL).origin
const RUTA = '/imagenes/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b.webp'
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]
const png = (nombre = 'foto.png', relleno = 0) => new File([new Uint8Array([...PNG, ...new Array(relleno).fill(0)])], nombre, { type: 'image/png' })

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json', ...headers }),
  json: async () => body,
})

let llamadas
function backend({ subida = () => json({ ruta: RUTA }, 201) } = {}) {
  llamadas = []
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    llamadas.push({ url, metodo, config })
    if (metodo === 'POST' && url.endsWith('/imagenes')) return subida()
    if (metodo !== 'GET') return json({ plato: { id_plato: 999 } }, 201)
    if (url.includes('/categorias')) return json({ categorias: [{ id_categoria: 1, nombre: 'Hamburguesas', descripcion: '' }] })
    if (url.includes('/platos')) return json({ platos: [] })
    return json({})
  })
}
const subidas = () => llamadas.filter((l) => l.metodo === 'POST' && l.url.endsWith('/imagenes'))

let creadas
beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  sessionStorage.setItem('smartdining_token', 'test-token')
  creadas = []
  URL.createObjectURL = vi.fn(() => { const u = `blob:local-${creadas.length}`; creadas.push(u); return u })
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { delete URL.createObjectURL; delete URL.revokeObjectURL })

const elegir = (archivo) => fireEvent.change(screen.getByTestId('subir-imagen-archivo'), { target: { files: [archivo] } })

describe('imagenesApi.subir', () => {
  it('manda multipart con el archivo en "imagen", con el token y SIN Content-Type JSON', async () => {
    backend()
    const r = await imagenesApi.subir(png())
    expect(r).toEqual({ ruta: RUTA })
    const [l] = subidas()
    expect(l.url).toBe(`${API_URL}/imagenes`)
    expect(l.config.body).toBeInstanceOf(FormData)
    expect(l.config.body.get('imagen')).toBeInstanceOf(File)
    expect(l.config.headers.Authorization).toBe('Bearer test-token')
    expect(l.config.headers['Content-Type']).toBeUndefined()
    expect(l.config).not.toHaveProperty('manejar429')
  })

  it('un 429 de la subida NO saca al login ni guarda el bloqueo global', async () => {
    backend({ subida: () => json({ error: 'Demasiadas imágenes', motivo: 'demasiadas_peticiones' }, 429, { 'retry-after': '120' }) })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, pathname: '/menu', assign })
    await expect(imagenesApi.subir(png())).rejects.toMatchObject({ status: 429, motivo: 'demasiadas_peticiones', retryAfter: 120 })
    expect(assign).not.toHaveBeenCalled()
    expect(Object.keys(sessionStorage).some((k) => /rate/i.test(k))).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('SubirImagen', () => {
  it('sube, pasa la ruta al formulario y la vista previa pasa a la imagen servida por la API', async () => {
    backend()
    const onCambio = vi.fn()
    const { rerender } = render(<SubirImagen valor="" onCambio={onCambio} />)
    expect(screen.getByText('Sin imagen')).toBeInTheDocument()
    elegir(png())
    await waitFor(() => expect(onCambio).toHaveBeenCalledWith(RUTA))
    expect(screen.getByRole('status')).toHaveTextContent('Imagen subida')
    rerender(<SubirImagen valor={RUTA} onCambio={onCambio} />)
    expect(screen.getByAltText('Vista previa de la imagen')).toHaveAttribute('src', `${ORIGEN_API}${RUTA}`)
  })

  it('mientras sube, la vista previa es el archivo local', async () => {
    let soltar
    backend({ subida: () => new Promise((r) => { soltar = () => r(json({ ruta: RUTA }, 201)) }) })
    render(<SubirImagen valor="" onCambio={() => {}} />)
    elegir(png())
    await waitFor(() => expect(screen.getByText('SUBIENDO…')).toBeInTheDocument())
    expect(screen.getByAltText('Vista previa de la imagen')).toHaveAttribute('src', 'blob:local-0')
    soltar()
    await waitFor(() => expect(screen.getByText('SUBIR IMAGEN')).toBeInTheDocument())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-0')
  })

  it.each([
    ['de más de 2 MB', png('grande.png', 2 * 1024 * 1024), /máximo es 2 MB/],
    ['que no es imagen aunque diga .png', new File(['soy texto'], 'foto.png', { type: 'image/png' }), /JPEG, PNG o WebP/],
  ])('un archivo %s no se sube y avisa', async (_, archivo, mensaje) => {
    backend()
    const onCambio = vi.fn()
    render(<SubirImagen valor="" onCambio={onCambio} />)
    elegir(archivo)
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje)
    expect(subidas()).toHaveLength(0)
    expect(onCambio).not.toHaveBeenCalled()
  })

  it.each([
    [413, 'archivo_muy_grande', /supera el máximo/],
    [415, 'tipo_no_permitido', /JPEG, PNG o WebP/],
    [422, 'imagen_invalida', /dañada/],
    [429, 'demasiadas_peticiones', /Espera 2 min/],
  ])('si el backend responde %i (%s), muestra el motivo y no cambia el campo', async (status, motivo, mensaje) => {
    backend({ subida: () => json({ error: 'x', motivo }, status, { 'retry-after': '90' }) })
    const onCambio = vi.fn()
    render(<SubirImagen valor="" onCambio={onCambio} />)
    elegir(png())
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje)
    expect(onCambio).not.toHaveBeenCalled()
  })
})

describe('Menú: subir la imagen de un plato nuevo', () => {
  it('sube, deja la ruta en el campo y al crear la manda como url_imagen; no guarda mientras sube', async () => {
    let soltar
    backend({ subida: () => new Promise((r) => { soltar = () => r(json({ ruta: RUTA }, 201)) }) })
    render(<AuthContext.Provider value={{ user: { id_usuario: 1, rol: 'admin' } }}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('NUEVO PLATO')).toBeInTheDocument())
    fireEvent.click(screen.getByText('NUEVO PLATO'))
    fireEvent.change(screen.getByPlaceholderText(/Ej. Bowl Personalizado/i), { target: { value: 'Plato Con Foto' } })
    fireEvent.change(screen.getByPlaceholderText('25000'), { target: { value: '15000' } })
    elegir(png())
    await waitFor(() => expect(screen.getByText('SUBIENDO IMAGEN...')).toBeInTheDocument())
    expect(screen.getByText('SUBIENDO IMAGEN...').closest('button')).toBeDisabled()
    soltar()
    await waitFor(() => expect(screen.getByPlaceholderText('https://… o /imagenes/<código>.webp')).toHaveValue(RUTA))
    fireEvent.click(screen.getByText('CREAR PLATO'))
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'POST' && l.url.endsWith('/platos'))).toBe(true))
    const crear = llamadas.find((l) => l.metodo === 'POST' && l.url.endsWith('/platos'))
    expect(JSON.parse(crear.config.body).url_imagen).toBe(RUTA)
  })
})

describe('SubirImagen: el formulario se cierra a mitad de la subida (revisión de Roberto en #230)', () => {
  it('la subida que termina después NO escribe su ruta (onCambio no se llama) y el padre deja de estar «subiendo» al cerrar', async () => {
    let soltar
    backend({ subida: () => new Promise((r) => { soltar = () => r(json({ ruta: RUTA }, 201)) }) })
    const onCambio = vi.fn()
    const onSubiendo = vi.fn()
    const { unmount } = render(<SubirImagen valor="" onCambio={onCambio} onSubiendo={onSubiendo} etiqueta="foto del plato" />)
    elegir(png())
    await waitFor(() => expect(onSubiendo).toHaveBeenCalledWith(true))
    await waitFor(() => expect(subidas()).toHaveLength(1))

    unmount()
    expect(onSubiendo).toHaveBeenLastCalledWith(false)
    const avisos = onSubiendo.mock.calls.length

    soltar()
    await new Promise((r) => setTimeout(r, 20))
    expect(onCambio).not.toHaveBeenCalled()
    // La subida vieja ya no avisa nada: no apaga el «subiendo» de otra subida.
    expect(onSubiendo.mock.calls.length).toBe(avisos)
  })

  it('si falla después de cerrar tampoco toca nada', async () => {
    let fallar
    backend({ subida: () => new Promise((_, rej) => { fallar = () => rej(new TypeError('Failed to fetch')) }) })
    const onCambio = vi.fn()
    const onSubiendo = vi.fn()
    const { unmount } = render(<SubirImagen valor="" onCambio={onCambio} onSubiendo={onSubiendo} />)
    elegir(png())
    await waitFor(() => expect(subidas()).toHaveLength(1))
    unmount()
    const avisos = onSubiendo.mock.calls.length
    fallar()
    await new Promise((r) => setTimeout(r, 20))
    expect(onCambio).not.toHaveBeenCalled()
    expect(onSubiendo.mock.calls.length).toBe(avisos)
  })
})
