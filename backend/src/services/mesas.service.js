const pool = require('../config/db');
const socketNotifier = require('./socket.notifier');
const aliasComensal = require('./alias-comensal');

// Tabla mesas (docs/modelo-er.md): id_mesa, numero, capacidad, ubicacion,
// estado, token_qr, actualizado_en.
//
// Este servicio solo lee/expone lo que está guardado en la columna token_qr.
// El socket-server de Roberto no usa Redis ni esta columna: emite tokens QR
// firmados con HMAC, con la expiración dentro del propio token. Los dos modelos
// conviven por ahora; la decisión de cuál queda es del equipo (docs/api-spec.md).

// Valores exactos del CHECK de mesas.estado en el schema.sql de Jarrison.
const ESTADOS_MESA = ['disponible', 'ocupada', 'reservada', 'mantenimiento'];
const ESTADO_MESA_LIBRE = 'disponible';
const ESTADO_MESA_OCUPADA = 'ocupada';

// Unica moneda del proyecto. Va explicita en la cuenta interna porque el
// contrato de Wompi la exige y el socket-server rechaza cualquier otra.
const MONEDA = 'COP';

async function listar() {
  const result = await pool.query('SELECT * FROM mesas ORDER BY numero ASC');
  return result.rows;
}

async function obtenerPorId(id) {
  const result = await pool.query('SELECT * FROM mesas WHERE id_mesa = $1', [id]);
  return result.rows[0] || null;
}

