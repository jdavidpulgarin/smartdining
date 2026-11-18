// Copiado de frontend-cliente; candidato a packages/core (R-22)
// Origen: frontend-cliente/src/utils/calcularPlato.js (adaptado en J-16)

export const PORCIONES = ['ligera', 'normal', 'extra']

export const FACTORES_PORCION = {
  ligera: 0.5,
  normal: 1,
  extra: 1.5,
}

const MAX_INGREDIENTES_LINEA = 20

export function validarPaso(paso, seleccionesDelPaso = {}) {
  if (!paso) {
    return { valido: true, faltan: 0, excede: false }
  }

  const elegidos = Object.keys(seleccionesDelPaso || {}).length
  const minSel = Math.max(0, Number(paso.min_sel) || 0)
  const maxSel = Math.max(0, Number(paso.max_sel) || 0)

  const faltan = Math.max(0, minSel - elegidos)
  const excede = maxSel > 0 && elegidos > maxSel
  const valido = faltan === 0 && !excede

  return {
    valido,
    faltan,
    excede,
  }
}

export function pasosPendientes(plato, selecciones = {}) {
  if (!plato || !Array.isArray(plato.pasos)) {
    return []
  }

  return plato.pasos
    .filter((paso) => {
      const selPaso = (selecciones && selecciones[paso.id_paso]) || {}
      const { faltan } = validarPaso(paso, selPaso)
      return faltan > 0
    })
    .map((paso) => paso.nombre)
}

export function calcularPlato(plato, selecciones = {}) {
  if (!plato) {
    return {
      precio: 0,
      calorias: 0,
      alergenos: [],
      ingredientes: [],
      detalle: [],
    }
  }

  const precioBase = Number(plato.precio) || 0
  let sumaExtras = 0
  let sumaCalorias = 0
  const alergenosSet = new Set()
  const ingredientes = []
  const detalle = []

  const pasosOrdenados = [...(plato.pasos || [])].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0)
  )

  for (const paso of pasosOrdenados) {
    const selPaso = (selecciones && selecciones[paso.id_paso]) || {}
    const listaIngredientes = paso.ingredientes || []

    for (const ing of listaIngredientes) {
      const idIng = ing.id_ingrediente
      if (!Object.prototype.hasOwnProperty.call(selPaso, idIng)) {
        continue
      }

      if (ingredientes.length >= MAX_INGREDIENTES_LINEA) {
        break
      }

      const porcion = selPaso[idIng] || 'normal'
      const precioExtraBase = Number(ing.precio_extra) || 0
      const recargo = porcion === 'extra' ? precioExtraBase : 0
      sumaExtras += recargo

      const factorCalorico = FACTORES_PORCION[porcion] ?? 1
      const calBase = Number(ing.calorias) || 0
      sumaCalorias += Math.round(calBase * factorCalorico)

      if (Array.isArray(ing.alergenos)) {
        for (const al of ing.alergenos) {
          if (al) alergenosSet.add(al)
        }
      }

      ingredientes.push({
        id_ingrediente: Number(idIng),
        nombre: ing.nombre,
        porcion,
        precio_extra: recargo,
      })

      detalle.push({
        paso: paso.nombre,
        ingrediente: ing.nombre,
        porcion,
        recargo,
      })
    }
  }

  const calPlatoBase = Number(plato.calorias) || 0
  if (Array.isArray(plato.alergenos)) {
    for (const al of plato.alergenos) {
      if (al) alergenosSet.add(al)
    }
  }

  return {
    precio: precioBase + sumaExtras,
    precioBase,
    sumaExtras,
    calorias: calPlatoBase + sumaCalorias,
    alergenos: Array.from(alergenosSet),
    ingredientes,
    detalle,
  }
}
