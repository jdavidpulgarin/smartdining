import { AlertCircle, ChefHat, LogOut, RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import Columna from '../components/Columna'
import IndicadorConexion from '../components/IndicadorConexion'
import { MENSAJE_SESION_CAIDA, useAuth } from '../context/AuthContext'
import { COLUMNAS, comandasDeColumna } from '../lib/comandas'
import { useTablero } from '../lib/useTablero'

/**
 * Tablero de cocina: tres columnas por estado.
 *
 * "Listas" queda vacia tras recargar la pagina a proposito: GET
 * /api/kds/comandas solo devuelve 'recibido' y 'en_preparacion', asi que esa
 * columna se llena con los order:status que llegan en vivo. Está documentado en
 * el README; cambiar el backend es otra actividad.
 */
export default function Tablero() {
  const { usuario, token, cerrarSesion } = useAuth()

  const alCaducarSesion = useCallback(() => {
    cerrarSesion(MENSAJE_SESION_CAIDA)
  }, [cerrarSesion])

  const { estado, conectado, ahora, recargar } = useTablero({ token, alCaducarSesion })

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-borde)] bg-[color:var(--color-panel)] px-5 py-3">
        <div className="flex items-center gap-3">
          <ChefHat size={30} className="text-[color:var(--color-listas)]" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold leading-none">Cocina</h1>
            <p className="text-sm text-[color:var(--color-texto-suave)]">
              {usuario?.nombre || usuario?.email} · {usuario?.rol}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <IndicadorConexion conectado={conectado} />

          <button
            type="button"
            onClick={recargar}
            className="flex items-center gap-2 rounded-lg border border-[color:var(--color-borde)] px-3 py-2 text-base font-semibold"
          >
            <RefreshCw
              size={18}
              className={estado.cargando ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            Actualizar
          </button>

          <button
            type="button"
            onClick={() => cerrarSesion()}
            className="flex items-center gap-2 rounded-lg border border-[color:var(--color-alerta)] px-3 py-2 text-base font-semibold text-[color:var(--color-alerta)]"
          >
            <LogOut size={18} aria-hidden="true" />
            Salir
          </button>
        </div>
      </header>

      {estado.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--color-alerta)]/15 px-5 py-3">
          <p className="flex items-center gap-2 text-lg text-[color:var(--color-alerta)]">
            <AlertCircle size={20} aria-hidden="true" />
            {estado.error}
          </p>
          <button
            type="button"
            onClick={recargar}
            className="rounded-lg bg-[color:var(--color-alerta)] px-4 py-2 text-base font-bold text-[color:var(--color-fondo)]"
          >
            Reintentar
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 gap-3 p-3">
        {COLUMNAS.map((columna) => (
          <Columna
            key={columna.estado}
            estado={columna.estado}
            titulo={columna.titulo}
            comandas={comandasDeColumna(estado, columna.estado)}
            ahora={ahora}
            nota={
              columna.estado === 'listo'
                ? 'Esta columna se llena con los avisos en vivo y se vacía al recargar'
                : null
            }
          />
        ))}
      </main>
    </div>
  )
}
