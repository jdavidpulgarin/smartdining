/**
 * D-20a: despacho de domicilios y repartidor (`pedidos_domicilio`, script 36).
 *
 * LO QUE DECIDE LA BASE y LO QUE DECIDE ESTE ARCHIVO. El trigger
 * fn_tr_validar_pedido_domicilio solo exige tres cosas:
 *   - que el pedido sea de canal 'domicilio';
 *   - que id_repartidor, si lo hay, sea un usuario ACTIVO con rol 'repartidor';
 *   - que una entrega 'entregado' o 'fallido' no cambie más de estado (final);
 * y pone las marcas de tiempo (asignado_en, en_camino_en, entregado_en,
 * fallido_en) la primera vez que se entra a cada estado. ck_domicilio_repartidor
 * exige repartidor en todo estado que no sea 'por_asignar', y ck_domicilio_fallo
 * un motivo en 'fallido'. El ORDEN de los estados no lo impone la base: lo
 * impone este archivo, con las únicas transiciones que existen:
 *
 *     por_asignar -> asignado      (asignar; asignado -> asignado = reasignar)
 *     asignado    -> en_camino     (salir, solo con el pedido en 'listo')
 *     en_camino   -> entregado     (entregar: el pedido pasa a 'entregado')
 *     en_camino   -> fallido       (fallar, con motivo: FINAL)
 *
 * Cualquier otra, o repetir una ya hecha, es 409 transicion_invalida sin
 * efectos (en asignar, 409 entrega_ya_salio).
 *
 * ORDEN DE BLOQUEOS: pedidos -> pedidos_domicilio, el mismo que todas las
 * cancelaciones (ver pedidos.service.js). Cada operación bloquea el pedido y
 * DESPUÉS su fila de domicilio, y decide con las dos bloqueadas.
 *
 * FALLIDO ES FINAL: no hay reintentos. El pedido se queda en 'listo' y lo
 * único que queda es que el admin lo cancele (listo -> cancelado, script 31:
 * lo cocinado es merma, scripts 27 y 31). El reembolso del pago anticipado es
 * aparte, con reembolsar_pago(): NO se automatiza aquí.
 *
 * DATOS PERSONALES: del cliente solo salen nombre y teléfono, y la dirección es
 * la COPIADA en pedidos_domicilio (no su libreta de direcciones). Nada de esto
 * se registra en el log.
 */

const pool = require('../config/db');
const { errorConMotivo } = require('../utils/error-con-motivo');
const { traducirAutorInexistente } = require('./autor-inexistente');
const { cerrarSiEntregadoYPagado } = require('./pedidos.service');

const ESTADOS_ENTREGA = Object.freeze(['por_asignar', 'asignado', 'en_camino', 'entregado', 'fallido']);
/** Por defecto el despacho muestra lo que todavía hay que mover. */
const ESTADOS_NO_TERMINADOS = Object.freeze(['por_asignar', 'asignado', 'en_camino']);
const ZONA = 'America/Bogota';

const MOTIVOS = Object.freeze({
  noEncontrado: 'no_encontrado',
  pedidoCancelado: 'pedido_cancelado',
  entregaYaSalio: 'entrega_ya_salio',
  repartidorNoValido: 'repartidor_no_valido',
  noEsTuEntrega: 'no_es_tu_entrega',
  transicionInvalida: 'transicion_invalida',
  pedidoNoListo: 'pedido_no_listo',
});

const MENSAJES = Object.freeze({
  noEncontrado: 'Ese pedido no es un domicilio',
  pedidoCancelado: 'El pedido está cancelado',
  entregaYaSalio: 'La entrega ya salió: no se puede cambiar el repartidor',
  repartidorNoValido: 'Ese usuario no es un repartidor activo',
  noEsTuEntrega: 'Esa entrega no es tuya',
  pedidoNoListo: 'El pedido todavía no está listo en cocina',
});

const errorDe = (status, clave, mensaje = MENSAJES[clave]) => errorConMotivo(status, MOTIVOS[clave], mensaje);

/** Lo que sale de una entrega: cliente (nombre y teléfono), dirección copiada, zona, repartidor y tiempos. */
const SQL_DOMICILIO = `
  SELECT pd.id_pedido, p.codigo_pedido, p.estado AS estado_pedido, p.total,
         c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
         pd.direccion_texto, pd.barrio, pd.referencia, pd.lat, pd.lng, pd.telefono_contacto,
         pd.id_zona, z.nombre AS zona_nombre, pd.costo_envio,
         pd.id_repartidor, u.nombre AS repartidor_nombre,
         pd.estado_entrega, pd.motivo_fallo,
         pd.creado_en, pd.asignado_en, pd.en_camino_en, pd.entregado_en, pd.fallido_en
    FROM pedidos_domicilio pd
    JOIN pedidos p ON p.id_pedido = pd.id_pedido
    JOIN zonas_envio z ON z.id_zona = pd.id_zona
    LEFT JOIN clientes c ON c.id_cliente = p.id_cliente
    LEFT JOIN usuarios u ON u.id_usuario = pd.id_repartidor`;

