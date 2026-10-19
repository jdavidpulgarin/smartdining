/**
 * Panel de ingredientes agotados (D-10).
 *
 * Toda la decision vive aqui, en funciones puras, para poder probarla sin
 * navegador: `npm test` es `node --test` a secas, sin jsdom ni render.
 * useAgotados.js solo se queda con los efectos (pedir, PATCH, socket).
 *
 * TODO VA POR id_ingrediente, nunca por nombre: en la carta hay nombres
 * repetidos a proposito (la "Panceta Crujiente" del seed son DOS ingredientes
 * distintos, en dos pasos distintos, y cada uno se agota por su cuenta).
 * Agrupar o contar por nombre los fusionaria y apagaria el equivocado.
 */

/** De donde salen los ingredientes: la carta publica. */
export const ORIGEN = '/menu'

/** Estado del panel antes de pedir nada. */
export function estadoInicial() {
  return {
    cargando: false,
    /** Mensaje para el cocinero, o null. */
    error: null,
    /** Status HTTP del fallo, para distinguir un 403 de un fallo de red. */
    status: null,
    /** [{ id_plato, plato, pasos: [{ id_paso, paso, ingredientes: [...] }] }] */
    grupos: [],
    /** Cambios pedidos y todavia sin respuesta: { [id]: { pedido, anterior } } */
    enVuelo: {},
    /** Error por ingrediente: { [id]: mensaje } */
    errores: {},
  }
}

export function marcarCargando(estado) {
  return { ...estado, cargando: true, error: null, status: null }
}

/**
 * Un fallo al leer la carta. NO borra lo que ya hubiera en pantalla: si el
 * panel ya mostraba la lista y falla una recarga, es mejor una lista vieja con
 * un aviso que un panel en blanco.
 */
export function marcarError(estado, mensaje, status = null) {
  return { ...estado, cargando: false, error: mensaje || 'No se pudo leer la carta', status }
}

/**
 * Construye los grupos a partir de la respuesta de GET /menu.
 *
 * Conserva el orden que da la base (categorias -> platos -> pasos por `orden`),
 * que es el mismo que ve el comensal en el constructor. Los platos sin pasos se
 * omiten: no hay nada que agotar en ellos.
 *
 * LIMITE CONOCIDO: GET /menu solo devuelve platos con `disponible = true`, asi
 * que los ingredientes de un plato entero no disponible no aparecen aqui. Es la
 * unica fuente que el rol `cocina` puede leer (GET /platos/:id/pasos es de
 * admin, cajero y mesero). Esta documentado en el README.
 */
export function cargarMenu(estado, menu) {
  const categorias = Array.isArray(menu?.categorias) ? menu.categorias : []
  const grupos = []

  for (const categoria of categorias) {
    for (const plato of categoria?.platos || []) {
      const pasos = []

      for (const paso of plato?.pasos || []) {
        const ingredientes = (paso?.ingredientes || [])
          .filter((ing) => Number.isFinite(Number(ing?.id_ingrediente)))
          .map((ing) => ({
            id_ingrediente: Number(ing.id_ingrediente),
            nombre: ing.nombre || 'Sin nombre',
            disponible: ing.disponible !== false,
            id_paso: Number(paso.id_paso),
            paso: paso.nombre || 'Sin paso',
            id_plato: Number(plato.id_plato),
            plato: plato.nombre || 'Sin plato',
          }))

        if (ingredientes.length > 0) {
          pasos.push({ id_paso: Number(paso.id_paso), paso: paso.nombre || 'Sin paso', ingredientes })
        }
      }

      if (pasos.length > 0) {
        grupos.push({ id_plato: Number(plato.id_plato), plato: plato.nombre || 'Sin plato', pasos })
      }
    }
  }

  // Al recargar se descartan los errores por ingrediente: la lista que llega es
  // la verdad del servidor y un error viejo ya no describe nada.
  return { ...estado, cargando: false, error: null, status: null, grupos, errores: {} }
}

/** Todos los ingredientes, en plano. Util para contar y para buscar uno. */
export function ingredientesDe(estado) {
  const lista = []
  for (const grupo of estado?.grupos || []) {
    for (const paso of grupo.pasos || []) {
      for (const ing of paso.ingredientes || []) lista.push(ing)
    }
  }
  return lista
}

/**
 * Cuantos ingredientes estan agotados.
 *
 * Es el numero de la insignia del header. Cuenta por `id_ingrediente`, asi que
 * dos ingredientes con el mismo nombre cuentan DOS, y el mismo id repetido
 * (no deberia pasar, pero la carta la arma la base) cuenta UNO.
 */
