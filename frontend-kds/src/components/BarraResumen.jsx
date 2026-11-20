import { UMBRAL_AMBAR, UMBRAL_ROJO, etiquetaDeNivel } from '../lib/espera'

/**
 * La franja bajo la cabecera: cuanto trabajo hay encima y que significan los
 * colores de las tarjetas.
 *
 * La leyenda no es decorativa. El semaforo pinta tarjetas de ambar y rojo, y
 * sin esto nadie sabe a partir de que minuto; con ella, un cocinero nuevo
 * entiende la pantalla sin que se lo expliquen.
 *
 * Ni las cifras ni los nombres se escriben aqui: salen de lib/espera, que es
 * quien decide los umbrales y como se llama cada nivel. Con los nombres a mano
 * ya paso una vez que la tarjeta dijera "Retrasada" y la leyenda "Atrasada",
 * dos nombres para una sola cosa en la misma pantalla.
 */

const NIVELES = [
  {
    color: 'var(--color-texto)',
    texto: `${etiquetaDeNivel('normal')} · menos de ${UMBRAL_AMBAR} min`,
  },
  {
    color: 'var(--color-preparacion)',
    texto: `${etiquetaDeNivel('ambar')} · ${UMBRAL_AMBAR} a ${UMBRAL_ROJO} min`,
  },
  {
    color: 'var(--color-alerta)',
    texto: `${etiquetaDeNivel('rojo')} · más de ${UMBRAL_ROJO} min`,
  },
]

export default function BarraResumen({ activas }) {
  return (
    <div className="tc-resumen">
      <p className="tc-resumen-total">
        {activas} {activas === 1 ? 'comanda activa' : 'comandas activas'}
      </p>

      <ul className="tc-leyenda">
        {NIVELES.map((nivel) => (
          <li key={nivel.texto} className="tc-leyenda-item">
            <span
              className="tc-leyenda-muestra shrink-0"
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
