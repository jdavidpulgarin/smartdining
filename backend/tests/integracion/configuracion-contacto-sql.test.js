const test = require('node:test');
const assert = require('node:assert');

/**
 * Correo y redes del local (script 29) contra PostgreSQL real.
 *
 * 1. Un PUT válido se guarda y se lee igual (por el servicio de verdad).
 * 2. Para CADA caso de una tabla, el esquema del PUT (zod) y la base dan el
 *    MISMO veredicto. La base se consulta con sus reglas reales, sin copiar sus
 *    patrones aquí:
 *      - redes: fn_redes_contacto_validas(), que es el cuerpo del CHECK;
 *      - correo: un UPDATE de verdad dentro de un SAVEPOINT que se deshace, así
 *        responden ck_configuracion_correo y el VARCHAR(254).
 *
 * Deja la configuración como estaba. Con SUPERUSUARIO, EXACTAMENTE, incluidos
 * actualizado_en y actualizado_por: el trigger tr_configuracion_actualizada los
 * reescribe en todo UPDATE, así que la restauración va en una transacción con
 * `SET LOCAL session_replication_role = replica` (sin triggers, solo en esa
 * transacción; los CHECK siguen valiendo). Con un usuario NORMAL ese SET da
 * 42501: se hace ROLLBACK, se restauran los campos de negocio con un UPDATE
 * normal y se comprueban solo esos (ver `restaurar`).
 *
 * Con VER_TABLA=1 imprime la tabla de casos.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const pool = require('../../src/config/db');
const servicio = require('../../src/services/configuracion.service');
const { configuracionSchema } = require('../../src/controllers/configuracion.controller');

/** Los campos de NEGOCIO: lo que un admin edita. */
const CAMPOS_NEGOCIO = [
  'nombre', 'telefono', 'direccion', 'url_logo', 'horario', 'propina_sugerida_pct', 'moneda',
  'correo', 'redes',
];
const COLUMNAS = [...CAMPOS_NEGOCIO, 'actualizado_en', 'actualizado_por'];

/** SQLSTATE insufficient_privilege: un usuario no superusuario no puede usar el modo replica. */
const SIN_PERMISO = '42501';

let sonda = null;
let hayBase = false;
let original = null;
let usuario = null;

async function filaActual() {
  // actualizado_en se guarda TAMBIÉN como texto: `pg` lo entrega como Date de
  // JavaScript, que solo tiene milisegundos, y la columna guarda microsegundos.
  // Restaurarlo desde el Date lo dejaría distinto.
  // Dos huellas: la de la fila ENTERA (con la auditoría) y la de los campos de
  // negocio, que es la que se compara cuando no se puede restaurar la auditoría.
  const { rows } = await sonda.query(
    `SELECT ${COLUMNAS.join(', ')}, actualizado_en::text AS actualizado_en_texto,
            md5(row_to_json(c)::text) AS huella,
            md5(json_build_object(${CAMPOS_NEGOCIO.map((k) => `'${k}', ${k}`).join(', ')})::text) AS huella_negocio
       FROM configuracion_restaurante c WHERE id = 1`
  );
  return rows[0];
}

/** Los valores de negocio originales, como parámetros $1..$9 del UPDATE. */
const valoresNegocio = () => [
  original.nombre, original.telefono, original.direccion, original.url_logo,
  JSON.stringify(original.horario), original.propina_sugerida_pct, original.moneda,
  original.correo, JSON.stringify(original.redes),
];

const SET_NEGOCIO = `nombre = $1::text, telefono = $2::text, direccion = $3::text, url_logo = $4::text,
              horario = $5::jsonb, propina_sugerida_pct = $6::numeric, moneda = $7::text,
              correo = $8::text, redes = $9::jsonb`;

/**
 * Deja la configuración como estaba. Devuelve qué tan exacta quedó:
 *   - 'exacta': con superusuario, en una transacción con session_replication_role
 *     = replica (sin el trigger): vuelven también actualizado_en y actualizado_por.
 *   - 'negocio': sin permiso para el modo replica (42501, un usuario normal de
 *     PostgreSQL, como el de Jarrison o el del CI): ROLLBACK de ese intento y un
 *     UPDATE normal de los campos de negocio; el trigger reescribe la auditoría.
 * Cualquier otro error se propaga: no se oculta.
 */
