import { UMBRAL_AMBAR, UMBRAL_ROJO } from '../lib/espera'

/**
 * La franja bajo la cabecera: cuanto trabajo hay encima y que significan los
 * colores de las tarjetas.
 *
 * La leyenda no es decorativa. El semaforo pinta tarjetas de ambar y rojo, y
 * sin esto nadie sabe a partir de que minuto; con ella, un cocinero nuevo
 * entiende la pantalla sin que se lo expliquen.
 *
 * Las cifras salen de los umbrales de lib/espera, no escritas a mano: si algun
 * dia la cocina decide que son 8 y 12, la leyenda cambia sola en vez de quedar
 * mintiendo.
 */

const NIVELES = [
  { color: 'var(--color-texto)', texto: `En tiempo · menos de ${UMBRAL_AMBAR} min` },
  { color: 'var(--color-preparacion)', texto: `Apurar · ${UMBRAL_AMBAR} a ${UMBRAL_ROJO} min` },
  { color: 'var(--color-alerta)', texto: `Atrasada · más de ${UMBRAL_ROJO} min` },
]

export default function BarraResumen({ activas }) {
  return (
    <div className="display flex flex-wrap items-center justify-center gap-x-8 gap-y-2 bg-[color:var(--color-marca)] px-5 py-2 text-base font-semibold text-white">
      <p>
        {activas} {activas === 1 ? 'comanda activa' : 'comandas activas'}
      </p>

      <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {NIVELES.map((nivel) => (
          <li key={nivel.texto} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-white/40"
              style={{ backgroundColor: nivel.color }}
              aria-hidden="true"
            />
            {nivel.texto}
          </li>
        ))}
      </ul>
    </div>
  )
}
