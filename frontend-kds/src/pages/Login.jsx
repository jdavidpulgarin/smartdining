import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { prepararSonido } from '../lib/aviso-sonoro'
import { CLAVE_SONIDO, guardarPreferencia } from '../lib/preferencias'

/**
 * Entrada a la cocina.
 *
 * La contrasena solo vive en el estado del formulario y viaja en el cuerpo del
 * login: no se guarda en ningun storage ni se vuelve a leer.
 */
export default function Login() {
  const { entrar, aviso, limpiarAviso } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [conSonido, setConSonido] = useState(true)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function alEnviar(evento) {
    evento.preventDefault()
    setError(null)
    limpiarAviso()
    setEnviando(true)

    // Este envio ES el gesto de usuario que el navegador exige para crear el
    // AudioContext. Si el aviso se preparara ya en el tablero, el navegador lo
    // bloquearia por no venir de un gesto y la casilla habria mentido: se
    // veria activada y no sonaria nada hasta tocar otro boton.
    if (conSonido) {
      const listo = await prepararSonido()
      guardarPreferencia(CLAVE_SONIDO, listo)
    } else {
      guardarPreferencia(CLAVE_SONIDO, false)
    }

    try {
      await entrar(email.trim(), password)
    } catch (fallo) {
      setError(fallo.message || 'No se pudo entrar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Logo texto="SmartDining" />
        <p className="display text-base font-semibold text-[color:var(--color-texto-suave)]">
          Pantalla de cocina
        </p>
      </header>

      <p className="display bg-[color:var(--color-marca)] px-6 py-2 text-center text-base font-semibold text-white">
        Solo personal de cocina · las comandas llegan en tiempo real
      </p>

      <main className="flex flex-1 flex-wrap items-center justify-center gap-10 p-6 lg:justify-between lg:px-16">
        {/* El reclamo de la izquierda no es relleno: esta pantalla se deja
            abierta en un monitor del pase, y asi se sabe de un vistazo cual de
            las tres aplicaciones de SmartDining es sin acercarse a leer. */}
        <div className="max-w-lg">
          <h1 className="display text-7xl font-bold leading-[0.9] text-[color:var(--color-marca)] lg:text-8xl">
            A la
            <br />
            cocina
          </h1>
          <p className="mt-5 text-lg text-[color:var(--color-texto-suave)]">
            Comandas en tres columnas, con el tiempo de cada una a la vista y aviso sonoro cuando
            entra una nueva.
          </p>
        </div>

        <form
          onSubmit={alEnviar}
          className="w-full max-w-md rounded-2xl border border-[color:var(--color-borde)] bg-[color:var(--color-panel)] p-8"
        >
          <h2 className="display mb-6 text-3xl font-bold">Entrar al tablero</h2>

          {aviso && (
            <p className="mb-4 rounded-lg bg-[color:var(--color-preparacion)]/15 p-3 text-base text-[color:var(--color-preparacion)]">
              {aviso}
            </p>
          )}

          <label className="block text-base font-semibold" htmlFor="email">
            Correo de cocina
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 mb-4 w-full rounded-lg border border-[color:var(--color-borde)] bg-[color:var(--color-fondo)] p-3 text-lg text-[color:var(--color-texto)] outline-none focus:border-[color:var(--color-marca)]"
          />

          <label className="block text-base font-semibold" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 mb-5 w-full rounded-lg border border-[color:var(--color-borde)] bg-[color:var(--color-fondo)] p-3 text-lg text-[color:var(--color-texto)] outline-none focus:border-[color:var(--color-marca)]"
          />

          <label className="mb-6 flex items-center gap-3 text-base" htmlFor="sonido">
            <input
              id="sonido"
              type="checkbox"
              checked={conSonido}
              onChange={(e) => setConSonido(e.target.checked)}
              className="h-6 w-6 shrink-0 accent-[color:var(--color-marca)]"
            />
            Activar aviso sonoro al entrar
          </label>

          {error && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-[color:var(--color-alerta)]/15 p-3 text-base text-[color:var(--color-alerta)]">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="display flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--color-marca)] p-4 text-2xl font-bold text-white disabled:opacity-60"
          >
            {enviando && <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />}
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="mt-4 text-center text-sm text-[color:var(--color-texto-suave)]">
            Solo entran usuarios con rol cocina o administrador.
          </p>
        </form>
      </main>
    </div>
  )
}
