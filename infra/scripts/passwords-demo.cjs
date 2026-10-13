/**
 * Contraseñas de los usuarios del personal en PRODUCCIÓN.
 *
 * No se usa directamente: lo llama infra/scripts/passwords-demo.sh, que lo
 * ejecuta DENTRO del contenedor backend (`node -e`) para usar su pg, su
 * bcrypt y sus variables PG*, sin tocar el código del backend.
 *
 *   SD_PASSWORDS=verificar  stdin: hashes publicados en el repositorio (uno por línea)
 *   SD_PASSWORDS=cambiar    stdin: 1.ª línea la contraseña nueva; después, los hashes
 *
 * La contraseña llega por stdin y no por argumento ni variable: así no aparece
 * en `ps`, en `docker inspect` ni en el historial de la shell.
 *
 * Un usuario es INSEGURO si su hash está escrito en el repositorio (cualquiera
 * puede probarlo sin conexión) o si su contraseña es una conocida, empezando
 * por Admin123! (backend/scripts/fijar-password-demo.sql). El despliegue no
 * publica el sitio mientras quede uno.
 */

// Se prueban con bcrypt contra cada usuario: contraseñas de ejemplo del repo
// y las primeras de cualquier diccionario.
const CONOCIDAS = [
  'Admin123!', 'Admin123', 'admin123', 'admin', 'Admin', 'password', 'Password1', '12345678',
  '123456789', 'smartdining', 'SmartDining', 'SmartDining123', 'cambia-esto', 'contrasena',
];
// Una contraseña nueva tampoco puede CONTENER estas partes.
const PARTES_PROHIBIDAS = ['admin123', 'smartdining', 'password', 'contrasena', '123456', 'cambia-esto'];
const MIN_CARACTERES = 12;
// bcrypt ignora lo que pase de 72 bytes: una más larga daría falsa seguridad.
const MAX_BYTES = 72;
const COSTO_BCRYPT = 10; // el mismo que usa backend/src/controllers/auth.controller.js

/** null si la contraseña nueva sirve; si no, el motivo. */
function problemaContrasena(clave) {
  if (typeof clave !== 'string' || clave.length < MIN_CARACTERES) return `debe tener al menos ${MIN_CARACTERES} caracteres`;
  if (Buffer.byteLength(clave, 'utf8') > MAX_BYTES) return `debe ocupar como máximo ${MAX_BYTES} bytes`;
  if (clave.trim() !== clave) return 'no puede empezar ni terminar con espacios';
  const baja = clave.toLowerCase();
  if (CONOCIDAS.some((c) => c.toLowerCase() === baja) || PARTES_PROHIBIDAS.some((p) => baja.includes(p))) {
    return 'es o contiene una contraseña conocida';
  }
  if (new Set(clave).size < 6) return 'repite demasiado los mismos caracteres';
  return null;
}

/** Hashes bcrypt de un texto (la salida de git grep), sin repetir. */
function leerHashes(texto) {
  return [...new Set(String(texto).match(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g) || [])];
}

/**
 * Usuarios cuya contraseña es pública. `comparar(clave, hash)` es bcrypt.compare;
 * un hash corrupto cuenta como no coincidente (no tumba la verificación).
 */
async function usuariosInseguros(usuarios, { hashesPublicos, comparar }) {
  const publicos = new Set(hashesPublicos);
  const inseguros = [];
  for (const u of usuarios) {
    if (publicos.has(u.password_hash)) {
      inseguros.push({ ...u, motivo: 'su hash está publicado en el repositorio' });
      continue;
    }
    for (const clave of CONOCIDAS) {
      // eslint-disable-next-line no-await-in-loop
      if (await comparar(clave, u.password_hash).catch(() => false)) {
        inseguros.push({ ...u, motivo: 'usa una contraseña conocida' });
        break;
      }
    }
  }
  return inseguros;
}

const describir = (u) => `${u.email} (${u.rol}${u.activo ? '' : ', inactivo'})`;

async function leerStdin() {
  let texto = '';
  for await (const trozo of process.stdin) texto += trozo;
  return texto;
}

async function principal(modo) {
  /* eslint-disable global-require */
  const { Client } = require('pg');
  const bcrypt = require('bcrypt');
  /* eslint-enable global-require */
  const entrada = await leerStdin();
  let nueva = null;
  let resto = entrada;
  if (modo === 'cambiar') {
    const salto = entrada.indexOf('\n');
    nueva = salto === -1 ? entrada : entrada.slice(0, salto);
    resto = salto === -1 ? '' : entrada.slice(salto + 1);
    const problema = problemaContrasena(nueva);
    if (problema) {
      console.error(`La contraseña nueva no sirve: ${problema}.`);
      return 2;
    }
  } else if (modo !== 'verificar') {
    console.error('Modo desconocido: usa verificar o cambiar');
    return 2;
  }
  const hashesPublicos = leerHashes(resto);

  const db = new Client(); // PGHOST, PGUSER, PGPASSWORD... del contenedor
  await db.connect();
  try {
    const { rows } = await db.query('SELECT id_usuario, email, rol, activo, password_hash FROM usuarios ORDER BY id_usuario');
    const inseguros = await usuariosInseguros(rows, { hashesPublicos, comparar: bcrypt.compare });

    if (modo === 'verificar') {
      if (!rows.some((u) => u.activo && u.rol === 'admin')) {
        console.error('Aviso: no hay ningún usuario admin activo; nadie podrá entrar al panel.');
      }
      if (inseguros.length === 0) {
        console.log(`OK: ${rows.length} usuario(s), ninguno con una contraseña conocida o publicada.`);
        return 0;
      }
      console.error('Usuarios con contraseña conocida o publicada (no se publica el sitio así):');
      for (const u of inseguros) console.error(`  - ${describir(u)}: ${u.motivo}`);
      console.error('Cámbialas con: sh infra/scripts/passwords-demo.sh cambiar');
      return 1;
    }

    const objetivo = process.env.SD_TODOS === '1' ? rows : inseguros;
    if (objetivo.length === 0) {
      console.log('No hay usuarios con contraseña conocida; no se cambió nada (usa --todos para cambiarlas igual).');
      return 0;
    }
    await db.query('BEGIN');
    for (const u of objetivo) {
      // Un hash (y una sal) por usuario.
      // eslint-disable-next-line no-await-in-loop
      const hash = await bcrypt.hash(nueva, COSTO_BCRYPT);
      // eslint-disable-next-line no-await-in-loop
      await db.query('UPDATE usuarios SET password_hash = $1 WHERE id_usuario = $2', [hash, u.id_usuario]);
    }
    await db.query('COMMIT');
    console.log(`Contraseña cambiada para ${objetivo.length} usuario(s):`);
    for (const u of objetivo) console.log(`  - ${describir(u)}`);
    return 0;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

if (process.env.SD_PASSWORDS) {
  principal(process.env.SD_PASSWORDS).then(
    (codigo) => { process.exitCode = codigo; },
    (err) => {
      // Solo el código y el mensaje: nunca la consulta con parámetros.
      console.error(`Error: ${err.code || ''} ${err.message}`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  problemaContrasena, leerHashes, usuariosInseguros, CONOCIDAS,
};
