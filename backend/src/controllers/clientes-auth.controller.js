/**
 * D-19 parte B: registro, login, refresh y logout de los clientes de la app.
 * Solo en /api/v1 (ver src/routes/solo-v1.js). Contrato: docs/api-spec.md,
 * "API v1 · Clientes (D-19)".
 *
 * DATOS PERSONALES: aquí no se registra nada del cuerpo (email, nombre,
 * teléfono, clave ni tokens), ni siquiera en un error. Los fallos van a next()
 * y el manejador global, en las rutas de clientes, solo anota el código y la
 * ruta.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const clientesService = require('../services/clientes.service');
const sesiones = require('../services/sesiones-cliente.service');
const { ALGORITMO_JWT, ROL_CLIENTE } = require('../middleware/auth.middleware');
const { COSTO_BCRYPT, HASH_FICTICIO } = require('./auth.controller');
const { vidaJwtCliente } = require('../config/clientes');
const { errorConMotivo } = require('../utils/error-con-motivo');
const {
  validarRegistro,
  validarLogin,
  validarCuerpoRefresh,
} = require('../utils/cliente-campos');

const MOTIVO_EMAIL_REGISTRADO = 'email_registrado';
const MOTIVO_CREDENCIALES = 'credenciales_invalidas';
const MENSAJE_EMAIL_REGISTRADO = 'Ese email ya tiene una cuenta';
/** El mismo mensaje para email que no existe, clave mala y cuenta inactiva (H-12). */
const MENSAJE_CREDENCIALES = 'Email o contraseña incorrectos';

/**
 * El JWT del cliente: `{ rol: 'cliente', sub: '<id_cliente>' }`, HS256 con
 * JWT_SECRET, vida corta. `expira_en` sale del propio `exp` del token, así
 * que nunca se separa de lo que el token dice.
 */
function firmarTokenCliente(idCliente, env = process.env) {
  const token = jwt.sign({ rol: ROL_CLIENTE }, env.JWT_SECRET, {
    algorithm: ALGORITMO_JWT,
    expiresIn: vidaJwtCliente(env),
    subject: String(idCliente),
  });
  const { exp } = jwt.decode(token);
  return { token, expira_en: new Date(exp * 1000).toISOString() };
}

const responder400 = (res, { motivo, mensaje }) => res.status(400).json({ error: mensaje, motivo });

/** POST /api/v1/auth/clientes/registro */
async function registro(req, res, next) {
  const v = validarRegistro(req.body);
  if (v.motivo) return responder400(res, v);
  const { nombre, email, password, telefono } = v.datos;

  try {
    const password_hash = await bcrypt.hash(password, COSTO_BCRYPT);

    // El cliente y su primera sesión, juntos: un registro a medias (cliente sin
    // refresh token) obligaría a la app a pedir un login que no esperaba.
    const client = await pool.connect();
    let cliente;
    let sesion;
    try {
      await client.query('BEGIN');
      cliente = await clientesService.insertar({ nombre, email, telefono, password_hash }, client);
      sesion = await sesiones.abrirSesion(client, cliente.id_cliente);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // La carrera de dos registros con el mismo email la decide el índice
      // único: el segundo recibe 409, no un 500.
      if (clientesService.esEmailRepetido(err)) {
        throw errorConMotivo(409, MOTIVO_EMAIL_REGISTRADO, MENSAJE_EMAIL_REGISTRADO);
      }
      throw err;
    } finally {
      client.release();
    }

    return res.status(201).json({
      cliente: clientesService.clientePublico(cliente),
      ...firmarTokenCliente(cliente.id_cliente),
      refresh_token: sesion.refreshToken,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/auth/clientes/login
 *
 * Sin enumeración (H-12, igual que el login del personal): se compara SIEMPRE
 * con bcrypt —contra el hash real o contra HASH_FICTICIO, del mismo costo— y
 * la decisión no depende de esa comparación cuando no hay cliente o está
 * inactivo. Mismo 401, mismo mensaje y mismo tiempo en los tres casos.
 */
async function login(req, res, next) {
  const v = validarLogin(req.body);
  if (v.motivo) return responder400(res, v);
  const { email, password } = v.datos;

  try {
    const cliente = await clientesService.buscarParaLogin(email);
    const hash = (cliente && cliente.password_hash) || HASH_FICTICIO;
    const claveOk = await bcrypt.compare(password, hash);

    if (!cliente || !cliente.activo || !claveOk) {
      return res.status(401).json({ error: MENSAJE_CREDENCIALES, motivo: MOTIVO_CREDENCIALES });
    }

    const sesion = await sesiones.abrirSesion(pool, cliente.id_cliente);
    return res.json({
      cliente: clientesService.clientePublico(cliente),
      ...firmarTokenCliente(cliente.id_cliente),
      refresh_token: sesion.refreshToken,
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/auth/clientes/refresh */
async function refresh(req, res, next) {
  const v = validarCuerpoRefresh(req.body);
  if (v.motivo) return responder400(res, v);

  try {
    const { idCliente, refreshToken } = await sesiones.refrescar(v.datos.refresh_token);
    return res.json({ ...firmarTokenCliente(idCliente), refresh_token: refreshToken });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/auth/clientes/logout: sin Authorization (el JWT puede haber
 * vencido). 204 siempre que el cuerpo sea válido, exista o no el token y esté
 * como esté: la respuesta no revela nada. Revoca SOLO ese token.
 */
async function logout(req, res, next) {
  const v = validarCuerpoRefresh(req.body);
  if (v.motivo) return responder400(res, v);

  try {
    await sesiones.cerrarSesion(v.datos.refresh_token);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  registro,
  login,
  refresh,
  logout,
  firmarTokenCliente,
  MOTIVO_EMAIL_REGISTRADO,
  MOTIVO_CREDENCIALES,
  MENSAJE_CREDENCIALES,
};
