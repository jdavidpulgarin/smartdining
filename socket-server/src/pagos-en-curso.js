const { ErrorHttp, enviarJson, exigirClaveInterna } = require('./http');
const { normalizarAlias } = require('./alias');

/**
 * GET /internal/pagos-en-curso?mesa=<id_mesa>[&comensal=<alias>] (T4, EVENTS.md §6.6)
 *
 * Para que el backend NO cancele un plato mientras alguien lo está pagando en
 * línea (Wompi): antes de quitar una línea pregunta si hay una intención de
 * pago vigente que la cubra. Solo lectura.
 *
 * Vigente = la marca sd:pago:pendiente:{mesa}:{comensal} existe, su intención
 * está en estado 'pendiente' y su expira_en todavía no pasó.
 *
 * - Con `comensal`: enCurso si ESE comensal (por la clave del alias, la misma
 *   regla que alias.js y claveAlias) tiene una vigente, o si CUALQUIERA de la
 *   mesa tiene una que no es 'propio': 'total' cubre todas las líneas. 'igual'
 *   (Dividir, que T2 retira) reparte el total, así que también cuenta.
 *   `pagos` trae solo esas, las que deciden.
 * - Sin `comensal`: enCurso si hay cualquier vigente en la mesa; `pagos`, todas.
 *
 * Nunca viajan la referencia de Wompi, tokens ni datos de tarjeta: solo
 * quién, el modo, el monto (pesos) y hasta cuándo vale.
 */

const MAX_INT_PG = 2147483647;
const PARAMETROS = ['mesa', 'comensal'];
const ENTERO_POSITIVO = /^[1-9][0-9]{0,9}$/;

const invalido = (mensaje) => new ErrorHttp(400, 'PAYLOAD_INVALIDO', mensaje);

/** Lee y valida el query; lanza 400 si no cumple. */
function leerConsulta(req) {
  const consulta = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
  const nombres = [...consulta.keys()];
  const deMas = nombres.filter((n) => !PARAMETROS.includes(n));
  if (deMas.length > 0) throw invalido(`Parámetros no permitidos: ${[...new Set(deMas)].slice(0, 5).join(', ')}`);
  for (const n of PARAMETROS) {
    if (consulta.getAll(n).length > 1) throw invalido(`${n} va una sola vez`);
  }

  const mesaTexto = consulta.get('mesa');
  if (mesaTexto === null || !ENTERO_POSITIVO.test(mesaTexto) || Number(mesaTexto) > MAX_INT_PG) {
    throw invalido(`mesa debe ser un entero entre 1 y ${MAX_INT_PG}`);
  }
  const mesa = Number(mesaTexto);

  if (!consulta.has('comensal')) return { mesa, clave: null };
  const alias = normalizarAlias(consulta.get('comensal'));
  if (alias.error) throw invalido(`comensal: ${alias.error}`);
  return { mesa, clave: alias.clave };
}

const claveDe = (comensal) => {
  const a = normalizarAlias(comensal);
  return a.error ? null : a.clave;
};

/** Intenciones vigentes de la mesa, ya en la forma de la respuesta. */
async function vigentesDeLaMesa(ctx, mesa, ahora = Date.now()) {
  const marcas = await ctx.almacenPagos.listarPendientesMesa(mesa);
  const pagos = [];
  for (const { referencia } of marcas) {
    const intencion = await ctx.almacenPagos.obtener(referencia);
    if (!intencion || intencion.estado !== 'pendiente' || intencion.id_mesa !== mesa) continue;
    if (!(Date.parse(intencion.expira_en) > ahora)) continue;
    pagos.push({
      comensal: intencion.comensal,
      modo: intencion.modo,
      monto: intencion.monto_centavos / 100,
      venceEn: intencion.expira_en,
    });
  }
  return pagos.sort((a, b) => a.comensal.localeCompare(b.comensal));
}

async function rutaPagosEnCurso(req, res, ctx) {
  exigirClaveInterna(req, ctx.config);
  const { mesa, clave } = leerConsulta(req);
  const todos = await vigentesDeLaMesa(ctx, mesa);

  const pagos = clave === null
    ? todos
    : todos.filter((p) => p.modo !== 'propio' || claveDe(p.comensal) === clave);
  return enviarJson(res, 200, { mesa, enCurso: pagos.length > 0, pagos });
}

const rutasPagosEnCurso = { 'GET /internal/pagos-en-curso': rutaPagosEnCurso };

module.exports = { rutasPagosEnCurso };
