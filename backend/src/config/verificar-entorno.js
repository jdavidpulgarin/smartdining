/**
 * Comprobaciones de configuración que se hacen al arrancar el servidor.
 *
 * Arrancar con un JWT_SECRET vacío o con el de ejemplo es peor que no arrancar:
 * el backend levantaría y firmaría tokens que cualquiera que haya visto el
 * repositorio puede falsificar, y además el socket-server los aceptaría, porque
 * comparte el mismo secreto. Falla al inicio y en voz alta.
 */

/**
 * Valores del .env.example. No se leen del archivo a propósito: en un despliegue
 * el .env.example puede no estar, y esta lista tiene que seguir funcionando.
 * Si alguien cambia el placeholder allí, hay que añadirlo aquí.
 */
const VALORES_DE_EJEMPLO = [
  'cambia-esto-por-un-secreto-largo-y-aleatorio',
  'cambia-esto-por-una-clave-interna-larga',
  'cambia-esto-por-otro-secreto-largo',
];

const LARGO_MINIMO = 16;

/**
 * Revisa el entorno y devuelve la lista de problemas que impiden arrancar.
 * No imprime ni corta: quien llama decide qué hacer (así es comprobable).
 *
 * @returns {string[]} vacío si todo está bien.
 */
function revisarEntorno(env = process.env) {
  const problemas = [];
  const secreto = env.JWT_SECRET;

  if (!secreto || !secreto.trim()) {
    problemas.push(
      'JWT_SECRET no está definida. Copia backend/.env.example a backend/.env y ponle un '
        + 'secreto propio (por ejemplo: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))").'
    );
  } else if (VALORES_DE_EJEMPLO.includes(secreto.trim())) {
    problemas.push(
      'JWT_SECRET todavía tiene el valor de ejemplo de .env.example. Cualquiera que haya '
        + 'visto el repositorio podría firmar tokens válidos: cámbialo por uno propio y '
        + 'ponle el mismo valor a socket-server/.env.'
    );
  } else if (secreto.trim().length < LARGO_MINIMO) {
    problemas.push(
      `JWT_SECRET es demasiado corta (${secreto.trim().length} caracteres). Usa al menos ${LARGO_MINIMO}.`
    );
  }

  return problemas;
}

/**
 * Comprueba el entorno y, si hay problemas, los muestra y corta el arranque.
 * Se llama solo al iniciar el servidor, no al importar la app en las pruebas.
 */
function exigirEntornoValido({ env = process.env, log = console.error, salir = process.exit } = {}) {
  const problemas = revisarEntorno(env);
  if (problemas.length === 0) return;

  log('\nNo se puede iniciar el backend de SmartDining:\n');
  for (const p of problemas) log(`  - ${p}`);
  log('');
  salir(1);
}

module.exports = { revisarEntorno, exigirEntornoValido, VALORES_DE_EJEMPLO, LARGO_MINIMO };
