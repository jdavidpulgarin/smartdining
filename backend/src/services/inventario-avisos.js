const { Client } = require('pg');
const socketNotifier = require('./socket.notifier');
const menuService = require('./menu.service');

/**
 * Avisos de inventario en vivo (D-17, P-19).
 *
 * `database/scripts/27_inventario.sql` publica en el canal `inventario` de
 * PostgreSQL dos clases de aviso, y solo cuando la transacción se confirma:
 *
 *   `{"tipo":"disponibilidad","entidad":"plato"|"ingrediente","id","disponible","motivo"}`
 *   cuando cambia lo CALCULADO (`stock_suficiente`) de un plato o de una opción;
 *
 *   `{"tipo":"stock_bajo","id_insumo","nombre","unidad","stock_actual","stock_minimo"}`
 *   cuando un insumo cruza su mínimo hacia abajo.
 *
 * Este módulo los escucha y los reenvía al socket-server: la disponibilidad por
 * las rutas que ya existen (`/internal/plato-disponibilidad` e
 * `/internal/ingrediente-disponibilidad`) y el stock bajo por
 * `/internal/inventario-alerta` (EVENTS.md §5.5).
 *
 * CONEXIÓN DEDICADA, no una del pool. `LISTEN` vive en la CONEXIÓN: una del pool
 * se devuelve en cuanto acaba la consulta y la siguiente petición la usaría —con
 * su `LISTEN` puesto— para cualquier otra cosa, o pg la cerraría por
 * `idleTimeoutMillis` y el canal quedaría muerto sin que nadie se enterara.
 * Tampoco se le pone `statement_timeout`: el recálculo del arranque recorre
 * TODA la carta y cortarlo a los 10 s lo dejaría a medias.
 *
 * NADA DE AQUÍ PUEDE TUMBAR EL BACKEND. El tiempo real es un extra: si
 * PostgreSQL no acepta la conexión del oyente, si el payload viene ilegible o si
 * el socket-server no responde, se registra y se sigue. El backend arranca y
 * sirve peticiones igual sin Redis y sin socket-server.
 */

const CANAL = 'inventario';

/** Clases de aviso que publica el script 27. */
const TIPO_DISPONIBILIDAD = 'disponibilidad';
const TIPO_STOCK_BAJO = 'stock_bajo';

/**
 * Espera entre intentos de reconexión: 1 s, 2 s, 4 s… hasta 30 s.
 *
 * Creciente porque los dos motivos típicos duran distinto: un reinicio de
 * PostgreSQL vuelve en segundos, pero una base caída de verdad puede tardar, y
 * un bucle de reintentos cada segundo solo llena el log y la tabla de
 * conexiones. El tope evita que la espera crezca sin fin y el canal tarde
 * minutos en volver cuando la base ya está.
 */
const ESPERA_INICIAL_MS = 1000;
const ESPERA_MAXIMA_MS = 30000;

/**
 * Cuántos avisos seguidos pueden fallar durante la emisión de la carta antes de
 * dejarlo.
 *
 * Al arrancar se emite la disponibilidad de TODA la carta (decenas de platos y
 * opciones). Si el socket-server no está levantado, cada envío gasta su timeout
 * y los demás van a fallar igual: insistir con los 60 restantes son minutos de
 * trabajo inútil y 60 líneas idénticas en el log. Con el socket-server vivo,
 * esto no se alcanza nunca.
 */
const MAX_FALLOS_SEGUIDOS = 5;

/**
 * Estado del oyente. Es un módulo con estado a propósito: hay UN canal por
 * proceso, igual que hay un pool.
 */
let cliente = null;
let temporizador = null;
let activo = false;
let espera = ESPERA_INICIAL_MS;
/** Promesa del último arranque o re-arranque. Solo la usan las pruebas. */
let ultimoCiclo = Promise.resolve();

/** La configuración de PostgreSQL, la misma que usa el pool (src/config/db.js). */
function configuracion() {
  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
}

/**
 * Un NUMERIC de PostgreSQL como número, o null.
 *
 * Los números del `pg_notify` ya vienen como números JSON, pero los de una
 * CONSULTA llegan como texto (`'450.00'`), y el socket-server rechaza con
 * `400 PAYLOAD_INVALIDO` un `stock_actual` que no sea número JSON (§5.5). Se
 * convierte aquí, en un solo sitio, en vez de confiar en qué camino trajo el
 * dato.
 */
function aNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

/**
 * Invalida la cache del menu sin que un fallo pueda cortar el oyente.
 *
 * `invalidarMenu` no lanza (con Redis caido devuelve false), pero esto corre en
 * el manejador de un evento del canal: si algun dia lanzara, el 'notification'
 * se quedaria con un rechazo sin dueno y el aviso no se reenviaria. El coste de
 * envolverlo es cero y lo que protege es que la carta siga llegando.
 */
async function invalidarCacheDelMenu() {
  try {
    await menuService.invalidarMenu();
    return true;
  } catch (err) {
    console.error('[inventario] no se pudo invalidar la cache del menu:', err && err.message);
    return false;
  }
}

/** ¿Es un id de verdad? */
function esId(valor) {
  const numero = aNumero(valor);
  return numero !== null && Number.isInteger(numero) && numero > 0;
}

/**
 * Reenvía UN aviso del canal al socket-server.
 *
 * Nunca lanza y devuelve qué hizo, que es lo que las pruebas comprueban sin
 * tener que mirar el log:
 *   - `{ reenviado: 'disponibilidad' | 'stock_bajo' }`
 *   - `{ ignorado: 'json' | 'tipo' | 'datos' }`
 *
 * Un payload que no se entiende se ignora y se registra: el canal lo llena la
 * base, así que un aviso raro es un cambio de contrato o un script más nuevo,
 * nunca algo que deba cortar el oyente.
 */
async function manejarAviso(payload, { notifier = socketNotifier } = {}) {
  let aviso;
  try {
    aviso = JSON.parse(payload);
  } catch {
    console.error('[inventario] aviso ilegible en el canal, se ignora');
    return { ignorado: 'json' };
  }

  if (!aviso || typeof aviso !== 'object') return { ignorado: 'json' };

  if (aviso.tipo === TIPO_DISPONIBILIDAD) {
    if (!esId(aviso.id) || typeof aviso.disponible !== 'boolean') {
      console.error(`[inventario] aviso de disponibilidad incompleto (entidad ${aviso.entidad})`);
      return { ignorado: 'datos' };
    }
    if (aviso.entidad !== 'plato' && aviso.entidad !== 'ingrediente') {
      console.error(`[inventario] entidad desconocida en el aviso: ${aviso.entidad}`);
      return { ignorado: 'datos' };
    }
    const id = aNumero(aviso.id);

    // ISSUE #135: la cache del menu se invalida ANTES de reenviar el aviso, y
    // pase lo que pase con el reenvio.
    //
    // GET /api/menu se cachea 60 s, y hasta ahora solo lo invalidaban las rutas
    // REST que editan la carta. La disponibilidad por STOCK cambia DENTRO de la
    // base (un pedido que consume, un movimiento, una receta, un insumo
    // desactivado) y solo avisa por este canal: durante hasta un minuto la carta
    // mostraba como disponible un plato ya agotado.
    //
    // Va antes del reenvio porque es lo que de verdad no puede esperar: si el
    // socket-server esta caido, el aviso en vivo se pierde pero la proxima
    // peticion del comensal tiene que ver la carta real.
    await invalidarCacheDelMenu();

    if (aviso.entidad === 'plato') {
      await notifier.notificarPlatoDisponibilidad(id, aviso.disponible, { conReintento: true });
    } else {
      await notifier.notificarIngredienteDisponibilidad(id, aviso.disponible, { conReintento: true });
    }
    return { reenviado: TIPO_DISPONIBILIDAD };
  }

  if (aviso.tipo === TIPO_STOCK_BAJO) {
    const stockActual = aNumero(aviso.stock_actual);
    const stockMinimo = aNumero(aviso.stock_minimo);
    if (!esId(aviso.id_insumo) || typeof aviso.nombre !== 'string' || !aviso.nombre
        || stockActual === null || stockMinimo === null) {
      console.error('[inventario] aviso de stock bajo incompleto, se ignora');
      return { ignorado: 'datos' };
    }

    await notifier.notificarInventarioAlerta({
      id_insumo: aNumero(aviso.id_insumo),
      nombre: aviso.nombre,
      unidad: typeof aviso.unidad === 'string' ? aviso.unidad : 'porcion',
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
    });
    return { reenviado: TIPO_STOCK_BAJO };
  }

  console.error(`[inventario] tipo de aviso desconocido: ${aviso.tipo}`);
  return { ignorado: 'tipo' };
}

