/**
 * Catálogo PROPIO de una suite de integración: categoría, plato y, si hace
 * falta, insumo con stock, receta y plato del constructor. Nada sale del seed.
 *
 * Antes las suites pedían "el primer plato disponible" (`ORDER BY id_plato
 * LIMIT 1`), que con el seed de la demo es Nachos Supremos: su receta alcanza
 * para 26 unidades (Totopos 4.000 g / 150 g). Corriendo en paralelo, varias
 * suites reservaban a la vez más que eso y el CI caía con
 * `El plato "Nachos Supremos" no tiene stock suficiente`. Y las que buscaban
 * "un plato con receta" por consulta podían encontrar el plato que otra suite
 * acababa de crear: cuando esa otra borraba sus movimientos, la reserva
 * desaparecía (`[]` donde se esperaba `['reserva']`) y su limpieza chocaba con
 * fk_detalles_plato por el pedido ajeno.
 *
 * Dos variantes (pedido de Jarrison, para no reservar stock donde no se mira):
 *   - SIN receta (`receta: false`, la de omisión): un plato que no reserva
 *     nada. Para las suites que solo necesitan "un plato para pedir", como ya
 *     hacía cierre-pedido-pago.test.js.
 *   - CON receta (`receta: true`): un insumo propio con STOCK_ALTO (entrada
 *     registrada en el libro) y el plato consume 1 por unidad. Para las suites
 *     que verifican reservas, devoluciones o mermas. Con `conConstructor: true`,
 *     además un plato personalizable con un paso obligatorio y uno opcional,
 *     cada uno con una opción cuya receta es 1 del mismo insumo.
 *
 * Los nombres son `prueba-<suite>-<aleatorio>`: dos suites, o dos corridas de
 * la misma, nunca comparten nada. Al crear se borran primero los restos de una
 * corrida cortada de ESA suite (mismo prefijo exacto).
 *
 * `limpiar()` deja la base como estaba, respetando las FK:
 *   1. los pedidos que contengan algo de este catálogo (sus transacciones y
 *      devoluciones pendientes primero, que son RESTRICT; detalles, historial y
 *      métricas caen en cascada). Solo esta suite usa estos platos, así que
 *      esos pedidos son suyos. Normalmente ya no queda ninguno: cada suite
 *      limpia su mesa antes;
 *   2. el libro del insumo (movimientos_inventario es RESTRICT hacia insumos);
 *   3. los platos (recetas, pasos, opciones y sus recetas caen en cascada);
 *   4. el insumo y la categoría;
 *   5. lo que dejaron los triggers sin FK: auditoria_cambios de los platos
 *      (tr_auditar_platos anota también el DELETE, por eso va al final) y
 *      historial_precios de platos y opciones.
 */

const STOCK_ALTO = 100000;
const PRECIO_POR_OMISION = 10000;

/** Solo minúsculas, dígitos y guiones: va dentro de una expresión regular. */
function validarSuite(suite) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(suite)) {
    throw new Error(`nombre de suite inválido para plato-prueba: ${suite}`);
  }
}

