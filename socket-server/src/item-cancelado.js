const { log } = require('./log');
const { esEventIdValido } = require('./idempotencia');
const { salaMesa, SALA_KDS, SALA_ADMIN } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

// Límites del esquema (database/schema.sql): ids INTEGER, platos.nombre
// VARCHAR(120), detalles_pedido.comensal VARCHAR(40), pedidos.total
// DECIMAL(10,2). codigo_pedido hasta 40, como en order:status.
const MAX_INT_PG = 2147483647;
const MAX_NOMBRE = 120;
const MAX_COMENSAL = 40;
const MAX_CODIGO = 40;
const MAX_TOTAL = 99999999.99;

// Estado del pedido DESPUÉS de quitar la línea: los estados en que el backend
// deja cancelar un plato, más 'cancelado' si era la última línea viva. El
// comensal solo puede con el pedido 'recibido' (#180); el personal (D-13),
// también con el pedido ya en cocina ('en_preparacion' o 'listo'). Nunca
// 'entregado' ni 'pagado': el backend no deja cancelar ahí.
const ESTADOS_TRAS_QUITAR = ['recibido', 'en_preparacion', 'listo', 'cancelado'];

// Quién quitó el plato: el comensal desde su sesión de QR (#180) o el personal
// desde el panel (D-13). Opcional: sin él es 'comensal', el único origen que
// había antes de este campo.
const ORIGENES = ['comensal', 'personal'];
const ORIGEN_POR_DEFECTO = 'comensal';

const CAMPOS = [
  'id_pedido', 'id_mesa', 'codigo_pedido', 'id_detalle', 'id_plato',
  'nombre', 'comensal', 'total', 'estado_pedido', 'origen', 'eventId',
];

const esId = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_INT_PG;
// Caracteres (puntos de código), como VARCHAR en PostgreSQL.
const esTextoDe1a = (v, max) => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max;
const esTextoONulo = (v, max) => v === null || esTextoDe1a(v, max);
// Solo números JSON: "18000.00" (lo que da pg con DECIMAL) se rechaza para
// que el error salga en el backend y no en la Caja.
const esTotal = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_TOTAL;

/** Valida el cuerpo (EVENTS.md §5.6); lanza 400 si no cumple. */
function validar(c) {
  const invalido = (mensaje) => new ErrorHttp(400, 'PAYLOAD_INVALIDO', mensaje);
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw invalido('El cuerpo debe ser un objeto JSON');
  const deMas = Object.keys(c).filter((k) => !CAMPOS.includes(k));
  if (deMas.length > 0) throw invalido(`Campos no permitidos: ${deMas.slice(0, 5).join(', ')}`);
  for (const campo of ['id_pedido', 'id_mesa', 'id_detalle', 'id_plato']) {
    if (!esId(c[campo])) throw invalido(`${campo} debe ser un entero entre 1 y ${MAX_INT_PG}`);
  }
  if (!esTextoONulo(c.codigo_pedido, MAX_CODIGO)) throw invalido(`codigo_pedido debe ser null o un texto de 1 a ${MAX_CODIGO} caracteres`);
  if (!esTextoDe1a(c.nombre, MAX_NOMBRE)) throw invalido(`nombre debe tener de 1 a ${MAX_NOMBRE} caracteres`);
  if (!esTextoONulo(c.comensal, MAX_COMENSAL)) throw invalido(`comensal debe ser null o un texto de 1 a ${MAX_COMENSAL} caracteres`);
  if (!esTotal(c.total)) throw invalido(`total debe ser un número entre 0 y ${MAX_TOTAL}`);
  if (!ESTADOS_TRAS_QUITAR.includes(c.estado_pedido)) throw invalido(`estado_pedido debe ser uno de: ${ESTADOS_TRAS_QUITAR.join(', ')}`);
  // Opcional quiere decir que puede NO venir; si viene, tiene que ser válido
  // (un null o un texto cualquiera es un error del backend, no 'comensal').
  if (c.origen !== undefined && !ORIGENES.includes(c.origen)) throw invalido(`origen debe ser uno de: ${ORIGENES.join(', ')} (o no venir)`);
  if (!esEventIdValido(c.eventId)) throw invalido('eventId debe ser un UUID');
}

/**
 * POST /internal/item-cancelado (EVENTS.md §5.6) — se canceló UNA línea de un
 * pedido: la quitó el comensal (J-14, #180) o el personal (D-13). Lo llama el
 * backend después del COMMIT; `origen` dice quién fue.
 *
 * Emite item:cancelado a room:kds (la cocina tacha la línea), room:admin (la
 * Caja ve el total nuevo) y room:mesa-N (los demás comensales). Si era la
 * última línea, el backend manda además el order:status 'cancelado' de
 * siempre: aquí no se deriva nada de estado_pedido.
 *
 * Idempotencia como inventario-alerta: todo se valida ANTES de reservar (un
 * 4xx no consume el eventId). Si la emisión falla, se libera la reserva y
 * responde 500 ERROR_INTERNO, que el backend reintenta con el mismo eventId.
 */
async function rutaItemCancelado(req, res, ctx) {
  exigirClaveInterna(req, ctx.config);
  const c = parsearJson(await leerCuerpoCrudo(req));
  validar(c);

  const clave = `backend:item-cancelado:${c.eventId}`;
  if (!(await ctx.registro.reservar(clave))) return enviarJson(res, 200, { ok: true, duplicado: true });
  try {
    // Encadenar .to(): un admin (en KDS y en Admin) lo recibe una sola vez.
    ctx.io.to(SALA_KDS).to(SALA_ADMIN).to(salaMesa(c.id_mesa)).emit('item:cancelado', {
      eventId: c.eventId,
      id_pedido: c.id_pedido,
      id_mesa: c.id_mesa,
      codigo_pedido: c.codigo_pedido,
      id_detalle: c.id_detalle,
      nombre: c.nombre,
      comensal: c.comensal,
      total: c.total,
      estado_pedido: c.estado_pedido,
      origen: c.origen ?? ORIGEN_POR_DEFECTO,
      emitidoEn: new Date().toISOString(),
    });
  } catch (err) {
    try {
      await ctx.registro.liberar(clave);
    } catch (errLiberar) {
      // Sin liberar, el reintento llegará como duplicado: que quede en el log.
      log.error('item-cancelado: no se pudo liberar el eventId tras fallar la emisión', { error: errLiberar });
    }
    throw err;
  }
  return enviarJson(res, 200, { ok: true, duplicado: false });
}

const rutasItemCancelado = { 'POST /internal/item-cancelado': rutaItemCancelado };

module.exports = { rutasItemCancelado };
