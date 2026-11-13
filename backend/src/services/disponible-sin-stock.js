/**
 * T5: cuántas unidades se PUEDEN pedir de cada faltante de un 409 `sin_stock`,
 * para el "Ajustar a N" de la PWA.
 *
 * LA FÓRMULA ES LA DE LA BASE, no una propia. Lo que reserva una línea lo dice
 * fn_consumo_detalle (database/scripts/27_inventario.sql):
 *
 *   - plato:  rp.cantidad * dp.cantidad                       (línea 129)
 *   - opción: ri.cantidad * fp.factor * dp.cantidad           (línea 134)
 *
 * y lo que "hay" de un insumo lo dice fn_faltantes_pedido (mismo script,
 * línea 392): `CASE WHEN s.activo THEN s.stock_actual ELSE 0 END`.
 * Despejando dp.cantidad:
 *
 *   disponible(plato)  = min sobre su receta de floor(hay / rp.cantidad)
 *   disponible(opción) = min sobre su receta de floor(hay / (ri.cantidad * factor))
 *
 * con el factor de la porción que se pidió (factores_porcion: ligera 0,5,
 * normal 1, extra 1,5). Si la misma opción se pidió con varias porciones, se
 * toma la de factor MÁS ALTO: el número que sale alcanza para cualquiera.
 *
 * Un plato sin receta (o un armable sin receta propia, cuyo faltante es el paso
 * obligatorio sin opciones) no tiene de dónde sacar el número: sale SIN
 * `disponible`, no con uno inventado.
 *
 * APROXIMADO. Se calcula por faltante, como si fuera lo único del pedido: si
 * otra línea del MISMO pedido gasta el mismo insumo (otro plato con el mismo
 * ingrediente), "Ajustar a N" puede volver a dar 409. Y el stock puede cambiar
 * entre esta lectura y el siguiente intento.
 *
 * Es una consulta de SOLO LECTURA por el pool, DESPUÉS del error y fuera de la
 * transacción del pedido (que ya está abortada). Nunca lanza: si falla, se
 * registra el código y el 409 sale igual, sin `disponible`.
 */

const pool = require('../config/db');

const SQLSTATE_SIN_STOCK = 'SD001';

/** Los faltantes (tipo, id) del DETAIL de la base, sin repetir. */
function faltantesDelDetalle(err) {
  try {
    const detalle = JSON.parse(err.detail);
    const filas = detalle && Array.isArray(detalle.faltantes) ? detalle.faltantes : [];
    const vistos = new Map();
    for (const f of filas) {
      if (!f || (f.tipo !== 'plato' && f.tipo !== 'ingrediente')) continue;
      if (!Number.isInteger(f.id) || f.id <= 0) continue;
      vistos.set(`${f.tipo}:${f.id}`, { tipo: f.tipo, id: f.id });
    }
    return [...vistos.values()];
  } catch {
    return [];
  }
}

/** Porciones con que se pidió cada opción en el pedido: id_ingrediente -> Set. */
function porcionesPedidas(items) {
  const porId = new Map();
  for (const item of items || []) {
    for (const ing of item.ingredientes || []) {
      if (!porId.has(ing.id_ingrediente)) porId.set(ing.id_ingrediente, new Set());
      porId.get(ing.id_ingrediente).add(ing.porcion || 'normal');
    }
  }
  return porId;
}

const SQL_DISPONIBLES = `
  WITH f AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(tipo text, id int, porciones text[])
  ),
  receta AS (
    SELECT f.tipo, f.id, rp.id_insumo, rp.cantidad::numeric AS por_unidad
      FROM f JOIN recetas_plato rp ON f.tipo = 'plato' AND rp.id_plato = f.id
    UNION ALL
    SELECT f.tipo, f.id, ri.id_insumo,
           ri.cantidad::numeric * COALESCE(
             (SELECT max(fp.factor) FROM factores_porcion fp WHERE fp.porcion = ANY(f.porciones)),
             1
           ) AS por_unidad
      FROM f JOIN recetas_ingrediente ri ON f.tipo = 'ingrediente' AND ri.id_ingrediente = f.id
  )
  SELECT r.tipo, r.id,
         GREATEST(0, MIN(floor(CASE WHEN s.activo THEN s.stock_actual ELSE 0 END / r.por_unidad)))::int AS disponible
    FROM receta r
    JOIN insumos s ON s.id_insumo = r.id_insumo
   WHERE r.por_unidad > 0
   GROUP BY r.tipo, r.id`;

/**
 * Calcula `disponible` por faltante. Devuelve un Map "tipo:id" -> entero >= 0
 * (sin entrada para lo que no tiene receta), o null si la consulta falló.
 */
async function calcularDisponibles(err, items, db = pool) {
  const faltantes = faltantesDelDetalle(err);
  if (faltantes.length === 0) return new Map();
  const porciones = porcionesPedidas(items);
  const entrada = faltantes.map((f) => ({
    tipo: f.tipo,
    id: f.id,
    porciones: f.tipo === 'ingrediente' ? [...(porciones.get(f.id) || ['normal'])] : null,
  }));
  try {
    const { rows } = await db.query(SQL_DISPONIBLES, [JSON.stringify(entrada)]);
    return new Map(rows.map((r) => [`${r.tipo}:${r.id}`, Number(r.disponible)]));
  } catch (e) {
    // Solo el código: nada de datos del pedido ni del inventario en el log.
    console.error(`[pedidos] no se pudo calcular el disponible de los faltantes (${e && e.code})`);
    return null;
  }
}

/**
 * Si `err` es el SD001 de sin stock, le anota `disponibles` (el Map de arriba)
 * para que inventario-errores.js los agregue a cada faltante. Nunca lanza.
 */
async function anotarDisponibles(err, items, db = pool) {
  if (!err || err.code !== SQLSTATE_SIN_STOCK) return;
  const disponibles = await calcularDisponibles(err, items, db);
  if (disponibles) err.disponibles = disponibles;
}

module.exports = { anotarDisponibles, calcularDisponibles, faltantesDelDetalle, porcionesPedidas, SQL_DISPONIBLES };
