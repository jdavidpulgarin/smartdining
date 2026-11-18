/**
 * Panel de agotados: ingredientes (D-10) y platos (D-14).
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
    /** La rama de PLATOS (D-14), con su propio libro de cambios. */
    platos: estadoPlatosInicial(),
  }
}

/**
 * Estado de la seccion de platos.
 *
 * Va en su propia rama y no suelto al lado de los ingredientes porque es una
 * lista distinta, de otra ruta (`GET /platos`), que puede fallar por su cuenta:
 * si la carta carga y los platos no, el panel tiene que poder avisar de un lado
 * sin apagar el otro.
 */
export function estadoPlatosInicial() {
  return {
    cargando: false,
    error: null,
    status: null,
    /** [{ id_plato, nombre, disponible, agotado_por_stock? }] */
    lista: [],
    /** Cambios pedidos y sin respuesta: { [id]: { pedido, anterior } } */
    enVuelo: {},
    /** Error por plato: { [id]: mensaje } */
    errores: {},
    /**
     * Sello del ultimo `plato:disponibilidad` aplicado, en ms: { [id]: ms }.
     *
     * Es lo que permite descartar un evento MAS VIEJO que lo que ya se pinto.
     * Con varias pantallas de cocina los eventos pueden llegar desordenados (el
     * socket-server los difunde a todos y la red no garantiza el orden), y
     * aplicar el viejo despues del nuevo dejaria el interruptor al reves.
     */
    visto: {},
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

/* -------------------------------------------------------------------------- *
 * El libro de cambios en vuelo.
 *
 * Ingredientes y platos hacen EXACTAMENTE lo mismo con sus interruptores
 * (optimista, con reversion y con el error en la fila), solo cambia la lista
 * sobre la que escriben. Esa parte vive aqui una vez, en funciones que reciben
 * y devuelven la pareja { enVuelo, errores }, para que una correccion al
 * comportamiento no haya que hacerla en dos sitios.
 * -------------------------------------------------------------------------- */

/**
 * Se pide un cambio: se anota como en vuelo y se limpia el error previo de esa
 * fila (quien acaba de reintentar no necesita el error viejo debajo).
 *
 * Si ya habia un cambio en vuelo para ese id, se conserva el `anterior` del
 * PRIMERO: es el unico valor al que tiene sentido volver si todo falla.
 */
function anotarPedido({ enVuelo, errores }, id, pedido, anterior) {
  const clave = String(id)
  const previo = enVuelo[clave]
  const sinError = { ...errores }
  delete sinError[clave]

  return {
    enVuelo: { ...enVuelo, [clave]: { pedido, anterior: previo ? previo.anterior : anterior } },
    errores: sinError,
  }
}

/** Llego respuesta: deja de estar en vuelo. */
function anotarRespuesta({ enVuelo, errores }, id) {
  const resto = { ...enVuelo }
  delete resto[String(id)]
  return { enVuelo: resto, errores }
}

/**
 * Fallo: deja de estar en vuelo, guarda el mensaje EN SU FILA y dice a que
 * valor hay que volver (`anterior`, o undefined si no habia nada pedido).
 *
 * El mensaje va en la fila y no en un aviso global porque es ahi donde esta
 * mirando el cocinero, igual que hace la tarjeta con los 409 del trigger.
 */
function anotarFallo({ enVuelo, errores }, id, mensaje, porDefecto) {
  const clave = String(id)
  const pendiente = enVuelo[clave]
  const resto = { ...enVuelo }
  delete resto[clave]

  return {
    enVuelo: resto,
    errores: { ...errores, [clave]: mensaje || porDefecto },
    anterior: pendiente ? pendiente.anterior : undefined,
  }
}

/** Quita el error de una fila del libro. */
function anotarSinError({ enVuelo, errores }, id) {
  const resto = { ...errores }
  delete resto[String(Number(id))]
  return { enVuelo, errores: resto }
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

  const libro = anotarPedido(estado, id, disponible, actual.disponible)

  return {
    ...estado,
    grupos: conDisponible(estado.grupos, id, disponible),
    ...libro,
  }
}

/**
 * El PATCH respondio 200: se fija el valor que dijo el servidor y se deja de
 * estar en vuelo. Se usa el valor de la respuesta, no el que se pidio, porque
 * el servidor es quien manda.
 */
export function confirmarCambio(estado, idIngrediente, disponible) {
  const id = Number(idIngrediente)

  return {
    ...estado,
    grupos: conDisponible(estado.grupos, id, disponible),
    ...anotarRespuesta(estado, id),
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
  const { anterior, ...libro } = anotarFallo(
    estado,
    id,
    mensaje,
    'No se pudo cambiar la disponibilidad'
  )

  return {
    ...estado,
    grupos: anterior === undefined ? estado.grupos : conDisponible(estado.grupos, id, anterior),
    ...libro,
  }
}

/** Quita el error de una fila (al volver a tocar, o al cerrar el aviso). */
export function limpiarError(estado, idIngrediente) {
  return { ...estado, ...anotarSinError(estado, idIngrediente) }
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

/* ========================================================================== *
 * PLATOS (D-14)
 *
 * Mismo interruptor que el de ingredientes, sobre otra lista. Se separa porque
 * la fuente es otra: `GET /platos`, no `GET /menu`. El menu NO sirve aqui, y no
 * es un detalle: obtener_menu_completo filtra por `p.disponible = TRUE`, asi que
 * un plato recien agotado desapareceria de la lista y no habria forma de
 * reponerlo desde el panel. `GET /platos` devuelve todos, agotados incluidos.
 * ========================================================================== */

/** De donde salen los platos. Publica, como /menu. */
export const ORIGEN_PLATOS = '/platos'

/** Pone la rama de platos en "cargando", sin borrar lo que ya se ve. */
export function marcarCargandoPlatos(estado) {
  return { ...estado, platos: { ...estado.platos, cargando: true, error: null, status: null } }
}

/** Fallo al leer los platos. Igual que en la carta: NO borra la lista vieja. */
export function marcarErrorPlatos(estado, mensaje, status = null) {
  return {
    ...estado,
    platos: {
      ...estado.platos,
      cargando: false,
      error: mensaje || 'No se pudieron leer los platos',
      status,
    },
  }
}

/**
 * Un plato de GET /platos, con los dos motivos separados (ISSUE #137).
 *
 * La fila de la base trae DOS columnas y hay que mirar las dos:
 *
 *   - `disponible`: el interruptor MANUAL de la cocina. Es el que mueve el
 *     boton de este panel.
 *   - `stock_suficiente`: lo calcula la base desde el stock de la receta
 *     (P-19). El panel no lo puede cambiar.
 *
 * Lo que la fila muestra como "Disponible" es el EFECTIVO, el AND de los dos.
 * Antes solo se miraba `disponible`, asi que un plato agotado por inventario se
 * veia AGOTADO en vivo (por el evento) y volvia a DISPONIBLE al recargar.
 *
 * Se guardan los tres: `disponible` (lo que se muestra),
 * `disponible_manual` (lo que el boton conmuta) y `agotado_por_stock` (para la
 * etiqueta del motivo, que ya existia esperando este dato).
 *
 * `stock_suficiente` ausente se trata como CON stock: es el DEFAULT de la
 * columna y el valor de un plato sin receta, que no controla inventario. Asi, un
 * backend viejo que no mande el campo se comporta como antes.
 */
function platoDeLaApi(p) {
  const manual = p.disponible !== false
  const conStock = p.stock_suficiente !== false

  const plato = {
    id_plato: Number(p.id_plato),
    nombre: p.nombre || 'Sin nombre',
    disponible: manual && conStock,
    disponible_manual: manual,
    stock_suficiente: conStock,
  }

  // Compatibilidad: si algun dia el backend manda el motivo ya resuelto, se
  // respeta. Lo normal es deducirlo de stock_suficiente (ver motivoAgotado).
  if (typeof p.agotado_por_stock === 'boolean') plato.agotado_por_stock = p.agotado_por_stock

  return plato
}

/**
 * Carga la lista desde la respuesta de GET /platos.
 *
 * Conserva el orden que da la base (por id_plato) y se queda SOLO con los
 * campos que el panel usa (ver platoDeLaApi).
 */
export function cargarPlatos(estado, filas) {
  const lista = (Array.isArray(filas) ? filas : [])
    // Entero POSITIVO, el mismo criterio que usa el backend para el :id de la
    // URL. Con `Number.isFinite` a secas no basta: Number(null) es 0, y una
    // fila rota entraria en la lista como el plato numero 0.
    .filter((p) => Number.isInteger(Number(p?.id_plato)) && Number(p.id_plato) > 0)
    .map(platoDeLaApi)

  return {
    ...estado,
    // Los errores por fila se descartan: la lista que llega es la verdad del
    // servidor y un error viejo ya no describe nada. El sello de los eventos
    // (`visto`) tambien, porque lo que acaba de leerse es mas nuevo que
    // cualquier evento anterior.
    platos: {
      ...estado.platos,
      cargando: false,
      error: null,
      status: null,
      lista,
      errores: {},
      visto: {},
    },
  }
}

/** La lista de platos, tal cual. */
export function platosDe(estado) {
  return estado?.platos?.lista || []
}

/** El plato con ese id, o null. */
export function buscarPlato(estado, idPlato) {
  const id = Number(idPlato)
  return platosDe(estado).find((p) => p.id_plato === id) || null
}

/** Cuantos platos estan agotados (por id, como en ingredientes). */
export function contarPlatosAgotados(estado) {
  const vistos = new Set()
  for (const plato of platosDe(estado)) {
    if (!plato.disponible) vistos.add(plato.id_plato)
  }
  return vistos.size
}

/** Cuantos platos hay, por id. */
export function contarPlatos(estado) {
  return new Set(platosDe(estado).map((p) => p.id_plato)).size
}

/** Hay un cambio pedido y sin respuesta para este plato? */
export function hayCambioEnVueloPlato(estado, idPlato) {
  return Object.hasOwn(estado?.platos?.enVuelo || {}, String(Number(idPlato)))
}

/** Filtra los platos por texto y por "solo agotados". Mismo criterio. */
export function filtrarPlatos(estado, { texto = '', soloAgotados = false } = {}) {
  const aguja = normalizar(texto)
  return platosDe(estado).filter((plato) => {
    if (soloAgotados && plato.disponible) return false
    if (!aguja) return true
    return normalizar(plato.nombre).includes(aguja)
  })
}

/**
 * Por que la lista de platos no devolvio nada.
 *
 * @returns {'vacio'|'sin-resultados'|'sin-agotados'|null}
 */
export function motivoListaVaciaPlatos(estado, { texto = '', soloAgotados = false } = {}) {
  if (filtrarPlatos(estado, { texto, soloAgotados }).length > 0) return null
  if (contarPlatos(estado) === 0) return 'vacio'
  if (soloAgotados && !normalizar(texto)) return 'sin-agotados'
  return 'sin-resultados'
}

/** Cambia el `disponible` de un plato en la lista, por id. */
function conDisponiblePlato(lista, idPlato, disponible) {
  const id = Number(idPlato)
  return (lista || []).map((plato) => {
    if (plato.id_plato !== id) return plato

    // El boton mueve el interruptor MANUAL (ISSUE #137); lo que se MUESTRA es el
    // efectivo. Encender a mano un plato sin stock lo deja agotado, que es lo
    // que va a contestar el backend y lo que ve el comensal.
    const conStock = plato.stock_suficiente !== false
    return { ...plato, disponible_manual: disponible, disponible: disponible && conStock }
  })
}

/**
 * Aplica el valor EFECTIVO que trae el evento `plato:disponibilidad`.
 *
 * El evento tiene UN solo booleano y no dice por que (EVENTS.md §5.4): un
 * `false` puede ser el interruptor o el inventario. Se usa cuando la relectura
 * del plato no esta disponible o falla, y se interpreta de la unica forma
 * sensata (ISSUE #137):
 *
 *   - `true`: los dos estan bien, asi que se enciende el interruptor y se da el
 *     stock por suficiente.
 *   - `false`: si el interruptor estaba ENCENDIDO, lo que falta es stock (y la
 *     fila lo dice con su etiqueta); si ya estaba apagado, se queda como estaba.
 *
 * Nunca apaga el interruptor manual por un evento: eso es una decision de la
 * cocina y el evento no la trae.
 */
function conEfectivoPlato(lista, idPlato, efectivo) {
  const id = Number(idPlato)
  return (lista || []).map((plato) => {
    if (plato.id_plato !== id) return plato
    if (efectivo) {
      return { ...plato, disponible: true, disponible_manual: true, stock_suficiente: true }
    }
    const manual = plato.disponible_manual ?? plato.disponible
    return manual
      ? { ...plato, disponible: false, stock_suficiente: false }
      : { ...plato, disponible: false }
  })
}

/**
 * Reemplaza un plato con la fila RECIEN LEIDA de GET /platos/:id (ISSUE #137).
 *
 * Es la respuesta buena al evento: la fila trae las dos columnas, asi que no hay
 * que adivinar que las apago. Si ese plato ya no esta en la lista, no se agrega:
 * la lista la manda GET /platos.
 */
export function aplicarPlatoReleido(estado, { id, fila }) {
  const idPlato = Number(id ?? fila?.id_plato)
  if (!Number.isInteger(idPlato) || idPlato <= 0) return estado
  if (!fila || typeof fila !== 'object') return estado
  if (!buscarPlato(estado, idPlato)) return estado

  const leido = platoDeLaApi({ ...fila, id_plato: idPlato })
  return {
    ...estado,
    platos: {
      ...estado.platos,
      lista: estado.platos.lista.map((plato) =>
        plato.id_plato === idPlato ? { ...plato, ...leido } : plato
      ),
    },
  }
}

/** Cambio OPTIMISTA de un plato: el interruptor se mueve ya, antes del PATCH. */
export function marcarEnVueloPlato(estado, idPlato, disponible) {
  const id = Number(idPlato)
  const actual = buscarPlato(estado, id)
  if (!actual) return estado

  return {
    ...estado,
    platos: {
      ...estado.platos,
      lista: conDisponiblePlato(estado.platos.lista, id, disponible),
      ...anotarPedido(estado.platos, id, disponible, actual.disponible),
    },
  }
}

/** El PATCH respondio 200: manda el valor del servidor, no el que se pidio. */
export function confirmarCambioPlato(estado, idPlato, disponible) {
  const id = Number(idPlato)

  return {
    ...estado,
    platos: {
      ...estado.platos,
      lista: conDisponiblePlato(estado.platos.lista, id, disponible),
      ...anotarRespuesta(estado.platos, id),
    },
  }
}

/** El PATCH fallo: vuelve al valor de antes y deja el mensaje en la fila. */
export function revertirCambioPlato(estado, idPlato, mensaje) {
  const id = Number(idPlato)
  const { anterior, ...libro } = anotarFallo(
    estado.platos,
    id,
    mensaje,
    'No se pudo cambiar la disponibilidad del plato'
  )

  return {
    ...estado,
    platos: {
      ...estado.platos,
      lista:
        anterior === undefined
          ? estado.platos.lista
          : conDisponiblePlato(estado.platos.lista, id, anterior),
      ...libro,
    },
  }
}

/** Quita el error de la fila de un plato. */
export function limpiarErrorPlato(estado, idPlato) {
  return { ...estado, platos: { ...estado.platos, ...anotarSinError(estado.platos, idPlato) } }
}

/**
 * Llega `plato:disponibilidad` del socket (EVENTS.md 5.4).
 *
 * Trae { id_plato, disponible, emitidoEn } --sin eventId--, asi que hay DOS
 * desambiguaciones y cada una resuelve un problema distinto:
 *
 * 1. Por EDAD, con `emitidoEn`: un evento con un sello igual o anterior al del
 *    ultimo que ya se aplico se descarta. El socket-server difunde a todas las
 *    pantallas y la red no garantiza el orden; sin esto, un "disponible" viejo
 *    que llega tarde reencenderia un plato que ya se habia agotado. El sello lo
 *    pone el socket-server al emitir (un solo reloj para todos los receptores),
 *    no el navegador.
 * 2. Por VALOR contra lo que yo pedi, igual que en ingredientes: el eco de mi
 *    propio cambio no repinta nada, y si el evento dice lo contrario gana el
 *    evento (otra pantalla escribio despues).
 *
 * El eco SI anota el sello aunque no cambie la lista: si no, un evento anterior
 * a ese eco se colaria despues como si fuera nuevo.
 *
 * Un id que no esta en la lista cargada se ignora sin ruido.
 */
export function aplicarEventoPlato(estado, evento) {
  const id = Number(evento?.id_plato)
  if (!Number.isFinite(id)) return estado
  if (typeof evento?.disponible !== 'boolean') return estado
  if (!buscarPlato(estado, id)) return estado

  const clave = String(id)
  const sello = Date.parse(evento?.emitidoEn ?? '')
  const visto = estado.platos.visto[clave]

  // Sin sello utilizable no se puede ordenar: se aplica, que es mejor que
  // perder un cambio real de otra pantalla.
  if (Number.isFinite(sello) && Number.isFinite(visto) && sello <= visto) return estado

  const platos = {
    ...estado.platos,
    visto: Number.isFinite(sello) ? { ...estado.platos.visto, [clave]: sello } : estado.platos.visto,
  }

  const pendiente = estado.platos.enVuelo[clave]
  if (pendiente) {
    if (pendiente.pedido === evento.disponible) return { ...estado, platos }
    return {
      ...estado,
      platos: {
        ...platos,
        lista: conEfectivoPlato(estado.platos.lista, id, evento.disponible),
        ...anotarRespuesta(estado.platos, id),
      },
    }
  }

  return {
    ...estado,
    platos: { ...platos, lista: conEfectivoPlato(estado.platos.lista, id, evento.disponible) },
  }
}

/**
 * Que mensaje enseña la seccion de platos. Mismos casos que el de la carta.
 *
 * @returns {'cargando'|'prohibido'|'error'|null}
 */
export function avisoDelPanelPlatos(estado) {
  const platos = estado?.platos
  if (platos?.cargando && platos.lista.length === 0) return 'cargando'
  if (platos?.status === 403) return 'prohibido'
  if (platos?.error) return 'error'
  return null
}

/**
 * Este plato esta agotado POR STOCK --se acabo el inventario-- y no porque
 * alguien lo apagara a mano?
 *
 * Ya funciona (ISSUE #137): `cargarPlatos` pone `agotado_por_stock` cuando
 * `GET /platos` dice `stock_suficiente: false` con el interruptor manual
 * ENCENDIDO. Si lo apago el cocinero, no se le echa la culpa al inventario y
 * esto devuelve null: el motivo que se muestra es el que se puede arreglar con
 * el boton.
 *
 * Nunca se adivina a partir de `disponible = false` a secas: etiquetar mal el
 * motivo es peor que no etiquetar nada.
 *
 * @returns {'stock'|null}
 */
export function motivoAgotado(plato) {
  if (plato?.disponible !== false) return null
  // Sin stock y con el interruptor encendido: la culpa es del inventario.
  if (plato?.stock_suficiente === false && plato?.disponible_manual !== false) return 'stock'
  return plato?.agotado_por_stock === true ? 'stock' : null
}