async function crear({ numero, capacidad, ubicacion, estado, token_qr }) {
  // capacidad, ubicacion y actualizado_en tienen DEFAULT en el schema: si no
  // vienen, se deja que la base ponga el suyo.
  //
  // Una mesa que nace 'ocupada' (caso raro, al dar de alta el salón con gente
  // sentada) ya está en una visita, así que arranca con su sesion_iniciada_en.
  // Si nace libre queda NULL, y la primera apertura la fijará.
  //
  // La comparación se hace aquí y llega como booleano ($6). Antes era
  // `CASE WHEN $4 = $6` en el SQL: $4 iba a la vez a la columna estado
  // (varchar) y a esa comparación (text), y PostgreSQL rechazaba la consulta
  // ("inconsistent types deduced for parameter $4"), así que POST /api/mesas
  // daba 500 siempre. Lo cubre tests/integracion/mesas-sql.test.js.
  const estadoInicial = estado || ESTADO_MESA_LIBRE;
  const result = await pool.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr, sesion_iniciada_en)
     VALUES ($1, COALESCE($2, 4), COALESCE($3, 'Principal'), $4, $5,
             CASE WHEN $6 THEN NOW() ELSE NULL END) RETURNING *`,
    [
      numero,
      capacidad ?? null,
      ubicacion || null,
      estadoInicial,
      token_qr || null,
      estadoInicial === ESTADO_MESA_OCUPADA,
    ]
  );
  return result.rows[0];
}

/**
 * Cambia el estado de la mesa a mano (PATCH /api/mesas/:id/estado).
 *
 * Este camino también puede empezar una visita: un mesero que marca la mesa
 * 'ocupada' desde el panel, sin pasar por "abrir" (y por tanto sin QR). Se
 * aplica la misma regla que en abrirSesion, porque si no la cuenta de ese grupo
 * arrastraría los pedidos del anterior.
 *
 * El CASE compara contra el estado VIEJO: en una misma sentencia SQL el lado
 * derecho del SET ve los valores previos a la fila, así que esto distingue
 * "pasa a ocupada" de "ya estaba ocupada" sin una lectura aparte ni una
 * carrera entre el SELECT y el UPDATE.
 *
 * actualizado_en y version_control los maneja el trigger tr_control_concurrencia_mesa.
 */
async function actualizarEstado(id, estado) {
  const result = await pool.query(
    `UPDATE mesas SET estado = COALESCE($1, estado),
            sesion_iniciada_en = CASE
              WHEN $1 = $3 AND estado <> $3 THEN NOW()
              ELSE sesion_iniciada_en
            END
      WHERE id_mesa = $2 RETURNING *`,
    [estado, id, ESTADO_MESA_OCUPADA]
  );
  return result.rows[0] || null;
}

/**
 * Abre la sesión de la mesa y devuelve el token del QR que hay que imprimir.
 *
 * Es idempotente: si la mesa ya tiene un token_qr y el socket-server dice que
 * sigue vigente, se devuelve ese mismo. Solo se pide uno nuevo si no hay o el
 * que había caducó.
 *
 * Todo ocurre con la fila de la mesa bloqueada (SELECT ... FOR UPDATE) para que
 * dos meseros pulsando "abrir" a la vez no generen dos QR distintos y se pisen
 * el token. Contrapartida asumida: el bloqueo se mantiene durante la llamada
 * HTTP al socket-server, por eso el timeout de ese cliente es corto.
 *
 * El JWT del mesero se reenvía a /qr/generar: es el socket-server quien decide
 * si ese rol puede generar QR.
 *
 * @returns uno de: { mesa, token, reutilizado } | { noExiste: true }
 *          | { socketCaido: true, motivo } | { rechazado: true, status, mensaje }
 */
async function abrirSesion(idMesa, { jwtStaff, socket = socketNotifier } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bloqueada = await client.query('SELECT * FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);
    if (bloqueada.rows.length === 0) {
      await client.query('ROLLBACK');
      return { noExiste: true };
    }
    const mesa = bloqueada.rows[0];

    // Se reutiliza el QR solo si la mesa está 'ocupada', o sea con una sesión
    // viva. Una mesa 'disponible' con token_qr es un resto de una sesión que ya
    // terminó: ahí SIEMPRE se genera uno nuevo y se reemplaza el guardado, para
    // que el grupo que llega no herede el QR del anterior.
    if (mesa.token_qr && mesa.estado === ESTADO_MESA_OCUPADA) {
      const vigente = await socket.validarTokenQr(mesa.token_qr);
      if (!vigente.alcanzado) {
        await client.query('ROLLBACK');
        return { socketCaido: true, motivo: vigente.motivo };
      }
      if (vigente.valido) {
        await client.query('COMMIT');
        return { mesa, token: mesa.token_qr, reutilizado: true };
      }
    }

    const generado = await socket.generarTokenQr(idMesa, jwtStaff);
    if (!generado.alcanzado) {
      await client.query('ROLLBACK');
      return { socketCaido: true, motivo: generado.motivo };
    }
    if (!generado.token) {
      await client.query('ROLLBACK');
      return { rechazado: true, status: generado.status, mensaje: generado.mensaje };
    }

    // sesion_iniciada_en marca el comienzo de la VISITA, no del QR: delimita qué
    // pedidos entran en la cuenta (scripts 17, obtener_cuenta_mesa). Se pone
    // solo si la mesa NO estaba ocupada, en la misma UPDATE y la misma
    // transacción que el estado y el token.
    //
    // Si ya estaba ocupada no se toca, aunque aquí se esté generando un QR
    // nuevo: eso pasa cuando el anterior caducó, y sigue siendo la misma visita.
    // Pisarlo dejaría fuera de la cuenta todo lo que el grupo ya pidió.
    const visitaNueva = mesa.estado !== ESTADO_MESA_OCUPADA;
    const actualizada = await client.query(
      `UPDATE mesas SET token_qr = $1, estado = 'ocupada',
              sesion_iniciada_en = CASE WHEN $3 THEN NOW() ELSE sesion_iniciada_en END
        WHERE id_mesa = $2 RETURNING *`,
      [generado.token, idMesa, visitaNueva]
    );

    await client.query('COMMIT');
    return { mesa: actualizada.rows[0], token: generado.token, reutilizado: false };
  } catch (err) {
    await client.query('ROLLBACK');
    // Una mesa INACTIVA no se abre ni recibe un QR nuevo: lo impide
    // tr_validar_mesa_activa con un 23514, que sin traducir saldría como un 422
    // genérico. Es una regla de sala, así que sale 409 con su motivo.
    throw traducirMesaActiva(err, MOTIVO_MESA_INACTIVA, MENSAJE_INACTIVA);
  } finally {
    client.release();
  }
}

/**
 * GUARDA DE CONTINUIDAD del QR, común a la rotación automática (#168) y a la
 * manual con `soloSiVacia` (#174). Rotar deja sin sesión a quien ya tenga un
 * JWT con el sid del QR anterior, así que no se rota si la sesión de mesa ya
 * tiene comensales:
 *   - pedidos de la sesión actual (misma regla de `sesion_iniciada_en` que
 *     liberarSiNoQuedanPedidosAbiertos);
 *   - reservas de alias de la mesa (todo el que entra por QR reserva su alias, y
 *     el personal reserva el de quien no tiene celular).
 *
 * Se llama DENTRO de la transacción de quien rota y con la mesa ya bloqueada
 * (FOR UPDATE), así la comprobación y el UPDATE del token no se separan. No hace
 * ROLLBACK: eso es de quien llama.
 *
 * @param {import('pg').PoolClient} client  el de la transacción abierta
 * @param {number} idMesa
 * @param {{sesion_iniciada_en: Date|null}} mesa  la fila bloqueada
 * @param {typeof aliasComensal.hayReservas} reservas
 * @returns {Promise<null | {conComensales: true, motivo: 'pedidos'|'alias'}
 *   | {reservasNoDisponibles: true}>}  null si se puede rotar.
 */
async function guardaDeContinuidad(client, idMesa, mesa, reservas) {
  const pedidos = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pedidos p
        WHERE p.id_mesa = $1::int
          AND ($2::timestamptz IS NULL OR p.creado_en >= $2::timestamptz)
     ) AS hay`,
    [idMesa, mesa.sesion_iniciada_en]
  );
  if (pedidos.rows[0].hay) return { conComensales: true, motivo: 'pedidos' };

  // Si las reservas no se pueden leer (Redis no responde) NO se rota: el QR
  // anterior sigue valiendo y nadie pierde su sesión.
  const r = await reservas(idMesa);
  if (!r || r.noDisponible) return { reservasNoDisponibles: true };
  if (r.hay) return { conComensales: true, motivo: 'alias' };
  return null;
}

