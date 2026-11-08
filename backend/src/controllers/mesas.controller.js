const jwt = require('jsonwebtoken');
const { z } = require('zod');
const mesasService = require('../services/mesas.service');
const { ALGORITMO_JWT, ROL_COMENSAL } = require('../middleware/auth.middleware');
const socketNotifier = require('../services/socket.notifier');
const { extraerSid } = require('../services/qr.token');
const aliasComensal = require('../services/alias-comensal');
// El enlace del QR se arma aparte: en desarrollo lleva la IP de la LAN para que
// el celular del comensal pueda abrirlo (ver src/utils/url-comensal.js).
const { urlDelComensal } = require('../utils/url-comensal');

// Vigencia de la sesión del comensal: una estadía en la mesa (3 h por defecto).
const COMENSAL_EXPIRES_IN = process.env.JWT_COMENSAL_EXPIRES_IN || '3h';

// Mensajes por motivo de rechazo de /qr/validar del socket-server.
const MENSAJE_MOTIVO = {
  expirado: 'El QR de la mesa expiró, pide uno nuevo al mesero',
  revocado: 'La sesión de esa mesa ya se cerró, escanea el QR nuevo',
  formato: 'Token de mesa inválido',
  firma: 'Token de mesa inválido',
};

/**
 * Mesa tal como sale en las respuestas de la API.
 *
 * token_qr NUNCA se incluye: es la credencial con la que se abre la sesión de la
 * mesa, así que quien lo tenga puede pedir a nombre de ese grupo. Solo viaja en
 * la respuesta de POST /mesas/:id/abrir, que es quien lo necesita para imprimir
 * el QR, y solo a mesero/admin.
 */
function vistaMesa(mesa) {
  return {
    id_mesa: mesa.id_mesa,
    numero: mesa.numero,
    capacidad: mesa.capacidad,
    ubicacion: mesa.ubicacion,
    estado: mesa.estado,
  };
}

/**
 * Vista para el personal. Agrega si la mesa tiene una sesión de QR abierta, que
 * es lo único que el panel de sala necesita saber del token: para volver a
 * mostrar el QR llama a POST /mesas/:id/abrir, que es idempotente y devuelve el
 * mismo token. Así el token no aparece en un listado que se pinta en pantalla,
 * se cachea y acaba en logs.
 */
function vistaMesaPersonal(mesa) {
  return { ...vistaMesa(mesa), sesion_abierta: Boolean(mesa.token_qr) };
}

/**
 * Cuerpo de PATCH /mesas/:id (D-16): los datos del mobiliario.
 *
 * Es un esquema aparte de mesaSchema y no su `.partial()`: aqui `estado` y
 * `token_qr` NO se aceptan. El estado tiene su propia ruta (y sus propios
 * permisos, que incluyen a mesero y cajero) y el token_qr es una credencial que
 * solo escribe el flujo de apertura de sesion. Con `.strict()`, mandarlos es
 * 400 y no un cambio que se ignora en silencio.
 *
 * `.refine`: un cuerpo vacio no es una edicion.
 */
const mesaDatosSchema = z
  .object({
    numero: z.number().int().positive(),
    capacidad: z.number().int().positive(),
    ubicacion: z.string().min(1).max(50),
  })
  .partial()
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Indica al menos un campo: numero, capacidad o ubicacion',
  });

const mesaSchema = z.object({
  numero: z.number().int().positive(),
  capacidad: z.number().int().positive().optional(),
  ubicacion: z.string().optional(),
  estado: z.enum(mesasService.ESTADOS_MESA).optional(),
  token_qr: z.string().optional(),
});