const marcaNueva = (suite) =>
  `prueba-${suite}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Ids de todo lo que lleva una marca que cumple `patron` (expresión regular de PostgreSQL). */
async function idsPorPatron(db, patron) {
  const [categorias, platos, insumos] = await Promise.all([
    db.query('SELECT id_categoria FROM categorias WHERE nombre ~ $1::text', [patron]),
    db.query('SELECT id_plato FROM platos WHERE nombre ~ $1::text', [patron]),
    db.query('SELECT id_insumo FROM insumos WHERE nombre ~ $1::text', [patron]),
  ]);
  return {
    categorias: categorias.rows.map((r) => r.id_categoria),
    platos: platos.rows.map((r) => r.id_plato),
    insumos: insumos.rows.map((r) => r.id_insumo),
  };
}

/** Borra el catálogo dado y todo lo que cuelga de él, en el orden de las FK. */
async function borrarCatalogo(db, { categorias, platos, insumos }) {
  if (platos.length) {
    const { rows: ing } = await db.query(
      `SELECT i.id_ingrediente FROM ingredientes i
         JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
        WHERE pc.id_plato = ANY($1::int[])`,
      [platos]
    );
    const ingredientes = ing.map((r) => r.id_ingrediente);

    // 1. Pedidos que todavía tengan algo de este catálogo.
    const { rows: ped } = await db.query(
      `SELECT DISTINCT dp.id_pedido FROM detalles_pedido dp
        WHERE dp.id_plato = ANY($1::int[])
           OR EXISTS (SELECT 1 FROM detalles_ingredientes di
                       WHERE di.id_detalle = dp.id_detalle AND di.id_ingrediente = ANY($2::int[]))`,
      [platos, ingredientes]
    );
    const pedidos = ped.map((r) => r.id_pedido);
    if (pedidos.length) {
      const t = await db.query(
        'DELETE FROM transacciones WHERE id_pedido = ANY($1::int[]) RETURNING id_transaccion',
        [pedidos]
      );
      const idsT = t.rows.map((f) => f.id_transaccion);
      if (idsT.length) {
        await db.query(
          `DELETE FROM auditoria_cambios
            WHERE tabla_afectada = 'transacciones'
              AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
          [idsT]
        );
      }
      await db.query('DELETE FROM pagos_por_devolver WHERE id_pedido = ANY($1::int[])', [pedidos]);
      await db.query(
        `DELETE FROM movimientos_inventario
          WHERE id_detalle IN (SELECT id_detalle FROM detalles_pedido WHERE id_pedido = ANY($1::int[]))`,
        [pedidos]
      );
      await db.query('DELETE FROM pedidos WHERE id_pedido = ANY($1::int[])', [pedidos]);
    }

    // 3. Los platos: recetas, pasos, opciones y recetas de opciones en cascada.
    await db.query('DELETE FROM platos WHERE id_plato = ANY($1::int[])', [platos]);

    // 5. Lo que no tiene FK (va después del DELETE, que también se audita).
    await db.query(
      `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'platos' AND registro_id = ANY($1::int[])`,
      [platos]
    );
    await db.query(
      `DELETE FROM historial_precios WHERE tipo = 'plato' AND id_referencia = ANY($1::int[])`,
      [platos]
    );
    if (ingredientes.length) {
      await db.query(
        `DELETE FROM historial_precios WHERE tipo = 'ingrediente' AND id_referencia = ANY($1::int[])`,
        [ingredientes]
      );
    }
  }
  if (insumos.length) {
    // 2. El libro del insumo (lo que no se fue con los pedidos: la entrada inicial).
    await db.query('DELETE FROM movimientos_inventario WHERE id_insumo = ANY($1::int[])', [insumos]);
    // Recetas de platos u opciones ajenos sobre este insumo no debería haber;
    // si las hubiera, el DELETE falla (RESTRICT) en vez de borrar algo ajeno.
    await db.query('DELETE FROM insumos WHERE id_insumo = ANY($1::int[])', [insumos]);
  }
  if (categorias.length) {
    await db.query('DELETE FROM categorias WHERE id_categoria = ANY($1::int[])', [categorias]);
  }
}

/** Patrón exacto de las marcas de una suite: `prueba-<suite>-<aleatorio>`, con sufijo. */
const patronDeSuite = (suite) => `^prueba-${suite}-[a-z0-9]+( .*)?$`;

/**
 * Crea el catálogo propio de una suite.
 *
 * @param {import('pg').Pool} db
 * @param {string} suite  nombre corto de la suite (minúsculas y guiones)
 * @param {{ receta?: boolean, conConstructor?: boolean, precio?: number }} [opciones]
 *   (`conConstructor` y no `constructor`: desestructurar `constructor` de un
 *   objeto sin esa clave da Object, no undefined, y el valor por omisión no
 *   se aplicaría.)
 * @returns {Promise<{
 *   marca: string,
 *   idCategoria: number,
 *   plato: { id_plato: number, precio: number, precio_centavos: number },
 *   idInsumo: number|null,
 *   constructor: { id_plato: number, ingredientes: { id_ingrediente: number, porcion: string }[] }|null,
 *   limpiar: () => Promise<void>,
 * }>}
 */
