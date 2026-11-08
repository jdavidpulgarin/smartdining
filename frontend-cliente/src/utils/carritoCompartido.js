import { calcularPlato } from './calcularPlato';

/**
 * Busca un plato en el menú (normalizado o crudo).
 */
export function buscarPlatoEnMenu(menu, idPlato) {
  const cats = Array.isArray(menu)
    ? menu
    : Array.isArray(menu?.categorias)
      ? menu.categorias
      : [];
  const idNum = Number(idPlato);
  for (const cat of cats) {
    for (const plato of cat.platos || []) {
      if (Number(plato.id_plato) === idNum) {
        return plato;
      }
    }
  }
  return null;
}

/**
 * Enriquece los ítems que devuelve el socket-server con la información del menú.
 * Calcula precios mediante calcularPlato (armables) o plato.precio (simples).
 */
export function enriquecerItems(items = [], menu = [], miAlias = '') {
  if (!Array.isArray(items)) return [];

  const aliasNormalizado =
    typeof miAlias === 'string' ? miAlias.trim().toLowerCase() : '';

  return items.map((item) => {
    const idPlato = Number(item.id_plato);
    const plato = buscarPlatoEnMenu(menu, idPlato);
    const cantidad = Math.min(
      20,
      Math.max(1, Math.floor(Number(item.cantidad) || 1))
    );
    const comensal = typeof item.comensal === 'string' ? item.comensal.trim() : '';
    const esMia = Boolean(
      aliasNormalizado && comensal.toLowerCase() === aliasNormalizado
    );

    let nombre = plato?.nombre || 'Plato no disponible';
    let url_imagen = plato?.url_imagen || plato?.imagen || null;
    let precioUnitario = Number(plato?.precio) || 0;
    let calorias = plato?.calorias ?? null;
    let alergenos = Array.isArray(plato?.alergenos) ? [...plato.alergenos] : [];
    let detalle = [];
    let disponible = plato ? plato.disponible !== false : false;

    if (plato && plato.personalizable && Array.isArray(item.ingredientes)) {
      const selecciones = {};
      const pasos = plato.pasos || [];

      for (const ingItem of item.ingredientes) {
        const idIngNum = Number(ingItem.id_ingrediente);
        const porcion = ingItem.porcion || 'normal';
        let pasoEncontrado = null;
        let ingEncontrado = null;

        for (const p of pasos) {
          const ingObj = (p.ingredientes || []).find(
            (i) => Number(i.id_ingrediente) === idIngNum
          );
          if (ingObj) {
            pasoEncontrado = p;
            ingEncontrado = ingObj;
            break;
          }
        }

        if (pasoEncontrado && ingEncontrado) {
          if (!selecciones[pasoEncontrado.id_paso]) {
            selecciones[pasoEncontrado.id_paso] = {};
          }
          selecciones[pasoEncontrado.id_paso][idIngNum] = porcion;

          if (ingEncontrado.disponible === false) {
            disponible = false;
          }
        } else {
          disponible = false;
        }
      }

      const calculo = calcularPlato(plato, selecciones);
      precioUnitario = calculo.precio;
      calorias = calculo.calorias;
      alergenos = calculo.alergenos;
      detalle = calculo.detalle;
    }

    const subtotal = precioUnitario * cantidad;

    return {
      id_linea: String(item.id_linea),
      comensal,
      id_plato: idPlato,
      cantidad,
      notas: typeof item.notas === 'string' ? item.notas.slice(0, 200) : '',
      nombre,
      url_imagen,
      precioUnitario,
      subtotal,
      calorias,
      alergenos,
      detalle,
      ingredientes: Array.isArray(item.ingredientes) ? item.ingredientes : [],
      esMia,
      disponible,
    };
  });
}

/**
 * Agrupa las líneas enriquecidas en "lo mío" y "lo de otros comensales" (ordenados alfabéticamente).
 */
export function agruparPorComensal(lineas = [], _miAlias = '') {
  if (!Array.isArray(lineas)) return { mias: [], otros: [] };

  const mias = [];
  const mapaOtros = new Map();

  for (const linea of lineas) {
    if (linea.esMia) {
      mias.push(linea);
    } else {
      const nombreOtro = linea.comensal || 'Otro';
      if (!mapaOtros.has(nombreOtro)) {
        mapaOtros.set(nombreOtro, {
          comensal: nombreOtro,
          lineas: [],
          subtotal: 0,
        });
      }
      const grupo = mapaOtros.get(nombreOtro);
      grupo.lineas.push(linea);
      grupo.subtotal += Number(linea.subtotal) || 0;
    }
  }

  const otros = Array.from(mapaOtros.values()).sort((a, b) =>
    a.comensal.localeCompare(b.comensal)
  );

  return { mias, otros };
}