export function contarAgotados(estado) {
  const vistos = new Set()
  for (const ing of ingredientesDe(estado)) {
    if (!ing.disponible) vistos.add(ing.id_ingrediente)
  }
  return vistos.size
}

/** Cuantos ingredientes hay en total, por id. */
export function contarIngredientes(estado) {
  return new Set(ingredientesDe(estado).map((i) => i.id_ingrediente)).size
}

/**
 * Texto comparable: sin mayusculas y sin acentos.
 *
 * En una cocina nadie escribe "Maíz" con tilde en un buscador, y "jalapeno"
 * tiene que encontrar "Jalapeño".
 */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Filtra los grupos por texto y por "solo agotados", conservando el agrupado.
 *
 * Un paso que se queda sin ingredientes desaparece, y un plato sin pasos
 * tambien: el panel no muestra cabeceras vacias.
 */
export function filtrar(estado, { texto = '', soloAgotados = false } = {}) {
  const aguja = normalizar(texto)
  const grupos = []

  for (const grupo of estado?.grupos || []) {
    const pasos = []

    for (const paso of grupo.pasos || []) {
      const ingredientes = (paso.ingredientes || []).filter((ing) => {
        if (soloAgotados && ing.disponible) return false
        if (!aguja) return true
        return normalizar(ing.nombre).includes(aguja)
      })

      if (ingredientes.length > 0) pasos.push({ ...paso, ingredientes })
    }

    if (pasos.length > 0) grupos.push({ ...grupo, pasos })
  }

  return grupos
}

/**
 * Por que el filtro no devolvio nada: para decir la frase correcta.
 *
 * 'vacio' (la carta no tiene ingredientes configurados) no es lo mismo que
 * 'sin-resultados' (hay, pero ninguno coincide): el primero es un problema de
 * la carta y el segundo, de lo que acabo de escribir.
 *
 * @returns {'vacio'|'sin-resultados'|'sin-agotados'|null}
 */
export function motivoListaVacia(estado, { texto = '', soloAgotados = false } = {}) {
  if (filtrar(estado, { texto, soloAgotados }).length > 0) return null
  if (contarIngredientes(estado) === 0) return 'vacio'
  if (soloAgotados && !normalizar(texto)) return 'sin-agotados'
  return 'sin-resultados'
}

/** Cambia el `disponible` de un ingrediente en los grupos, por id. */
function conDisponible(grupos, idIngrediente, disponible) {
  const id = Number(idIngrediente)
  return (grupos || []).map((grupo) => ({
    ...grupo,
    pasos: grupo.pasos.map((paso) => ({
      ...paso,
      ingredientes: paso.ingredientes.map((ing) =>
        ing.id_ingrediente === id ? { ...ing, disponible } : ing
      ),
    })),
  }))
}

/** El ingrediente con ese id, o null. */
export function buscarIngrediente(estado, idIngrediente) {
  const id = Number(idIngrediente)
  return ingredientesDe(estado).find((i) => i.id_ingrediente === id) || null
}

/** ¿Hay un cambio pedido y sin respuesta para este ingrediente? */
export function hayCambioEnVuelo(estado, idIngrediente) {
  return Object.hasOwn(estado?.enVuelo || {}, String(Number(idIngrediente)))
}

/**
 * Cambio OPTIMISTA: el interruptor se mueve ya, antes del PATCH.
 *
 * Se guarda el valor anterior para poder volver atras si el PATCH falla, y se
 * limpia el error previo de esa fila: el cocinero acaba de reintentar y dejarle
 * el error viejo debajo del interruptor nuevo solo confunde.
 *
 * Si ya habia un cambio en vuelo para ese ingrediente, se conserva el `anterior`
 * del PRIMERO: es el unico valor al que tiene sentido volver si todo falla.
 */
export function marcarEnVuelo(estado, idIngrediente, disponible) {
  const id = Number(idIngrediente)
  const actual = buscarIngrediente(estado, id)
  if (!actual) return estado

  const yaEnVuelo = estado.enVuelo[String(id)]
  const errores = { ...estado.errores }
  delete errores[String(id)]

  return {
    ...estado,
    grupos: conDisponible(estado.grupos, id, disponible),
    enVuelo: {
      ...estado.enVuelo,
      [String(id)]: {
        pedido: disponible,
        anterior: yaEnVuelo ? yaEnVuelo.anterior : actual.disponible,
      },
    },
    errores,
  }
}

