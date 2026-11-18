import restauranteDefault from '../datos/restaurante.js';

export const DIAS_SEMANA_ORDEN = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
];

const DIAS_EN_A_ES = {
  Monday: 'lunes',
  Tuesday: 'martes',
  Wednesday: 'miercoles',
  Thursday: 'jueves',
  Friday: 'viernes',
  Saturday: 'sabado',
  Sunday: 'domingo',
};

const NOMBRES_DIAS_ES = {
  lunes: 'lunes',
  martes: 'martes',
  miercoles: 'miércoles',
  jueves: 'jueves',
  viernes: 'viernes',
  sabado: 'sábado',
  domingo: 'domingo',
};

/**
 * Convierte una hora en formato "HH:MM" a minutos transcurridos desde medianoche (0-1439).
 */
export function aMinutos(horaHHMM) {
  if (!horaHHMM || typeof horaHHMM !== 'string') return 0;
  const [h, m] = horaHHMM.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Formatea una hora "HH:MM" en formato de 12 horas es-CO con "a. m." / "p. m.".
 */
export function formatearHora12(horaHHMM) {
  if (!horaHHMM || typeof horaHHMM !== 'string') return '';
  const [hStr, mStr] = horaHHMM.split(':');
  const horas = parseInt(hStr, 10);
  const minutos = parseInt(mStr, 10);
  if (isNaN(horas) || isNaN(minutos)) return '';

  const fechaRef = new Date(Date.UTC(2020, 0, 1, horas, minutos, 0));
  const dtf = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return dtf.format(fechaRef).replace(/[\u202F\u00A0]/g, ' ');
}

/**
 * Determina el estado de apertura de un restaurante dada una fecha/hora,
 * su configuración de horario y la zona horaria objetivo.
 *
 * Función pura: NUNCA usa getHours() o getDay() del cliente ni depende de la zona
 * horaria local del dispositivo.
 *
 * @param {Date} [ahora=new Date()]
 * @param {Object} [horario=restauranteDefault.horario]
 * @param {string} [zona='America/Bogota']
 * @returns {{ abierto: boolean, texto: string }}
 */
export function estadoHorario(
  ahora = new Date(),
  horario = restauranteDefault.horario,
  zona = 'America/Bogota'
) {
  if (!horario || typeof horario !== 'object') {
    return { abierto: false, texto: 'Cerrado' };
  }

  // Obtener día de la semana y hora HH:MM estrictamente en la zona horaria objetivo
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const partes = dtf.formatToParts(ahora);
  let diaEn = '';
  let hora = 0;
  let minuto = 0;

  for (const p of partes) {
    if (p.type === 'weekday') diaEn = p.value;
    if (p.type === 'hour') hora = parseInt(p.value, 10);
    if (p.type === 'minute') minuto = parseInt(p.value, 10);
  }

  const diaActual = DIAS_EN_A_ES[diaEn];
  if (!diaActual) {
    return { abierto: false, texto: 'Cerrado' };
  }

  const indiceActual = DIAS_SEMANA_ORDEN.indexOf(diaActual);
  const minutosActual = hora * 60 + minuto;

  // 1. Revisar si estamos en un turno trasnochador iniciado el día de ayer (cierra < abre)
  const indiceAyer = (indiceActual + 6) % 7;
  const diaAyer = DIAS_SEMANA_ORDEN[indiceAyer];
  const horarioAyer = horario[diaAyer];
  if (horarioAyer?.abre && horarioAyer?.cierra) {
    const abreAyer = aMinutos(horarioAyer.abre);
    const cierraAyer = aMinutos(horarioAyer.cierra);
    if (cierraAyer < abreAyer && minutosActual < cierraAyer) {
      return {
        abierto: true,
        texto: `Abierto ahora · Cierra a las ${formatearHora12(horarioAyer.cierra)}`,
      };
    }
  }

  // 2. Revisar el horario del día de hoy
  const horarioHoy = horario[diaActual];
  if (horarioHoy?.abre && horarioHoy?.cierra) {
    const abreHoy = aMinutos(horarioHoy.abre);
    const cierraHoy = aMinutos(horarioHoy.cierra);

    // Turno trasnochador que inicia hoy
    if (cierraHoy < abreHoy) {
      if (minutosActual >= abreHoy) {
        return {
          abierto: true,
          texto: `Abierto ahora · Cierra a las ${formatearHora12(horarioHoy.cierra)}`,
        };
      }
      return {
        abierto: false,
        texto: `Cerrado · Abre hoy a las ${formatearHora12(horarioHoy.abre)}`,
      };
    }

    // Turno regular (abre y cierra el mismo día)
    // Abre inclusivo, cierra exclusivo (a las 23:00 ya está cerrado)
    if (minutosActual >= abreHoy && minutosActual < cierraHoy) {
      return {
        abierto: true,
        texto: `Abierto ahora · Cierra a las ${formatearHora12(horarioHoy.cierra)}`,
      };
    }

    if (minutosActual < abreHoy) {
      return {
        abierto: false,
        texto: `Cerrado · Abre hoy a las ${formatearHora12(horarioHoy.abre)}`,
      };
    }
  }

  // 3. Hoy ya cerró o no abre: buscar el siguiente día con apertura
  for (let offset = 1; offset <= 7; offset++) {
    const proxIndice = (indiceActual + offset) % 7;
    const proxDia = DIAS_SEMANA_ORDEN[proxIndice];
    const horarioProx = horario[proxDia];
    if (horarioProx?.abre && horarioProx?.cierra) {
      const horaAbre = formatearHora12(horarioProx.abre);
      if (offset === 1) {
        return {
          abierto: false,
          texto: `Cerrado · Abre mañana a las ${horaAbre}`,
        };
      }
      return {
        abierto: false,
        texto: `Cerrado · Abre el ${NOMBRES_DIAS_ES[proxDia]} a las ${horaAbre}`,
      };
    }
  }

  return { abierto: false, texto: 'Cerrado' };
}
