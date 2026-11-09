/**
 * Reglas de la pantalla de Inventario (P-22, pestaña Insumos), fuera de los
 * componentes para poder probarlas solas.
 *
 * Contrato: backend/docs/api-spec.md, "Inventario: insumos, movimientos y
 * recetas (D-17 PR 2)". El backend valida lo mismo (zod y los CHECK del script
 * 27); esto solo evita mandar algo que se sabe que va a rechazar y da el mensaje
 * antes.
 *
 * Regla de oro del contrato: `stock_actual` NUNCA se edita. Solo lo mueven los
 * movimientos (entrada, ajuste, merma) y la reserva de los pedidos, y
 * SUM(movimientos) = stock_actual. Por eso ningún formulario de aquí lo manda.
 */

/** Unidades del CHECK de `insumos.unidad`. */
export const UNIDADES = [
  { valor: 'porcion', etiqueta: 'Porción', corta: 'porc.' },
  { valor: 'unidad', etiqueta: 'Unidad', corta: 'und.' },
  { valor: 'g', etiqueta: 'Gramos (g)', corta: 'g' },
  { valor: 'ml', etiqueta: 'Mililitros (ml)', corta: 'ml' },
]

/** Los tres movimientos que se registran a mano (los otros dos los escribe la base). */
export const TIPOS_MANUALES = [
  { valor: 'entrada', etiqueta: 'Entrada', ayuda: 'Llegó mercancía: suma al stock.' },
  { valor: 'merma', etiqueta: 'Merma', ayuda: 'Se dañó o se perdió: resta del stock.' },
  { valor: 'ajuste', etiqueta: 'Ajuste por conteo', ayuda: 'Contaste la bodega: deja el stock en lo contado.' },
]

/** Todos los tipos del libro, como se muestran en el historial. */
export const ETIQUETA_MOVIMIENTO = {
  entrada: 'Entrada',
  ajuste: 'Ajuste',
  merma: 'Merma',
  reserva: 'Reserva (pedido)',
  devolucion: 'Devolución (pedido cancelado)',
}

export const ESTADOS = {
  agotado: { etiqueta: 'AGOTADO', clase: 'sd-badge-red' },
  bajo: { etiqueta: 'BAJO', clase: 'sd-badge-gold' },
  ok: { etiqueta: 'OK', clase: 'sd-badge-light' },
  inactivo: { etiqueta: 'INACTIVO', clase: 'sd-badge-dark' },
}

export const NOMBRE_MAX = 80
export const MOTIVO_MAX = 500

/** Redondeo a 2 decimales (las columnas son NUMERIC(12,2)). */
const redondear = (n) => Math.round(n * 100) / 100

/**
 * Texto de un input → número con hasta 2 decimales, o null. Acepta coma decimal
 * y no acepta signo: los signos los pone el tipo de movimiento.
 */