/**
 * Rota el QR de una mesa con sesión abierta: pide un token nuevo al
 * socket-server y lo guarda como el vigente.
 *
 * Solo para mesas 'ocupada': rotar una mesa libre equivaldría a abrirla sin
 * pasar por POST /abrir. La fila se bloquea (FOR UPDATE) igual que al abrir,
 * para que dos rotaciones simultáneas no dejen guardado un token distinto del
 * que se avisó a la tablet.
 *
 * Avisar a la tablet (/internal/qr-rotado) es del controller, DESPUÉS del
 * commit: así nunca se anuncia un token que no quedó guardado.
 *
 * `soloSiVacia` (#174, la renovación automática del modal del panel): antes de
 * pedir el token se aplica la MISMA guarda de continuidad que la rotación
 * interna, en esta transacción y con la mesa bloqueada. Sin él, el "Nuevo QR"
 * manual rota aunque haya comensales, como siempre.
 *
 * @returns { noExiste: true } | { noOcupada: true, estado }
 *          | { conComensales: true, motivo } | { reservasNoDisponibles: true }
 *          | { socketCaido: true, motivo } | { rechazado: true, status, mensaje }
 *          | { mesa, token, expira_en }
 */
async function rotarQr(idMesa, {
  jwtStaff,
  socket = socketNotifier,
  soloSiVacia = false,
  reservas = aliasComensal.hayReservas,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bloqueada = await client.query('SELECT * FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);
    if (bloqueada.rows.length === 0) {
      await client.query('ROLLBACK');
      return { noExiste: true };
    }
    const mesa = bloqueada.rows[0];
    if (mesa.estado !== ESTADO_MESA_OCUPADA) {
      await client.query('ROLLBACK');
      return { noOcupada: true, estado: mesa.estado };
    }

    if (soloSiVacia) {
      const impide = await guardaDeContinuidad(client, idMesa, mesa, reservas);
      if (impide) {
        await client.query('ROLLBACK');
        return impide;
      }
    }

    const generado = await socket.generarTokenQr(idMesa, jwtStaff);
    if (!generado.alcanzado) {
      await client.query('ROLLBACK');
      return { socketCaido: true, motivo: generado.motivo };
    }
    if (!generado.token) {
      await client.query('ROLLBACK');
      return { rechazado: true, status: generado.status, mensaje: generado.mensaje };
    }

    const actualizada = await client.query(
      'UPDATE mesas SET token_qr = $1 WHERE id_mesa = $2 RETURNING *',
      [generado.token, idMesa]
    );

    await client.query('COMMIT');
    return { mesa: actualizada.rows[0], token: generado.token, expira_en: generado.expira_en ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    // Una mesa INACTIVA no se abre ni recibe un QR nuevo: lo impide
    // tr_validar_mesa_activa con un 23514, que sin traducir saldría como un 422
    // genérico. Es una regla de sala, así que sale 409 con su motivo.
    throw traducirMesaActiva(err, MOTIVO_MESA_INACTIVA, MENSAJE_INACTIVA);
  } finally {
    client.release();
  }
}

/**
 * ROTACIÓN AUTOMÁTICA del QR, la que pide el socket-server cada 3 minutos
 * mientras la mesa está abierta y vacía (socket-server/docs/rotacion-qr.md):
 * POST /mesas/:id/token-qr/interno. A diferencia de `rotarQr` (la manual), el
 * token NUEVO ya viene firmado por el socket-server: aquí solo se decide si se
 * puede guardar.
 *
 * En UNA transacción, con la mesa bloqueada:
 *   1. La mesa tiene que existir (`noExiste`) y estar 'ocupada' (`noOcupada`).
 *   2. COMPARE-AND-SWAP: `tokenAnterior` tiene que ser el token vigente. Si no,
 *      alguien rotó a mano o liberó la mesa mientras tanto (`cambioDeToken`).
 *      Un `tokenAnterior` NULL también se rechaza: es un swap sin "compare". El
 *      socket-server arranca la rotación SIEMPRE con el token que acaba de
 *      firmar en /qr/generar (que es el que guarda el backend al abrir o rotar
 *      a mano), así que hoy nunca manda null; si algún día lo hiciera, sería
 *      un rotador que no sabe qué QR hay vigente, y pisarlo a ciegas podría
 *      deshacer una rotación manual.
 *   3. GUARDA DE CONTINUIDAD: rotar deja sin sesión a quien ya tenga un JWT con
 *      el sid del QR anterior (sesionDeMesaVigente compara el sid con
 *      mesas.token_qr). Si la sesión de mesa ya tiene comensales, NO se rota
 *      (`conComensales`): el socket-server deja de rotar y el QR queda fijo,
 *      que es lo que el diseño quiere en cuanto entra alguien. Dos señales:
 *        - pedidos de la sesión actual (misma transacción, misma regla de
 *          `sesion_iniciada_en` que liberarSiNoQuedanPedidosAbiertos);
 *        - reservas de alias de la mesa (todo el que entra por QR reserva su
 *          alias, y el personal reserva el de quien no tiene celular).
 *      Si las reservas no se pueden leer (Redis no responde), NO se rota
 *      (`reservasNoDisponibles`, que el controller responde 503): el QR anterior
 *      sigue valiendo, nadie pierde su sesión, y el socket-server lo reintenta
 *      en el siguiente ciclo. Vive en `guardaDeContinuidad`, que comparte con
 *      la rotación manual con `soloSiVacia`.
 *   4. Se guarda el token anterior en token_qr_historico y se cambia token_qr.
 *
 * No avisa a /internal/qr-rotado: el socket-server anuncia qr:actualizado él
 * mismo al recibir el 200.
 *
 * @returns {Promise<{noExiste: true} | {noOcupada: true, estado: string}
 *   | {cambioDeToken: true} | {conComensales: true, motivo: string}
 *   | {reservasNoDisponibles: true} | {ok: true}>}
 */
async function rotarQrInterno(idMesa, { tokenQr, tokenAnterior, reservas = aliasComensal.hayReservas } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bloqueada = await client.query(
      'SELECT id_mesa, estado, token_qr, sesion_iniciada_en FROM mesas WHERE id_mesa = $1::int FOR UPDATE',
      [idMesa]
    );
    if (bloqueada.rows.length === 0) {
      await client.query('ROLLBACK');
      return { noExiste: true };
    }
    const mesa = bloqueada.rows[0];
    if (mesa.estado !== ESTADO_MESA_OCUPADA) {
      await client.query('ROLLBACK');
      return { noOcupada: true, estado: mesa.estado };
    }

    // Compare-and-swap. NULL no se acepta como comodín (ver arriba).
    if (tokenAnterior === null || tokenAnterior === undefined || mesa.token_qr !== tokenAnterior) {
      await client.query('ROLLBACK');
      return { cambioDeToken: true };
    }

    const impide = await guardaDeContinuidad(client, idMesa, mesa, reservas);
    if (impide) {
      await client.query('ROLLBACK');
      return impide;
    }

    await client.query(
      'INSERT INTO token_qr_historico (id_mesa, token_antiguo) VALUES ($1::int, $2::text)',
      [idMesa, mesa.token_qr]
    );
    await client.query('UPDATE mesas SET token_qr = $1::text WHERE id_mesa = $2::int', [tokenQr, idMesa]);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw traducirMesaActiva(err, MOTIVO_MESA_INACTIVA, MENSAJE_INACTIVA);
  } finally {
    client.release();
  }
}

/**
 * Cierra la sesión de la mesa a mano: la deja 'disponible' y borra su token_qr,
 * con lo que el QR impreso deja de valer y las sesiones de comensal de ese grupo
 * caen (el middleware compara el sid del JWT contra la columna).
 *
 * Liberar a mano es SOLO para grupos que se van sin pedir: si la mesa tiene
 * pedidos abiertos hay que cobrarlos o cancelarlos, y entonces la mesa se libera
 * sola (ver liberarSiNoQuedanPedidosAbiertos). El chequeo va dentro de la misma
 * transacción y con la mesa bloqueada, para que no se cuele un pedido nuevo
 * entre la comprobación y el UPDATE.
 *
 * Avisar al socket-server es del controller, DESPUÉS del commit: si ese aviso
 * falla no se debe revertir la liberación.
 *
 * @returns { noExiste: true } | { pedidosAbiertos: number } | { mesa }
 */
async function liberarSesion(idMesa) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bloqueada = await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);
    if (bloqueada.rows.length === 0) {
      await client.query('ROLLBACK');
      return { noExiste: true };
    }

    const abiertos = await client.query(
      // Solo los de la visita actual: un pedido abierto que quedó colgado de un
      // grupo anterior no debe impedir cerrar la mesa de este (y, si no se
      // filtrara, la mesa no se liberaría nunca más).
      `SELECT count(*)::int AS n FROM pedidos p
       JOIN mesas m ON m.id_mesa = p.id_mesa
       WHERE p.id_mesa = $1
         AND p.estado NOT IN ('pagado', 'cancelado')
         AND (m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en)`,
      [idMesa]
    );
    const n = abiertos.rows[0] && abiertos.rows[0].n;
    if (typeof n !== 'number') {
      // Sin poder contar no se libera: es más seguro que soltar una mesa con
      // pedidos vivos (mismo criterio que la liberación automática).
      await client.query('ROLLBACK');
      throw { status: 500, message: 'No se pudo comprobar si la mesa tiene pedidos abiertos' };
    }
    if (n > 0) {
      await client.query('ROLLBACK');
      return { pedidosAbiertos: n };
    }

    const actualizada = await client.query(
      `UPDATE mesas SET estado = $1, token_qr = NULL WHERE id_mesa = $2 RETURNING *`,
      [ESTADO_MESA_LIBRE, idMesa]
    );

    await client.query('COMMIT');
    return { mesa: actualizada.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Libera la mesa si ya no le quedan pedidos abiertos. Se usa DENTRO de la
 * transacción que acaba de cerrar un pedido (pagado o cancelado), con el client
 * de esa transacción.
 *
 * El SELECT ... FOR UPDATE sobre la mesa serializa los cierres simultáneos: si
 * dos pedidos de la misma mesa se liquidan a la vez, el segundo espera al
 * primero y ve el estado ya actualizado, así la mesa se libera una sola vez.
 *
 * @returns {Promise<boolean>} true si esta llamada fue la que la liberó.
 */
async function liberarSiNoQuedanPedidosAbiertos(client, idMesa) {
  await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);

  const abiertos = await client.query(
    // Mismo criterio de visita que liberarSesion.
    `SELECT count(*)::int AS n FROM pedidos p
     JOIN mesas m ON m.id_mesa = p.id_mesa
     WHERE p.id_mesa = $1
       AND p.estado NOT IN ('pagado', 'cancelado')
       AND (m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en)`,
    [idMesa]
  );
  // Si por alguna razón no se puede leer el conteo, NO se libera: es más
  // seguro dejar la mesa ocupada que soltarla con pedidos vivos.
  const fila = abiertos.rows[0];
  if (!fila || typeof fila.n !== 'number' || fila.n > 0) return false;

  const liberada = await client.query(
    `UPDATE mesas SET estado = $1, token_qr = NULL
     WHERE id_mesa = $2 AND (estado <> $1 OR token_qr IS NOT NULL)
     RETURNING id_mesa`,
    [ESTADO_MESA_LIBRE, idMesa]
  );
  return liberada.rows.length > 0;
}