async function restaurar() {
  const c = await sonda.connect();
  try {
    await c.query('BEGIN');
    try {
      await c.query("SET LOCAL session_replication_role = 'replica'");
    } catch (err) {
      if (!err || err.code !== SIN_PERMISO) throw err;
      await c.query('ROLLBACK');
      await c.query(`UPDATE configuracion_restaurante SET ${SET_NEGOCIO} WHERE id = 1`, valoresNegocio());
      return 'negocio';
    }
    await c.query(
      `UPDATE configuracion_restaurante
          SET ${SET_NEGOCIO},
              actualizado_en = $10::timestamptz, actualizado_por = $11::int
        WHERE id = 1`,
      [...valoresNegocio(), original.actualizado_en_texto, original.actualizado_por]
    );
    await c.query('COMMIT');
    return 'exacta';
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* ya cerrada */ }
    throw err;
  } finally {
    c.release();
  }
}

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    const tiene = await sonda.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'configuracion_restaurante' AND column_name IN ('correo', 'redes')`
    );
    const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' ORDER BY id_usuario LIMIT 1");
    usuario = u.rows[0] ? u.rows[0].id_usuario : null;
    hayBase = tiene.rows[0].n === 2 && usuario !== null;
    if (hayBase) original = await filaActual();
  } catch {
    hayBase = false;
  }
});

test.after(async () => {
  try {
    if (hayBase && original) {
      const modo = await restaurar();
      const despues = await filaActual();
      if (process.env.VER_TABLA) console.log(`restauracion: ${modo}`);
      if (modo === 'exacta') {
        assert.strictEqual(despues.huella, original.huella, 'la configuracion quedo exactamente como estaba');
      } else {
        // Sin superusuario el trigger reescribe actualizado_en/actualizado_por:
        // se comparan solo los campos de negocio.
        assert.strictEqual(despues.huella_negocio, original.huella_negocio, 'los campos de negocio quedaron como estaban');
      }
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

test('un PUT valido de correo y redes se guarda y se lee igual', async (t) => {
  if (!hayBase) return t.skip('sin base de datos (o sin el script 29)');
  const cambios = {
    correo: 'contacto@smartdining.co',
    redes: {
      instagram: 'https://www.instagram.com/smartdining',
      facebook: 'https://fb.com/smartdining',
      tiktok: 'https://tiktok.com/@smartdining',
      whatsapp: '+573001234567',
    },
  };
  assert.ok(configuracionSchema.safeParse(cambios).success, 'el esquema lo acepta');

  const guardada = await servicio.actualizar(cambios, { idUsuario: usuario });
  assert.strictEqual(guardada.correo, cambios.correo);
  assert.deepStrictEqual(guardada.redes, cambios.redes);

  const leida = await servicio.obtener();
  assert.strictEqual(leida.correo, cambios.correo);
  assert.deepStrictEqual(leida.redes, cambios.redes);

  // Reemplazo, no mezcla: con solo whatsapp, las otras tres desaparecen.
  const reemplazo = await servicio.actualizar({ redes: { whatsapp: '+573009999999' } }, { idUsuario: usuario });
  assert.deepStrictEqual(reemplazo.redes, { whatsapp: '+573009999999' });

  // {} deja sin redes y correo null quita el correo.
  const vacio = await servicio.actualizar({ redes: {}, correo: null }, { idUsuario: usuario });
  assert.deepStrictEqual(vacio.redes, {});
  assert.strictEqual(vacio.correo, null);
});

// ---------------------------------------------------------------------------
// La tabla de casos: zod contra la base
// ---------------------------------------------------------------------------

const NBSP = ' ';
const EM_SPACE = ' ';

/** [clave, valor, nota] de una sola red. */
const CASOS_RED = [
  ['instagram', 'https://instagram.com/smartdining', 'perfil'],
  ['instagram', 'https://www.instagram.com/smartdining', 'www.'],
  ['instagram', 'https://m.instagram.com/smartdining', 'm.'],
  ['instagram', 'https://INSTAGRAM.COM/SmartDining', 'mayusculas'],
  ['instagram', 'https://instagram.com/', 'sin perfil'],
  ['instagram', 'http://instagram.com/smartdining', 'http'],
  ['instagram', 'https://instagram.com.evil.co/x', 'otro dominio'],
  ['instagram', 'https://instagram.com/smart dining', 'espacio'],
  ['instagram', `https://instagram.com/smart${NBSP}dining`, 'espacio duro (U+00A0)'],
  ['instagram', `https://instagram.com/smart${EM_SPACE}dining`, 'espacio em (U+2003)'],
  ['instagram', 'https://instagram.com/smart\tdining', 'tabulador'],
  ['instagram', `https://instagram.com/${'a'.repeat(178)}`, '200 caracteres'],
  ['instagram', `https://instagram.com/${'a'.repeat(179)}`, '201 caracteres'],
  ['facebook', 'https://facebook.com/smartdining', 'pagina'],
  ['facebook', 'https://fb.com/smartdining', 'fb.com'],
  ['facebook', 'https://FB.COM/smartdining', 'FB.COM'],
  ['facebook', 'https://www.facebook.com/smartdining', 'www.'],
  ['facebook', 'https://facebook.co/smartdining', '.co'],
  ['facebook', 'facebook.com/smartdining', 'sin https'],
  ['facebook', 'https://xfacebook.com/smartdining', 'dominio parecido'],
  ['tiktok', 'https://tiktok.com/@smartdining', 'perfil'],
  ['tiktok', 'https://www.TikTok.com/@smartdining', 'mayusculas'],
  ['tiktok', 'https://vm.tiktok.com/ZMabc/', 'subdominio'],
  ['tiktok', 'https://tiktok.com', 'sin perfil'],
  ['whatsapp', '+573001234567', 'E.164'],
  ['whatsapp', '+1234567', '7 digitos'],
  ['whatsapp', '+123456789012345', '15 digitos'],
  ['whatsapp', '573001234567', 'sin +'],
  ['whatsapp', '+0573001234567', 'empieza en 0'],
  ['whatsapp', '+57 300 1234567', 'espacios'],
  ['whatsapp', '+123456', '6 digitos'],
  ['whatsapp', '+1234567890123456', '16 digitos'],
  ['whatsapp', '+٥٧٣٠٠١٢٣٤٥٦٧', 'digitos arabes'],
];