/**
 * Construye el payload limpio para la acción 'set' de cart:update.
 */
export function construirSet(linea) {
  if (!linea) throw new Error('linea es requerida');
  const id_plato = Number(linea.id_plato ?? linea.idPlato);
  if (!id_plato || isNaN(id_plato)) {
    throw new Error('id_plato válido es requerido');
  }

  const cantidad = Math.min(
    20,
    Math.max(1, Math.floor(Number(linea.cantidad) || 1))
  );

  const payload = {
    accion: 'set',
    id_linea: String(linea.id_linea),
    id_plato,
    cantidad,
  };

  const notas = linea.notas || linea.notasCocina || linea.notasCliente;
  if (typeof notas === 'string' && notas.trim()) {
    payload.notas = notas.trim().slice(0, 200);
  }

  const ingredientesRaw = Array.isArray(linea.ingredientes)
    ? linea.ingredientes
    : Array.isArray(linea.selecciones)
      ? linea.selecciones
      : null;

  if (ingredientesRaw && ingredientesRaw.length > 0) {
    const vistos = new Set();
    const ingredientes = [];
    for (const ing of ingredientesRaw) {
      const id = Number(ing.id_ingrediente ?? ing.idIngrediente);
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      ingredientes.push({
        id_ingrediente: id,
        porcion: ing.porcion || 'normal',
      });
      if (ingredientes.length >= 20) break;
    }
    if (ingredientes.length > 0) {
      payload.ingredientes = ingredientes;
    }
  }

  return payload;
}

/**
 * Construye el payload limpio para la acción 'remove' de cart:update.
 */
export function construirRemove(id_linea) {
  if (!id_linea) throw new Error('id_linea es requerido');
  return {
    accion: 'remove',
    id_linea: String(id_linea),
  };
}

/**
 * Calcula los totales globales y de la propia persona para la mesa.
 */
export function totalesMesa(lineas = []) {
  if (!Array.isArray(lineas)) return { mio: 0, mesa: 0, unidades: 0 };
  let mio = 0;
  let mesa = 0;
  let unidades = 0;

  for (const l of lineas) {
    const sub = Number(l.subtotal) || 0;
    const cant = Number(l.cantidad) || 0;
    if (l.esMia) {
      mio += sub;
    }
    mesa += sub;
    unidades += cant;
  }

  return { mio, mesa, unidades };
}

/**
 * Valida si un comensal puede enviar su pedido al backend.
 */
export function puedoEnviar(misLineas = []) {
  if (!Array.isArray(misLineas) || misLineas.length === 0) {
    return { ok: false, motivo: 'No tienes platos en tu pedido' };
  }
  if (misLineas.length > 50) {
    return { ok: false, motivo: 'No puedes enviar más de 50 ítems por pedido' };
  }
  const tieneAgotados = misLineas.some((l) => l.disponible === false);
  if (tieneAgotados) {
    return {
      ok: false,
      motivo: 'Tienes platos con ingredientes agotados: quítalos para enviar',
    };
  }
  return { ok: true, motivo: null };
}

/**
 * Traduce códigos de error del socket a mensajes legibles en español.
 */
export function traducirErrorSocket(codigo, err) {
  const cod = codigo || err?.codigo || err?.message;
  switch (cod) {
    case 'NO_AUTORIZADO':
      return 'Solo puedes cambiar tus propios platos';
    case 'RATE_LIMIT':
      return 'Vas muy rápido, espera un momento';
    case 'PAYLOAD_INVALIDO':
      return 'No se pudo guardar ese cambio';
    case 'SIN_RESPUESTA':
    case 'ERROR_INTERNO':
      return 'Sin conexión, reintentando…';
    case 'SIN_SALA':
      return 'Conectando con la mesa…';
    case 'SESION_CERRADA':
      return 'La sesión de la mesa terminó';
    default:
      return 'No se pudo actualizar el carrito';
  }
}
