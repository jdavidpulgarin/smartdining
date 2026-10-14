const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const usuariosService = require('../services/usuarios.service');
const { ROLES_STAFF } = require('../middleware/auth.middleware');

// Solo se registran usuarios del personal: admin, mesero, cajero, cocina.
// El comensal NO se registra — obtiene su sesión escaneando el QR de la mesa
// (POST /api/mesas/qr/:token/sesion) y su rol solo existe dentro del JWT.
// La tabla usuarios no tiene telefono (ver docs/modelo-er.md).
const registerSchema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  rol: z.enum(ROLES_STAFF),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

/**
 * Costo de bcrypt. Es el que usa `register` y el mismo con el que se generaron
 * los hashes del seed de Jarrison (todos con prefijo `$2b$10$`, comprobado en
 * database/seed.sql y en la tabla usuarios). Que coincida es lo que hace que el
 * hash ficticio de abajo cueste exactamente lo mismo que uno real: con otro
 * costo, el tiempo de respuesta volvería a delatar si el email existe.
 */
const COSTO_BCRYPT = 10;

/**
 * H-12: hash contra el que se compara cuando el email NO existe (o la cuenta
 * está inactiva), para que el login tarde lo mismo en los tres casos.
 *
 * Antes un email inexistente respondía en ~3 ms y uno existente en ~70 ms,
 * porque solo el segundo llegaba a bcrypt. Esa diferencia permitía recorrer una
 * lista de correos y quedarse con los que sí tienen cuenta, sin acertar una
 * sola contraseña.
 *
 * Sale de una cadena ALEATORIA que no se guarda en ninguna parte: no es la
 * huella de ninguna contraseña, ni real ni conocida, así que no existe una
 * contraseña que haga que esta comparación dé `true`. Y aunque la diera, la
 * decisión no se apoya en ella: sin usuario se rechaza siempre (ver `login`).
 *
 * Se calcula UNA vez al cargar el módulo (~70 ms al arrancar) y no por
 * petición: hashear en cada login duplicaría el trabajo de bcrypt y el login
 * legítimo tardaría el doble.
 */
const HASH_FICTICIO = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), COSTO_BCRYPT);

/**
 * H-12: un solo mensaje y un solo código para los tres casos —email que no
 * existe, cuenta inactiva y contraseña incorrecta—. Distinguirlos le decía al
 * atacante cuáles de sus correos son cuentas reales; a quien de verdad se
 * equivocó de contraseña no le aporta nada saber cuál de las tres fue.
 *
 * La cuenta desactivada se explica en el middleware (H-09), donde ya hay un JWT
 * válido y por tanto no hay nada que enumerar.
 */
const MENSAJE_CREDENCIALES = 'Credenciales inválidas';

function firmarTokenStaff(usuario) {
  return jwt.sign(
    { id_usuario: usuario.id_usuario, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

/**
 * POST /api/auth/register — solo un admin autenticado puede crear usuarios
 * (la restricción de rol se aplica en las rutas, ver auth.routes.js).
 */
async function register(req, res, next) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { nombre, email, password, rol } = parsed.data;

  try {
    const existente = await usuariosService.buscarPorEmail(email);
    if (existente) {
      return res.status(400).json({ error: 'Ese email ya está registrado' });
    }

    const password_hash = await bcrypt.hash(password, COSTO_BCRYPT);
    const usuario = await usuariosService.crear({ nombre, email, password_hash, rol });

    return res.status(201).json({ usuario });
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { email, password } = parsed.data;

  try {
    const usuario = await usuariosService.buscarPorEmail(email);

    // H-12: se compara SIEMPRE, exista el usuario o no, y antes de mirar si la
    // cuenta está activa. Eso es lo que iguala el tiempo: los tres caminos
    // pagan un bcrypt del mismo costo. El `||` cubre también a un usuario sin
    // hash en la base, que si no reventaría bcrypt y delataría el caso.
    const hashConQueComparar = (usuario && usuario.password_hash) || HASH_FICTICIO;
    const passwordOk = await bcrypt.compare(password, hashConQueComparar);

    // La decisión NO depende de lo que dé la comparación con el ficticio: si no
    // hay usuario se rechaza pase lo que pase, y lo mismo si está inactivo.
    // Un solo código y un solo mensaje para los tres casos.
    if (!usuario || !usuario.activo || !passwordOk) {
      return res.status(401).json({ error: MENSAJE_CREDENCIALES });
    }

    return res.json({
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
      token: firmarTokenStaff(usuario),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, COSTO_BCRYPT, MENSAJE_CREDENCIALES };
