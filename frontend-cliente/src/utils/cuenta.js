/**
 * Utilidades puras para el cálculo y gestión de la cuenta y los pagos (J-08).
 *
 * Todas las funciones aquí son puras, sin efectos secundarios, para facilitar
 * pruebas unitarias exhaustivas con Vitest sin necesidad de simular el DOM.
 */

/**
 * Formatea un valor numérico a pesos colombianos redondeados sin decimales.
 * Formato esperado: "$ 28.000"
 *
 * @param {number|string} n - Monto a formatear
 * @returns {string} Texto formateado en pesos
 */
export function formatoPesos(n) {
  const num = Math.round(Number(n) || 0);
  return `$ ${num.toLocaleString('es-CO')}`;
}

export const MODOS_PAGO = ['propio', 'igual', 'total'];

export const TITULOS_MODO = {
  propio: 'LO MÍO',
  igual: 'DIVIDIR',
  total: 'TODA LA MESA',
};

/**
 * Normaliza la cuenta devuelta por la API (GET /api/pedidos/mesa/cuenta)
 * organizando a los comensales (colocando a 'miAlias' de primero) y
 * calculando la parte que le corresponde al usuario actual.
 *
 * @param {object} api - Objeto crudo de la API
 * @param {string} [miAlias] - Alias del comensal del JWT
 * @returns {object} Cuenta normalizada
 */
export function normalizarCuenta(api = {}, miAlias = '') {
  const datos = api || {};
  const total = Math.max(0, Number(datos.total_mesa ?? datos.total ?? 0));
  const pagado = Math.max(0, Number(datos.pagado_mesa ?? datos.pagado ?? 0));
  const saldo = Math.max(0, Number(datos.saldo_mesa ?? datos.saldo ?? Math.max(0, total - pagado)));
  const id_mesa = datos.id_mesa != null ? Number(datos.id_mesa) : null;
  const numero = datos.numero != null ? Number(datos.numero) : (id_mesa ?? null);
  const ubicacion = datos.ubicacion || '';
  const items_totales = Number(datos.items_totales ?? 0);
  const sesion_iniciada_en = datos.sesion_iniciada_en || null;
  const pedidos = Array.isArray(datos.pedidos) ? datos.pedidos : [];

  const aliasNormalizado = (miAlias || '').trim().toLowerCase();

  const rawComensales = Array.isArray(datos.comensales) ? datos.comensales : [];

  // Mapear cada comensal
  const comensalesMapeados = rawComensales.map((raw) => {
    const nombre = (raw.comensal || raw.nombre || 'Comensal').trim();
    const esGeneral = nombre.toLowerCase() === 'general';
    const esMio = !esGeneral && Boolean(aliasNormalizado && nombre.toLowerCase() === aliasNormalizado);
    const subtotal = Math.max(0, Number(raw.subtotal ?? 0));
    const pagadoComensal = Math.max(0, Number(raw.pagado ?? 0));
    const saldoComensal = Math.max(0, Number(raw.saldo ?? Math.max(0, subtotal - pagadoComensal)));
    const pago = saldoComensal <= 0;

    return {
      nombre,
      esMio,
      esGeneral,
      subtotal,
      pagado: pagadoComensal,
      saldo: saldoComensal,
      pago,
      items_pedidos: Number(raw.items_pedidos ?? 0),
    };
  });

  // Ordenar: yo primero, luego los demás comensales, y "General" al final si existe
  const mios = [];
  const otros = [];
  const generales = [];

  for (const c of comensalesMapeados) {
    if (c.esMio) {
      mios.push(c);
    } else if (c.esGeneral) {
      generales.push(c);
    } else {
      otros.push(c);
    }
  }

  const comensales = [...mios, ...otros, ...generales];

  // Si miAlias no estaba en la lista de comensales (ej. aún no tiene platos pedidos)
  const yo = mios[0] || null;
  const mia = {
    subtotal: yo ? yo.subtotal : 0,
    pagado: yo ? yo.pagado : 0,
    saldo: yo ? yo.saldo : 0,
  };

  return {
    id_mesa,
    numero,
    ubicacion,
    total,
    pagado,
    saldo,
    items_totales,
    sesion_iniciada_en,
    pedidos,
    mia,
    comensales,
  };
}

/**
 * Calcula los montos a pagar según el modo seleccionado:
 * - propio: mi saldo (nunca más que el saldo de la mesa)
 * - igual: total de la mesa dividido entre el número de personas, redondeado, nunca más que el saldo
 * - total: todo lo que le falta a la mesa (saldo)
 *
 * @param {object} cuenta - Cuenta normalizada
 * @param {number} [personas] - Personas presentes en la mesa (mínimo 1)
 * @returns {{ propio: number, igual: number, total: number }}
 */
