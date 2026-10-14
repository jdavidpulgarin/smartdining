/**
 * Comprobación de los secretos al arrancar.
 *
 * Arrancar con un secreto vacío, corto o copiado del .env.example es peor que
 * no arrancar: quien haya visto el repositorio podría firmar JWT de personal,
 * fabricar QR de cualquier mesa o llamar a /internal/* (liberar mesas, inventar
 * comandas). Por eso se falla al inicio y en voz alta, nunca al primer uso.
 */

// 32 caracteres: lo mínimo para que un secreto aleatorio en hex lleve 128 bits
// de entropía. `randomBytes(32).toString('hex')` produce 64.
const LARGO_MINIMO = 32;

// Secretos que el servidor exige para arrancar. Cada uno protege algo distinto
// y por eso, además, deben ser distintos entre sí (ver revisarSecretos).
const SECRETOS_OBLIGATORIOS = ['JWT_SECRET', 'QR_SECRET', 'INTERNAL_API_KEY'];

/**
 * Marcas de valores de ejemplo. No se lee el .env.example: en un despliegue
 * puede no estar, y esta lista tiene que seguir funcionando. Se comparan en
 * minúsculas y como subcadena, para atrapar también variantes como
 * "cambia-esto-por-un-secreto-largo-y-aleatorio-2".
 */
const MARCAS_DE_EJEMPLO = [
  'cambia-esto', 'cambiaesto', 'changeme', 'change-me', 'ejemplo', 'example',
  'dev-key', 'secreto-de-pruebas', 'tu-secreto', 'your-secret', 'placeholder',
];

const esDeEjemplo = (valor) => {
  const v = valor.toLowerCase();
  return MARCAS_DE_EJEMPLO.some((m) => v.includes(m));
};

/**
 * Revisa los secretos y devuelve la lista de problemas (vacía si todo está
 * bien). No imprime ni corta: quien llama decide, así se puede probar.
 * Los mensajes nombran la variable pero NUNCA muestran su valor.
 */
function revisarSecretos(env, nombres = SECRETOS_OBLIGATORIOS) {
  const problemas = [];
  const vistos = new Map(); // valor -> nombre de la primera variable que lo usa

  for (const nombre of nombres) {
    const valor = typeof env[nombre] === 'string' ? env[nombre].trim() : '';
    if (!valor) {
      problemas.push(`${nombre} es obligatoria`);
      continue;
    }
    if (esDeEjemplo(valor)) {
      problemas.push(`${nombre} todavía tiene un valor de ejemplo: genera uno propio`);
      continue;
    }
    if (valor.length < LARGO_MINIMO) {
      problemas.push(`${nombre} es demasiado corta (${valor.length} caracteres, mínimo ${LARGO_MINIMO})`);
      continue;
    }
    // Separación de claves: si dos secretos coinciden, filtrar uno compromete
    // también lo que protege el otro (p. ej. la clave interna firmaría JWT).
    if (vistos.has(valor)) {
      problemas.push(`${nombre} no puede ser igual a ${vistos.get(valor)}`);
      continue;
    }
    vistos.set(valor, nombre);
  }
  return problemas;
}

const COMANDO_GENERAR = 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

/** Lanza un único Error con todos los problemas, listo para mostrar. */
function exigirSecretos(env, nombres) {
  const problemas = revisarSecretos(env, nombres);
  if (problemas.length === 0) return;
  const err = new Error(
    `Secretos inválidos:\n${problemas.map((p) => `  - ${p}`).join('\n')}\n`
      + `Genera cada uno con: ${COMANDO_GENERAR}`,
  );
  err.codigo = 'SECRETOS_INVALIDOS';
  throw err;
}

module.exports = {
  revisarSecretos, exigirSecretos, esDeEjemplo, SECRETOS_OBLIGATORIOS, LARGO_MINIMO,
};
