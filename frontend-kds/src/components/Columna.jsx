import { ChefHat } from 'lucide-react'
import BloqueMesa from './BloqueMesa'

/**
 * Una columna del tablero, con su contador y su estado vacio.
 *
 * El color va en una regla arriba del encabezado y en el titulo; el contador
 * es neutro en las tres para que la cifra se lea igual de lejos sin que el
 * color le cambie el peso. Las tarjetas no se tinen de color de columna: lo
 * que las pinta es el semaforo de tiempos, y son dos cosas distintas.
 *
 * T10: la columna dibuja BLOQUES (una tarjeta por mesa, ver lib/bloques.js) y
 * el contador cuenta tarjetas, que es lo que el cocinero ve debajo.
 */

const COLOR = {
  recibido: 'var(--color-nuevas)',
  en_preparacion: 'var(--color-preparacion)',
  listo: 'var(--color-listas)',
}

export default function Columna({
  estado,
  titulo,
  bloques,
  ahora,
  vacio,
  conectado,
  onAvanzar,
  todoListo = {},
  onTodoListo,
  onDescartarFallos,
}) {
  const color = COLOR[estado] || 'var(--color-texto-suave)'

  return (
    <section className="tc-columna">
      <header className="tc-columna-cabecera" style={{ borderColor: color }}>
        {/* El titulo va en blanco y no en el color de la columna: tres titulos
            de colores distintos compiten entre si, y el color ya lo lleva la
            regla de arriba, que es donde se distingue sin leer. */}
        <h2 className="display tc-columna-titulo">{titulo}</h2>
        <span
          className="tc-contador"
          aria-label={`${bloques.length} ${bloques.length === 1 ? 'tarjeta' : 'tarjetas'}`}
        >
          {bloques.length}
        </span>
      </header>

      <div className="tc-pila">
        {bloques.length === 0 ? (
          // Caja punteada, no un parrafo suelto: deja claro que el hueco es el
          // sitio donde van a aparecer las comandas, y no un fallo de carga.
          //
          // Con .tema-cocina el tablero tiene fondo opaco (ya no cae sobre la
          // foto), así que el texto suave se lee directamente sobre el carbón.
          <div className="tc-vacio">
            <ChefHat size={34} className="tc-vacio-icono" aria-hidden="true" />
            <p className="display tc-vacio-titulo">{vacio?.titulo || 'Sin comandas'}</p>
            {vacio?.nota && <p className="tc-vacio-nota">{vacio.nota}</p>}
          </div>
        ) : (
          bloques.map((bloque) => (
            <BloqueMesa
              key={bloque.clave}
              bloque={bloque}
              ahora={ahora}
              conectado={conectado}
              onAvanzar={onAvanzar}
              todoListo={todoListo[bloque.clave]}
              onTodoListo={onTodoListo}
              onDescartarFallos={onDescartarFallos}
            />
          ))
        )}
      </div>
    </section>
  )
}
