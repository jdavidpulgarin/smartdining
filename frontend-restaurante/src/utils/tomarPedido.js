/**
 * Funciones puras de lógica para la toma de pedidos del mesero (J-16).
 * Valida comensales, normaliza alias y prepara el payload para la API.
 */

/**
 * Normaliza un alias según las reglas del contrato (R-18):
 * NFC, minúsculas, sin tildes/marcas de acento, sin espacios ni caracteres . _ ' -
 *
 * @param {string} texto
 * @returns {string}
 */
export function claveAlias(texto) {
  if (typeof texto !== 'string') return ''
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s._'-]/g, '')
}

/**
 * Une comensales de presencia y cuenta en una sola lista sin "General",
 * sin duplicados por clave, conservando el texto exacto que llegó del servidor y ordenada.
 *
 * @param {{ presencia?: { comensales?: string[], sin_celular?: string[] } | string[], cuenta?: { comensales?: Array<{ comensal?: string, nombre?: string } | string> } | Array<{ comensal?: string, nombre?: string } | string> }} params
 * @returns {string[]}
 */
export function unirComensales({ presencia, cuenta } = {}) {
  const candidatos = []

  // Extraer de presencia
  if (presencia) {
    if (Array.isArray(presencia)) {
      candidatos.push(...presencia)
    } else {
      if (Array.isArray(presencia.comensales)) {
        candidatos.push(...presencia.comensales)
      }
      if (Array.isArray(presencia.sin_celular)) {
        candidatos.push(...presencia.sin_celular)
      }
    }
  }

  // Extraer de cuenta
  if (cuenta) {
    const comensalesCuenta = Array.isArray(cuenta) ? cuenta : cuenta.comensales
    if (Array.isArray(comensalesCuenta)) {
      for (const c of comensalesCuenta) {
        if (typeof c === 'string') {
          candidatos.push(c)
        } else if (c && typeof c.comensal === 'string') {
          candidatos.push(c.comensal)
        } else if (c && typeof c.nombre === 'string') {
          candidatos.push(c.nombre)
        }
      }
    }
  }

  const clavesVistas = new Set()
  const resultado = []

  for (const raw of candidatos) {
    if (typeof raw !== 'string') continue
    const recortado = raw.trim()
    if (!recortado) continue
    const clave = claveAlias(recortado)
    if (!clave || clave === 'general') continue

    if (!clavesVistas.has(clave)) {
      clavesVistas.add(clave)
      resultado.push(recortado)
    }
  }

  return resultado.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
}

/**
 * Busca en la lista de comensales existentes a alguien con la misma clave.
 *
 * @param {Array<string|{ comensal?: string, nombre?: string }>} lista
 * @param {string} texto
 * @returns {string|null} Devuelve el alias existente tal como está en la lista, o null si no se encuentra.
 */
export function buscarPorClave(lista, texto) {
  if (!Array.isArray(lista) || !texto) return null
  const claveBuscada = claveAlias(texto)
  if (!claveBuscada) return null

  for (const item of lista) {
    const alias = typeof item === 'string' ? item : item?.comensal || item?.nombre || ''
    if (claveAlias(alias) === claveBuscada) {
      return typeof item === 'string' ? item : (item?.comensal || item?.nombre || alias)
    }
  }
  return null
}

/**
 * Interpreta el error 409 de comensales o pedidos según el motivo del contrato.
 *
 * @param {any} error
 * @returns {{ tipo: 'alias_en_uso'|'mesa_sin_sesion'|'comensal_no_registrado'|'sin_stock'|'desconocido', mensaje: string, alias?: string, faltantes?: any[] }}
 */
export function accionError409(error) {
  const data = error?.data || error?.response?.data || error || {}
  const motivoRaw = data?.motivo || error?.motivo || ''
  const motivo = String(motivoRaw).toLowerCase()
  const mensaje = data?.error || data?.mensaje || error?.message || 'Error en la operación'

  if (motivo === 'alias_en_uso') {
    return {
      tipo: 'alias_en_uso',
      mensaje: mensaje || 'Ese nombre ya está en la mesa',
      alias: data?.alias || error?.alias,
    }
  }

  if (motivo === 'mesa_sin_sesion') {
    return {
      tipo: 'mesa_sin_sesion',
      mensaje: mensaje || 'La mesa no tiene una sesión abierta',
    }
  }

  if (motivo === 'comensal_no_registrado') {
    return {
      tipo: 'comensal_no_registrado',
      mensaje: mensaje || 'Comensal no registrado',
      alias: data?.alias || error?.alias,
    }
  }

  if (motivo === 'sin_stock') {
    return {
      tipo: 'sin_stock',
      mensaje: mensaje || 'Sin stock disponible',
      faltantes: data?.faltantes || error?.faltantes || [],
    }
  }

  return {
    tipo: 'desconocido',
    mensaje,
    alias: data?.alias || error?.alias,
    faltantes: data?.faltantes || error?.faltantes,
  }
}

/**
 * Reemplaza de forma inmutable el comensal de los ítems donde coincida la clave con aliasViejo.
 *
 * @param {Array<object>} items
 * @param {string} aliasViejo
 * @param {string} aliasNuevo
 * @returns {Array<object>}
 */
export function reemplazarAlias(items, aliasViejo, aliasNuevo) {
  if (!Array.isArray(items)) return []
  const claveVieja = claveAlias(aliasViejo)

  return items.map((item) => {
    if (claveAlias(item.comensal) === claveVieja) {
      return {
        ...item,
        comensal: aliasNuevo,
      }
    }
    return item
  })
}

/**
 * Arma el cuerpo para POST /api/pedidos desde el mesero.
 * Filtra campos de precio prohibidos y asegura estructura limpia.
 *
 * @param {{ idMesa: number|string, items: Array<object>, notasGenerales?: string }} params
 * @returns {{ id_mesa: number, items: Array<object>, notas_generales?: string }}
 */
export function armarPedido({ idMesa, items = [], notasGenerales = '' } = {}) {
  const id_mesa = Number(idMesa)
  if (!id_mesa || id_mesa <= 0) {
    throw new Error('id_mesa es obligatorio y debe ser un número positivo')
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('El pedido debe tener al menos un ítem')
  }

  const itemsLimpios = items.map((it) => {
    const itemLimpiado = {
      id_plato: Number(it.id_plato || it.idPlato),
      cantidad: Math.min(20, Math.max(1, Math.floor(Number(it.cantidad) || 1))),
    }

    if (it.comensal && typeof it.comensal === 'string' && it.comensal.trim()) {
      itemLimpiado.comensal = it.comensal.trim()
    }

    const nota = it.notas || it.notasCocina || it.notas_especiales
    if (typeof nota === 'string' && nota.trim()) {
      itemLimpiado.notas = nota.trim().slice(0, 200)
    }

    const ingr = it.ingredientes || it.selecciones
    if (Array.isArray(ingr) && ingr.length > 0) {
      itemLimpiado.ingredientes = ingr.map((ig) => ({
        id_ingrediente: Number(ig.id_ingrediente ?? ig.idIngrediente),
        porcion: ig.porcion || 'normal',
      }))
    }

    return itemLimpiado
  })

  const payload = {
    id_mesa,
    items: itemsLimpios,
  }

  if (typeof notasGenerales === 'string' && notasGenerales.trim()) {
    payload.notas_generales = notasGenerales.trim().slice(0, 500)
  }

  return payload
}