/**
 * ¿Existe esa mesa? Una sola consulta por clave primaria y sin traer la fila.
 *
 * Es la pregunta previa de todo lo que recibe un `id_mesa` de fuera: las dos
 * cuentas ya la hacían (sin esto, `obtener_cuenta_mesa_json` lanza un RAISE que
 * el manejador central daría como un 409 incomprensible) y desde D-18c también
 * `POST /api/pedidos`, para que un id equivocado sea un 404 y no un 409 que
 * culpa al nombre del comensal.
 *
 * `SELECT 1` y no `SELECT *`: solo interesa si hay fila, y traerla entera
 * invitaría a usar este helper como un `obtenerPorId` barato, que no es.
 */
async function existe(idMesa) {
  const result = await pool.query('SELECT 1 FROM mesas WHERE id_mesa = $1', [idMesa]);
  return result.rows.length > 0;
}

/**
 * Cuenta de la mesa para el socket-server (EVENTS.md §8.2), en centavos.
 *
 * Los centavos se calculan EN SQL (`ROUND(x * 100)::bigint`) y no en
 * JavaScript: `33333.33 * 100` en coma flotante da 3333332.9999999995, y un
 * peso perdido al redondear en el lado equivocado deja una cuenta que nunca
 * cuadra. La base ya guarda DECIMAL(10,2); multiplicar ahí mantiene el entero
 * exacto.
 *
 * El desglose sale de obtener_cuenta_mesa_json() de Jarrison, que es la
 * autoridad sobre quién consumió qué y cuánto se ha pagado. `por_comensal` solo
 * lleva a quien todavía debe algo: a quien ya pagó no hay que volver a
 * cobrarle, y el comensal lo usa para elegir "pago lo mío".
 *
 * @returns {Promise<null|{id_mesa, moneda, total_centavos, saldo_centavos, por_comensal}>}
 *          null si la mesa no existe (el endpoint responde 404; la función SQL
 *          lanzaría un RAISE, que el manejador central traduciría a 409).
 */