/**
 * Pone la carta al día y la emite entera (pasos 2 y 3 del arranque).
 *
 * 2. `fn_recalcular_toda_la_carta()` corrige cualquier `stock_suficiente`
 *    desfasado porque el stock cambió mientras el backend estaba caído. Lo que
 *    cambie sale por `pg_notify` como siempre, y este oyente ya está escuchando.
 * 3. Los avisos emitidos mientras el backend no estaba se PERDIERON, y el
 *    recálculo no los repite (si el estado ya era correcto, no hay cambio que
 *    notificar). Así que se lee `v_carta_disponible` y se emite la
 *    disponibilidad de cada plato y de cada opción: es la única forma de que las
 *    mesas conectadas vean la carta real sin esperar al próximo movimiento.
 *
 * Nunca lanza. Devuelve un resumen, que es lo que se registra y lo que las
 * pruebas revisan.
 */
async function ponerLaCartaAlDia(conexion, { notifier = socketNotifier } = {}) {
  const resumen = { recalculados: null, emitidos: 0, fallidos: 0, abortado: false, cacheInvalidada: false };

  try {
    const recalculo = await conexion.query('SELECT fn_recalcular_toda_la_carta() AS cambios');
    resumen.recalculados = aNumero(recalculo.rows[0] && recalculo.rows[0].cambios);
    console.log(`[inventario] carta recalculada al arrancar: ${resumen.recalculados} cambios`);
  } catch (err) {
    console.error('[inventario] no se pudo recalcular la carta:', err && err.message);
  }

  // ISSUE #135: tras el recalculo, la cache del menu puede tener una carta de
  // antes de que el backend se cayera. Se invalida en el arranque y en CADA
  // reconexion del canal, que es justo cuando no se sabe que paso mientras no
  // habia nadie escuchando.
  resumen.cacheInvalidada = await invalidarCacheDelMenu();

  let filas = [];
  try {
    const carta = await conexion.query(
      'SELECT tipo, id, disponible_efectivo, motivo FROM v_carta_disponible ORDER BY tipo, id'
    );
    filas = carta.rows;
  } catch (err) {
    console.error('[inventario] no se pudo leer la carta:', err && err.message);
    return resumen;
  }

  let fallosSeguidos = 0;
  for (const fila of filas) {
    const id = aNumero(fila.id);
    const disponible = fila.disponible_efectivo === true;
    if (id === null) continue;

    try {
      const resultado = fila.tipo === 'plato'
        ? await notifier.notificarPlatoDisponibilidad(id, disponible, { conReintento: true })
        : await notifier.notificarIngredienteDisponibilidad(id, disponible, { conReintento: true });

      if (resultado && resultado.ok) {
        resumen.emitidos += 1;
        fallosSeguidos = 0;
      } else {
        resumen.fallidos += 1;
        fallosSeguidos += 1;
      }
    } catch (err) {
      // El notificador no lanza, así que esto es una red de seguridad.
      console.error('[inventario] fallo inesperado al emitir la carta:', err && err.message);
      resumen.fallidos += 1;
      fallosSeguidos += 1;
    }

    if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
      resumen.abortado = true;
      console.error(
        `[inventario] ${fallosSeguidos} avisos seguidos fallaron: no se emite el resto de la carta`
      );
      break;
    }
  }

  console.log(
    `[inventario] carta emitida: ${resumen.emitidos} avisos, ${resumen.fallidos} fallidos`
      + (resumen.abortado ? ' (se abortó: el socket-server no responde)' : '')
  );
  return resumen;
}

/**
 * Programa la reconexión. Nunca deja un temporizador suelto: `detener` lo
 * cancela, y por eso NO lleva `unref()`.
 *
 * `unref()` haría que el proceso pudiera terminar en medio de la espera, que es
 * lo que en D-18 dejó 27 pruebas canceladas: el runner veía el event loop vacío
 * y cerraba el archivo con promesas a medias. Aquí es trabajo pendiente de
 * verdad —hay un canal que volver a abrir— y el apagado ordenado lo cancela de
 * forma explícita.
 */
