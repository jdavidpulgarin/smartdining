/**
 * Combina el menú actual con uno nuevo recibido.
 * Si el nuevo origen es 'fija' y el anterior era 'vivo', conserva el anterior
 * para que una caída momentánea de red no reemplace la carta en vivo por la fija.
 * En cualquier otro caso, devuelve el nuevo.
 */
export function combinarMenu(anterior, nuevo) {
  if (anterior?.origen === 'vivo' && nuevo?.origen === 'fija') {
    return anterior;
  }
  return nuevo;
}

export default combinarMenu;
