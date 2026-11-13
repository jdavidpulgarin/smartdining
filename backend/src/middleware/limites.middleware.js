const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { enPruebas } = require('../config/entorno');
const { hashDeRefresh } = require('../utils/refresh-token');

/**
 * Límites de peticiones: uno por ruta para las dos públicas que se pueden
 * martillear —el login del personal (H-04) y la apertura de sesión por QR
 * (H-27)— y uno GLOBAL por IP para todo lo demás (D-21).
 *
 * Los de ruta son la defensa de verdad (5 y 20 por minuto); el global es un
 * techo de respaldo para que ninguna IP pueda inundar el resto de la API, que
 * hoy no tiene ningún tope.
 *
 * Las dos tienen el mismo problema de fondo: no piden sesión previa, así que
 * cualquiera puede probar combinaciones hasta acertar. En la auditoría se
 * midieron 40 intentos de login en 2,75 s sin un solo 429, y bcrypt aguanta
 * unos 30 logins por segundo, así que además de abrir la puerta a la fuerza
 * bruta es una forma barata de tumbar el servidor.
 *
 * LIMITACIÓN CONOCIDA: el contador vive en memoria del proceso. Con varias
 * instancias del backend (Docker con réplicas, PM2 en cluster) el límite es
 * por instancia, no global: con N instancias el techo real es 5×N. Para que
 * fuera global haría falta un store compartido en Redis; se deja anotado en
 * vez de añadir otra dependencia que no hace falta hoy.
 */

/** Minutos a milisegundos, para que los valores por defecto se lean solos. */
const UN_MINUTO_MS = 60 * 1000;

/** Lee un entero de una variable de entorno, con respaldo si no es válido. */
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const MENSAJE_LOGIN =
  'Demasiados intentos de inicio de sesión. Espera un momento y vuelve a intentarlo.';
const MENSAJE_QR =
  'Demasiados intentos de abrir la sesión de la mesa. Espera un momento y vuelve a intentarlo.';
const MENSAJE_GLOBAL =
  'Demasiadas peticiones desde esta red. Espera un momento y vuelve a intentarlo.';

/** Motivo de todos los 429 (D-19): se AGREGA al `error` de siempre. */
const MOTIVO_429 = 'demasiadas_peticiones';

/**
 * Respuesta del 429. express-rate-limit ya pone Retry-After; aquí solo se da
 * el cuerpo, `{ error, motivo }` como el resto de errores con motivo.
 */
function responder429(mensaje) {
  return (req, res) => res.status(429).json({ error: mensaje, motivo: MOTIVO_429 });
}

/**
 * Limitador del login: cuenta por IP **y** email.
 *
 * Por IP sola, un atacante con una botnet esquiva el límite; por email solo,
 * cualquiera puede bloquear la cuenta de otro a propósito. La combinación
 * limita "esta IP probando esta cuenta", que es justo el ataque.
 *
 * Solo cuenta los intentos FALLIDOS (skipSuccessfulRequests): un cajero que
 * entra y sale varias veces en un minuto no debe bloquearse a sí mismo.
 *
 * ipKeyGenerator normaliza la IP (en IPv6 agrupa por subred /64, para que un
 * atacante con un rango entero no cuente como miles de clientes distintos).
 */
function crearLimitadorLogin(env = process.env) {
  return rateLimit({
    windowMs: entero(env.RATE_LIMIT_LOGIN_VENTANA_MS, UN_MINUTO_MS),
    limit: entero(env.RATE_LIMIT_LOGIN_MAX, 5),
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => enPruebas(env),
    keyGenerator: (req) => {
      // El email se normaliza igual que al buscar el usuario, para que
      // "Ana@x.com" y "ana@x.com " compartan contador.
      const email = String(req.body?.email || '').trim().toLowerCase();
      return `${ipKeyGenerator(req.ip)}:${email}`;
    },
    handler: responder429(MENSAJE_LOGIN),
  });
}

/**
 * Limitador de la apertura de sesión por QR.
 *
 * Más holgado que el login a propósito: los comensales de una mesa comparten
 * el wifi del local, así que varias personas escaneando a la vez salen con la
 * misma IP pública. 20 por minuto deja trabajar a una mesa entera y sigue
 * cortando a quien prueba tokens en serie.
 *
 * Aquí se cuentan TODOS los intentos, no solo los fallidos: un token válido
 * que se reusa muchas veces por segundo también es tráfico que no debería
 * pasar.
 */