/** Objetos completos de redes. */
const CASOS_OBJETO = [
  [{}, '{} (sin redes)'],
  [{ instagram: null }, 'valor null'],
  [{ instagram: '' }, 'valor ""'],
  [{ whatsapp: 573001234567 }, 'numero, no texto'],
  [{ twitter: 'https://x.com/smartdining' }, 'clave desconocida'],
  [{ instagram: 'https://instagram.com/a', whatsapp: '+573001234567' }, 'dos redes validas'],
  [{ instagram: 'https://instagram.com/a', whatsapp: '573001234567' }, 'una valida y una no'],
  [[], 'un arreglo'],
];

const CASOS_CORREO = [
  ['hola@smartdining.co', 'normal'],
  ['a.b+c@sub.dominio.com.co', 'subdominios'],
  ['sinarroba.com', 'sin arroba'],
  ['a@b', 'sin punto'],
  ['a@@b.co', 'dos arrobas'],
  ['a b@c.co', 'espacio'],
  [`a${NBSP}b@c.co`, 'espacio duro (U+00A0)'],
  ['a@b.', 'termina en punto'],
  ['a@b.c.', 'punto final'],
  ['', 'vacio'],
  [`${'a'.repeat(249)}@x.co`, '254 caracteres'],
  [`${'a'.repeat(250)}@x.co`, '255 caracteres'],
];

const tabla = [];

async function veredictoRedesBase(objeto) {
  const { rows } = await sonda.query('SELECT fn_redes_contacto_validas($1::jsonb) AS ok', [JSON.stringify(objeto)]);
  return rows[0].ok === true;
}

test('cada patron de red: zod y fn_redes_contacto_validas dan el mismo veredicto', async (t) => {
  if (!hayBase) return t.skip('sin base de datos (o sin el script 29)');
  const distintos = [];
  for (const [clave, valor, nota] of CASOS_RED) {
    const zod = configuracionSchema.safeParse({ redes: { [clave]: valor } }).success;
    const base = await veredictoRedesBase({ [clave]: valor });
    tabla.push({ campo: `redes.${clave}`, nota, zod, base });
    if (zod !== base) distintos.push(`${clave} ${nota}: zod=${zod} base=${base}`);
  }
  for (const [objeto, nota] of CASOS_OBJETO) {
    const zod = configuracionSchema.safeParse({ redes: objeto }).success;
    const base = await veredictoRedesBase(objeto);
    tabla.push({ campo: 'redes', nota, zod, base });
    if (zod !== base) distintos.push(`redes ${nota}: zod=${zod} base=${base}`);
  }
  assert.deepStrictEqual(distintos, [], 'zod y la base discrepan');
});

test('correo: zod y el CHECK (y el VARCHAR(254)) de la base dan el mismo veredicto', async (t) => {
  if (!hayBase) return t.skip('sin base de datos (o sin el script 29)');
  const distintos = [];
  const c = await sonda.connect();
  try {
    await c.query('BEGIN');
    for (const [valor, nota] of CASOS_CORREO) {
      const zod = configuracionSchema.safeParse({ correo: valor }).success;
      let base = true;
      await c.query('SAVEPOINT caso');
      try {
        await c.query('UPDATE configuracion_restaurante SET correo = $1::text WHERE id = 1', [valor]);
      } catch (err) {
        if (!['23514', '22001'].includes(err.code)) throw err;
        base = false;
      }
      await c.query('ROLLBACK TO SAVEPOINT caso');
      tabla.push({ campo: 'correo', nota, zod, base });
      if (zod !== base) distintos.push(`correo ${nota}: zod=${zod} base=${base}`);
    }
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  assert.deepStrictEqual(distintos, [], 'zod y la base discrepan');

  if (process.env.VER_TABLA) {
    console.log('\nCAMPO               CASO                          ZOD    BASE');
    for (const f of tabla) {
      console.log(`${f.campo.padEnd(20)}${f.nota.padEnd(30)}${String(f.zod).padEnd(7)}${f.base}${f.zod === f.base ? '' : '   <- DISTINTO'}`);
    }
  }
});
