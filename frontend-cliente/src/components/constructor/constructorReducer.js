const PORCIONES_VALIDAS = ['ligera', 'normal', 'extra'];

export const estadoInicial = {
  pasoActual: 0,
  selecciones: {},
  notas: '',
  enResumen: false,
};

export function constructorReducer(estado, accion) {
  if (!accion || !accion.type) {
    return estado;
  }

  switch (accion.type) {
    case 'ALTERNAR_INGREDIENTE': {
      const { paso, ingrediente } = accion;
      if (!paso || !ingrediente || !ingrediente.disponible) {
        return estado;
      }

      const idPaso = paso.id_paso;
      const idIngrediente = ingrediente.id_ingrediente;
      const seleccionesPaso = { ...(estado.selecciones[idPaso] || {}) };
      const yaElegido = Object.prototype.hasOwnProperty.call(
        seleccionesPaso,
        idIngrediente
      );

      if (yaElegido) {
        delete seleccionesPaso[idIngrediente];
        return {
          ...estado,
          selecciones: {
            ...estado.selecciones,
            [idPaso]: seleccionesPaso,
          },
        };
      }

      if (paso.max_sel === 1) {
        return {
          ...estado,
          selecciones: {
            ...estado.selecciones,
            [idPaso]: {
              [idIngrediente]: 'normal',
            },
          },
        };
      }

      const cantidadActual = Object.keys(seleccionesPaso).length;
      if (paso.max_sel > 0 && cantidadActual >= paso.max_sel) {
        return estado;
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
      };
    }

    case 'CAMBIAR_PORCION': {
      const { id_paso: idPaso, id_ingrediente: idIngrediente, porcion } = accion;
      if (!PORCIONES_VALIDAS.includes(porcion)) {
        return estado;
      }

      const seleccionesPaso = estado.selecciones[idPaso];
      if (
        !seleccionesPaso ||
        !Object.prototype.hasOwnProperty.call(seleccionesPaso, idIngrediente)
      ) {
        return estado;
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
      };
    }

    case 'SIGUIENTE': {
      if (estado.enResumen) {
        return estado;
      }
      const totalPasos = Number(accion.totalPasos) || 0;
      if (totalPasos > 0 && estado.pasoActual + 1 >= totalPasos) {
        return {
          ...estado,
          enResumen: true,
        };
      }
      return {
        ...estado,
        pasoActual: estado.pasoActual + 1,
      };
    }

    case 'ANTERIOR': {
      if (estado.enResumen) {
        return {
          ...estado,
          enResumen: false,
        };
      }
      return {
        ...estado,
        pasoActual: Math.max(0, estado.pasoActual - 1),
      };
    }

    case 'CAMBIAR_NOTAS': {
      const texto = typeof accion.notas === 'string' ? accion.notas : '';
      return {
        ...estado,
        notas: texto.slice(0, 200),
      };
    }

    case 'REINICIAR': {
      return {
        ...estadoInicial,
        selecciones: {},
      };
    }

    case 'QUITAR_NO_DISPONIBLE': {
      const idIngrediente = Number(
        accion.id_ingrediente ?? accion.idIngrediente
      );
      if (!idIngrediente) return estado;

      let huboCambio = false;
      const nuevasSelecciones = {};

      for (const [idPaso, ingsDelPaso] of Object.entries(estado.selecciones)) {
        if (Object.prototype.hasOwnProperty.call(ingsDelPaso, idIngrediente)) {
          huboCambio = true;
          const copiaPaso = { ...ingsDelPaso };
          delete copiaPaso[idIngrediente];
          nuevasSelecciones[idPaso] = copiaPaso;
        } else {
          nuevasSelecciones[idPaso] = ingsDelPaso;
        }
      }

      if (!huboCambio) return estado;

      return {
        ...estado,
        selecciones: nuevasSelecciones,
      };
    }

    default:
      return estado;
  }
}

export default constructorReducer;