function programarReconexion(opciones) {
  if (!activo || temporizador) return;

  const msEspera = espera;
  espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
  console.error(`[inventario] se reintenta la conexion del canal en ${msEspera} ms`);

  temporizador = setTimeout(() => {
    temporizador = null;
    if (!activo) return;
    ultimoCiclo = conectar(opciones);
  }, msEspera);
}

/**
 * Abre la conexión, hace LISTEN y pone la carta al día, EN ESE ORDEN.
 *
 * El `LISTEN` va primero para no perder nada: si se recalculara antes, los
 * avisos de ese propio recálculo se emitirían con el canal todavía sin
 * escuchar y la carta quedaría desfasada hasta el siguiente movimiento.
 *
 * Nunca lanza: si la conexión falla, programa el siguiente intento y vuelve.
 */
async function conectar({ crearCliente = () => new Client(configuracion()), notifier = socketNotifier } = {}) {
  if (!activo) return;

  let conexion;
  try {
    conexion = crearCliente();
    conexion.on('error', (err) => {
      // Un error en esta conexión NO es una petición que responder: la base se
      // reinició o la red cortó. Sin este manejador, el 'error' de un
      // EventEmitter sin oyentes tumba el proceso entero.
      console.error('[inventario] error en la conexion del canal:', err && err.message);
    });
    conexion.on('end', () => {
      if (cliente === conexion) {
        cliente = null;
        console.error('[inventario] se cerro la conexion del canal');
        programarReconexion({ crearCliente, notifier });
      }
    });

    await conexion.connect();
    conexion.on('notification', (mensaje) => {
      if (mensaje.channel !== CANAL) return;
      // Sin await: el oyente de un evento no puede devolver una promesa a nadie.
      // `manejarAviso` no lanza, y el catch es por si acaso.
      manejarAviso(mensaje.payload, { notifier }).catch((err) => {
        console.error('[inventario] fallo al reenviar un aviso:', err && err.message);
      });
    });

    await conexion.query(`LISTEN ${CANAL}`);
    cliente = conexion;
    espera = ESPERA_INICIAL_MS;
    console.log(`[inventario] escuchando el canal ${CANAL}`);

    await ponerLaCartaAlDia(conexion, { notifier });
  } catch (err) {
    console.error('[inventario] no se pudo abrir el canal:', err && err.message);
    if (conexion) {
      try {
        await conexion.end();
      } catch {
        // Ya estaba cerrada.
      }
    }
    if (cliente === conexion) cliente = null;
    programarReconexion({ crearCliente, notifier });
  }
}

/**
 * Arranca el oyente. Se llama una sola vez, desde server.js y solo cuando el
 * proceso es el servidor (no cuando una prueba importa `app`).
 *
 * No se espera su promesa: el backend tiene que estar sirviendo peticiones
 * aunque el canal tarde o no se pueda abrir.
 */
function iniciar(opciones = {}) {
  if (activo) return ultimoCiclo;
  activo = true;
  espera = ESPERA_INICIAL_MS;
  ultimoCiclo = conectar(opciones);
  return ultimoCiclo;
}

/**
 * Cierra el oyente y cancela cualquier reconexión pendiente. Lo llama el
 * apagado ordenado, ANTES de cerrar el pool.
 */
async function detener() {
  activo = false;
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  const conexion = cliente;
  cliente = null;
  if (!conexion) return;
  try {
    await conexion.end();
  } catch (err) {
    console.error('[inventario] fallo al cerrar la conexion del canal:', err && err.message);
  }
}

/** Para las pruebas: esperar el arranque o la reconexión en vuelo. */
function esperarCiclo() {
  return ultimoCiclo;
}

/** Para las pruebas: dejar el módulo como recién cargado. */
function reiniciarEstado() {
  activo = false;
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  cliente = null;
  espera = ESPERA_INICIAL_MS;
  ultimoCiclo = Promise.resolve();
}

module.exports = {
  iniciar,
  detener,
  manejarAviso,
  ponerLaCartaAlDia,
  aNumero,
  esperarCiclo,
  reiniciarEstado,
  CANAL,
  TIPO_DISPONIBILIDAD,
  TIPO_STOCK_BAJO,
  ESPERA_INICIAL_MS,
  ESPERA_MAXIMA_MS,
  MAX_FALLOS_SEGUIDOS,
};
