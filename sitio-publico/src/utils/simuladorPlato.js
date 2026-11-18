/**
 * Lógica pura para el simulador de personalización de platos ('Arma tu plato').
 */

/**
 * Devuelve el texto de la regla del paso según sus restricciones de selección.
 */
export function reglaTextoPaso(paso = {}) {
  const min = Number(paso.min_sel ?? paso.minimo ?? (paso.obligatorio ? 1 : 0));
  const max = Number(paso.max_sel ?? paso.maximo ?? 1);
  const esObligatorio = Boolean(paso.obligatorio || min > 0);

  if (esObligatorio && max === 1) {
    return 'Obligatorio, elige 1';
  }
  if (esObligatorio) {
    return `Obligatorio, elige hasta ${max}`;
  }
  return `Opcional, hasta ${max}`;
}

/**
 * Genera la selección inicial para todos los pasos de un plato personalizable.
 * Los pasos obligatorios arrancan con la primera opción disponible.
 *
 * @param {Array} pasos
 * @returns {Array<Array<number>>}
 */
export function inicializarSeleccion(pasos = []) {
  if (!Array.isArray(pasos)) return [];

  return pasos.map((paso) => {
    const min = Number(paso.min_sel ?? paso.minimo ?? (paso.obligatorio ? 1 : 0));
    const esObligatorio = Boolean(paso.obligatorio || min > 0);
    if (!esObligatorio) {
      return [];
    }

    const ingredientes = Array.isArray(paso.ingredientes) ? paso.ingredientes : [];
    const primerDisponible = ingredientes.findIndex(
      (ing) => ing.disponible !== false
    );

    return primerDisponible >= 0 ? [primerDisponible] : [];
  });
}

/**
 * Alterna la selección de un ingrediente dentro de un paso.
 * - En pasos con max = 1, reemplaza la opción anterior.
 * - En pasos con max > 1, respeta el tope máximo mostrando un mensaje si se supera.
 * - No permite quitar la última opción de un paso obligatorio.
 * - Opciones no disponibles (agotadas) no son seleccionables.
 *
 * @param {Object} params
 * @param {Array} params.pasos
 * @param {Array<Array<number>>} params.sel
 * @param {number} params.pasoIndex
 * @param {number} params.opcionIndex
 * @returns {{ nuevaSel: Array<Array<number>>, mensajeTope: string }}
 */
export function alternarOpcion({ pasos = [], sel = [], pasoIndex, opcionIndex }) {
  const paso = pasos[pasoIndex];
  if (!paso) {
    return { nuevaSel: sel, mensajeTope: '' };
  }

  const ingredientes = Array.isArray(paso.ingredientes) ? paso.ingredientes : [];
  const ingrediente = ingredientes[opcionIndex];

  // No seleccionable si está agotado
  if (!ingrediente || ingrediente.disponible === false) {
    return { nuevaSel: sel, mensajeTope: '' };
  }

  const min = Number(paso.min_sel ?? paso.minimo ?? (paso.obligatorio ? 1 : 0));
  const max = Number(paso.max_sel ?? paso.maximo ?? 1);
  const esObligatorio = Boolean(paso.obligatorio || min > 0);

  const seleccionPaso = [...(sel[pasoIndex] || [])];
  const pos = seleccionPaso.indexOf(opcionIndex);

  let nuevaSeleccionPaso;
  let mensajeTope = '';

  if (pos > -1) {
    // Ya estaba seleccionada: intentar desmarcar
    if (esObligatorio && seleccionPaso.length <= 1) {
      // No quitar el último de un obligatorio
      return { nuevaSel: sel, mensajeTope: '' };
    }
    nuevaSeleccionPaso = seleccionPaso.filter((idx) => idx !== opcionIndex);
  } else if (max === 1) {
    // Paso de selección única: reemplaza
    nuevaSeleccionPaso = [opcionIndex];
  } else if (seleccionPaso.length >= max) {
    // Alcanzó el tope de selección
    return {
      nuevaSel: sel,
      mensajeTope: `Máximo ${max}: quita uno para cambiar.`,
    };
  } else {
    nuevaSeleccionPaso = [...seleccionPaso, opcionIndex];
  }

  const nuevaSel = sel.map((arr, idx) =>
    idx === pasoIndex ? nuevaSeleccionPaso : arr
  );

  return { nuevaSel, mensajeTope };
}

/**
 * Calcula el total del plato (precio base + adicionales seleccionados).
 */
export function calcularTotalSimulador({ precioBase = 0, pasos = [], sel = [] }) {
  let total = Number(precioBase) || 0;

  pasos.forEach((paso, pIdx) => {
    const seleccionados = sel[pIdx] || [];
    const ingredientes = Array.isArray(paso.ingredientes) ? paso.ingredientes : [];

    seleccionados.forEach((ingIdx) => {
      const ing = ingredientes[ingIdx];
      if (ing) {
        total += Number(ing.precio_extra) || 0;
      }
    });
  });

  return total;
}

/**
 * Calcula las calorías totales del plato simulado.
 * Devuelve el total numérico solo si TODAS las opciones elegidas tienen calorías declaradas.
 * Si al menos una opción seleccionada tiene calorias === null/undefined, devuelve null.
 */
export function calcularCaloriasSimulador({ pasos = [], sel = [] }) {
  let totalKcal = 0;
  let tieneOpcionesSeleccionadas = false;

  for (let pIdx = 0; pIdx < pasos.length; pIdx++) {
    const paso = pasos[pIdx];
    const seleccionados = sel[pIdx] || [];
    const ingredientes = Array.isArray(paso.ingredientes) ? paso.ingredientes : [];

    for (const ingIdx of seleccionados) {
      const ing = ingredientes[ingIdx];
      if (!ing) continue;

      tieneOpcionesSeleccionadas = true;
      if (ing.calorias == null || isNaN(Number(ing.calorias))) {
        return null;
      }
      totalKcal += Number(ing.calorias);
    }
  }

  return tieneOpcionesSeleccionadas ? totalKcal : 0;
}