function crearLimitadorQr(env = process.env) {
  return rateLimit({
    windowMs: entero(env.RATE_LIMIT_QR_VENTANA_MS, UN_MINUTO_MS),
    limit: entero(env.RATE_LIMIT_QR_MAX, 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => enPruebas(env),
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: responder429(MENSAJE_QR),
  });
}

/**
 * Segmentos de ruta que el límite global NO cuenta (D-21).
 *
 * - `health`: es la sonda de Docker y del balanceador. Con `interval: 10s` en
 *   docker-compose son 6 por minuto que, si contaran, se gastarían del cupo del
 *   local; y si una IP agotara el cupo, el contenedor se declararía enfermo y se
 *   reiniciaría solo. Un límite que tira el servicio es peor que no tenerlo.
 * - `internal` e `interno`: el canal servidor-a-servidor con el socket-server
 *   (`POST /api/transacciones/internal`, `GET /api/mesas/:id/cuenta/interno`).
 *   Van por `x-internal-key`, no por IP, y toda esa máquina sale con UNA sola
 *   IP: un pico de pagos confirmados contaría como una sola fuente y se
 *   cortaría a sí misma. Esas rutas ya tienen su propia autenticación.
 *
 * Las DOS grafías a propósito: hoy el backend tiene una ruta en inglés
 * (`/internal`) y otra en español (`/interno`), y mirar solo una dejaría la otra
 * dentro del límite por un detalle de ortografía.
 *
 * El precio de exentarlas por ruta es que el límite global tampoco frena a quien
 * las martillee sin la clave; se acepta porque `requireInternalKey` responde sin
 * tocar la base y porque el alternativo —exentar a quien MANDE la cabecera—
 * sería un portillo: cualquiera la pondría con un valor falso para saltarse el
 * límite de toda la API.
 */
const SEGMENTOS_EXENTOS = new Set(['health', 'internal', 'interno']);

/** ¿Esta ruta queda fuera del límite global? */
function rutaExenta(ruta) {
  return String(ruta || '')
    .toLowerCase()
    .split('/')
    .some((segmento) => SEGMENTOS_EXENTOS.has(segmento));
}

/**
 * Límite GLOBAL por IP (D-21): un techo para toda la API.
 *
 * Cuenta por IP y nada más, con `ipKeyGenerator` como los otros dos (en IPv6
 * agrupa por subred /64, para que un atacante con un rango entero no cuente como
 * miles de clientes distintos). Para que esa IP sea la del cliente real y no la
 * del proxy hace falta `TRUST_PROXY` (ver server.js): sin él, detrás de nginx o
 * de Docker todas las peticiones comparten la IP del proxy y el límite global
 * sería un único cupo para TODO el mundo a la vez.
 *
 * POR QUÉ 2000 POR MINUTO, que parece muchísimo: **los comensales de un local
 * comparten una sola IP pública**, la del wifi, así que el cupo no es de una
 * persona sino del restaurante entero. Con 20 mesas de 4 son 80 teléfonos, y en
 * el pico (todos abriendo la carta y armando su plato al mismo tiempo) cada uno
 * hace del orden de 15 a 20 peticiones en ese minuto: 80 × 20 = 1600. Más las
 * tablets del personal y el panel. 2000 deja ese pico pasar con holgura y aun
 * así corta a una sola máquina que intente raspar o inundar la API: 33 por
 * segundo sostenidos no los hace ningún comensal. Y lo que de verdad protege las
 * rutas peligrosas no es este número, sino los límites de login (5) y QR (20),
 * que siguen contando aparte.
 *
 * Un local más grande, o varios locales detrás de la misma IP, sube
 * `RATE_LIMIT_GLOBAL_MAX`. Queda anotado en el README.
 *
 * Misma LIMITACIÓN que los otros: el contador vive en memoria del proceso, así
 * que con N instancias el techo real es 2000×N.
 */
function crearLimitadorGlobal(env = process.env) {
  return rateLimit({
    windowMs: entero(env.RATE_LIMIT_GLOBAL_VENTANA_MS, UN_MINUTO_MS),
    limit: entero(env.RATE_LIMIT_GLOBAL_MAX, 2000),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Mismo criterio que los otros dos: dentro de las pruebas no se cuenta
    // nada, o cualquier suite que haga unas cuantas llamadas empezaría a
    // chocar con el techo según creciera.
    skip: (req) => enPruebas(env) || rutaExenta(req.path),
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: responder429(MENSAJE_GLOBAL),
  });
}

/* -------------------------------------------------------------------------- *
 * D-19 parte B: límites de las rutas de autenticación de CLIENTES.
 *
 * Cada ruta lleva DOS contadores independientes (docs/api-spec.md, "Límites de
 * las rutas de clientes"): el principal cuenta por la CUENTA (email
 * normalizado, o el hash del refresh token) y el de IP es un freno de abuso
 * alto, porque muchos clientes legítimos comparten IP (el wifi del local, el
 * NAT del operador móvil). Superar cualquiera da 429 `demasiadas_peticiones`
 * con Retry-After.
 *
 *   registro: email 5 / h      + IP 100 / h      (todos los intentos)
 *   login:    email 10 / 15 min + IP 200 / 15 min (solo los FALLIDOS)
 *   refresh y logout (el MISMO contador): hash del token 10 / min + IP 600 / min
 *
 * Si el cuerpo no trae el campo de la cuenta como texto, solo cuenta el de IP
 * (y la validación responde 400). El contador nunca guarda el token: guarda su
 * SHA-256, el mismo que la base. Mismo almacén en memoria que los de arriba
 * (con la misma limitación de varias instancias) y desactivados en pruebas.
 * -------------------------------------------------------------------------- */

const MENSAJE_CLIENTES =
  'Demasiados intentos. Espera un momento y vuelve a intentarlo.';

const UNA_HORA_MS = 60 * UN_MINUTO_MS;

/** Email del cuerpo normalizado como en la base (trim + minúsculas), o null. */
function emailDelCuerpo(req) {
  const email = req.body && req.body.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

/** SHA-256 del refresh_token del cuerpo, o null si no hay un texto. */
function hashDelRefreshDelCuerpo(req) {
  const token = req.body && req.body.refresh_token;
  return typeof token === 'string' ? hashDeRefresh(token) : null;
}

/**
 * Un par de limitadores [IP, cuenta] para una ruta de clientes.
 * `claveDeCuenta(req)` devuelve la clave de la cuenta o null (entonces el de
 * cuenta no cuenta esa petición).
 */
function parDeLimitadores(env, { prefijo, ventanaPorDefecto, ipPorDefecto, cuentaPorDefecto, variables, claveDeCuenta, soloFallidos }) {
  const ventana = entero(env[variables.ventana], ventanaPorDefecto);
  const comunes = {
    windowMs: ventana,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: Boolean(soloFallidos),
    handler: responder429(MENSAJE_CLIENTES),
  };
  const porIp = rateLimit({
    ...comunes,
    limit: entero(env[variables.ip], ipPorDefecto),
    skip: () => enPruebas(env),
    keyGenerator: (req) => `${prefijo}:ip:${ipKeyGenerator(req.ip)}`,
  });
  const porCuenta = rateLimit({
    ...comunes,
    limit: entero(env[variables.cuenta], cuentaPorDefecto),
    skip: (req) => enPruebas(env) || !claveDeCuenta(req),
    keyGenerator: (req) => `${prefijo}:cuenta:${claveDeCuenta(req)}`,
  });
  return [porIp, porCuenta];
}

/**
 * Los limitadores de las rutas de clientes, creados UNA vez (al cargar las
 * rutas). `logout` es el mismo par que `refresh`: comparten contador.
 */
function crearLimitadoresClientes(env = process.env) {
  const refresh = parDeLimitadores(env, {
    prefijo: 'clientes-refresh',
    ventanaPorDefecto: UN_MINUTO_MS,
    ipPorDefecto: 600,
    cuentaPorDefecto: 10,
    variables: {
      ventana: 'RATE_LIMIT_CLIENTES_REFRESH_VENTANA_MS',
      ip: 'RATE_LIMIT_CLIENTES_REFRESH_IP_MAX',
      cuenta: 'RATE_LIMIT_CLIENTES_REFRESH_TOKEN_MAX',
    },
    claveDeCuenta: hashDelRefreshDelCuerpo,
  });
  return {
    registro: parDeLimitadores(env, {
      prefijo: 'clientes-registro',
      ventanaPorDefecto: UNA_HORA_MS,
      ipPorDefecto: 100,
      cuentaPorDefecto: 5,
      variables: {
        ventana: 'RATE_LIMIT_CLIENTES_REGISTRO_VENTANA_MS',
        ip: 'RATE_LIMIT_CLIENTES_REGISTRO_IP_MAX',
        cuenta: 'RATE_LIMIT_CLIENTES_REGISTRO_EMAIL_MAX',
      },
      claveDeCuenta: emailDelCuerpo,
    }),
    login: parDeLimitadores(env, {
      prefijo: 'clientes-login',
      ventanaPorDefecto: 15 * UN_MINUTO_MS,
      ipPorDefecto: 200,
      cuentaPorDefecto: 10,
      variables: {
        ventana: 'RATE_LIMIT_CLIENTES_LOGIN_VENTANA_MS',
        ip: 'RATE_LIMIT_CLIENTES_LOGIN_IP_MAX',
        cuenta: 'RATE_LIMIT_CLIENTES_LOGIN_EMAIL_MAX',
      },
      claveDeCuenta: emailDelCuerpo,
      soloFallidos: true,
    }),
    refresh,
    logout: refresh,
  };
}

module.exports = {
  crearLimitadorLogin,
  crearLimitadorQr,
  crearLimitadorGlobal,
  crearLimitadoresClientes,
  MOTIVO_429,
  MENSAJE_CLIENTES,
  enPruebas,
  entero,
  rutaExenta,
  SEGMENTOS_EXENTOS,
  MENSAJE_LOGIN,
  MENSAJE_QR,
  MENSAJE_GLOBAL,
};
