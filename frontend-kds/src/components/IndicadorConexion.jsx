/**
 * Estado del socket. Importa mas de lo que parece: si el tiempo real esta
 * caido, la pantalla se queda congelada sin que nada mas lo delate, y el
 * cocinero tiene que saber que lo que ve puede estar viejo.
 *
 * Desconectado va en rojo y no en ambar: no es una advertencia menor, es que
 * las comandas nuevas no estan entrando.
 */
export default function IndicadorConexion({ conectado }) {
  const color = conectado ? 'var(--color-texto)' : 'var(--color-alerta)'

  return (
    <p
      className="display flex items-center gap-2 rounded-full border px-4 py-1 text-base font-semibold"
      style={{ borderColor: color, color }}
      role="status"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {conectado ? 'En vivo' : 'Desconectado'}
    </p>
  )
}