async function listar(req, res, next) {
  try {
    const mesas = await mesasService.listar();
    return res.json({ mesas: mesas.map(vistaMesaPersonal) });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const mesa = await mesasService.obtenerPorId(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    // Ruta pública: sin token_qr.
    return res.json(vistaMesa(mesa));
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/mesas/:id/abrir — el mesero abre la mesa y obtiene su QR.
 *
 * Idempotente: dos meseros pulsando "abrir" a la vez reciben el mismo token
 * (ver mesasService.abrirSesion, que bloquea la fila de la mesa).
 *
 * Devuelve la url ya armada para mostrar el QR, para que la sala no tenga que
 * saber cómo se construye.
 *
 * Modelo "QR en vidrio" (opción A): cuando el token es NUEVO se avisa al
 * socket-server para que la tablet de la mesa lo muestre. Si se reutiliza el de
 * una mesa que ya estaba ocupada NO se avisa: la tablet ya está mostrando ese
 * mismo QR y reenviarlo solo haría parpadear la pantalla.
 */
async function abrir(req, res, next) {
  const idMesa = Number(req.params.id);
  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    return res.status(400).json({ error: 'id de mesa inválido' });
  }

  try {
    // El JWT del mesero se reenvía a /qr/generar: el socket-server decide si su
    // rol puede generar QR, en vez de que el backend lo suplante.
    const jwtStaff = (req.headers.authorization || '').replace(/^Bearer /, '');
    const r = await mesasService.abrirSesion(idMesa, { jwtStaff });

    if (r.noExiste) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (r.socketCaido) {
      return res.status(503).json({
        error: 'No se pudo obtener el QR: el servicio de tiempo real no responde',
        motivo: r.motivo,
      });
    }
    if (r.rechazado) {
      return res.status(r.status === 403 ? 403 : 502).json({ error: r.mensaje });
    }

    // Después del commit (abrirSesion ya cerró su transacción) y aislado: si el
    // socket-server falla, la mesa queda abierta igual.
    if (!r.reutilizado) {
      socketNotifier.notificarQrRotado(idMesa, r.token);
      // Sesión nueva: los alias del grupo anterior quedan libres.
      aliasComensal.olvidarMesa(idMesa);
    }

    return res.status(201).json({
      token: r.token,
      url: urlDelComensal(r.token),
      reutilizado: r.reutilizado,
      mesa: {
        id_mesa: r.mesa.id_mesa,
        numero: r.mesa.numero,
        estado: r.mesa.estado,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/mesas/:id/cuenta/interno — la llama el socket-server de Roberto con
 * x-internal-key, no un navegador (EVENTS.md §8.2).
 *
 * Es la cuenta que el comensal ve antes de pagar: total y saldo de la mesa en
 * centavos, y cuánto debe cada alias. Los montos los calcula la base; aquí no
 * se suma nada.
 */
async function cuentaInterna(req, res, next) {
  const idMesa = Number(req.params.id);
  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    return res.status(400).json({ error: 'id de mesa inválido' });
  }

  try {
    const cuenta = await mesasService.cuentaInterna(idMesa);
    if (!cuenta) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(cuenta);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/mesas/:id/cuenta — la cuenta de la mesa para el personal.
 *
 * Es la misma cuenta que ve el comensal (GET /api/pedidos/mesa/cuenta), con los
 * montos en PESOS: la leen personas. La variante en centavos es
 * /cuenta/interno, que consume el socket-server.
 *
 * El desglose por comensal lo calcula obtener_cuenta_mesa_json: aquí no se suma
 * ni se reparte nada.
 */
async function cuenta(req, res, next) {
  const idMesa = Number(req.params.id);
  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    return res.status(400).json({ error: 'id de mesa inválido' });
  }

  try {
    const cuentaMesa = await mesasService.cuentaPorComensal(idMesa);
    if (!cuentaMesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(cuentaMesa);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/mesas/:id/rotar-qr — el mesero cambia el QR de una mesa abierta
 * (p. ej. porque alguien fotografió la tablet).
 *
 * Reemplaza a la llamada que el panel hacía directo a /internal/qr-rotado con
 * la clave interna en el navegador: ahora el panel solo usa su JWT y es el
 * backend quien, después del commit, avisa al socket-server.
 *
 * El token viaja únicamente dentro de `url`, que es lo que el panel necesita
 * para dibujar el QR; no se repite en otros campos para no multiplicar los
 * sitios donde puede quedar copiado (logs, caché, herramientas de depuración).
 */
async function rotarQr(req, res, next) {
  const idMesa = Number(req.params.id);
  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    return res.status(400).json({ error: 'id de mesa inválido' });
  }

  try {
    const jwtStaff = (req.headers.authorization || '').replace(/^Bearer /, '');
    const r = await mesasService.rotarQr(idMesa, { jwtStaff });

    if (r.noExiste) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (r.noOcupada) {
      return res.status(409).json({ error: 'Solo se puede rotar el QR de una mesa abierta (ocupada)', estado: r.estado });
    }
    if (r.socketCaido) {
      return res.status(503).json({
        error: 'No se pudo rotar el QR: el servicio de tiempo real no responde',
        motivo: r.motivo,
      });
    }
    if (r.rechazado) {
      return res.status(r.status === 403 ? 403 : 502).json({ error: r.mensaje });
    }

    // Después del commit y aislado: si el aviso falla, el token nuevo ya es el
    // vigente y el mesero puede volver a mostrar el QR desde el panel.
    socketNotifier.notificarQrRotado(idMesa, r.token);

    return res.status(201).json({
      url: urlDelComensal(r.token),
      expira_en: r.expira_en,
      mesa: { id_mesa: r.mesa.id_mesa, numero: r.mesa.numero, estado: r.mesa.estado },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/mesas/:id/liberar — el mesero cierra la mesa.
 *
 * Deja la mesa 'disponible' y token_qr en NULL, con lo que el QR anterior deja
 * de servir y las sesiones de comensal de ese grupo caen en el middleware.
 *
 * Es solo para grupos que se van SIN PEDIR: con pedidos abiertos responde 409 y
 * no cambia nada. Cuando se cobran o cancelan, la mesa se libera sola.
 */
async function liberar(req, res, next) {
  const idMesa = Number(req.params.id);
  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    return res.status(400).json({ error: 'id de mesa inválido' });
  }

  try {
    const r = await mesasService.liberarSesion(idMesa);

    if (r.noExiste) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (r.pedidosAbiertos) {
      return res.status(409).json({
        error: 'La mesa tiene pedidos abiertos; cóbralos o cancélalos antes de liberarla',
        pedidos_abiertos: r.pedidosAbiertos,
      });
    }

    // Después del commit y aislado: si el socket-server falla, la mesa ya quedó
    // liberada en la base y no se revierte (el notifier no lanza).
    socketNotifier.notificarMesaLiberada(idMesa);
    aliasComensal.olvidarMesa(idMesa);

    return res.json({
      id_mesa: r.mesa.id_mesa,
      numero: r.mesa.numero,
      estado: r.mesa.estado,
      token_qr: null,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/mesas/qr/:token/sesion — punto de entrada del comensal.
 *
 * Doble comprobación, porque cada una cubre algo distinto:
 *  1. /qr/validar del socket-server: que el token esté bien firmado y no haya
 *     expirado (la firma y la vigencia son suyas, no nuestras).
 *  2. Que sea idéntico al guardado en mesas.token_qr: así un QR de una sesión
 *     anterior, aunque siga siendo válido y firmado, no sirve una vez que la
 *     mesa se liberó o se le generó otro.
 *
 * Emite un JWT { id_mesa, sid, rol: 'comensal', comensal }. El sid viene del
 * propio token y es lo que ata la sesión a ese QR (ver el middleware).
 *
 * Body: { "comensal": "Ana" }. El alias se valida, se reserva (único en la
 * sesión de la mesa: 409 si ya lo tiene otro) y va FIRMADO en el JWT: el
 * socket-server solo cree ese, así nadie edita, quita o paga como otro
 * comensal (ver services/alias-comensal.js).
 */
async function crearSesionPorToken(req, res, next) {
  const tokenQr = req.params.token;
  const alias = aliasComensal.normalizarAlias(req.body && req.body.comensal);
  if (alias.error) return res.status(400).json({ error: alias.error, campo: 'comensal' });

  try {
    const veredicto = await socketNotifier.validarTokenQr(tokenQr);

    if (!veredicto.alcanzado) {
      return res.status(503).json({
        error: 'No se pudo validar el QR: el servicio de tiempo real no responde',
        motivo: veredicto.motivo,
      });
    }
    if (!veredicto.valido) {
      return res.status(401).json({
        error: MENSAJE_MOTIVO[veredicto.motivo] || 'Token de mesa inválido',
        motivo: veredicto.motivo,
      });
    }

    const mesa = await mesasService.obtenerPorId(veredicto.id_mesa);
    if (!mesa) return res.status(401).json({ error: 'Token de mesa inválido', motivo: 'mesa_inexistente' });

    if (!mesa.token_qr || mesa.token_qr !== tokenQr) {
      return res.status(401).json({
        error: 'Ese QR ya no es el vigente de la mesa, escanea el QR actual',
        motivo: mesa.token_qr ? 'no_es_el_vigente' : 'mesa_sin_sesion',
      });
    }

    const sid = extraerSid(tokenQr);
    if (!sid) {
      return res.status(401).json({ error: 'Token de mesa inválido', motivo: 'formato' });
    }

    // Al final, con el QR ya validado: un QR inválido no gasta alias.
    const reserva = await aliasComensal.reservar(mesa.id_mesa, alias, { vigencia: COMENSAL_EXPIRES_IN });
    if (reserva.enUso) {
      return res.status(409).json({
        error: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
        motivo: 'alias_en_uso',
      });
    }
    if (reserva.noDisponible) {
      return res.status(503).json({ error: 'No se pudo abrir la sesión, intenta de nuevo en unos segundos', motivo: 'alias_no_disponible' });
    }

    const token = jwt.sign(
      { id_mesa: mesa.id_mesa, sid, rol: ROL_COMENSAL, comensal: alias.alias },
      process.env.JWT_SECRET,
      // Algoritmo explícito, el mismo que exige requireAuth (ver ALGORITMO_JWT).
      { algorithm: ALGORITMO_JWT, expiresIn: COMENSAL_EXPIRES_IN }
    );

    return res.status(201).json({
      token,
      comensal: alias.alias,
      expira_en: COMENSAL_EXPIRES_IN,
      qr_expira_en: veredicto.expira_en ?? null,
      mesa: {
        id_mesa: mesa.id_mesa,
        numero: mesa.numero,
        capacidad: mesa.capacidad,
        ubicacion: mesa.ubicacion,
        estado: mesa.estado,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  const parsed = mesaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const mesa = await mesasService.crear(parsed.data);
    return res.status(201).json(vistaMesaPersonal(mesa));
  } catch (err) {
    return next(err);
  }
}

async function actualizarEstado(req, res, next) {
  const parsed = mesaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const mesa = await mesasService.actualizarEstado(req.params.id, parsed.data.estado);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(vistaMesaPersonal(mesa));
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/mesas/:id — numero, capacidad y ubicacion (D-16). Solo admin.
 *
 * Los 409 (numero repetido, mesa ocupada que no se renumera) los decide el
 * service y llegan aqui como { status, message }, que el manejador central ya
 * sabe responder: por eso solo se hace next(err).
 */
async function actualizarDatos(req, res, next) {
  const parsed = mesaDatosSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const mesa = await mesasService.actualizarDatos(req.params.id, parsed.data);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(vistaMesaPersonal(mesa));
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const eliminada = await mesasService.eliminar(req.params.id);
    if (!eliminada) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

/* -------------------------------------------------------------------------- *
 * Comensales sin celular (D-18)
 *
 * Alguien de la mesa no tiene teléfono: el mesero (o el admin) lo da de alta con
 * su alias y pide por esa persona. A partir de ahí cuenta como persona para la
 * presencia y para "igual", y puede pagar en caja con su alias.
 *
 * NO hay tabla nueva ni cambios en database/: la persona sin celular vive en la
 * MISMA reserva de alias que usan las sesiones de QR (`sd:mesa:{id}:alias`), con
 * la misma función de validación. Dos formas de validar el alias en el mismo
 * proyecto acabarían aceptando en una lo que la otra rechaza, y entonces la
 * unicidad —que es lo que impide cobrarle los platos a otro— dejaría de valerlo.
 * -------------------------------------------------------------------------- */

/** Mensajes de los 409 del socket-server, traducidos para quien está en sala. */
const MENSAJE_POR_CODIGO_SOCKET = {
  ALIAS_EN_USO: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
  MESA_LIBERADA: 'Esa mesa ya no tiene una sesión abierta, vuelve a abrirla',
  LIMITE_COMENSALES: 'Esa mesa ya tiene el máximo de personas sin celular',
};

/** Entero positivo de la URL, o null. Mismo criterio que el resto de la API. */
function idMesaDeLaUrl(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * ¿Ese comensal tiene platos en la cuenta de la mesa?
 *
 * Se compara por CLAVE del alias, no por el texto: la cuenta agrupa por
 * `btrim(dp.comensal)` (función `obtener_cuenta_mesa`), que distingue
 * mayúsculas y tildes, así que "Ana" y "ana" salen como dos filas. Si se
 * comparara el texto, quitar a "ana" dejaría pasar el borrado aunque hubiera
 * platos cargados a "Ana" —la misma persona— y esos platos quedarían sin dueño
 * a la hora de dividir la cuenta.
 *
 * Se cuentan los platos, no el saldo: una persona que ya pagó lo suyo sigue
 * teniendo sus platos en la cuenta, y quitarla del listado desarmaría el
 * desglose por comensal que el cajero tiene delante.
 */
function tienePlatosEnLaCuenta(cuentaMesa, clave) {
  const comensales = (cuentaMesa && cuentaMesa.comensales) || [];
  return comensales.some((fila) => {
    const normalizado = aliasComensal.normalizarAlias(fila && fila.comensal);
    if (normalizado.error || normalizado.clave !== clave) return false;
    return Number(fila.items_pedidos) > 0;
  });
}

/**
 * POST /api/mesas/:id/comensales — dar de alta a alguien sin celular (D-18).
 *
 * Orden de las comprobaciones, que es parte del contrato:
 *   1. alias válido (400)
 *   2. la mesa existe (404)
 *   3. la mesa tiene sesión viva (409) — ANTES de reservar, para no dejar un
 *      alias reservado en una mesa que nadie va a usar
 *   4. reservar el alias (409 si ya está en uso, 503 si no hay Redis)
 *   5. avisar al socket-server
 *
 * El aviso SÍ se espera aquí, al contrario que el resto de los avisos de este
 * controlador, y es a propósito: el contrato (§6.4) pide que un 409 del
 * socket-server suelte el alias que se acaba de reservar, y eso no se puede
 * decidir sin mirar la respuesta. No rompe el aislamiento del tiempo real: si el
 * socket-server no está, tarda o devuelve cualquier otra cosa, el alta sigue
 * siendo un 201, porque la reserva ya está hecha y el backend es la fuente de
 * verdad. Lo único que cambia la respuesta es un 409, que es una regla de
 * negocio, no una falla de transporte.
 */
async function agregarComensal(req, res, next) {
  const idMesa = idMesaDeLaUrl(req.params.id);
  if (idMesa === null) return res.status(400).json({ error: 'id de mesa inválido' });

  const alias = aliasComensal.normalizarAlias(req.body && req.body.alias);
  if (alias.error) return res.status(400).json({ error: alias.error, campo: 'alias' });

  try {
    const mesa = await mesasService.obtenerPorId(idMesa);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    // Equivale al 409 MESA_LIBERADA del socket (§6.4), pero lo decide el
    // backend: sin sesión abierta no hay mesa a la que sentar a nadie, y el
    // alias se borra al liberar, así que la reserva se perdería igual.
    if (mesa.estado !== mesasService.ESTADO_MESA_OCUPADA) {
      return res.status(409).json({
        error: 'Esa mesa no tiene una sesión abierta: ábrela antes de agregar comensales',
        motivo: 'mesa_sin_sesion',
      });
    }

    const reserva = await aliasComensal.reservar(idMesa, alias, {
      // La vigencia vive en alias-comensal.js, que es quien tiene que coincidir
      // con el TTL del socket-server.
      vigencia: aliasComensal.VIGENCIA_SIN_CELULAR,
      // La MARCA: es lo que permite distinguir después a esta persona de alguien
      // que entró con su celular por el QR. Sin ella, el DELETE del personal
      // podría tirar la sesión de un comensal conectado.
      extra: { [aliasComensal.MARCA_SIN_CELULAR]: true },
    });
    if (reserva.enUso) {
      return res.status(409).json({
        error: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
        motivo: 'alias_en_uso',
      });
    }
    if (reserva.noDisponible) {
      // Mismo comportamiento que las sesiones de QR: sin reserva fiable no se
      // da de alta a nadie, porque una mesa sin unicidad de alias permite
      // cargarle los platos a otra persona.
      return res.status(503).json({
        error: 'No se pudo agregar al comensal, intenta de nuevo en unos segundos',
        motivo: 'alias_no_disponible',
      });
    }

    const aviso = await socketNotifier.notificarMesaComensal(
      idMesa,
      // El alias normalizado, no lo que escribió el mesero: es el texto con el
      // que habrá que quitarlo después (§6.4 compara idéntico).
      alias.alias,
      'agregar',
      alias.clave
    );

    const codigo = aviso && aviso.respuesta && aviso.respuesta.codigo;
    if (aviso && aviso.motivo === 'HTTP_409') {
      // Guardia del socket-server: suelta el alias para no dejar una reserva sin
      // presencia (nadie podría volver a usar ese nombre y la persona no
      // aparecería en la mesa).
      await aliasComensal.liberar(idMesa, alias.clave);
      return res.status(409).json({
        error: MENSAJE_POR_CODIGO_SOCKET[codigo] || 'No se pudo agregar al comensal en esa mesa',
        motivo: codigo || 'rechazado_por_el_socket',
      });
    }

    return res.status(201).json({ id_mesa: idMesa, alias: alias.alias });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/mesas/:id/comensales/:alias — quitar a alguien sin celular.
 *
 * Comprueba, EN ESTE ORDEN:
 *   1. que la mesa exista (404);
 *   2. que ese alias sea de un comensal SIN CELULAR (409 si es de alguien que
 *      entró por QR). Va antes de todo lo demás porque es lo único que protege
 *      la sesión de un comensal conectado: soltar su reserva dejaría su nombre
 *      libre para otro, que heredaría sus platos;
 *   3. que no tenga platos (409);
 *   4. soltar la reserva (503 si Redis no responde).
 *
 * Un alias que NO está reservado se trata como un borrado idempotente: 204. No
 * hay nada que soltar, y pedir dos veces que se quite a la misma persona no es
 * un error (es también lo que hace §6.4 con un 'quitar' de quien no está).
 *
 * El aviso de 'quitar' NO se espera: aquí no hay nada que decidir con su
 * respuesta —el alias ya está suelto en el backend, que es la fuente de verdad—
 * y esperar un socket-server caído retrasaría la respuesta del mesero 1,5 s por
 * nada. Va por la cadena de la mesa, así que nunca se adelanta a un 'agregar'
 * anterior de esa misma mesa.
 */
async function quitarComensal(req, res, next) {
  const idMesa = idMesaDeLaUrl(req.params.id);
  if (idMesa === null) return res.status(400).json({ error: 'id de mesa inválido' });

  const alias = aliasComensal.normalizarAlias(req.params.alias);
  if (alias.error) return res.status(400).json({ error: alias.error, campo: 'alias' });

  try {
    const cuentaMesa = await mesasService.cuentaPorComensal(idMesa);
    if (!cuentaMesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const marca = await aliasComensal.esSinCelular(idMesa, alias.clave);
    if (marca.noDisponible) {
      return res.status(503).json({
        error: 'No se pudo quitar al comensal, intenta de nuevo en unos segundos',
        motivo: 'alias_no_disponible',
      });
    }
    if (marca.sinCelular === false) {
      // Reservado pero sin la marca: es la sesión de alguien que entró con su
      // celular, o una reserva de antes de que la marca existiera. En los dos
      // casos no se toca desde aquí.
      return res.status(409).json({
        error: 'Esa persona entró con su celular: su sesión no se puede quitar desde aquí',
        motivo: 'comensal_con_sesion',
      });
    }

    if (marca.noExiste) {
      // Nada que soltar. Se avisa igual al socket-server, por si allí sí quedó
      // en la lista (su TTL y el de aquí son dos relojes distintos).
      socketNotifier.notificarMesaComensal(idMesa, alias.alias, 'quitar', alias.clave);
      return res.status(204).send();
    }

    if (tienePlatosEnLaCuenta(cuentaMesa, alias.clave)) {
      return res.status(409).json({
        error: 'Esa persona ya tiene platos en la cuenta: no se puede quitar de la mesa',
        motivo: 'comensal_con_platos',
      });
    }

    const suelta = await aliasComensal.liberar(idMesa, alias.clave);
    if (suelta.noDisponible) {
      return res.status(503).json({
        error: 'No se pudo quitar al comensal, intenta de nuevo en unos segundos',
        motivo: 'alias_no_disponible',
      });
    }

    socketNotifier.notificarMesaComensal(idMesa, alias.alias, 'quitar', alias.clave);

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  agregarComensal,
  quitarComensal,
  actualizarDatos,
  listar,
  obtener,
  abrir,
  rotarQr,
  cuentaInterna,
  cuenta,
  liberar,
  crearSesionPorToken,
  crear,
  actualizarEstado,
  eliminar,
};