/** La fila de SQL_DOMICILIO con la forma de la respuesta. */
function aEntrega(f) {
  return {
    pedido: { id_pedido: f.id_pedido, codigo_pedido: f.codigo_pedido, estado: f.estado_pedido, total: f.total },
    cliente: { nombre: f.cliente_nombre ?? null, telefono: f.cliente_telefono ?? null },
    direccion: {
      direccion: f.direccion_texto,
      barrio: f.barrio,
      referencia: f.referencia,
      lat: f.lat,
      lng: f.lng,
      telefono_contacto: f.telefono_contacto,
    },
    zona: { id_zona: f.id_zona, nombre: f.zona_nombre },
    costo_envio: f.costo_envio,
    repartidor: f.id_repartidor === null || f.id_repartidor === undefined
      ? null
      : { id_usuario: f.id_repartidor, nombre: f.repartidor_nombre },
    estado_entrega: f.estado_entrega,
    motivo_fallo: f.motivo_fallo,
    tiempos: {
      creado_en: f.creado_en,
      asignado_en: f.asignado_en,
      en_camino_en: f.en_camino_en,
      entregado_en: f.entregado_en,
      fallido_en: f.fallido_en,
    },
  };
}

/**
 * GET /domicilios: el despacho (admin y cajero). `estados` ya validados; por
 * defecto los no terminados. Nunca salen los pedidos en 'por_pagar' (todavía
 * no llegan a cocina) ni los 'cancelado' (no hay nada que despachar).
 */
async function listarDespacho(estados = ESTADOS_NO_TERMINADOS) {
  const { rows } = await pool.query(
    `${SQL_DOMICILIO}
      WHERE pd.estado_entrega = ANY($1::text[])
        AND p.estado NOT IN ('por_pagar', 'cancelado')
      ORDER BY pd.creado_en, pd.id_pedido`,
    [estados]
  );
  return rows.map(aEntrega);
}

/**
 * GET /domicilios/mios: las entregas del repartidor que todavía no terminaron
 * (sin las de pedidos cancelados) y las que terminó HOY, en hora de Bogotá.
 */
async function listarMias(idRepartidor) {
  const { rows } = await pool.query(
    `${SQL_DOMICILIO}
      WHERE pd.id_repartidor = $1::int
        AND (
          (pd.estado_entrega IN ('asignado', 'en_camino') AND p.estado <> 'cancelado')
          OR (pd.estado_entrega IN ('entregado', 'fallido')
              AND COALESCE(pd.entregado_en, pd.fallido_en)
                  >= (date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text))
        )
      ORDER BY CASE pd.estado_entrega WHEN 'en_camino' THEN 0 WHEN 'asignado' THEN 1 ELSE 2 END,
               pd.asignado_en, pd.id_pedido`,
    [idRepartidor, ZONA]
  );
  return rows.map(aEntrega);
}

/** Abre una transacción y ejecuta `trabajo(client)`. */
async function enTransaccion(trabajo) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await trabajo(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw traducirAutorInexistente(err) || err;
  } finally {
    client.release();
  }
}

/**
 * Bloquea el pedido y DESPUÉS su fila de pedidos_domicilio (orden de
 * bloqueos). 404 si no existe o no es un domicilio.
 */
async function bloquear(client, idPedido) {
  const p = await client.query(
    'SELECT id_pedido, estado FROM pedidos WHERE id_pedido = $1::int FOR UPDATE',
    [idPedido]
  );
  if (p.rows.length === 0) throw errorDe(404, 'noEncontrado');
  const d = await client.query(
    'SELECT id_pedido, estado_entrega, id_repartidor FROM pedidos_domicilio WHERE id_pedido = $1::int FOR UPDATE',
    [idPedido]
  );
  if (d.rows.length === 0) throw errorDe(404, 'noEncontrado');
  return { pedido: p.rows[0], entrega: d.rows[0] };
}

async function leerEntrega(client, idPedido) {
  const { rows } = await client.query(
    `${SQL_DOMICILIO}
      WHERE pd.id_pedido = $1::int`,
    [idPedido]
  );
  return aEntrega(rows[0]);
}

/** El trigger también exige un repartidor activo: su check_violation es el mismo 409. */
const esRepartidorInvalidoDelTrigger = (err) =>
  Boolean(err) && err.code === '23514' && /no es un repartidor activo/.test(err.message || '');

/**
 * PATCH /domicilios/:id_pedido/repartidor (admin y cajero): asigna o reasigna
 * mientras la entrega esté en 'por_asignar' o 'asignado'. asignado_en se pone
 * en cada asignación (la última es la que vale para el despacho).
 */
