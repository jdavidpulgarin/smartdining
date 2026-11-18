const { log } = require('./log');
const { ROL_COMENSAL } = require('./auth');
const { normalizarAlias } = require('./alias');
const { esEventIdValido } = require('./idempotencia');
const { salaMesa } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

// Protección contra errores o abuso, no la capacidad de la mesa (§6.4).
const MAX_SIN_CELULAR = 20;
const ACCIONES = ['agregar', 'quitar'];

/** Valida el cuerpo (§6.4); lanza 400. Devuelve los campos ya normalizados. */
function validar(c) {
  const invalido = (mensaje) => new ErrorHttp(400, 'PAYLOAD_INVALIDO', mensaje);
  if (!Number.isSafeInteger(c.id_mesa) || c.id_mesa <= 0) throw invalido('id_mesa debe ser un entero positivo');
  const alias = normalizarAlias(c.alias);
  if (alias.error) throw invalido(alias.error);
  if (!ACCIONES.includes(c.accion)) throw invalido('accion debe ser "agregar" o "quitar"');
  if (!esEventIdValido(c.eventId)) throw invalido('eventId debe ser un UUID');
  return {
    idMesa: c.id_mesa, alias: alias.alias, clave: alias.clave, accion: c.accion, eventId: c.eventId,
  };
}

/** ¿Algún comensal CONECTADO a la mesa tiene un alias con esta clave? */
async function claveConectada(ctx, idMesa, clave) {
  const sockets = await ctx.io.in(salaMesa(idMesa)).fetchSockets();
  return sockets.some((s) => s.data.identidad && s.data.identidad.rol === ROL_COMENSAL
    && s.data.alias && normalizarAlias(s.data.alias).clave === clave);
}

const sinCambio = (res) => enviarJson(res, 200, { ok: true, duplicado: false });

/**
 * POST /internal/mesa-comensal (EVENTS.md §6.4) — el personal agrega o quita a
 * alguien SIN CELULAR (D-18). Lo llama el backend después del COMMIT.
 *
 * Orden: clave interna, JSON, validación, mesa liberada, "ya procesado" y
 * guardias (409). Todo eso pasa ANTES de reservar el eventId, así un 4xx no lo
 * consume. Después se reserva, se aplica y, si falla, se libera la reserva y
 * responde 500 ERROR_INTERNO para que el backend reintente.
 *
 * Las guardias no reemplazan al backend: la reserva del alias (misma función
 * de clave) es la fuente de verdad. Aquí solo se evita una presencia rota.
 */
async function rutaMesaComensal(req, res, ctx) {
  exigirClaveInterna(req, ctx.config);
  const p = validar(parsearJson(await leerCuerpoCrudo(req)));

  if (ctx.mesaLiberada(p.idMesa)) {
    throw new ErrorHttp(409, 'MESA_LIBERADA', 'La mesa está liberada y no tiene un QR nuevo');
  }
  const claveEvento = `backend:mesa-comensal:${p.eventId}`;
  if ((await ctx.registro.obtener(claveEvento)) !== undefined) {
    return enviarJson(res, 200, { ok: true, duplicado: true });
  }

  const lista = await ctx.estadoMesas.sinCelular(p.idMesa); // clave -> alias guardado
  const guardado = lista[p.clave];

  if (p.accion === 'agregar') {
    if (guardado === p.alias) return sinCambio(res);
    if (guardado !== undefined || (await claveConectada(ctx, p.idMesa, p.clave))) {
      throw new ErrorHttp(409, 'ALIAS_EN_USO', 'Ese nombre ya lo usa otra persona en la mesa');
    }
    if (Object.keys(lista).length >= MAX_SIN_CELULAR) {
      throw new ErrorHttp(409, 'LIMITE_COMENSALES', `La mesa ya tiene ${MAX_SIN_CELULAR} comensales sin celular`);
    }
  } else if (guardado === undefined) {
    return sinCambio(res); // quitar a quien no está: nada que hacer
  }

  if (!(await ctx.registro.reservar(claveEvento))) return enviarJson(res, 200, { ok: true, duplicado: true });
  let aplicado;
  try {
    aplicado = p.accion === 'agregar'
      ? await ctx.estadoMesas.agregarSinCelular(p.idMesa, p.clave, p.alias)
      : await ctx.estadoMesas.quitarSinCelular(p.idMesa, p.clave);
  } catch (err) {
    await liberarSinPerder(ctx, claveEvento);
    throw err;
  }
  if (!aplicado) {
    // Otra petición ganó entre la lectura y la escritura (HSETNX / HDEL).
    await liberarSinPerder(ctx, claveEvento);
    if (p.accion === 'agregar') throw new ErrorHttp(409, 'ALIAS_EN_USO', 'Ese nombre ya lo usa otra persona en la mesa');
    return sinCambio(res);
  }
  ctx.presencia.programar(p.idMesa);
  return enviarJson(res, 200, { ok: true, duplicado: false });
}

async function liberarSinPerder(ctx, claveEvento) {
  try {
    await ctx.registro.liberar(claveEvento);
  } catch (err) {
    // Sin liberar, el reintento llegará como duplicado: que quede en el log.
    log.error('mesa-comensal: no se pudo liberar el eventId', { error: err });
  }
}

const rutasMesaComensal = { 'POST /internal/mesa-comensal': rutaMesaComensal };

module.exports = { rutasMesaComensal, MAX_SIN_CELULAR };
