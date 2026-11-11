const bcrypt = require('bcrypt');
const { z } = require('zod');
const usuariosService = require('../services/usuarios.service');
const usuarioActivo = require('../services/usuario-activo');
const { ROLES_STAFF } = require('../middleware/auth.middleware');
const { conTopeDeBcrypt, cuerpoDel400 } = require('../utils/clave-bcrypt');
// El MISMO costo con el que hashea el registro. Importado y no copiado: dos
// costos distintos en el proyecto producen hashes que el login sí reconoce pero
// que cuestan tiempos distintos, y eso es justo lo que H-12 quiere evitar.
const { COSTO_BCRYPT } = require('./auth.controller');

/**
 * Administración de usuarios del personal (D-16, parte A). Todo es de `admin`:
 * la restricción de rol se aplica en las rutas (ver usuarios.routes.js).
 *
 * Los roles válidos son ROLES_STAFF, los mismos que acepta el registro y los
 * mismos del CHECK de la tabla: `comensal` no está, porque no es una fila de
 * `usuarios` sino un rol que solo existe dentro del JWT de una mesa.
 */

/**
 * Cuerpo de PATCH /usuarios/:id.
 *
 * `.strict()`: una clave de más es 400. Sin esto, un panel que reenviara la fila
 * entera colaría `email`, `rol` o incluso `password_hash` en un endpoint que no
 * los acepta, y el `COALESCE` del UPDATE los ignoraría en silencio: quien llama
 * creería haber cambiado algo que no cambió.
 *
 * El `email` queda FUERA a propósito: es la credencial con la que se entra y la
 * clave de unicidad de la tabla. Cambiarlo es dar de alta otra identidad, no
 * editar un perfil, y merece su propio endpoint cuando haga falta.
 *
 * `.refine`: un cuerpo vacío `{}` no es una edición, es una llamada perdida.
 */
const actualizarSchema = z
  .object({
    nombre: z.string().min(2).max(100),
    rol: z.enum(ROLES_STAFF),
    activo: z.boolean(),
  })
  .partial()
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Indica al menos un campo: nombre, rol o activo',
  });

/**
 * Cuerpo de POST /usuarios/:id/clave.
 *
 * Mínimo 8 CARACTERES, más que los 6 del registro: en el registro el mínimo lo
 * fija un contrato que ya está publicado, y bajarlo aquí para igualarlo sería
 * empeorar a propósito.
 *
 * Máximo 72 BYTES, no 72 caracteres, porque es por bytes como trunca bcrypt: a
 * partir del byte 72 ignora el resto en silencio. Y la diferencia no es teórica
 * en español: una `ñ` o una tilde ocupan DOS bytes en UTF-8, así que
 * "contraseña" de 40 caracteres puede pasarse de 72 bytes. Con `.max(72)` de zod
 * —que cuenta caracteres— esa clave entraría, bcrypt la cortaría por la mitad y
 * el usuario tendría una contraseña que no es la que escribió. Rechazarla es
 * mejor que cortarla sin avisar.
 */
const claveSchema = z
  .object({
    // El tope de 72 bytes es la regla común de utils/clave-bcrypt.js, la misma
    // que usa el registro.
    password: conTopeDeBcrypt(z.string().min(8, 'La clave debe tener al menos 8 caracteres')),
  })
  .strict();

/** Entero positivo de la URL, o null si no lo es. Igual que en platos. */
function idDeLaUrl(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Olvida lo que la caché sepa del usuario (H-09).
 *
 * Sin esto, desactivar a alguien o quitarle el rol tarda hasta el TTL (60 s por
 * defecto) en surtir efecto, porque `estaActivo` contesta desde Redis sin
 * preguntarle a la base. Un cambio de clave también invalida: quien está dentro
 * con el token viejo no debería seguir pasando por una respuesta cacheada.
 *
 * NUNCA tumba la petición: el cambio ya está guardado y PostgreSQL es la fuente
 * de verdad. Si Redis no responde, `olvidar` devuelve false y lo único que pasa
 * es que el cambio tarda el TTL en verse, que es el comportamiento de antes.
 */
async function olvidarEnCache(idUsuario) {
  try {
    await usuarioActivo.olvidar(idUsuario);
  } catch {
    // Ignorado a propósito: la caché no decide nada.
  }
}

/** GET /api/usuarios — la lista del panel, sin el hash de la clave. */
async function listar(req, res, next) {
  try {
    const usuarios = await usuariosService.listar();
    return res.json({ usuarios });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /api/usuarios/:id — nombre, rol y activo. */
async function actualizar(req, res, next) {
  const id = idDeLaUrl(req.params.id);
  if (id === null) return res.status(400).json({ error: 'El id debe ser un entero positivo' });

  const parsed = actualizarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const usuario = await usuariosService.actualizar(id, parsed.data, {
      // requireAuth deja el payload del JWT en req.user (ver auth.middleware).
      idUsuarioQuePide: req.user.id_usuario,
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Se invalida tras el COMMIT y solo si cambió algo que el middleware mira.
    // Antes del COMMIT sería peor que no hacerlo: una petición en vuelo podría
    // volver a cachear el valor viejo justo antes de que el cambio se guarde.
    if (parsed.data.activo !== undefined || parsed.data.rol !== undefined) {
      await olvidarEnCache(id);
    }

    return res.json({ usuario });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/usuarios/:id/clave — clave nueva, con el hash del registro. */
async function cambiarClave(req, res, next) {
  const id = idDeLaUrl(req.params.id);
  if (id === null) return res.status(400).json({ error: 'El id debe ser un entero positivo' });

  const parsed = claveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(cuerpoDel400(parsed.error));

  try {
    const password_hash = await bcrypt.hash(parsed.data.password, COSTO_BCRYPT);
    const usuario = await usuariosService.cambiarClave(id, password_hash);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    await olvidarEnCache(id);

    return res.json({ usuario });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, actualizar, cambiarClave, actualizarSchema, claveSchema };