async function cuentaInterna(idMesa) {
  if (!(await existe(idMesa))) return null;

  const result = await pool.query(
    `WITH cuenta AS (SELECT obtener_cuenta_mesa_json($1) AS j)
     SELECT
       ROUND(COALESCE((j->>'total_mesa')::numeric, 0) * 100)::bigint AS total_centavos,
       ROUND(COALESCE((j->>'saldo_mesa')::numeric, 0) * 100)::bigint AS saldo_centavos,
       COALESCE((
         SELECT json_agg(
                  json_build_object(
                    'comensal', e->>'comensal',
                    'saldo_centavos', ROUND((e->>'saldo')::numeric * 100)::bigint
                  ) ORDER BY e->>'comensal' ASC
                )
         FROM json_array_elements(j->'comensales') AS e
         WHERE (e->>'saldo')::numeric > 0
       ), '[]'::json) AS por_comensal
     FROM cuenta`,
    [idMesa]
  );

  const fila = result.rows[0];
  return {
    id_mesa: Number(idMesa),
    moneda: MONEDA,
    // pg devuelve bigint como string para no perder precisión; aquí los montos
    // en centavos caben de sobra en un entero de JavaScript.
    total_centavos: Number(fila.total_centavos),
    saldo_centavos: Number(fila.saldo_centavos),
    por_comensal: fila.por_comensal,
  };
}

