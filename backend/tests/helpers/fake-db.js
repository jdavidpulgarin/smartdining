// Las pruebas corren sin PostgreSQL: este helper reemplaza pool.query y
// pool.connect por dobles en memoria y registra las queries ejecutadas, para
// poder afirmar con qué valores llegó cada INSERT.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../../src/config/db');
const { ROL_COMENSAL } = require('../../src/middleware/auth.middleware');

// Sesión de mesa vigente por mesa: sid -> token_qr, tal como estarían en la
// columna mesas.token_qr. requireAuth consulta esa columna en cada petición de
// comensal, así que el doble tiene que poder contestarla.
const sesionesDeMesa = new Map();

const SQL_TOKEN_DE_MESA = 'SELECT token_qr FROM mesas WHERE id_mesa';

/** Token con la misma forma que los del socket-server: v1.<datos>.<firma>. */
function construirTokenQr(id_mesa, sid = crypto.randomBytes(12).toString('base64url')) {
  const ahora = Date.now();
  const datos = { m: id_mesa, iat: ahora, exp: ahora + 3 * 60 * 60 * 1000, sid };
  const cuerpo = `v1.${Buffer.from(JSON.stringify(datos)).toString('base64url')}`;
  // La firma no se verifica en el backend (eso es de /qr/validar), así que para
  // las pruebas basta con que tenga la forma correcta.
  const firma = crypto.createHmac('sha256', 'firma-de-prueba').update(cuerpo).digest('base64url');
  return { token: `${cuerpo}.${firma}`, sid };
}

/**
 * @param {(sql: string, params: any[]) => {rows: any[]}|undefined} responder
 *        devuelve las filas de cada query; si devuelve undefined, { rows: [] }.
 * @param {{sesionCerrada?: boolean, tokenQrDeMesa?: string,
 *           pedidosAbiertos?: number, mesaYaLiberada?: boolean}} opciones
 *        Por omisión la sesión de mesa del comensal está vigente. Con
 *        sesionCerrada la columna token_qr responde NULL (mesa liberada), y con
 *        tokenQrDeMesa se fija otro token (para simular un QR distinto).
 */
function instalarFakeDb(responder, opciones = {}) {
  const queryOriginal = pool.query;
  const connectOriginal = pool.connect;
  const ejecutadas = [];

  const ejecutar = async (sql, params = []) => {
    ejecutadas.push({ sql, params });

    // La consulta del middleware se contesta aquí para que cada prueba no tenga
    // que saber que existe; se puede forzar con las opciones.
    if (sql.includes(SQL_TOKEN_DE_MESA)) {
      if (opciones.sesionCerrada) return { rows: [{ token_qr: null }] };
      if (opciones.tokenQrDeMesa) return { rows: [{ token_qr: opciones.tokenQrDeMesa }] };
      const registrado = sesionesDeMesa.get(params[0]);
      return { rows: [{ token_qr: registrado || null }] };
    }

    // Flujo de liberación automática de la mesa: por omisión la mesa no tiene
    // otros pedidos abiertos y la liberación surte efecto. Se puede cambiar con
    // las opciones para simular "queda otro pedido" o "ya estaba liberada".
    if (sql.includes('count(*)::int AS n FROM pedidos')) {
      return { rows: [{ n: opciones.pedidosAbiertos ?? 0 }] };
    }
    if (sql.includes('UPDATE mesas SET estado = $1, token_qr = NULL')) {
      // Se devuelve la fila como la daría RETURNING *, para que sirva tanto a la
      // liberación automática (que solo mira si afectó filas) como a
      // liberarSesion (que responde con el estado de la mesa).
      if (opciones.mesaYaLiberada) return { rows: [] };
      return { rows: [{ id_mesa: params[1], numero: params[1], estado: params[0], token_qr: null }] };
    }

    return responder(sql, params) || { rows: [] };
  };

  pool.query = ejecutar;
  pool.connect = async () => ({ query: ejecutar, release() {} });

  return {
    ejecutadas,
    /** Primera query ejecutada que contiene el fragmento de SQL dado. */
    buscar(fragmento) {
      return ejecutadas.find((q) => q.sql.includes(fragmento));
    },
    /** Todas las queries que contienen el fragmento. */
    todas(fragmento) {
      return ejecutadas.filter((q) => q.sql.includes(fragmento));
    },
    restaurar() {
      pool.query = queryOriginal;
      pool.connect = connectOriginal;
    },
  };
}

/**
 * JWT de comensal { id_mesa, sid, rol }. Registra el token_qr correspondiente
 * como el vigente de la mesa, de modo que el middleware lo acepte.
 */
function tokenComensal(id_mesa) {
  const { token, sid } = construirTokenQr(id_mesa);
  sesionesDeMesa.set(id_mesa, token);
  return jwt.sign({ id_mesa, sid, rol: ROL_COMENSAL }, process.env.JWT_SECRET, { expiresIn: '3h' });
}

/** JWT de comensal con un sid que NO es el vigente de la mesa (grupo anterior). */
function tokenComensalDeOtraSesion(id_mesa) {
  const { sid } = construirTokenQr(id_mesa, 'sid-de-la-sesion-anterior');
  // A propósito NO se registra: la mesa sigue con el token de la sesión actual.
  return jwt.sign({ id_mesa, sid, rol: ROL_COMENSAL }, process.env.JWT_SECRET, { expiresIn: '3h' });
}

function tokenStaff(id_usuario, rol) {
  return jwt.sign({ id_usuario, rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/** token_qr que el doble de base de datos devuelve como vigente para esa mesa. */
function tokenQrVigente(id_mesa) {
  return sesionesDeMesa.get(id_mesa) || null;
}

module.exports = {
  instalarFakeDb,
  tokenComensal,
  tokenComensalDeOtraSesion,
  tokenStaff,
  construirTokenQr,
  tokenQrVigente,
  SQL_TOKEN_DE_MESA,
};