export function montosPorModo(cuenta, personas = 1) {
  const saldo = Math.max(0, Number(cuenta?.saldo ?? 0));
  const totalMesa = Math.max(0, Number(cuenta?.total ?? saldo));

  // Número de personas: usa el argumento o la cantidad de comensales individuales (mínimo 1)
  const cantPersonas = Math.max(
    1,
    Number(personas) || (cuenta?.comensales ? cuenta.comensales.filter((c) => !c.esGeneral).length : 1) || 1
  );

  const miSaldo = Math.max(0, Number(cuenta?.mia?.saldo ?? 0));
  const propio = Math.min(saldo, miSaldo);
  const cuotaIgual = Math.round(totalMesa / cantPersonas);
  const igual = Math.min(saldo, Math.max(0, cuotaIgual));
  const total = saldo;

  return {
    propio,
    igual,
    total,
  };
}

/**
 * Aplica un evento payment:confirmed recibido (o simulado) sobre la cuenta actual.
 * Descuenta el monto pagado del comensal indicado (o de todos si comensal es null)
 * y ajusta el saldo y pagado de la mesa.
 *
 * @param {object} cuenta - Cuenta normalizada actual
 * @param {object} evento - Evento payment:confirmed
 * @returns {object} Nueva cuenta actualizada inmutablemente
 */
export function aplicarPagoConfirmado(cuenta, evento = {}) {
  if (!cuenta) return cuenta;

  const monto = evento.monto != null
    ? Math.max(0, Number(evento.monto))
    : (evento.monto_centavos != null ? Math.max(0, Number(evento.monto_centavos) / 100) : 0);

  const comensalEvento = evento.comensal ? String(evento.comensal).trim().toLowerCase() : null;

  let resto = monto;
  const comensalesClonados = (cuenta.comensales || []).map((c) => ({ ...c }));

  // Si el evento tiene comensal específico, abonar a ese comensal primero
  if (comensalEvento) {
    const destino = comensalesClonados.find(
      (c) => c.nombre.trim().toLowerCase() === comensalEvento
    );
    if (destino) {
      const abono = Math.min(resto, destino.saldo);
      destino.pagado += abono;
      destino.saldo = Math.max(0, destino.subtotal - destino.pagado);
      destino.pago = destino.saldo <= 0;
      resto -= abono;
    }
  }

  // Si es pago de la mesa completa (comensal null) o si sobró monto tras cubrir al comensal:
  if (resto > 0) {
    for (const c of comensalesClonados) {
      if (resto <= 0) break;
      const abono = Math.min(resto, c.saldo);
      c.pagado += abono;
      c.saldo = Math.max(0, c.subtotal - c.pagado);
      c.pago = c.saldo <= 0;
      resto -= abono;
    }
  }

  const nuevoTotal = cuenta.total;
  let nuevoSaldo;
  if (evento.saldo_restante != null) {
    nuevoSaldo = Math.max(0, Number(evento.saldo_restante));
  } else if (evento.saldo_restante_centavos != null) {
    nuevoSaldo = Math.max(0, Number(evento.saldo_restante_centavos) / 100);
  } else {
    nuevoSaldo = Math.max(0, cuenta.saldo - monto);
  }

  const nuevoPagado = Math.min(nuevoTotal, Math.max(0, nuevoTotal - nuevoSaldo));

  // Recalcular mia
  const yo = comensalesClonados.find((c) => c.esMio);
  const nuevaMia = yo
    ? { subtotal: yo.subtotal, pagado: yo.pagado, saldo: yo.saldo }
    : { ...cuenta.mia };

  return {
    ...cuenta,
    pagado: nuevoPagado,
    saldo: nuevoSaldo,
    comensales: comensalesClonados,
    mia: nuevaMia,
  };
}

/**
 * Genera el texto para la notificación toast global ante un pago confirmado.
 *
 * @param {object} evento - Evento payment:confirmed
 * @param {string} [miAlias] - Alias del usuario actual
 * @returns {string} Mensaje para el toast
 */
export function textoPagoConfirmado(evento = {}, miAlias = '') {
  const monto = evento.monto != null
    ? Number(evento.monto)
    : (evento.monto_centavos != null ? Number(evento.monto_centavos) / 100 : 0);

  const montoTexto = formatoPesos(monto);
  const comensalEvento = evento.comensal ? String(evento.comensal).trim() : null;
  const aliasNormalizado = (miAlias || '').trim().toLowerCase();

  if (!comensalEvento) {
    return 'Se pagó la cuenta completa';
  }

  if (aliasNormalizado && comensalEvento.toLowerCase() === aliasNormalizado) {
    return `Pago confirmado: ${montoTexto}`;
  }

  return `${comensalEvento} pagó ${montoTexto}`;
}

