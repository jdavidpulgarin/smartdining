export const PORCIONES = ['ligera', 'normal', 'extra'];

export const FACTORES_PORCION = {
  ligera: 0.5,
  normal: 1,
  extra: 1.5,
};

const MAX_INGREDIENTES_LINEA = 30;

export function validarPaso(paso, seleccionesDelPaso = {}) {
  if (!paso) {
    return { valido: true, faltan: 0, excede: false };
  }

  const elegidos = Object.keys(seleccionesDelPaso || {}).length;
  const minSel = Math.max(0, Number(paso.min_sel) || 0);
  const maxSel = Math.max(0, Number(paso.max_sel) || 0);

  const faltan = Math.max(0, minSel - elegidos);
  const excede = maxSel > 0 && elegidos > maxSel;
  const valido = faltan === 0 && !excede;

  return {
    valido,
    faltan,
    excede,
  };
}

export function pasosPendientes(plato, selecciones = {}) {
  if (!plato || !Array.isArray(plato.pasos)) {
    return [];
  }

  return plato.pasos
    .filter((paso) => {
      const selPaso = (selecciones && selecciones[paso.id_paso]) || {};
      const { faltan } = validarPaso(paso, selPaso);
      return faltan > 0;
    })
    .map((paso) => paso.nombre);
}

export function calcularPlato(plato, selecciones = {}) {
  if (!plato) {
    return {
      precio: 0,
      calorias: 0,
      alergenos: [],
      ingredientes: [],
      detalle: [],
    };
  }

  const precioBase = Number(plato.precio) || 0;
  let sumaExtras = 0;
  let sumaCalorias = 0;
  const alergenosSet = new Set();
  const ingredientes = [];
  const detalle = [];

  const pasosOrdenados = [...(plato.pasos || [])].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0)
  );

  for (const paso of pasosOrdenados) {
    const selPaso = (selecciones && selecciones[paso.id_paso]) || {};
    const listaIngredientes = paso.ingredientes || [];

    for (const ing of listaIngredientes) {
      const idIng = ing.id_ingrediente;
      if (!Object.prototype.hasOwnProperty.call(selPaso, idIng)) {
        continue;
      }

      if (ingredientes.length >= MAX_INGREDIENTES_LINEA) {
        break;
      }

      const porcionRaw = selPaso[idIng];
      const porcion = PORCIONES.includes(porcionRaw) ? porcionRaw : 'normal';
      const factor = FACTORES_PORCION[porcion] ?? 1;

      if (porcion === 'extra') {
        sumaExtras += Number(ing.precio_extra) || 0;
      }

      sumaCalorias += (Number(ing.calorias) || 0) * factor;

      if (Array.isArray(ing.alergenos)) {
        for (const alergeno of ing.alergenos) {
          if (alergeno) {
            alergenosSet.add(alergeno);
          }
        }
      }

      ingredientes.push({
        id_ingrediente: Number(idIng),
        porcion,
      });

      detalle.push({
        paso: paso.nombre,
        nombre: ing.nombre,
        porcion,
      });
    }
  }

  return {
    precio: precioBase + sumaExtras,
    calorias: Math.round(sumaCalorias),
    alergenos: Array.from(alergenosSet),
    ingredientes,
    detalle,
  };
}

export default {
  PORCIONES,
  FACTORES_PORCION,
  calcularPlato,
  validarPaso,
  pasosPendientes,
};