export function leerNumero(texto) {
  const t = String(texto ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

/** "450 g", "2,5 porc." — en el formato del navegador, sin decimales de más. */
export function formatoCantidad(valor, unidad) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  const corta = UNIDADES.find((u) => u.valor === unidad)?.corta || unidad || ''
  return `${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${corta}`.trim()
}

/**
 * Estado de un insumo para la etiqueta. Usa `bajo` y `agotado` del servidor (los
 * calcula el backend con la misma regla que `v_stock_bajo`) y solo los deduce si
 * no vinieran.
 */
export function estadoDeInsumo(insumo) {
  if (insumo.activo === false) return 'inactivo'
  const stock = Number(insumo.stock_actual)
  const agotado = typeof insumo.agotado === 'boolean' ? insumo.agotado : stock === 0
  if (agotado) return 'agotado'
  const bajo = typeof insumo.bajo === 'boolean' ? insumo.bajo : stock <= Number(insumo.stock_minimo)
  return bajo ? 'bajo' : 'ok'
}

const PRIORIDAD = { agotado: 0, bajo: 1, ok: 2, inactivo: 3 }

/** Primero lo agotado, luego lo bajo, luego el resto; dentro de cada grupo, por nombre. */
export function ordenarInsumos(lista) {
  return [...(lista || [])].sort(
    (a, b) =>
      PRIORIDAD[estadoDeInsumo(a)] - PRIORIDAD[estadoDeInsumo(b)] ||
      String(a.nombre).localeCompare(String(b.nombre), 'es')
  )
}

/** Cuántos insumos ACTIVOS están bajo el mínimo (incluye los agotados) y cuántos agotados. */
export function resumenInsumos(lista) {
  let bajo = 0
  let agotado = 0
  for (const insumo of lista || []) {
    const estado = estadoDeInsumo(insumo)
    if (estado === 'agotado') { agotado += 1; bajo += 1 }
    else if (estado === 'bajo') bajo += 1
  }
  return { bajo, agotado }
}

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Filtro de la lista: `todos` (los activos), `bajo` (activos en o bajo el
 * mínimo, agotados incluidos) o `inactivos`; y búsqueda por nombre sin
 * distinguir mayúsculas ni tildes.
 */
export function filtrarInsumos(lista, { filtro = 'todos', busqueda = '' } = {}) {
  const q = sinTildes(busqueda).trim()
  return (lista || []).filter((insumo) => {
    const estado = estadoDeInsumo(insumo)
    if (filtro === 'inactivos' && estado !== 'inactivo') return false
    if (filtro === 'bajo' && estado !== 'bajo' && estado !== 'agotado') return false
    if (filtro === 'todos' && estado === 'inactivo') return false
    return !q || sinTildes(insumo.nombre).includes(q)
  })
}

/** Insumo (o nada) → texto del formulario de alta/edición. */
export function formDeInsumo(insumo) {
  return {
    nombre: insumo?.nombre ?? '',
    unidad: insumo?.unidad ?? 'porcion',
    stock_minimo: insumo ? String(Number(insumo.stock_minimo)) : '',
    stock_inicial: '',
    activo: insumo ? insumo.activo !== false : true,
  }
}

/**
 * Formulario → { datos } o { error }. En el alta, `stock_inicial` es opcional y
 * entra como movimiento `entrada` del lado del servidor; en la edición no existe.
 */
export function validarInsumo(form, { nuevo = false } = {}) {
  const nombre = String(form.nombre ?? '').trim()
  if (!nombre) return { error: 'El nombre del insumo es obligatorio.' }
  if (nombre.length > NOMBRE_MAX) return { error: `El nombre admite hasta ${NOMBRE_MAX} caracteres.` }
  if (!UNIDADES.some((u) => u.valor === form.unidad)) return { error: 'Elige la unidad.' }

  const textoMinimo = String(form.stock_minimo ?? '').trim()
  const stock_minimo = textoMinimo === '' ? 0 : leerNumero(textoMinimo)
  if (stock_minimo === null) return { error: 'El stock mínimo es un número de 0 en adelante, con hasta 2 decimales.' }

  const datos = { nombre, unidad: form.unidad, stock_minimo }

  if (nuevo) {
    const textoInicial = String(form.stock_inicial ?? '').trim()
    if (textoInicial !== '') {
      const stock_inicial = leerNumero(textoInicial)
      if (stock_inicial === null || stock_inicial <= 0) {
        return { error: 'El stock inicial es un número mayor que 0, con hasta 2 decimales (o déjalo vacío).' }
      }
      datos.stock_inicial = stock_inicial
    }
  } else {
    datos.activo = Boolean(form.activo)
  }
  return { datos }
}

/** Solo lo que cambió en la edición (el PUT es parcial y `.strict()`). */
export function cambiosDeInsumo(insumo, datos) {
  const cambios = {}
  if (datos.nombre !== insumo.nombre) cambios.nombre = datos.nombre
  if (datos.unidad !== insumo.unidad) cambios.unidad = datos.unidad
  if (datos.stock_minimo !== Number(insumo.stock_minimo)) cambios.stock_minimo = datos.stock_minimo
  if (typeof datos.activo === 'boolean' && datos.activo !== (insumo.activo !== false)) cambios.activo = datos.activo
  return cambios
}

/**
 * Formulario de movimiento → { datos, resultante } o { error }.
 *
 * - entrada: cantidad > 0. Motivo opcional.
 * - merma: cantidad > 0 y no más de lo que hay. Motivo obligatorio.
 * - ajuste: se pide CUÁNTO HAY CONTADO; la cantidad que viaja es la diferencia
 *   con signo (contado − stock actual), que es lo que espera el contrato
 *   (`ajuste` con signo, ≠ 0). Motivo obligatorio.
 *
 * `resultante` es el stock que quedaría, para mostrarlo antes de guardar.
 */
export function validarMovimiento(form, stockActual) {
  const stock = Number(stockActual) || 0
  const motivo = String(form.motivo ?? '').trim()
  if (motivo.length > MOTIVO_MAX) return { error: `El motivo admite hasta ${MOTIVO_MAX} caracteres.` }

  if (form.tipo === 'ajuste') {
    const contado = leerNumero(form.contado)
    if (contado === null) return { error: 'Escribe cuánto hay contado (0 o más, hasta 2 decimales).' }
    const cantidad = redondear(contado - stock)
    if (cantidad === 0) return { error: 'Lo contado coincide con el stock: no hay nada que ajustar.' }
    if (!motivo) return { error: 'El motivo es obligatorio en un ajuste (p. ej. "Conteo del viernes").' }
    return { datos: { tipo: 'ajuste', cantidad, motivo }, resultante: contado }
  }

  if (form.tipo !== 'entrada' && form.tipo !== 'merma') return { error: 'Elige el tipo de movimiento.' }
  const cantidad = leerNumero(form.cantidad)
  if (cantidad === null || cantidad <= 0) return { error: 'La cantidad es un número mayor que 0, con hasta 2 decimales.' }

  if (form.tipo === 'merma') {
    if (cantidad > stock) return { error: `No se puede dar de baja más de lo que hay (${stock.toLocaleString('es-CO')}).` }
    if (!motivo) return { error: 'El motivo es obligatorio en una merma (p. ej. "Se venció").' }
    return { datos: { tipo: 'merma', cantidad, motivo }, resultante: redondear(stock - cantidad) }
  }

  const datos = { tipo: 'entrada', cantidad }
  if (motivo) datos.motivo = motivo
  return { datos, resultante: redondear(stock + cantidad) }
}

/** Cómo se lee una fila del historial (la merma en 0 de una cancelación tiene su explicación). */
export function notaDeMovimiento(mov) {
  if (mov.tipo === 'merma' && Number(mov.cantidad) === 0 && mov.id_detalle) {
    return 'Cancelado en preparación: ya se había descontado en la reserva.'
  }
  return mov.motivo || ''
}

/** Texto del aviso en vivo `inventario:alerta` (EVENTS.md §5.5). */
export function textoDeAlerta(alerta) {
  const nombre = alerta?.nombre || `Insumo ${alerta?.id_insumo ?? ''}`.trim()
  if (alerta?.agotado || Number(alerta?.stock_actual) === 0) return `${nombre}: AGOTADO`
  return `${nombre}: bajo el mínimo (${formatoCantidad(alerta?.stock_actual, alerta?.unidad)} de ${formatoCantidad(alerta?.stock_minimo, alerta?.unidad)})`
}
