/**
 * Estado del socket. Importa mas de lo que parece: si el tiempo real esta
 * caido, la pantalla se queda congelada sin que nada mas lo delate, y el
 * cocinero tiene que saber que lo que ve puede estar viejo.
 *
 * Desconectado va en rojo y no en ambar: no es una advertencia menor, es que
 * las comandas nuevas no estan entrando.
 */
export default function IndicadorConexion({ conectado }) {
  // El color sale de `conectado`, igual que antes; ahora lo pone la clase.
  return (
    <p className={conectado ? 'tc-conexion' : 'tc-conexion es-desconectado'} role="status">
      <span className="tc-conexion-punto shrink-0" aria-hidden="true" />
      {conectado ? 'En vivo' : 'Desconectado'}
    </p>
  )
}