/**
 * Cuenta de la mesa por comensal, tal como la devuelve
 * obtener_cuenta_mesa_json() de Jarrison (scripts 15 y 16).
 *
 * Los montos van en PESOS con decimales, que es la unidad de la función y de la
 * base: esta cuenta la leen personas (la lee el cajero en el panel y el
 * comensal en su teléfono), no la pasarela. La versión en centavos enteros es
 * cuentaInterna(), que es la que consume el socket-server; aquí no se convierte
 * nada para no tener dos verdades sobre el mismo número.
 *
 * Se devuelve el JSON de la función sin recomponerlo: sus campos son el
 * contrato (id_mesa, numero, estado_mesa, ubicacion, total_mesa, pagado_mesa,
 * saldo_mesa, items_totales, pedidos[], comensales[]), y copiarlos a mano aquí
 * solo añadiría un sitio más que actualizar cuando Jarrison los cambie.
 *
 * @returns {Promise<null|object>} null si la mesa no existe (404). La función
 *          SQL lanzaría un RAISE, que el manejador central daría como 409.
 */
async function cuentaPorComensal(idMesa) {
  if (!(await existe(idMesa))) return null;

  const result = await pool.query('SELECT obtener_cuenta_mesa_json($1) AS cuenta', [idMesa]);
  return result.rows[0].cuenta;
}

/** token_qr vigente de la mesa, o null. Lo usa el middleware de sesión. */
async function tokenQrDeMesa(idMesa) {
  const result = await pool.query('SELECT token_qr FROM mesas WHERE id_mesa = $1', [idMesa]);
  return (result.rows[0] && result.rows[0].token_qr) || null;
}

/* ========================================================================== *
 * Edición y borrado de una mesa (D-16, parte A)
 * ========================================================================== */

/** SQLSTATE de unicidad. En mesas solo puede ser `numero` o `token_qr`. */
const PG_UNIQUE = '23505';

/**
 * SQLSTATE con el que `tr_validar_mesa_activa` rechaza las tres cosas que no se
 * pueden hacer con una mesa inactiva (database/scripts/26_configuracion.sql:
 * `USING ERRCODE = 'check_violation'`): desactivar una ocupada, abrir una
 * inactiva y darle un QR nuevo a una inactiva.
 *
 * Sin traducirlo, el manejador central lo convierte en un 422 genérico («un dato
 * está fuera del rango permitido») que no dice ni qué mesa ni qué hacer. Son
 * reglas de sala, así que aquí se vuelven 409 con su `motivo`.
 */
const PG_CHECK = '23514';

const MOTIVO_MESA_OCUPADA = 'mesa_ocupada';
const MOTIVO_MESA_INACTIVA = 'mesa_inactiva';

const MENSAJE_OCUPADA_NO_SE_DESACTIVA =
  'Esa mesa está ocupada: libérala antes de desactivarla.';
const MENSAJE_INACTIVA =
  'Esa mesa está inactiva: actívala antes de abrirla o de generarle un QR.';

const MENSAJE_NUMERO_EN_USO = 'Ya hay otra mesa con ese número';
const MENSAJE_OCUPADA_NO_SE_RENUMERA =
  'Esa mesa está ocupada: no se puede cambiar su número mientras haya gente sentada. '
  + 'Libérala primero.';
const MENSAJE_OCUPADA_NO_SE_BORRA =
  'Esa mesa está ocupada: libérala antes de borrarla.';
const MENSAJE_CON_PEDIDOS =
  'Esa mesa tiene pedidos registrados: no se puede borrar sin perder el historial. '
  + 'Déjala en mantenimiento si ya no se usa.';

