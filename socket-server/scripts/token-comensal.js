// Genera un JWT de comensal para probar el socket-server (join:table,
// cart:update, etc.) sin depender de que el backend esté corriendo. Firma
// { id_mesa, rol: 'comensal' } (+ sid si se indica) con el JWT_SECRET del
// .env, que debe ser el MISMO que usa el servidor para poder validarlo.
//
// Uso: npm run token:comensal -- --mesa 5 [--sid <texto>] [--horas 3]
require('dotenv').config();
const jwt = require('jsonwebtoken');

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function main() {
  // Un token de comensal es una herramienta de desarrollo: en producción no
  // hay ninguna razón legítima para fabricar uno por fuera del backend real.
  if (process.env.NODE_ENV === 'production') {
    console.error('Este script no corre con NODE_ENV=production: generaría tokens de prueba en un entorno real.');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('Falta JWT_SECRET en el .env (debe ser el mismo que usa el servidor).');
    process.exit(1);
  }

  const args = leerArgs(process.argv.slice(2));

  const idMesa = Number(args.mesa);
  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    console.error('--mesa es obligatorio y debe ser un entero positivo. Uso: npm run token:comensal -- --mesa 5');
    process.exit(1);
  }

  const horas = args.horas === undefined ? 3 : Number(args.horas);
  if (!Number.isFinite(horas) || horas <= 0) {
    console.error('--horas debe ser un número positivo.');
    process.exit(1);
  }

  const payload = { id_mesa: idMesa, rol: 'comensal' };
  if (args.sid) payload.sid = args.sid;

  const token = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: `${horas}h` });

  console.log(`# Token de comensal para la mesa ${idMesa} (vence en ${horas}h)`);
  console.log(token);
}

main();
