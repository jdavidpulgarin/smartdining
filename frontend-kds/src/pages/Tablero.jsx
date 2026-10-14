import {
  AlertCircle,
  LogOut,
  Maximize,
  Minimize,
  Moon,
  RefreshCw,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import BarraResumen from '../components/BarraResumen'
import Columna from '../components/Columna'
import IndicadorConexion from '../components/IndicadorConexion'
import Logo from '../components/Logo'
import { MENSAJE_SESION_CAIDA, useAuth } from '../context/AuthContext'
import { cerrarSonido, prepararSonido, sonarAvisoDeComanda } from '../lib/aviso-sonoro'
import { COLUMNAS, comandasDeColumna, contarComandasActivas } from '../lib/comandas'
import {
  CLAVE_SONIDO,
  CLAVE_TEMA,
  guardarPreferencia,
  leerPreferencia,
  sonidoInicial,
  temaInicial,
} from '../lib/preferencias'
import { useCronometro } from '../hooks/useCronometro'
import { useTablero } from '../lib/useTablero'

/**
 * Tablero de cocina: tres columnas por estado, con los botones de avance.
 *
 * Desde D-09 la columna "Listas" también viene de la API, así que sobrevive a
 * una recarga o a una reconexión.
 */
export default function Tablero() {
  const { usuario, token, cerrarSesion } = useAuth()

  const [tema, setTema] = useState(() =>
    temaInicial(
      leerPreferencia(CLAVE_TEMA),
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: light)').matches
        : null
    )
  )
  const [sonido, setSonido] = useState(() => sonidoInicial(leerPreferencia(CLAVE_SONIDO)))
  const [pantallaCompleta, setPantallaCompleta] = useState(false)

  // El tema se aplica en <html> para que lo vean también los estilos base.
  useEffect(() => {
    document.documentElement.dataset.tema = tema
  }, [tema])

  // Si el sonido venía activado de una sesión anterior, el AudioContext no se
  // puede crear hasta que haya un gesto; el primer toque en cualquier botón de
  // la barra lo prepara. Se intenta aquí por si el navegador ya lo permite.
  useEffect(() => {
    if (sonido) prepararSonido()
    return () => {
      if (!sonido) cerrarSonido()
    }
  }, [sonido])

  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  const alCaducarSesion = useCallback(() => {
    cerrarSesion(MENSAJE_SESION_CAIDA)
  }, [cerrarSesion])

  // Solo suena por una comanda que entra por el socket (nunca al recargar ni al
  // reconectar: eso lo decide useTablero).
  const alLlegarComandaNueva = useCallback(() => {
    if (sonido) sonarAvisoDeComanda()
  }, [sonido])

  const { estado, conectado, recargar, avanzar } = useTablero({
    token,
    alCaducarSesion,
    alLlegarComandaNueva,
  })

  // Un solo intervalo de 1 s para todas las tarjetas.
  const ahora = useCronometro()

  async function alternarSonido() {
    if (sonido) {
      setSonido(false)
      guardarPreferencia(CLAVE_SONIDO, false)
      cerrarSonido()
      return
    }
    // Este clic ES el gesto que el navegador exige para permitir audio.
    const listo = await prepararSonido()
    setSonido(listo)
    guardarPreferencia(CLAVE_SONIDO, listo)
  }

  function alternarTema() {
    const siguiente = tema === 'oscuro' ? 'claro' : 'oscuro'
    setTema(siguiente)
    guardarPreferencia(CLAVE_TEMA, siguiente)
  }

  async function alternarPantallaCompleta() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      // Algunos navegadores la bloquean o no la soportan: no es crítico.
    }
  }

  // Solo-icono: en la cabecera del mockup lo unico que lleva texto es SALIR,
  // que es el boton del que mas conviene no dudar. El resto se explica con el
  // title y con aria-label, que ademas es lo que lee un lector de pantalla.
  const botonBarra =
    'grid h-12 w-12 place-items-center rounded-xl border border-[color:var(--color-borde)] text-[color:var(--color-texto)]'

  // El reloj de pared se cuelga del mismo latido de un segundo que los
  // cronometros de las tarjetas: ni un timer mas.
  const horaDePared = new Date(ahora).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const activas = contarComandasActivas(estado)

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-borde)] bg-[color:var(--color-panel)] px-5 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <Logo
            texto="Cocina"
            titulo={
              usuario ? `${usuario.nombre || usuario.email} · ${usuario.rol}` : undefined
            }
          />
          <IndicadorConexion conectado={conectado} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="display mr-2 text-3xl font-bold tabular-nums" aria-label="Hora">
            {horaDePared}
          </p>

          <button
            type="button"
            onClick={alternarSonido}
            className={botonBarra}
            aria-pressed={sonido}
            aria-label={sonido ? 'Silenciar el aviso de comanda nueva' : 'Activar el aviso sonoro'}
            title={sonido ? 'Silenciar el aviso de comanda nueva' : 'Activar el aviso sonoro'}
          >
            {sonido ? <Volume2 size={22} aria-hidden="true" /> : <VolumeX size={22} aria-hidden="true" />}
          </button>

          <button
            type="button"
            onClick={recargar}
            className={botonBarra}
            aria-label="Actualizar las comandas"
            title="Actualizar las comandas"
          >
            <RefreshCw
              size={22}
              className={estado.cargando ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={alternarPantallaCompleta}
            className={botonBarra}
            aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
            title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {pantallaCompleta ? (
              <Minimize size={22} aria-hidden="true" />
            ) : (
              <Maximize size={22} aria-hidden="true" />
            )}
          </button>

          {/* El mockup es solo oscuro, pero el tema claro existe y sin boton
              quedaria inalcanzable: se queda, con la misma forma que los demas. */}
          <button
            type="button"
            onClick={alternarTema}
            className={botonBarra}
            aria-label="Cambiar entre claro y oscuro"
            title="Cambiar entre claro y oscuro"
          >
            {tema === 'oscuro' ? <Sun size={22} aria-hidden="true" /> : <Moon size={22} aria-hidden="true" />}
          </button>

          <button
            type="button"
            onClick={() => {
              cerrarSonido()
              cerrarSesion()
            }}
            className="display flex h-12 items-center gap-2 rounded-xl border border-[color:var(--color-borde)] px-4 text-xl font-semibold"
          >
            <LogOut size={22} aria-hidden="true" />
            Salir
          </button>
        </div>
      </header>

      <BarraResumen activas={activas} />

      {estado.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[color:var(--color-alerta)]/15 px-5 py-3">
          <p className="flex items-center gap-2 text-lg text-[color:var(--color-alerta)]">
            <AlertCircle size={20} aria-hidden="true" />
            {estado.error}
          </p>
          <button
            type="button"
            onClick={recargar}
            className="h-12 rounded-lg bg-[color:var(--color-alerta)] px-4 text-base font-bold text-[color:var(--color-fondo)]"
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
            onAvanzar={avanzar}
            vacio={columna.vacio}
          />
        ))}
      </main>
    </div>
  )
}