/**
 * Error de negocio con status, que es la primera rama de errores.middleware.
 *
 * `motivo` es opcional y es el código estable que el cliente compara, al lado
 * del `error` que es texto para leer: la convención `{ error, motivo }` de los
 * 409 de mesas y pedidos. El manejador central lo pasa tal cual si viene.
 */
function errorDeMesa(status, message, motivo) {
  return motivo ? { status, message, motivo } : { status, message };
}

/**
 * Traduce el 23514 de `tr_validar_mesa_activa` a un 409 con su motivo.
 *
 * Es una red de seguridad, no el camino normal: desactivar una mesa ocupada ya
 * se corta antes en `actualizarDatos`, sin llegar a la base. Pero el trigger
 * cubre caminos que el backend no controla (abrir una mesa inactiva, rotarle el
 * QR, o una consulta a mano), y por esos sí llega aquí.
 *
 * Solo el 23514: cualquier otro error sube como venía, para no tapar un CHECK
 * distinto de la misma tabla.
 */
function traducirMesaActiva(err, motivo, mensaje) {
  if (err && err.code === PG_CHECK) return errorDeMesa(409, mensaje, motivo);
  return err;
}

/**
 * PATCH /api/mesas/:id — numero, capacidad y ubicacion.
 *
 * `estado` NO se toca aquí: ya tiene su propia ruta
 * (`PATCH /api/mesas/:id/estado`, de admin, cajero y mesero) porque mover el
 * estado es la operación del salón, con su propia lógica de `sesion_iniciada_en`
 * y sus propios permisos. Esto es el alta/baja del mobiliario, que es de admin.
 *
 * Reglas, con la fila bloqueada:
 *   - 404 si la mesa no existe.
 *   - una mesa OCUPADA no se renumera (409). El número es lo que la gente ve en
 *     el QR impreso, lo que grita el mesero y lo que el comensal confirma al
 *     escanear: cambiárselo con gente sentada y pedidos en marcha deja los
 *     tiquetes de cocina apuntando a una mesa que ya no existe con ese nombre.
 *     Capacidad y ubicación sí se pueden corregir, porque no identifican nada.
 *   - una mesa OCUPADA o con SESIÓN ABIERTA no se desactiva (409
 *     `mesa_ocupada`). Se comprueba aquí, con la fila ya bloqueada, y no se
 *     delega al trigger: así el mensaje dice qué pasa y qué hacer, y no se gasta
 *     un viaje a la base para que lo rechace. El trigger sigue siendo la red de
 *     seguridad para los caminos que no pasan por aquí.
 *   - un número repetido es 409 con un mensaje que lo dice (el UNIQUE de la base
 *     daría un 23505, que el manejador central traduce a un "Ya existe un
 *     registro con esos datos" genérico).
 *
 * Los campos que no vienen no se tocan (`COALESCE`).
 *
 * `actualizado_en` y `version_control` los pone el trigger
 * tr_control_concurrencia_mesa: aquí no se escriben a mano.
 *
 * @param {number|string} id
 * @param {{numero?: number, capacidad?: number, ubicacion?: string}} cambios
 * @returns {Promise<object|null>} la mesa actualizada, o null si no existe.
 */
