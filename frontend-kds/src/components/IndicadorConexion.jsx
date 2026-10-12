import { Wifi, WifiOff } from 'lucide-react'

/**
 * Estado del socket. Importa mas de lo que parece: si el tiempo real esta
 * caido, la pantalla se queda congelada sin que nada mas lo delate, y el
 * cocinero tiene que saber que lo que ve puede estar viejo.
 */
export default function IndicadorConexion({ conectado }) {
  const color = conectado ? 'var(--color-listas)' : 'var(--color-preparacion)'

  return (
    <p
      className="flex items-center gap-2 rounded-full border px-3 py-1 text-base font-semibold"
      style={{ borderColor: color, color }}
      role="status"
    >
      {conectado ? <Wifi size={18} aria-hidden="true" /> : <WifiOff size={18} aria-hidden="true" />}
      {conectado ? 'Conectado' : 'Reconectando…'}
    </p>
  )
}
