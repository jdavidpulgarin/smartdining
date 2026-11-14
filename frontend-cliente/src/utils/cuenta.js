/**
 * Utilidades puras para el cálculo y gestión de la cuenta y los pagos (J-08).
 *
 * Todas las funciones aquí son puras, sin efectos secundarios, para facilitar
 * pruebas unitarias exhaustivas con Vitest sin necesidad de simular el DOM.
 */

import { claveAlias } from './apodo';

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

export const MODOS_PAGO = ['propio', 'total'];

export const TITULOS_MODO = {
  propio: 'Pagar lo mío',
  total: 'Pagar toda la cuenta',
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
 * Cuenta la cantidad de comensales distintos en la cuenta (excluyendo "General"
 * si existiera), comparando con claveAlias. Mínimo 1.
 *
 * @param {object} [cuenta] - Cuenta normalizada de la mesa
 * @returns {number}
 */
export function contarComensalesCuenta(cuenta) {
  const personas = new Set();
  const comensales = Array.isArray(cuenta?.comensales) ? cuenta.comensales : [];
  for (const c of comensales) {
    if (!c) continue;
    if (c.esGeneral) continue;
    const nombre = typeof c === 'string' ? c : (c.nombre || c.comensal || '');
    const clave = claveAlias(nombre);
    if (clave && clave !== 'general') {
      personas.add(clave);
    }
  }
  return Math.max(1, personas.size);
}

/**
 * Calcula los montos a pagar según el modo seleccionado:
 * - propio: mi saldo (nunca más que el saldo de la mesa)
 * - total: todo lo que le falta a la mesa (saldo)
 *
 * @param {object} cuenta - Cuenta normalizada (cuenta.saldo es el saldo de la mesa)
 * @returns {{ propio: number, total: number }}
 */
export function montosPorModo(cuenta) {
  const saldo = Math.max(0, Number(cuenta?.saldo ?? 0));
  const miSaldo = Math.max(0, Number(cuenta?.mia?.saldo ?? 0));
  const propio = Math.min(saldo, miSaldo);
  const total = saldo;

  return {
    propio,
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

/**
 * Aviso en la pantalla de pago para quien pidió para varios comensales (J-15).
 * Decisión del equipo: Opción A, "quien pide, paga".
 *
 * @param {object} opciones
 * @param {object} [opciones.cuenta] - Cuenta normalizada de la mesa
 * @param {object} [opciones.presencia] - Estado de mesa:presencia ({ comensales, sin_celular, pagaron })
 * @param {string} [opciones.yo] - Alias de quien paga
 * @param {('propio'|'total')} [opciones.modo] - Modo de pago ('propio' | 'total')
 * @returns {{ tipo: 'especifico' | 'general', nombres: string[], mensaje: string } | null}
 */
export function avisoPedidoGrupal({ cuenta, presencia, yo, modo } = {}) {
  // Solo aplica si modo === 'propio' y mi saldo (cuenta.mia.saldo) > 0. Si no, null.
  if (modo !== 'propio') return null;
  const miSaldo = Number(cuenta?.mia?.saldo ?? 0);
  if (miSaldo <= 0) return null;

  const miAlias = typeof yo === 'string' ? yo.trim() : '';

  function esGeneral(alias) {
    return String(alias || '').trim().toLowerCase() === 'general';
  }

  function esYo(alias) {
    if (!miAlias) return false;
    return String(alias || '').trim() === miAlias;
  }

  // Personas de la mesa: unión de presencia.comensales y presencia.sin_celular (si hay presencia)
  // con los comensales de la cuenta que no son "General". Sin repetidos y sin incluirme a mí (compara con el alias tal cual).
  const personasMesaSet = new Set();

  if (presencia) {
    if (Array.isArray(presencia.comensales)) {
      for (const a of presencia.comensales) {
        const str = typeof a === 'string' ? a.trim() : '';
        if (str && !esGeneral(str) && !esYo(str)) {
          personasMesaSet.add(str);
        }
      }
    }
    if (Array.isArray(presencia.sin_celular)) {
      for (const a of presencia.sin_celular) {
        const str = typeof a === 'string' ? a.trim() : '';
        if (str && !esGeneral(str) && !esYo(str)) {
          personasMesaSet.add(str);
        }
      }
    }
  }

  const comensalesCuenta = Array.isArray(cuenta?.comensales) ? cuenta.comensales : [];
  for (const c of comensalesCuenta) {
    const nombre = typeof c === 'string' ? c.trim() : (c?.nombre || c?.comensal || '').trim();
    if (nombre && !esGeneral(nombre) && !esYo(nombre)) {
      personasMesaSet.add(nombre);
    }
  }

  // Si no hay nadie más en la mesa → null.
  if (personasMesaSet.size === 0) return null;

  // "sinPedidos": personas de la presencia que NO aparecen en la cuenta o aparecen con subtotal 0 (sin "General" y sin mí).
  const sinPedidos = [];
  if (presencia) {
    const personasPresenciaSet = new Set();
    if (Array.isArray(presencia.comensales)) {
      for (const a of presencia.comensales) {
        const str = typeof a === 'string' ? a.trim() : '';
        if (str && !esGeneral(str) && !esYo(str)) {
          personasPresenciaSet.add(str);
        }
      }
    }
    if (Array.isArray(presencia.sin_celular)) {
      for (const a of presencia.sin_celular) {
        const str = typeof a === 'string' ? a.trim() : '';
        if (str && !esGeneral(str) && !esYo(str)) {
          personasPresenciaSet.add(str);
        }
      }
    }

    for (const p of personasPresenciaSet) {
      const registro = comensalesCuenta.find((c) => {
        const nombre = typeof c === 'string' ? c.trim() : (c?.nombre || c?.comensal || '').trim();
        return nombre === p;
      });

      if (!registro || Number(registro.subtotal ?? 0) <= 0) {
        sinPedidos.push(p);
      }
    }
  }

  // Si hay sinPedidos → tipo 'especifico'
  if (sinPedidos.length > 0) {
    let nombres;
    let textoSujetos;
    const esPlural = sinPedidos.length > 1;

    if (sinPedidos.length === 1) {
      nombres = [sinPedidos[0]];
      textoSujetos = sinPedidos[0];
    } else if (sinPedidos.length === 2) {
      nombres = [sinPedidos[0], sinPedidos[1]];
      textoSujetos = `${sinPedidos[0]} y ${sinPedidos[1]}`;
    } else if (sinPedidos.length === 3) {
      nombres = [sinPedidos[0], sinPedidos[1], sinPedidos[2]];
      textoSujetos = `${sinPedidos[0]}, ${sinPedidos[1]} y ${sinPedidos[2]}`;
    } else {
      const restantes = sinPedidos.length - 3;
      nombres = [sinPedidos[0], sinPedidos[1], sinPedidos[2], `y ${restantes} más`];
      textoSujetos = `${sinPedidos.slice(0, 3).join(', ')} y ${restantes} más`;
    }

    const mensaje = esPlural
      ? `${textoSujetos} no tienen nada a su nombre. Si tú pediste por ellos o ellas, puedes pagar toda la cuenta.`
      : `${textoSujetos} no tiene nada a su nombre. Si tú pediste por él o ella, puedes pagar toda la cuenta.`;

    return {
      tipo: 'especifico',
      nombres,
      mensaje,
    };
  }

  // Si no → tipo 'general'
  return {
    tipo: 'general',
    nombres: [],
    mensaje: '¿Pediste para otros? Puedes pagar toda la cuenta.',
  };
}

export const TEXTO_SUGERENCIA_SIN_CELULAR =
  '¿Alguien no tiene celular? Pídele al mesero que lo agregue a la mesa.';

/**
 * Determina si se debe mostrar la sugerencia para comensales sin celular (J-15).
 * Se muestra mientras haya saldo pendiente en la mesa.
 *
 * @param {object} [cuenta] - Cuenta normalizada de la mesa
 * @returns {boolean}
 */
export function debeMostrarSugerenciaSinCelular(cuenta) {
  const saldoMesa = Math.max(0, Number(cuenta?.saldo ?? 0));
  return saldoMesa > 0;
}

/**
 * Determina si se debe salir de la pantalla de espera tras un intento de pago (J-15).
 * Si el saldo actual bajó respecto al saldo que había antes de iniciar el pago,
 * significa que el pago ya fue confirmado e impactado en la cuenta.
 *
 * @param {object} [opciones]
 * @param {number} [opciones.saldoAntes]
 * @param {number} [opciones.saldoAhora]
 * @returns {boolean}
 */
export function debeSalirDeEspera({ saldoAntes, saldoAhora } = {}) {
  if (
    saldoAntes == null ||
    saldoAhora == null ||
    typeof saldoAntes !== 'number' ||
    typeof saldoAhora !== 'number' ||
    !Number.isFinite(saldoAntes) ||
    !Number.isFinite(saldoAhora)
  ) {
    return false;
  }
  return saldoAhora < saldoAntes;
}

/**
 * Decide si se debe salir de la pantalla de espera o mantenerla (J-15).
 * Con el widget abierto (o origen 'widget'), NUNCA se cierra el widget ni se
 * sale de la espera por pagos de terceros o por bajas de saldo. Solo se sale
 * ante un pago confirmado propio, o por cierre/rechazo del propio widget.
 *
 * @param {object} [opciones]
 * @param {'widget'|'redireccion'} [opciones.origen='redireccion'] - Origen del estado de espera
 * @param {boolean} [opciones.widgetAbierto=false] - Si el modal del widget de Wompi está abierto
 * @param {number|null} [opciones.saldoAntes] - Saldo antes de iniciar el pago
 * @param {number|null} [opciones.saldoAhora] - Saldo actual tras la actualización
 * @param {'pago_propio'|'pago_mesa'|'pago_otro'|'salida_espera'|'saldo_cero'|string} [opciones.tipoEvento]
 * @returns {'mantener' | 'confirmado_propio' | 'confirmado_mesa' | 'salir_a_cuenta'}
 */
export function decidirSalidaEspera({
  origen = 'redireccion',
  widgetAbierto = false,
  saldoAntes = null,
  saldoAhora = null,
  tipoEvento = 'salida_espera',
} = {}) {
  const tieneWidget = Boolean(widgetAbierto || origen === 'widget');

  // Si mi widget está abierto (o el origen de la espera es el widget):
  if (tieneWidget) {
    if (tipoEvento === 'pago_propio') {
      return 'confirmado_propio';
    }
    // Cualquier otro evento (pago de otro, mesa en 0 por otro, baja de saldo) se mantiene
    return 'mantener';
  }

  // Sin widget abierto (origen 'redireccion'):
  if (tipoEvento === 'pago_propio') {
    return 'confirmado_propio';
  }

  if (tipoEvento === 'pago_mesa' || tipoEvento === 'saldo_cero') {
    return 'confirmado_mesa';
  }

  // Salida por baja de saldo (debeSalirDeEspera / salida_espera):
  if (
    saldoAntes != null &&
    saldoAhora != null &&
    typeof saldoAntes === 'number' &&
    typeof saldoAhora === 'number' &&
    Number.isFinite(saldoAntes) &&
    Number.isFinite(saldoAhora) &&
    saldoAhora < saldoAntes
  ) {
    return saldoAhora === 0 ? 'confirmado_mesa' : 'salir_a_cuenta';
  }

  return 'mantener';
}

/**
 * Clasifica un evento payment:confirmed o el estado de confirmación (J-15).
 * - 'propio': el comensal coincide con el usuario actual ('yo').
 * - 'mesa': cobro de toda la mesa en caja (comensal null/vacío), pago de otro
 *           comensal con el que la mesa queda en saldo 0, o estado de saldo 0 sin evento propio.
 * - 'otro': pago realizado por otro comensal dejando aún saldo pendiente.
 *
 * @param {object} [opciones]
 * @param {string|null} [opciones.comensal] - Alias del comensal en el evento
 * @param {string|null} [opciones.yo] - Alias del usuario actual
 * @param {number|null} [opciones.saldoRestante] - Saldo restante de la mesa tras el pago
 * @returns {'propio' | 'mesa' | 'otro'}
 */
export function mensajePagoConfirmado({ comensal, yo, saldoRestante } = {}) {
  const comensalNorm = comensal ? String(comensal).trim().toLowerCase() : null;
  const yoNorm = yo ? String(yo).trim().toLowerCase() : null;

  if (!comensalNorm) {
    return 'mesa';
  }

  if (yoNorm && comensalNorm === yoNorm) {
    return 'propio';
  }

  // Si pagó otro comensal pero con eso la mesa quedó en $0:
  if (saldoRestante !== undefined && saldoRestante !== null && Number(saldoRestante) <= 0) {
    return 'mesa';
  }

  return 'otro';
}

/**
 * Determina el texto a mostrar en la pantalla de confirmación de pago (J-15).
 * Solo si tipo === 'propio' se muestra "Pagaste $X. Te llegará el comprobante de Wompi."
 * En cualquier otro caso ('mesa', 'otro', etc.) se muestra "La mesa quedó pagada."
 *
 * @param {object} [opciones]
 * @param {'propio'|'mesa'|'otro'|string} [opciones.tipo]
 * @param {number} [opciones.monto]
 * @param {function} [opciones.formato]
 * @returns {{ esPropio: boolean, mensaje: string, comprobante: string|null }}
 */
export function textoDetalleConfirmacion({ tipo, monto = 0, formato = formatoPesos } = {}) {
  if (tipo === 'propio') {
    return {
      esPropio: true,
      mensaje: `Pagaste ${formato(monto)}.`,
      comprobante: 'Te llegará el comprobante de Wompi.',
    };
  }

  return {
    esPropio: false,
    mensaje: 'La mesa quedó pagada.',
    comprobante: null,
  };
}

/**
 * Determina qué eventId usar al crear una intención de pago (J-15).
 * Reutiliza el eventId previo si se reintenta el mismo modo con el mismo saldo
 * y no se ha confirmado un pago previo, evitando agotar la cuota de rate limit.
 *
 * @param {object|null} previo - Intento previo { eventId, modo, saldo, confirmado }
 * @param {object} [actual] - Estado actual { modo, saldo }
 * @param {function} [generar] - Función que genera un nuevo eventId
 * @returns {string|null}
 */
export function eventIdParaIntento(previo, { modo, saldo } = {}, generar) {
  if (
    previo &&
    previo.eventId &&
    !previo.confirmado &&
    previo.modo === modo &&
    previo.saldo === saldo
  ) {
    return previo.eventId;
  }
  return typeof generar === 'function' ? generar() : null;
}

/**
 * Determina la configuración del selector de modos de pago y el botón de acción (T2).
 *
 * - Comensales en la mesa = comensales distintos de cuenta.comensales comparados con claveAlias.
 *   NO usa mesa:presencia para no colapsar a total si otros bloquean el celular.
 * - Si hay 1 persona (o mi saldo = saldo de la mesa) → mostrarSelector false y modo 'total' con el texto "Pagar la cuenta".
 * - Si lo mío ya está pagado (miSaldo <= 0) → solo 'total' (no mostrar 'propio', ni siquiera deshabilitado).
 * - Si no → las dos opciones, con modo inicial 'propio'.
 *
 * @param {object} [opciones]
 * @param {number} [opciones.saldoMesa=0] - Saldo restante de la mesa
 * @param {number} [opciones.miSaldo=0] - Saldo personal del comensal
 * @param {number} [opciones.miPagado=0] - Monto ya pagado por el comensal
 * @param {object} [opciones.cuenta] - Cuenta normalizada de la mesa
 * @param {number} [opciones.personas] - Número explícito de personas (para pruebas)
 * @returns {{
 *   mostrarSelector: boolean,
 *   modo: 'propio' | 'total',
 *   modoInicial: 'propio' | 'total',
 *   modosDisponibles: Array<'propio' | 'total'>,
 *   texto: string|null,
 *   textoBoton: string|null,
 *   loMioHabilitado: boolean,
 *   yaPague: boolean
 * }}
 */
export function estadoSelectorPago({
  saldoMesa = 0,
  miSaldo = 0,
  miPagado = 0,
  cuenta = null,
  personas = null,
} = {}) {
  const saldoM = Math.max(0, Number(saldoMesa) || 0);
  const saldoP = Math.max(0, Number(miSaldo) || 0);
  const pagadoP = Math.max(0, Number(miPagado) || 0);
  const yaPague = pagadoP > 0 && saldoP <= 0;

  const cantPersonas =
    typeof personas === 'number'
      ? Math.max(1, Math.round(personas))
      : contarComensalesCuenta(cuenta);

  if (saldoM <= 0) {
    return {
      mostrarSelector: false,
      modosDisponibles: [],
      modo: 'total',
      modoInicial: 'total',
      textoBoton: 'Pagar la cuenta',
      texto: 'Pagar la cuenta',
      loMioHabilitado: false,
      yaPague,
    };
  }

  // Si hay 1 persona (o mi saldo = saldo de la mesa) → mostrarSelector false y modo 'total' con el texto "Pagar la cuenta"
  if (cantPersonas === 1 || saldoP >= saldoM) {
    return {
      mostrarSelector: false,
      modosDisponibles: ['total'],
      modo: 'total',
      modoInicial: 'total',
      textoBoton: 'Pagar la cuenta',
      texto: 'Pagar la cuenta',
      loMioHabilitado: false,
      yaPague,
    };
  }

  // Si lo mío ya está pagado (miSaldo <= 0) → solo 'total' (no mostrar 'propio', ni siquiera deshabilitado)
  if (saldoP <= 0) {
    return {
      mostrarSelector: false,
      modosDisponibles: ['total'],
      modo: 'total',
      modoInicial: 'total',
      textoBoton: 'Pagar toda la cuenta',
      texto: 'Pagar toda la cuenta',
      loMioHabilitado: false,
      yaPague,
    };
  }

  // Si no → las dos opciones, con modo inicial 'propio'
  return {
    mostrarSelector: true,
    modosDisponibles: ['propio', 'total'],
    modo: 'propio',
    modoInicial: 'propio',
    textoBoton: null,
    texto: null,
    loMioHabilitado: true,
    yaPague,
  };
}

/**
 * Determina el color y texto de ayuda de la tarjeta "TU PARTE" (J-15).
 * - yaPague true: $0 en verde (#2FA35A) y "Ya pagaste lo tuyo. ¡Gracias!".
 * - Sin consumos propios (miSaldo 0 y miPagado 0): color normal (#FFFFFF) y
 *   "No tienes nada a tu nombre. Puedes aportar pagando toda la cuenta.".
 * - Saldo propio pendiente (miSaldo > 0): color normal (#FFFFFF) y "Consumiste $X".
 *
 * @param {object} [opciones]
 * @param {number} [opciones.miSaldo=0] - Saldo personal del comensal
 * @param {number} [opciones.miPagado=0] - Monto ya pagado por el comensal
 * @param {number} [opciones.miSubtotal=0] - Subtotal consumido por el comensal
 * @param {boolean} [opciones.yaPague] - Si ya pagó según estadoSelectorPago
 * @param {function} [opciones.formato=formatoPesos]
 * @returns {{ color: string, esVerde: boolean, mensaje: string }}
 */
export function infoTuParte({
  miSaldo = 0,
  miPagado = 0,
  miSubtotal = 0,
  yaPague,
  formato = formatoPesos,
} = {}) {
  const saldo = Math.max(0, Number(miSaldo) || 0);
  const pagado = Math.max(0, Number(miPagado) || 0);
  const subtotal = Math.max(0, Number(miSubtotal) || 0);

  const pago = yaPague !== undefined ? Boolean(yaPague) : (pagado > 0 && saldo <= 0);

  if (pago) {
    return {
      color: '#2FA35A',
      esVerde: true,
      mensaje: 'Ya pagaste lo tuyo. ¡Gracias!',
    };
  }

  if (saldo <= 0) {
    return {
      color: '#FFFFFF',
      esVerde: false,
      mensaje: 'No tienes nada a tu nombre. Puedes aportar pagando toda la cuenta.',
    };
  }

  return {
    color: '#FFFFFF',
    esVerde: false,
    mensaje: `Consumiste ${formato(subtotal)}`,
  };
}

/**
 * Calcula el monto a mostrar en la tarjeta "TU PARTE" (J-15).
 * Muestra el saldo personal del comensal con tope en el saldo pendiente de la mesa,
 * reflejando adecuadamente si otro comensal pagó con DIVIDIR o TODA LA MESA.
 *
 * @param {object} [opciones]
 * @param {number} [opciones.saldoMesa=0] - Saldo restante de la mesa
 * @param {number} [opciones.miSaldo=0] - Saldo personal del comensal
 * @returns {number}
 */
export function montoTuParte(opciones = {}) {
  const opts = opciones || {};
  const saldoM = Math.max(0, Number(opts.saldoMesa) || 0);
  const saldoP = Math.max(0, Number(opts.miSaldo) || 0);
  return Math.min(saldoM, saldoP);
}

/**
 * Determina la siguiente pantalla y acciones de limpieza tras eventos de pago (J-15).
 * Apaga el estado de espera, el overlay y el spinner al confirmar o cancelar un pago.
 *
 * @param {object} [opciones]
 * @param {'pago_confirmado'|'saldo_cero'|'salida_espera'|'widget_resultado'|'volver_cuenta'} [opciones.tipo]
 * @param {'propio'|'mesa'|'otro'} [opciones.tipoConfirmado]
 * @param {number} [opciones.saldoMesa]
 * @param {object|null} [opciones.resultadoWidget]
 * @param {string} [opciones.pantallaActual='cuenta']
 * @returns {{
 *   pantalla: 'cuenta' | 'espera' | 'confirmado' | 'caja',
 *   apagarEspera: boolean,
 *   limpiarAlmacenamiento: boolean,
 *   cerrarWidget: boolean,
 *   errorPago: string | null
 * }}
 */
export function transicionPantallaPago({
  tipo,
  tipoConfirmado,
  saldoMesa = 0,
  resultadoWidget = null,
  pantallaActual = 'cuenta',
} = {}) {
  switch (tipo) {
    case 'pago_confirmado': {
      if (tipoConfirmado === 'propio' || tipoConfirmado === 'mesa') {
        return {
          pantalla: 'confirmado',
          apagarEspera: true,
          limpiarAlmacenamiento: true,
          cerrarWidget: true,
          errorPago: null,
        };
      }
      return {
        pantalla: pantallaActual,
        apagarEspera: false,
        limpiarAlmacenamiento: false,
        cerrarWidget: false,
        errorPago: null,
      };
    }

    case 'saldo_cero': {
      return {
        pantalla: 'confirmado',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      };
    }

    case 'salida_espera': {
      const saldo = Math.max(0, Number(saldoMesa) || 0);
      return {
        pantalla: saldo === 0 ? 'confirmado' : 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      };
    }

    case 'widget_resultado': {
      const status = resultadoWidget?.transaction?.status;
      if (status === 'APPROVED') {
        return {
          pantalla: 'espera',
          apagarEspera: false,
          limpiarAlmacenamiento: false,
          cerrarWidget: false,
          errorPago: null,
        };
      }

      const esRechazado = status === 'DECLINED' || status === 'ERROR';
      return {
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: esRechazado
          ? 'El pago no fue aprobado. Puedes intentar nuevamente.'
          : null,
      };
    }

    case 'volver_cuenta': {
      return {
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      };
    }

    default:
      return {
        pantalla: pantallaActual,
        apagarEspera: false,
        limpiarAlmacenamiento: false,
        cerrarWidget: false,
        errorPago: null,
      };
  }
}

export default {
  formatoPesos,
  MODOS_PAGO,
  TITULOS_MODO,
  contarComensalesCuenta,
  normalizarCuenta,
  montosPorModo,
  aplicarPagoConfirmado,
  textoPagoConfirmado,
  traducirErrorPago,
  ESTADO_CUENTA_INICIAL,
  ESTADO_CUENTA_ENVIANDO,
  estadoCuentaSolicitada,
  textoCajaSegunEstado,
  avisoPedidoGrupal,
  TEXTO_SUGERENCIA_SIN_CELULAR,
  debeMostrarSugerenciaSinCelular,
  debeSalirDeEspera,
  mensajePagoConfirmado,
  textoDetalleConfirmacion,
  eventIdParaIntento,
  estadoSelectorPago,
  infoTuParte,
  montoTuParte,
  transicionPantallaPago,
  decidirSalidaEspera,
};