async function crearCatalogoPrueba(db, suite, { receta = false, conConstructor = false, precio = PRECIO_POR_OMISION } = {}) {
  validarSuite(suite);
  if (conConstructor && !receta) throw new Error('plato-prueba: conConstructor necesita receta: true');

  // Restos de una corrida cortada de esta misma suite.
  await borrarCatalogo(db, await idsPorPatron(db, patronDeSuite(suite)));

  const marca = marcaNueva(suite);
  const ids = { categorias: [], platos: [], insumos: [] };
  const limpiar = () => borrarCatalogo(db, ids);

  try {
    const c = await db.query(
      'INSERT INTO categorias (nombre, descripcion) VALUES ($1::text, $2::text) RETURNING id_categoria',
      [marca, 'Categoría de una prueba de integración']
    );
    const idCategoria = c.rows[0].id_categoria;
    ids.categorias.push(idCategoria);

    let idInsumo = null;
    if (receta) {
      const s = await db.query(
        `INSERT INTO insumos (nombre, unidad) VALUES ($1::text, 'unidad') RETURNING id_insumo`,
        [`${marca} insumo`]
      );
      idInsumo = s.rows[0].id_insumo;
      ids.insumos.push(idInsumo);
      // El stock entra por el libro, como en la operación real: así
      // SUM(movimientos) = stock_actual también para este insumo.
      await db.query(
        'SELECT registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)',
        [idInsumo, 'entrada', STOCK_ALTO, `${marca} stock inicial`]
      );
    }

    const p = await db.query(
      `INSERT INTO platos (id_categoria, nombre, precio, disponible, personalizable)
       VALUES ($1::int, $2::text, $3::numeric, TRUE, FALSE) RETURNING id_plato`,
      [idCategoria, `${marca} plato`, precio]
    );
    const idPlato = p.rows[0].id_plato;
    ids.platos.push(idPlato);
    if (receta) {
      await db.query(
        'INSERT INTO recetas_plato (id_plato, id_insumo, cantidad) VALUES ($1::int, $2::int, $3::numeric)',
        [idPlato, idInsumo, 1]
      );
    }

    let armado = null;
    if (conConstructor) {
      const pc = await db.query(
        `INSERT INTO platos (id_categoria, nombre, precio, disponible, personalizable)
         VALUES ($1::int, $2::text, $3::numeric, TRUE, TRUE) RETURNING id_plato`,
        [idCategoria, `${marca} constructor`, precio]
      );
      const idConstructor = pc.rows[0].id_plato;
      ids.platos.push(idConstructor);

      // Un paso obligatorio (porción normal) y uno opcional (porción extra),
      // como lo que elegían las suites en el plato del constructor del seed.
      const pasos = [
        { nombre: 'base', orden: 1, min: 1, obligatorio: true, porcion: 'normal' },
        { nombre: 'extra', orden: 2, min: 0, obligatorio: false, porcion: 'extra' },
      ];
      const ingredientes = [];
      for (const paso of pasos) {
        const ps = await db.query(
          `INSERT INTO pasos_constructor (id_plato, nombre, orden, min_sel, max_sel, obligatorio)
           VALUES ($1::int, $2::text, $3::int, $4::int, 1, $5::boolean) RETURNING id_paso`,
          [idConstructor, paso.nombre, paso.orden, paso.min, paso.obligatorio]
        );
        const ing = await db.query(
          `INSERT INTO ingredientes (id_paso, nombre, precio_extra) VALUES ($1::int, $2::text, $3::numeric)
           RETURNING id_ingrediente`,
          [ps.rows[0].id_paso, `${marca} opción ${paso.nombre}`, 0]
        );
        const idIngrediente = ing.rows[0].id_ingrediente;
        await db.query(
          'INSERT INTO recetas_ingrediente (id_ingrediente, id_insumo, cantidad) VALUES ($1::int, $2::int, $3::numeric)',
          [idIngrediente, idInsumo, 1]
        );
        ingredientes.push({ id_ingrediente: idIngrediente, porcion: paso.porcion });
      }
      armado = { id_plato: idConstructor, ingredientes };
    }

    return {
      marca,
      idCategoria,
      plato: { id_plato: idPlato, precio, precio_centavos: Math.round(precio * 100) },
      idInsumo,
      constructor: armado,
      limpiar,
    };
  } catch (err) {
    // Lo que alcanzó a crearse no se queda en la base.
    await limpiar().catch(() => {});
    throw err;
  }
}

module.exports = { STOCK_ALTO, crearCatalogoPrueba };
