require('dotenv').config();

// Se lee el entorno en una función (y no al cargar el módulo) para que las
// pruebas puedan cambiar process.env y volver a construir la configuración.
function cargarConfig(env = process.env) {
  const origenes = (env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Un comodín con credenciales dejaría a cualquier sitio abrir un socket
  // en nombre del comensal; preferimos fallar al arrancar que quedar expuestos.
  if (origenes.includes('*')) {
    throw new Error('CORS_ORIGINS no admite "*": lista los orígenes explícitos');
  }
  if (origenes.length === 0) {
    throw new Error('CORS_ORIGINS es obligatorio (orígenes separados por comas)');
  }

  // Sin el secreto compartido con el backend no podemos verificar ningún JWT
  // y cualquiera podría conectarse; es mejor no arrancar.
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET es obligatorio (el mismo que usa backend/)');
  }

  return {
    puerto: Number(env.PORT) || 4001,
    entorno: env.NODE_ENV || 'development',
    origenes,
    jwtSecret: env.JWT_SECRET,
  };
}

module.exports = { cargarConfig };