async function actualizarDatos(id, cambios) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      'SELECT m.id_mesa, m.numero, m.estado, m.activa, m.token_qr FROM mesas m WHERE m.id_mesa = $1 FOR UPDATE',
      [id]
    );
    const mesa = actual.rows[0];
    if (!mesa) {
      await client.query('ROLLBACK');
      return null;
    }

    const cambiaElNumero = cambios.numero !== undefined && Number(cambios.numero) !== Number(mesa.numero);
    if (cambiaElNumero && mesa.estado === ESTADO_MESA_OCUPADA) {
      await client.query('ROLLBACK');
      throw errorDeMesa(409, MENSAJE_OCUPADA_NO_SE_RENUMERA);
    }

    // Desactivar es retirar la mesa del servicio (ADR-06). Lo único que lo
    // impide es que haya gente sentada: con la mesa ocupada, desactivarla deja
    // una sesión que no se puede cerrar por el camino normal.
    //
    // Un `token_qr` en una mesa 'disponible' NO bloquea: es el resto de una
    // sesión que ya terminó (el cierre deja el token hasta la próxima rotación),
    // así que no hay nadie a quien dejar colgado.
    const seDesactiva = cambios.activa === false && mesa.activa === true;
    if (seDesactiva && mesa.estado === ESTADO_MESA_OCUPADA) {
      await client.query('ROLLBACK');
      throw errorDeMesa(409, MENSAJE_OCUPADA_NO_SE_DESACTIVA, MOTIVO_MESA_OCUPADA);
    }

    // Al desactivar se borra el token en la MISMA sentencia: una mesa inactiva
    // no conserva un QR, o quedaría un código que escanea a una mesa fuera de
    // servicio. `$5 IS FALSE` solo es cierto cuando `activa` llega en `false`:
    // con `null` (el campo no viene) o con `true`, el token no se toca.
    const result = await client.query(
      `UPDATE mesas
          SET numero    = COALESCE($2, numero),
              capacidad = COALESCE($3, capacidad),
              ubicacion = COALESCE($4, ubicacion),
              activa    = COALESCE($5, activa),
              token_qr  = CASE WHEN $5 IS FALSE THEN NULL ELSE token_qr END
        WHERE id_mesa = $1
        RETURNING *`,
      [
        id,
        cambios.numero ?? null,
        cambios.capacidad ?? null,
        cambios.ubicacion ?? null,
        cambios.activa ?? null,
      ]
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ya estaba cerrada.
    }
    // Solo `numero` puede chocar por aquí: a `token_qr` este UPDATE solo le
    // escribe NULL, y el índice único no cuenta los NULL.
    if (err && err.code === PG_UNIQUE) throw errorDeMesa(409, MENSAJE_NUMERO_EN_USO);
    // Red de seguridad: si el trigger rechaza el cambio de `activa` por un
    // camino que la guarda de arriba no vio, sale 409 y no un 422 genérico.
    throw traducirMesaActiva(err, MOTIVO_MESA_OCUPADA, MENSAJE_OCUPADA_NO_SE_DESACTIVA);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/mesas/:id, comprobando ANTES por qué no se puede borrar.
 *
 * Sin esto, una mesa con pedidos chocaba con el `ON DELETE RESTRICT` de
 * `fk_pedidos_mesa` y el manejador central devolvía un 409 genérico ("La
 * operación choca con otro registro relacionado"), que no le dice al admin ni
 * qué mesa ni qué hacer. Y una mesa OCUPADA sin pedidos todavía (recién abierta)
 * se borraba con un 204, dejando una sesión de QR viva apuntando a una mesa que
 * ya no existe.
 *
 * Las dos comprobaciones van dentro de la transacción y con la fila bloqueada,
 * para que no se cuele un pedido entre el conteo y el DELETE.
 *
 * Cuando SÍ se puede borrar, el comportamiento es el de antes: devuelve la fila
 * borrada, y null si la mesa no existía (el controller responde 404).
 *
 * @returns {Promise<{id_mesa: number}|null>}
 */
async function eliminar(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      'SELECT m.id_mesa, m.estado FROM mesas m WHERE m.id_mesa = $1 FOR UPDATE',
      [id]
    );
    const mesa = actual.rows[0];
    if (!mesa) {
      await client.query('ROLLBACK');
      return null;
    }

    if (mesa.estado === ESTADO_MESA_OCUPADA) {
      await client.query('ROLLBACK');
      throw errorDeMesa(409, MENSAJE_OCUPADA_NO_SE_BORRA);
    }

    // TODOS los pedidos, no solo los abiertos: el RESTRICT de la FK no
    // distingue estados, así que uno pagado de hace un mes impide el borrado
    // igual que uno en curso. Y con razón: borrar la mesa dejaría el histórico
    // de pedidos sin a qué mesa pertenecía.
    const conteo = await client.query(
      'SELECT count(*)::int AS pedidos FROM pedidos WHERE id_mesa = $1',
      [id]
    );
    const pedidos = conteo.rows[0] ? conteo.rows[0].pedidos : null;
    // Si el conteo no se puede leer NO se borra: es más seguro negar el borrado
    // que llevarse por delante el historial de una mesa.
    if (typeof pedidos !== 'number' || pedidos > 0) {
      await client.query('ROLLBACK');
      throw errorDeMesa(409, MENSAJE_CON_PEDIDOS);
    }

    const result = await client.query(
      'DELETE FROM mesas WHERE id_mesa = $1 RETURNING id_mesa',
      [id]
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ya estaba cerrada.
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ESTADOS_MESA,
  ESTADO_MESA_LIBRE,
  ESTADO_MESA_OCUPADA,
  abrirSesion,
  rotarQr,
  rotarQrInterno,
  liberarSesion,
  liberarSiNoQuedanPedidosAbiertos,
  existe,
  cuentaInterna,
  cuentaPorComensal,
  tokenQrDeMesa,
  MONEDA,
  listar,
  obtenerPorId,
  crear,
  actualizarEstado,
  actualizarDatos,
  eliminar,
  MENSAJE_NUMERO_EN_USO,
  MENSAJE_OCUPADA_NO_SE_RENUMERA,
  MENSAJE_OCUPADA_NO_SE_DESACTIVA,
  MENSAJE_INACTIVA,
  MOTIVO_MESA_OCUPADA,
  MOTIVO_MESA_INACTIVA,
  traducirMesaActiva,
  MENSAJE_OCUPADA_NO_SE_BORRA,
  MENSAJE_CON_PEDIDOS,
};
