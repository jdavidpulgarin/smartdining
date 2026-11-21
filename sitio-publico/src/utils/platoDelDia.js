import { CALENDARIO_PLATO_DEL_DIA } from '../datos/platoDelDia.js';

/**
 * Normaliza una cadena de texto eliminando tildes y pasando a minúsculas.
 * @param {string} texto
 * @returns {string}
 */
function normalizarTexto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
  return normalizarTexto(diaConTilde);
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
 * Obtiene el plato del día correspondiente al día indicado o al día de hoy.
 * Función de entrada única que permite una futura sustitución por llamada a API
 * sin necesidad de modificar el componente de la sección.
 * @param {string} [dia]
 * @returns {object} Objeto con la información del plato del día.
 */
export function obtenerPlatoDelDia(dia) {
  const claveDia = dia ? normalizarTexto(dia) : diaDeHoy();
  const plato = CALENDARIO_PLATO_DEL_DIA[claveDia] || CALENDARIO_PLATO_DEL_DIA.lunes;
  return { ...plato };
}