/**
 * El PATCH respondio 200: se fija el valor que dijo el servidor y se deja de
 * estar en vuelo. Se usa el valor de la respuesta, no el que se pidio, porque
 * el servidor es quien manda.
 */
export function confirmarCambio(estado, idIngrediente, disponible) {
  const id = Number(idIngrediente)
  const enVuelo = { ...estado.enVuelo }
  delete enVuelo[String(id)]

  return {
    ...estado,
    grupos: conDisponible(estado.grupos, id, disponible),
    enVuelo,
  }
}

/**
 * El PATCH fallo: vuelve al valor de antes y deja el mensaje EN LA FILA.
 *
 * El mensaje va en la fila y no en un aviso global porque es ahi donde el
 * cocinero esta mirando, igual que hace la tarjeta con los 409 del trigger.
 */
export function revertirCambio(estado, idIngrediente, mensaje) {
  const id = Number(idIngrediente)
  const pendiente = estado.enVuelo[String(id)]
  const enVuelo = { ...estado.enVuelo }
  delete enVuelo[String(id)]

  const grupos = pendiente
    ? conDisponible(estado.grupos, id, pendiente.anterior)
    : estado.grupos

  return {
    ...estado,
    grupos,
    enVuelo,
    errores: {
      ...estado.errores,
      [String(id)]: mensaje || 'No se pudo cambiar la disponibilidad',
    },
  }
}

/** Quita el error de una fila (al volver a tocar, o al cerrar el aviso). */
export function limpiarError(estado, idIngrediente) {
  const errores = { ...estado.errores }
  delete errores[String(Number(idIngrediente))]
  return { ...estado, errores }
}

/**
 * Llega `ingrediente:disponibilidad` del socket (EVENTS.md §5.3).
 *
 * El evento NO trae eventId —solo { id_ingrediente, disponible, emitidoEn }—,
 * asi que no se puede deduplicar por id como en el tablero. La desambiguacion
 * es por VALOR contra lo que yo pedi, y con un booleano alcanza:
 *
 *   - sin cambio en vuelo -> se aplica: lo movio otra pantalla.
 *   - en vuelo y el evento dice LO MISMO que pedi -> no se toca nada. Es el eco
 *     de mi propio cambio y la pantalla ya lo muestra: repintar aqui seria el
 *     parpadeo.
 *   - en vuelo y el evento dice lo CONTRARIO -> gana el evento y se deja de
 *     estar en vuelo: otra pantalla escribio despues. Cuando mi PATCH responda,
 *     su valor volvera a aplicarse (la ultima escritura gana, que es lo correcto
 *     para un booleano: no hay nada que fusionar).
 *
 * Un id que no esta en la carta cargada se ignora sin ruido: puede ser de un
 * plato no disponible, que GET /menu no devuelve.
 */
export function aplicarEvento(estado, evento) {
  const id = Number(evento?.id_ingrediente)
  if (!Number.isFinite(id)) return estado
  if (typeof evento?.disponible !== 'boolean') return estado
  if (!buscarIngrediente(estado, id)) return estado

  const pendiente = estado.enVuelo[String(id)]

  if (pendiente) {
    if (pendiente.pedido === evento.disponible) return estado

    const enVuelo = { ...estado.enVuelo }
    delete enVuelo[String(id)]
    return { ...estado, grupos: conDisponible(estado.grupos, id, evento.disponible), enVuelo }
  }

  return { ...estado, grupos: conDisponible(estado.grupos, id, evento.disponible) }
}

/**
 * Que mensaje enseña el panel arriba.
 *
 * El 403 se separa a proposito: con rol `cocina` no deberia pasar nunca, pero
 * si el backend cambia de criterio conviene que se lea "no tienes permiso" y no
 * un fallo de red, que invita a reintentar en vano.
 *
 * El 401 no sale aqui: services/api.js ya dispara el cierre de sesion y la app
 * se va al login sola.
 *
 * @returns {'cargando'|'prohibido'|'error'|null}
 */
export function avisoDelPanel(estado) {
  if (estado?.cargando && estado.grupos.length === 0) return 'cargando'
  if (estado?.status === 403) return 'prohibido'
  if (estado?.error) return 'error'
  return null
}

/**
 * Texto del interruptor. Nunca solo color: bajo las luces de una cocina, y en
 * el tema claro, el color por si solo no basta.
 */
export function rotuloDisponibilidad(disponible) {
  return disponible ? 'Disponible' : 'Agotado'
}
