import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { Configuracion } from '../Configuracion'
import { errorDeClave } from '../../utils/configuracion'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

function sesionComo(rol, id = 1) {
  sessionStorage.setItem('smartdining_token', 'test-token')
  sessionStorage.setItem(
    'smartdining_staff_user',
    JSON.stringify({ id, id_usuario: id, nombre: 'Ana Ríos', email: 'ana@mail.com', rol, role: rol })
  )
}

/** Backend simulado. `escrituras(url, metodo, cuerpo)` decide cada POST/PATCH/DELETE. */
function backend({ mesas = [], usuarios = [], configuracion = null, escrituras = () => json({}) }) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    if (metodo !== 'GET') return escrituras(url, metodo, config.body ? JSON.parse(config.body) : undefined)
    if (url.includes('/configuracion/completa')) {
      return typeof configuracion === 'function' ? configuracion() : json(configuracion)
    }
    if (url.includes('/usuarios')) return json({ usuarios })
    if (url.includes('/mesas')) return json({ mesas })
    return json({})
  })
}

function montar() {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/configuracion']}>
        <Routes>
          <Route path="/" element={<p>INICIO</p>} />
          <Route path="/configuracion" element={<Configuracion />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

const escriturasDe = (spy) =>
  spy.mock.calls
    .filter(([, c = {}]) => (c.method || 'GET') !== 'GET')
    .map(([url, c]) => ({ url, metodo: c.method, cuerpo: c.body ? JSON.parse(c.body) : undefined }))

const mesasBase = [
  { id_mesa: 1, numero: 1, capacidad: 2, ubicacion: 'Terraza', estado: 'disponible', sesion_abierta: false },
  { id_mesa: 3, numero: 3, capacidad: 4, ubicacion: 'Salón', estado: 'ocupada', sesion_abierta: true },
]

describe('P-21 · Configuración', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('solo admin: un mesero es enviado al inicio', () => {
    sesionComo('mesero')
    backend({})
    montar()
    expect(screen.getByText('INICIO')).toBeInTheDocument()
    expect(screen.queryByText('CONFIGURACIÓN')).toBeNull()
  })

  describe('pestaña Mesas', () => {
    it('lista las mesas ordenadas y sin columna "activa" si la API aún no la trae', async () => {
      sesionComo('admin')
      backend({ mesas: [mesasBase[1], mesasBase[0]] })
      montar()

      const filas = await screen.findAllByTestId(/^mesa-/)
      expect(filas.map((f) => f.dataset.testid)).toEqual(['mesa-1', 'mesa-3'])
      expect(screen.queryByText('ACTIVA')).toBeNull()
      expect(screen.queryByTitle(/Desactivar mesa/)).toBeNull()
    })

    it('crea una mesa con número, capacidad y ubicación', async () => {
      sesionComo('admin')
      const spy = backend({ mesas: mesasBase, escrituras: () => json({ id_mesa: 9, numero: 9 }, 201) })
      montar()
      const form = await screen.findByRole('form', { name: 'Nueva mesa' })

      fireEvent.change(within(form).getByLabelText('NÚMERO'), { target: { value: '9' } })
      fireEvent.change(within(form).getByLabelText('CAPACIDAD'), { target: { value: '6' } })
      fireEvent.change(within(form).getByLabelText('UBICACIÓN'), { target: { value: ' VIP ' } })
      fireEvent.click(within(form).getByRole('button', { name: /CREAR MESA/ }))

      expect(await screen.findByRole('status')).toHaveTextContent('Mesa 9 creada.')
      expect(escriturasDe(spy)).toEqual([
        { url: expect.stringMatching(/\/mesas$/), metodo: 'POST', cuerpo: { numero: 9, capacidad: 6, ubicacion: 'VIP' } },
      ])
    })

    it('valida antes de enviar: sin ubicación no llama a la API', async () => {
      sesionComo('admin')
      const spy = backend({ mesas: mesasBase })
      montar()
      const form = await screen.findByRole('form', { name: 'Nueva mesa' })
      fireEvent.change(within(form).getByLabelText('NÚMERO'), { target: { value: '9' } })
      fireEvent.click(within(form).getByRole('button', { name: /CREAR MESA/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Escribe la ubicación')
      expect(escriturasDe(spy)).toEqual([])
    })

    it('al editar manda SOLO lo que cambió', async () => {
      sesionComo('admin')
      const spy = backend({ mesas: mesasBase, escrituras: () => json({}) })
      montar()
      await screen.findByTestId('mesa-1')

      fireEvent.click(screen.getByTitle('Editar mesa 1'))
      fireEvent.change(screen.getByLabelText('Capacidad'), { target: { value: '4' } })
      fireEvent.click(screen.getByRole('button', { name: 'GUARDAR' }))

      await screen.findByRole('status')
      expect(escriturasDe(spy)).toEqual([{ url: expect.stringMatching(/\/mesas\/1$/), metodo: 'PATCH', cuerpo: { capacidad: 4 } }])
    })

    it('muestra el 409 del backend tal cual (renumerar una mesa ocupada)', async () => {
      sesionComo('admin')
      const mensaje = 'Esa mesa está ocupada: no se puede cambiar su número mientras haya gente sentada. Libérala primero.'
      backend({ mesas: mesasBase, escrituras: () => json({ error: mensaje }, 409) })
      montar()
      await screen.findByTestId('mesa-3')

      fireEvent.click(screen.getByTitle('Editar mesa 3'))
      fireEvent.change(screen.getByLabelText('Número'), { target: { value: '30' } })
      fireEvent.click(screen.getByRole('button', { name: 'GUARDAR' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(`No se guardó: ${mensaje}`)
    })

    it('con D-16B (campo activa) ofrece Activar/Desactivar y manda { activa }', async () => {
      sesionComo('admin')
      const spy = backend({
        mesas: mesasBase.map((m) => ({ ...m, activa: true })),
        escrituras: () => json({}),
      })
      montar()
      await screen.findByTestId('mesa-1')
      expect(screen.getByText('ACTIVA')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('Desactivar mesa 1'))
      expect(await screen.findByRole('status')).toHaveTextContent('Mesa 1 desactivada.')
      expect(escriturasDe(spy)).toEqual([{ url: expect.stringMatching(/\/mesas\/1$/), metodo: 'PATCH', cuerpo: { activa: false } }])
    })

    it('desactivar una mesa ocupada muestra el 409 del backend y la deja como estaba', async () => {
      sesionComo('admin')
      const mensaje = 'Esa mesa está ocupada: libérala antes de desactivarla.'
      backend({
        mesas: mesasBase.map((m) => ({ ...m, activa: true })),
        escrituras: () => json({ error: mensaje, motivo: 'mesa_ocupada' }, 409),
      })
      montar()
      await screen.findByTestId('mesa-3')

      fireEvent.click(screen.getByTitle('Desactivar mesa 3'))
      expect(await screen.findByRole('alert')).toHaveTextContent(`No se guardó: ${mensaje}`)
      expect(within(screen.getByTestId('mesa-3')).getByText('Sí')).toBeInTheDocument()
    })

    it('borrar pide confirmación y muestra el 409 si la mesa tiene pedidos', async () => {
      sesionComo('admin')
      const mensaje = 'Esa mesa tiene pedidos registrados: no se puede borrar sin perder el historial.'
      const spy = backend({ mesas: mesasBase, escrituras: () => json({ error: mensaje }, 409) })
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      montar()
      await screen.findByTestId('mesa-1')

      fireEvent.click(screen.getByTitle('Borrar mesa 1'))
      expect(escriturasDe(spy)).toEqual([])

      fireEvent.click(screen.getByTitle('Borrar mesa 1'))
      expect(await screen.findByRole('alert')).toHaveTextContent(mensaje)
      expect(escriturasDe(spy)[0]).toMatchObject({ metodo: 'DELETE' })
    })
  })

  describe('pestaña Personal', () => {
    const usuarios = [
      { id_usuario: 1, nombre: 'Ana Ríos', email: 'ana@mail.com', rol: 'admin', activo: true },
      { id_usuario: 2, nombre: 'Luis Pardo', email: 'luis@mail.com', rol: 'mesero', activo: true },
    ]

    async function abrirPersonal(opciones) {
      sesionComo('admin', 1)
      const spy = backend({ mesas: mesasBase, usuarios, ...opciones })
      montar()
      fireEvent.click(await screen.findByRole('tab', { name: 'PERSONAL' }))
      await screen.findByTestId('usuario-2')
      return spy
    }

    it('en la fila propia no ofrece cambiar el rol ni desactivarse', async () => {
      await abrirPersonal()
      const yo = screen.getByTestId('usuario-1')
      expect(within(yo).getByText('(tú)')).toBeInTheDocument()
      expect(within(yo).queryByRole('combobox')).toBeNull()
      expect(within(yo).queryByRole('button', { name: /DESACTIVAR/ })).toBeNull()
      // Restablecer la propia clave sí se permite.
      expect(within(yo).getByRole('button', { name: /RESTABLECER CLAVE/ })).toBeInTheDocument()
    })

    it('cambiar el rol de otro manda solo { rol }', async () => {
      const spy = await abrirPersonal({ escrituras: () => json({ usuario: {} }) })
      fireEvent.change(screen.getByLabelText('Rol de Luis Pardo'), { target: { value: 'cajero' } })

      expect(await screen.findByRole('status')).toHaveTextContent('Luis Pardo ahora es Cajero.')
      expect(escriturasDe(spy)).toEqual([{ url: expect.stringMatching(/\/usuarios\/2$/), metodo: 'PATCH', cuerpo: { rol: 'cajero' } }])
    })

    it('desactivar pide confirmación y muestra el 409 de "último admin"', async () => {
      const mensaje = 'No se puede dejar el sistema sin ningún admin activo: asciende o activa a otro antes.'
      await abrirPersonal({ escrituras: () => json({ error: mensaje }, 409) })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      fireEvent.click(within(screen.getByTestId('usuario-2')).getByRole('button', { name: 'DESACTIVAR' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(mensaje)
    })

    it('crear usuario: valida la clave en el panel y luego llama a /auth/register', async () => {
      const spy = await abrirPersonal({ escrituras: () => json({ usuario: { id_usuario: 3 } }, 201) })
      const form = screen.getByRole('form', { name: 'Nuevo usuario' })
      fireEvent.change(within(form).getByLabelText('NOMBRE'), { target: { value: 'Sara Gil' } })
      fireEvent.change(within(form).getByLabelText('EMAIL'), { target: { value: 'sara@mail.com' } })
      fireEvent.change(within(form).getByLabelText('CLAVE INICIAL'), { target: { value: 'corta' } })
      fireEvent.change(within(form).getByLabelText('ROL'), { target: { value: 'cocina' } })
      fireEvent.click(within(form).getByRole('button', { name: /CREAR USUARIO/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('al menos 8 caracteres')
      expect(escriturasDe(spy)).toEqual([])

      fireEvent.change(within(form).getByLabelText('CLAVE INICIAL'), { target: { value: 'clave-segura-1' } })
      fireEvent.click(within(form).getByRole('button', { name: /CREAR USUARIO/ }))

      expect(await screen.findByRole('status')).toHaveTextContent('Sara Gil ya puede entrar al panel.')
      expect(escriturasDe(spy)).toEqual([
        {
          url: expect.stringMatching(/\/auth\/register$/),
          metodo: 'POST',
          cuerpo: { nombre: 'Sara Gil', email: 'sara@mail.com', password: 'clave-segura-1', rol: 'cocina' },
        },
      ])
    })

    it('restablecer clave llama a /usuarios/:id/clave y no deja la clave en pantalla', async () => {
      const spy = await abrirPersonal({ escrituras: () => json({ usuario: {} }) })
      const fila = screen.getByTestId('usuario-2')
      fireEvent.click(within(fila).getByRole('button', { name: /RESTABLECER CLAVE/ }))
      fireEvent.change(within(fila).getByLabelText('Clave nueva de Luis Pardo'), { target: { value: 'otra-clave-99' } })
      fireEvent.click(within(fila).getByRole('button', { name: 'GUARDAR' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Clave de Luis Pardo restablecida.')
      expect(escriturasDe(spy)).toEqual([
        { url: expect.stringMatching(/\/usuarios\/2\/clave$/), metodo: 'POST', cuerpo: { password: 'otra-clave-99' } },
      ])
      await waitFor(() => expect(screen.queryByLabelText('Clave nueva de Luis Pardo')).toBeNull())
    })
  })

  describe('pestaña Restaurante (P2)', () => {
    // Forma real de GET /configuracion/completa (api-spec, D-16 parte B).
    const configBase = {
      id: 1,
      nombre: 'SmartDining',
      telefono: '3001234567',
      direccion: 'Calle 1 #2-3',
      url_logo: null,
      horario: { lunes: { abre: '11:00', cierra: '22:00' } },
      propina_sugerida_pct: 10,
      moneda: 'COP',
      actualizado_en: '2026-11-08T12:00:00.000Z',
      actualizado_por: 1,
    }
    const personal = [{ id_usuario: 1, nombre: 'Ana Ríos', email: 'ana@mail.com', rol: 'admin', activo: true }]

    async function abrirRestaurante() {
      fireEvent.click(await screen.findByRole('tab', { name: 'RESTAURANTE' }))
      return screen.findByRole('form', { name: 'Datos del restaurante' })
    }

    it('carga los datos reales del local, el horario por día y quién guardó por última vez', async () => {
      sesionComo('admin')
      backend({ mesas: mesasBase, usuarios: personal, configuracion: configBase })
      montar()
      const form = await abrirRestaurante()

      expect(within(form).getByLabelText('NOMBRE')).toHaveValue('SmartDining')
      expect(within(form).getByLabelText('MONEDA')).toHaveValue('COP')
      expect(within(form).getByLabelText('PROPINA SUGERIDA (%)')).toHaveValue('10')
      expect(within(form).getByLabelText('Lunes')).toBeChecked()
      expect(within(form).getByLabelText('Abre el Lunes')).toHaveValue('11:00')
      expect(within(form).getByLabelText('Martes')).not.toBeChecked()
      expect(await within(form).findByText(/Última actualización: .* · por Ana Ríos/)).toBeInTheDocument()
      expect(screen.queryByText(/pendiente/i)).toBeNull()
    })

    it('guardar manda solo lo que cambió y muestra la fila que devuelve el servidor', async () => {
      sesionComo('admin')
      const guardada = {
        ...configBase,
        propina_sugerida_pct: 12.5,
        horario: { ...configBase.horario, domingo: { abre: '12:00', cierra: '21:00' } },
        actualizado_en: '2026-11-09T15:00:00.000Z',
      }
      const spy = backend({
        mesas: mesasBase,
        usuarios: personal,
        configuracion: configBase,
        escrituras: (url, metodo) => (url.endsWith('/configuracion') && metodo === 'PUT' ? json(guardada) : json({}, 404)),
      })
      montar()
      const form = await abrirRestaurante()

      fireEvent.change(within(form).getByLabelText('PROPINA SUGERIDA (%)'), { target: { value: '12,5' } })
      fireEvent.click(within(form).getByLabelText('Domingo'))
      fireEvent.change(within(form).getByLabelText('Abre el Domingo'), { target: { value: '12:00' } })
      fireEvent.change(within(form).getByLabelText('Cierra el Domingo'), { target: { value: '21:00' } })
      fireEvent.click(within(form).getByRole('button', { name: /GUARDAR CAMBIOS/ }))

      expect(await screen.findByRole('status')).toHaveTextContent('Datos del restaurante guardados.')
      expect(escriturasDe(spy)).toEqual([
        {
          url: expect.stringMatching(/\/configuracion$/),
          metodo: 'PUT',
          cuerpo: {
            propina_sugerida_pct: 12.5,
            horario: { lunes: { abre: '11:00', cierra: '22:00' }, domingo: { abre: '12:00', cierra: '21:00' } },
          },
        },
      ])
      expect(within(form).getByLabelText('PROPINA SUGERIDA (%)')).toHaveValue('12.5')

      // Sin tocar nada más no hay segundo PUT: se compara contra lo ya guardado.
      fireEvent.click(within(form).getByRole('button', { name: /GUARDAR CAMBIOS/ }))
      expect(await screen.findByText('No hay cambios que guardar.')).toBeInTheDocument()
      expect(escriturasDe(spy)).toHaveLength(1)
    })

    it('valida antes de mandar: un día abierto sin hora de cierre no llega al servidor', async () => {
      sesionComo('admin')
      const spy = backend({ mesas: mesasBase, usuarios: personal, configuracion: configBase })
      montar()
      const form = await abrirRestaurante()

      fireEvent.click(within(form).getByLabelText('Martes'))
      fireEvent.change(within(form).getByLabelText('Abre el Martes'), { target: { value: '11:00' } })
      fireEvent.click(within(form).getByRole('button', { name: /GUARDAR CAMBIOS/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Martes: pon la hora de apertura y de cierre (HH:MM).')
      expect(escriturasDe(spy)).toEqual([])
    })

    it('si el servidor rechaza el cambio, muestra su mensaje y conserva lo escrito', async () => {
      sesionComo('admin')
      backend({
        mesas: mesasBase,
        usuarios: personal,
        configuracion: configBase,
        escrituras: () => json({ error: 'moneda debe ser un código ISO 4217 de 3 letras' }, 400),
      })
      montar()
      const form = await abrirRestaurante()

      fireEvent.change(within(form).getByLabelText('MONEDA'), { target: { value: 'xyz' } })
      fireEvent.click(within(form).getByRole('button', { name: /GUARDAR CAMBIOS/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó: moneda debe ser un código ISO 4217 de 3 letras')
      expect(within(form).getByLabelText('MONEDA')).toHaveValue('XYZ')
    })

    it('si no carga, dice por qué y deja reintentar, sin un formulario con datos inventados', async () => {
      sesionComo('admin')
      let intentos = 0
      backend({
        mesas: mesasBase,
        usuarios: personal,
        configuracion: () => (++intentos === 1 ? json({ error: 'Error interno del servidor' }, 500) : json(configBase)),
      })
      montar()
      fireEvent.click(await screen.findByRole('tab', { name: 'RESTAURANTE' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Error interno del servidor')
      expect(screen.queryByRole('form', { name: 'Datos del restaurante' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /REINTENTAR/ }))
      expect(await screen.findByRole('form', { name: 'Datos del restaurante' })).toBeInTheDocument()
    })
  })

  it('errorDeClave: mínimo 8 caracteres y máximo 72 bytes (las tildes cuentan doble)', () => {
    expect(errorDeClave('1234567')).toMatch(/8 caracteres/)
    expect(errorDeClave('12345678')).toBeNull()
    expect(errorDeClave('a'.repeat(72))).toBeNull()
    expect(errorDeClave('ñ'.repeat(37))).toMatch(/72 bytes/) // 37 caracteres, 74 bytes
  })
})
