const jwt = require('jsonwebtoken');
const { z } = require('zod');
const mesasService = require('../services/mesas.service');
const { ROL_COMENSAL } = require('../middleware/auth.middleware');
const socketNotifier = require('../services/socket.notifier');
const { extraerSid } = require('../services/qr.token');

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

/** URL que se codifica en el QR impreso de la mesa. */
function urlDelComensal(token) {
  const base = (process.env.FRONTEND_CLIENTE_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/?token=${encodeURIComponent(token)}`;
}

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
    if (!r.reutilizado) socketNotifier.notificarQrRotado(idMesa, r.token);

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
 * Emite un JWT { id_mesa, sid, rol: 'comensal' }. El sid viene del propio token
 * y es lo que ata la sesión a ese QR (ver el middleware).
 */
async function crearSesionPorToken(req, res, next) {
  const tokenQr = req.params.token;

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

    const token = jwt.sign(
      { id_mesa: mesa.id_mesa, sid, rol: ROL_COMENSAL },
      process.env.JWT_SECRET,
      { expiresIn: COMENSAL_EXPIRES_IN }
    );

    return res.status(201).json({
      token,
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

async function eliminar(req, res, next) {
  try {
    const eliminada = await mesasService.eliminar(req.params.id);
    if (!eliminada) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listar,
  obtener,
  abrir,
  liberar,
  crearSesionPorToken,
  crear,
  actualizarEstado,
  eliminar,
};