/**
 * Traduce códigos de error HTTP / Socket a mensajes claros en español.
 *
 * @param {number|string} [status] - Código de estado HTTP
 * @param {string} [codigo] - Código simbólico de error
 * @returns {string} Mensaje de error amigable
 */
export function traducirErrorPago(status, codigo) {
  const s = Number(status);
  const cod = String(codigo || '').toUpperCase();

  if (s === 409 || cod === 'SIN_SALDO') {
    return 'No hay saldo pendiente para pagar';
  }

  if (s === 429 || cod === 'RATE_LIMIT') {
    return 'Demasiados intentos, espera un minuto';
  }

  if (cod === 'NO_CONFIGURADO' || (s === 503 && cod.includes('CONFIGURADO'))) {
    return 'Los pagos en línea no están disponibles; paga en la caja';
  }

  if (s === 401 || s === 403 || cod === 'NO_AUTORIZADO' || cod === 'TOKEN_INVALIDO') {
    return 'Tu sesión de la mesa terminó, escanea el QR de nuevo';
  }

  return 'No pudimos iniciar el pago, intenta de nuevo';
}

export const ESTADO_CUENTA_INICIAL = {
  estado: 'inicial',
  mensaje: 'Pedir la cuenta al mesero',
  deshabilitado: false,
  tipo: 'neutro',
};

export const ESTADO_CUENTA_ENVIANDO = {
  estado: 'enviando',
  mensaje: 'Avisando al mesero...',
  deshabilitado: true,
  tipo: 'info',
};

/**
 * Traduce el resultado (o error) de emitir cuenta:solicitada a un estado normalizado.
 *
 * @param {object|Error|string} resultado - Ack exitoso, Error capturado o clave de estado
 * @param {boolean} [esError=false] - Indica si resultado proviene de un catch
 * @returns {{ estado: 'inicial'|'enviando'|'ok'|'rate_limit'|'error', mensaje: string, deshabilitado: boolean, tipo: 'neutro'|'info'|'exito'|'advertencia'|'error' }}
 */
export function estadoCuentaSolicitada(resultado, esError = false) {
  if (resultado === 'enviando') {
    return ESTADO_CUENTA_ENVIANDO;
  }
  if (!resultado && !esError) {
    return ESTADO_CUENTA_INICIAL;
  }

  if (esError) {
    const codigo = resultado?.codigo || resultado?.message || '';
    if (codigo === 'RATE_LIMIT' || /RATE_LIMIT/i.test(codigo)) {
      return {
        estado: 'rate_limit',
        mensaje: 'La mesa ya pidió la cuenta; espera un momento',
        deshabilitado: true,
        tipo: 'advertencia',
      };
    }
    return {
      estado: 'error',
      mensaje: 'No pudimos avisar al mesero. Toca para reintentar.',
      deshabilitado: false,
      tipo: 'error',
    };
  }

  if (resultado?.codigo === 'RATE_LIMIT' || resultado?.ack?.codigo === 'RATE_LIMIT') {
    return {
      estado: 'rate_limit',
      mensaje: 'La mesa ya pidió la cuenta; espera un momento',
      deshabilitado: true,
      tipo: 'advertencia',
    };
  }

  if (resultado?.ok === false) {
    return {
      estado: 'error',
      mensaje: 'No pudimos avisar al mesero. Toca para reintentar.',
      deshabilitado: false,
      tipo: 'error',
    };
  }

  return {
    estado: 'ok',
    mensaje: 'Ya le avisamos al mesero que quieres la cuenta',
    deshabilitado: true,
    tipo: 'exito',
  };
}

/**
 * Devuelve el mensaje explicativo para la pantalla PAGA EN LA CAJA según el estado del aviso al mesero.
 *
 * @param {{ estado: string }} avisoCuenta
 * @returns {string}
 */
export function textoCajaSegunEstado(avisoCuenta) {
  switch (avisoCuenta?.estado) {
    case 'enviando':
      return 'Avisando al mesero que pagarás en la caja...';
    case 'ok':
      return 'Ya le avisamos al mesero. Puedes acercarte a la caja o esperarlo en la mesa.';
    case 'rate_limit':
      return 'La mesa ya pidió la cuenta. Puedes acercarte a la caja o esperar al mesero.';
    case 'error':
      return 'No pudimos avisar al mesero. Puedes acercarte directamente a la caja a pagar.';
    default:
      return 'Puedes acercarte a la caja a pagar o esperar al mesero en la mesa.';
  }
}

export default {
  formatoPesos,
  MODOS_PAGO,
  TITULOS_MODO,
  normalizarCuenta,
  montosPorModo,
  aplicarPagoConfirmado,
  textoPagoConfirmado,
  traducirErrorPago,
  ESTADO_CUENTA_INICIAL,
  ESTADO_CUENTA_ENVIANDO,
  estadoCuentaSolicitada,
  textoCajaSegunEstado,
};
