import { AlertCircle, ChefHat, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

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
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function alEnviar(evento) {
    evento.preventDefault()
    setError(null)
    limpiarAviso()
    setEnviando(true)
    try {
      await entrar(email.trim(), password)
    } catch (fallo) {
      setError(fallo.message || 'No se pudo entrar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={alEnviar}
        className="w-full max-w-md rounded-2xl border border-[color:var(--color-borde)] bg-[color:var(--color-panel)] p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <ChefHat size={36} className="text-[color:var(--color-listas)]" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-bold leading-tight">Cocina</h1>
            <p className="text-base text-[color:var(--color-texto-suave)]">SmartDining · KDS</p>
          </div>
        </div>

        {aviso && (
          <p className="mb-4 rounded-lg bg-[color:var(--color-preparacion)]/15 p-3 text-base text-[color:var(--color-preparacion)]">
            {aviso}
          </p>
        )}

        <label className="block text-base font-semibold" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 mb-4 w-full rounded-lg border border-[color:var(--color-borde)] bg-[color:var(--color-fondo)] p-3 text-lg text-[color:var(--color-texto)] outline-none focus:border-[color:var(--color-nuevas)]"
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
          className="mt-1 mb-6 w-full rounded-lg border border-[color:var(--color-borde)] bg-[color:var(--color-fondo)] p-3 text-lg text-[color:var(--color-texto)] outline-none focus:border-[color:var(--color-nuevas)]"
        />

        {error && (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-[color:var(--color-alerta)]/15 p-3 text-base text-[color:var(--color-alerta)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--color-listas)] p-4 text-xl font-bold text-[color:var(--color-fondo)] disabled:opacity-60"
        >
          {enviando && <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />}
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="mt-4 text-center text-sm text-[color:var(--color-texto-suave)]">
          Solo para usuarios de cocina o administración.
        </p>
      </form>
    </main>
  )
}
