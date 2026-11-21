import { CALENDARIO_PLATO_DEL_DIA } from '../datos/platoDelDia.js';

/**
 * Normaliza una cadena de texto eliminando tildes, pasando a minúsculas y colapsando espacios.
 * @param {string} texto
 * @returns {string}
 */
export function normalizar(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve el día de la semana actual según la zona horaria 'America/Bogota'.
 * Retorna 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado' o 'domingo' (sin tildes).
 * @param {Date} [fecha=new Date()]
 * @returns {string}
 */
export function diaDeHoy(fecha = new Date()) {
  const formateador = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
  });
  const diaConTilde = formateador.format(fecha);
  return normalizar(diaConTilde);
}

/**
 * Calcula los milisegundos restantes hasta la medianoche (00:00:00) en la zona horaria de Bogotá.
 * @param {Date} [fecha=new Date()]
 * @returns {number} Milisegundos hasta las 00:00:00 de Bogotá.
 */
export function msHastaMedianocheBogota(fecha = new Date()) {
  const formateador = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  const partes = Object.fromEntries(
    formateador.formatToParts(fecha).map((p) => [p.type, p.value])
  );

  const hora = Number(partes.hour) % 24;
  const minuto = Number(partes.minute);
  const segundo = Number(partes.second);
  const ms = fecha.getMilliseconds();

  const pasadosMs = ((hora * 60 + minuto) * 60 + segundo) * 1000 + ms;
  return 86400000 - pasadosMs;
}

/**
 * Extrae una lista plana de platos desde cualquier formato de carta (objeto con platos/armables, categorias o array).
 * @param {object|Array} carta
 * @returns {Array}
 */
function extraerPlatos(carta) {
  if (!carta) return [];
  if (Array.isArray(carta)) return carta;
  const lista = [];
  if (Array.isArray(carta.platos)) lista.push(...carta.platos);
  if (Array.isArray(carta.armables)) lista.push(...carta.armables);
  if (Array.isArray(carta.categorias)) {
    for (const cat of carta.categorias) {
      if (Array.isArray(cat.platos)) lista.push(...cat.platos);
    }
  }
  return lista;
}

/**
 * Obtiene el plato del día correspondiente al día indicado y busca su precio y disponibilidad en la carta en vivo.
 *
 * @param {string} [dia] - Día de la semana o undefined para usar hoy.
 * @param {object|Array} [carta] - Objeto o arreglo con la carta de platos.
 * @returns {object} Información del plato con su estado ('disponible', 'agotado', 'no-existe', 'cargando'), precio y datos promocionales.
 */
export function obtenerPlatoDelDia(dia, carta) {
  const claveDia = dia ? normalizar(dia) : diaDeHoy();
  const datosCalendario = CALENDARIO_PLATO_DEL_DIA[claveDia] || CALENDARIO_PLATO_DEL_DIA.lunes;
  const nombreReferencia = datosCalendario.nombreCarta;

  if (!carta) {
    return {
      estado: 'cargando',
      ...datosCalendario,
      nombre: nombreReferencia,
    };
  }

  const listaPlatos = extraerPlatos(carta);
  const nombreBuscado = normalizar(nombreReferencia);

  const platoEncontrado = listaPlatos.find(
    (p) => normalizar(p?.nombre) === nombreBuscado
  );

  if (!platoEncontrado) {
    return {
      estado: 'no-existe',
      ...datosCalendario,
      nombre: nombreReferencia,
    };
  }

  const disponible =
    platoEncontrado.disponible !== false &&
    platoEncontrado.disponible_plato !== false &&
    (platoEncontrado.tieneStock !== undefined ? platoEncontrado.tieneStock : true);

  const esRespaldo = carta?.origen === 'fija';

  if (!disponible) {
    return {
      estado: 'agotado',
      ...datosCalendario,
      nombre: platoEncontrado.nombre || nombreReferencia,
      esRespaldo,
    };
  }

  return {
    estado: 'disponible',
    precio: Number(platoEncontrado.precio),
    esRespaldo,
    ...datosCalendario,
    nombre: platoEncontrado.nombre || nombreReferencia,
  };
}
