// Copiado desde frontend-cliente/src/components/constructor/constructorReducer.js
// Adaptado para frontend-restaurante en J-16

const PORCIONES_VALIDAS = ['ligera', 'normal', 'extra']

export const estadoInicial = {
  pasoActual: 0,
  selecciones: {},
  notas: '',
  enResumen: false,
}

export function constructorReducer(estado, accion) {
  if (!accion || !accion.type) {
    return estado
  }

  switch (accion.type) {
    case 'ALTERNAR_INGREDIENTE': {
      const { paso, ingrediente } = accion
      if (!paso || !ingrediente || ingrediente.disponible === false) {
        return estado
      }

      const idPaso = paso.id_paso
      const idIngrediente = ingrediente.id_ingrediente
      const seleccionesPaso = { ...(estado.selecciones[idPaso] || {}) }
      const yaElegido = Object.prototype.hasOwnProperty.call(
        seleccionesPaso,
        idIngrediente
      )

      if (yaElegido) {
        delete seleccionesPaso[idIngrediente]
        return {
          ...estado,
          selecciones: {
            ...estado.selecciones,
            [idPaso]: seleccionesPaso,
          },
        }
      }

      if (Number(paso.max_sel) === 1) {
        return {
          ...estado,
          selecciones: {
            ...estado.selecciones,
            [idPaso]: {
              [idIngrediente]: 'normal',
            },
          },
        }
      }

      const cantidadActual = Object.keys(seleccionesPaso).length
      if (Number(paso.max_sel) > 0 && cantidadActual >= Number(paso.max_sel)) {
        return estado
      }

      return {
        ...estado,
        selecciones: {
          ...estado.selecciones,
          [idPaso]: {
            ...seleccionesPaso,
            [idIngrediente]: 'normal',
          },
        },
      }
    }

    case 'CAMBIAR_PORCION': {
      const { id_paso: idPaso, id_ingrediente: idIngrediente, porcion } = accion
      if (!PORCIONES_VALIDAS.includes(porcion)) {
        return estado
      }

      const seleccionesPaso = estado.selecciones[idPaso]
      if (
        !seleccionesPaso ||
        !Object.prototype.hasOwnProperty.call(seleccionesPaso, idIngrediente)
      ) {
        return estado
      }

      return {
        ...estado,
        selecciones: {
          ...estado.selecciones,
          [idPaso]: {
            ...seleccionesPaso,
            [idIngrediente]: porcion,
          },
        },
      }
    }

    case 'ESTABLECER_PASO': {
      const nuevoPaso = Number(accion.paso)
      if (Number.isNaN(nuevoPaso) || nuevoPaso < 0) {
        return estado
      }
      return {
        ...estado,
        pasoActual: nuevoPaso,
      }
    }

    case 'CAMBIAR_NOTAS': {
      return {
        ...estado,
        notas: typeof accion.notas === 'string' ? accion.notas.slice(0, 200) : '',
      }
    }

    case 'REINICIAR': {
      return {
        pasoActual: 0,
        selecciones: accion.seleccionesIniciales || {},
        notas: accion.notasIniciales || '',
        enResumen: false,
      }
    }

    default:
      return estado
  }
}