async function asignar(idPedido, idRepartidor) {
  try {
    return await enTransaccion(async (client) => {
      const { pedido, entrega } = await bloquear(client, idPedido);
      if (pedido.estado === 'cancelado') throw errorDe(409, 'pedidoCancelado');
      if (!['por_asignar', 'asignado'].includes(entrega.estado_entrega)) throw errorDe(409, 'entregaYaSalio');

      const r = await client.query(
        `SELECT 1 FROM usuarios u WHERE u.id_usuario = $1::int AND u.rol = 'repartidor' AND u.activo`,
        [idRepartidor]
      );
      if (r.rows.length === 0) throw errorDe(409, 'repartidorNoValido');

      await client.query(
        `UPDATE pedidos_domicilio
            SET id_repartidor = $2::int, estado_entrega = 'asignado', asignado_en = now()
          WHERE id_pedido = $1::int`,
        [idPedido, idRepartidor]
      );
      return leerEntrega(client, idPedido);
    });
  } catch (err) {
    // Lo desactivaron entre la comprobación y el UPDATE: el trigger lo para.
    if (esRepartidorInvalidoDelTrigger(err)) throw errorDe(409, 'repartidorNoValido');
    throw err;
  }
}

const transicionInvalida = (estado, accion) =>
  errorConMotivo(409, MOTIVOS.transicionInvalida, `La entrega está en '${estado}': no se puede ${accion}`);

/**
 * Una transición del repartidor, con el pedido y la entrega bloqueados.
 * `decidir(pedido, entrega)` lanza el 409 si no vale; `aplicar(client)` hace
 * los cambios.
 */
async function transicion(idPedido, idRepartidor, decidir, aplicar) {
  return enTransaccion(async (client) => {
    const { pedido, entrega } = await bloquear(client, idPedido);
    if (entrega.id_repartidor !== idRepartidor) throw errorDe(403, 'noEsTuEntrega');
    decidir(pedido, entrega);
    await aplicar(client, pedido);
    return leerEntrega(client, idPedido);
  });
}

/** POST /domicilios/:id_pedido/salir: asignado -> en_camino, solo con el pedido en 'listo'. */
function salir(idPedido, idRepartidor) {
  return transicion(
    idPedido,
    idRepartidor,
    (pedido, entrega) => {
      if (entrega.estado_entrega !== 'asignado') throw transicionInvalida(entrega.estado_entrega, 'salir');
      if (pedido.estado !== 'listo') throw errorDe(409, 'pedidoNoListo');
    },
    (client) =>
      client.query(
        `UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = $1::int`,
        [idPedido]
      )
  );
}

/**
 * POST /domicilios/:id_pedido/entregar: en_camino -> entregado y, en la MISMA
 * transacción, el pedido listo -> entregado firmado por el repartidor
 * (listo -> entregado requiere usuario) y la regla de cierre compartida con el
 * mesero (entregado + pagado + saldo 0 -> 'pagado'). Sin mesa no hay nada que
 * liberar.
 */
function entregar(idPedido, idRepartidor) {
  return transicion(
    idPedido,
    idRepartidor,
    (pedido, entrega) => {
      if (entrega.estado_entrega !== 'en_camino') throw transicionInvalida(entrega.estado_entrega, 'entregar');
      if (pedido.estado !== 'listo') throw errorDe(409, 'pedidoNoListo');
    },
    async (client, pedido) => {
      await client.query(
        `UPDATE pedidos_domicilio SET estado_entrega = 'entregado' WHERE id_pedido = $1::int`,
        [idPedido]
      );
      const entregado = await client.query(
        `UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = $1::int RETURNING *`,
        [idPedido]
      );
      await client.query(
        `INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
         VALUES ($1::int, $2::int, $3::text, 'entregado', $4::text)`,
        [idPedido, idRepartidor, pedido.estado, 'Entregado a domicilio']
      );
      await cerrarSiEntregadoYPagado(client, entregado.rows[0], idRepartidor);
    }
  );
}

/**
 * POST /domicilios/:id_pedido/fallar { motivo }: en_camino -> fallido. FINAL:
 * el pedido se queda en 'listo' y solo el admin puede cancelarlo.
 */
function fallar(idPedido, idRepartidor, motivo) {
  return transicion(
    idPedido,
    idRepartidor,
    (pedido, entrega) => {
      if (entrega.estado_entrega !== 'en_camino') throw transicionInvalida(entrega.estado_entrega, 'marcar como fallida');
    },
    (client) =>
      client.query(
        `UPDATE pedidos_domicilio SET estado_entrega = 'fallido', motivo_fallo = $2::varchar
          WHERE id_pedido = $1::int`,
        [idPedido, motivo]
      )
  );
}

/** GET /usuarios/repartidores: los activos, solo id y nombre. */
async function listarRepartidores() {
  const { rows } = await pool.query(
    `SELECT id_usuario, nombre FROM usuarios
      WHERE rol = 'repartidor' AND activo
      ORDER BY nombre, id_usuario`
  );
  return rows;
}

module.exports = {
  ESTADOS_ENTREGA,
  ESTADOS_NO_TERMINADOS,
  MOTIVOS,
  SQL_DOMICILIO,
  listarDespacho,
  listarMias,
  asignar,
  salir,
  entregar,
  fallar,
  listarRepartidores,
};
