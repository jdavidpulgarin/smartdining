import { pedirJson } from './api';

let cacheConfigPromise = null;

const DIAS_ORDEN = [
  { claves: ['lunes'], dia: 'Lunes' },
  { claves: ['martes'], dia: 'Martes' },
  { claves: ['miercoles', 'miércoles'], dia: 'Miércoles' },
  { claves: ['jueves'], dia: 'Jueves' },
  { claves: ['viernes'], dia: 'Viernes' },
  { claves: ['sabado', 'sábado'], dia: 'Sábado' },
  { claves: ['domingo'], dia: 'Domingo' },
];

const ETIQUETAS_REDES = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  x: 'X',
  twitter: 'X',
  youtube: 'YouTube',
  web: 'Sitio web',
};

function limpiarTexto(valor) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

function normalizarEntradaDia(diaEtiqueta, valor) {
  if (!valor) return null;
  if (typeof valor === 'string') {
    const texto = limpiarTexto(valor);
    return texto ? { dia: diaEtiqueta, abre: null, cierra: null, texto } : null;
  }
  if (typeof valor === 'object' && !Array.isArray(valor)) {
    if (valor.cerrado === true) {
      return { dia: diaEtiqueta, abre: null, cierra: null, texto: 'Cerrado' };
    }
    const abre = limpiarTexto(valor.abre);
    const cierra = limpiarTexto(valor.cierra);
    if (abre && cierra) {
      return {
        dia: diaEtiqueta,
        abre,
        cierra,
        texto: `${abre} - ${cierra}`,
      };
    }
    const textoDirecto = limpiarTexto(valor.texto ?? valor.horario);
    if (textoDirecto) {
      return { dia: diaEtiqueta, abre: null, cierra: null, texto: textoDirecto };
    }
  }
  return null;
}

export function normalizarHorario(horarioCrudo) {
  if (!horarioCrudo) return null;

  if (typeof horarioCrudo === 'string') {
    const texto = limpiarTexto(horarioCrudo);
    return texto
      ? [{ dia: 'Horario', abre: null, cierra: null, texto }]
      : null;
  }

  if (Array.isArray(horarioCrudo)) {
    const items = horarioCrudo
      .map((item) => {
        if (typeof item === 'string') {
          return normalizarEntradaDia('Horario', item);
        }
        if (item && typeof item === 'object') {
          const dia = limpiarTexto(item.dia) || 'Horario';
          return normalizarEntradaDia(dia, item);
        }
        return null;
      })
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }

  if (typeof horarioCrudo === 'object') {
    const entradasCrudas = Object.entries(horarioCrudo);
    if (entradasCrudas.length === 0) return null;

    const resultado = [];
    const clavesUsadas = new Set();

    for (const def of DIAS_ORDEN) {
      const encontrada = entradasCrudas.find(([k]) =>
        def.claves.includes(k.trim().toLowerCase())
      );
      if (encontrada) {
        clavesUsadas.add(encontrada[0]);
        const normalizada = normalizarEntradaDia(def.dia, encontrada[1]);
        if (normalizada) {
          resultado.push(normalizada);
        }
      }
    }

    for (const [clave, valor] of entradasCrudas) {
      if (clavesUsadas.has(clave)) continue;
      const etiqueta = limpiarTexto(clave);
      if (!etiqueta) continue;
      const diaFormateado =
        etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1);
      const normalizada = normalizarEntradaDia(diaFormateado, valor);
      if (normalizada) {
        resultado.push(normalizada);
      }
    }

    return resultado.length > 0 ? resultado : null;
  }

  return null;
}

export function normalizarRedes(redesCrudo) {
  if (!redesCrudo) return null;

  if (Array.isArray(redesCrudo)) {
    const lista = redesCrudo
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const nombre = limpiarTexto(item.nombre ?? item.red);
        const valor = limpiarTexto(item.url ?? item.enlace ?? item.valor);
        if (!nombre && !valor) return null;
        const esUrl =
          typeof valor === 'string' && /^https?:\/\//i.test(valor);
        return {
          nombre: nombre || valor,
          valor: valor || nombre,
          url: esUrl ? valor : null,
        };
      })
      .filter(Boolean);
    return lista.length > 0 ? lista : null;
  }

  if (typeof redesCrudo === 'object') {
    const lista = [];
    for (const [clave, valorCrudo] of Object.entries(redesCrudo)) {
      const valor = limpiarTexto(valorCrudo);
      if (!valor) continue;
      const claveNorm = clave.trim().toLowerCase();
      const nombre =
        ETIQUETAS_REDES[claveNorm] ||
        clave.trim().charAt(0).toUpperCase() + clave.trim().slice(1);
      const esUrl = /^https?:\/\//i.test(valor);
      lista.push({
        nombre,
        valor,
        url: esUrl ? valor : null,
      });
    }
    return lista.length > 0 ? lista : null;
  }

  return null;
}

/**
 * Normaliza la respuesta de GET /api/configuracion sin inventar datos faltantes.
 * Todo campo ausente, vacío o inválido queda en null.
 */
export function normalizarConfiguracion(crudo) {
  const baseVacia = {
    nombre: null,
    direccion: null,
    horario: null,
    telefono: null,
    correo: null,
    redes: null,
    url_logo: null,
    moneda: null,
    propina_sugerida_pct: null,
  };

  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return baseVacia;
  }

  const propinaNum =
    crudo.propina_sugerida_pct !== null &&
    crudo.propina_sugerida_pct !== undefined &&
    crudo.propina_sugerida_pct !== ''
      ? Number(crudo.propina_sugerida_pct)
      : NaN;

  return {
    nombre: limpiarTexto(crudo.nombre),
    direccion: limpiarTexto(crudo.direccion),
    horario: normalizarHorario(crudo.horario),
    telefono: limpiarTexto(crudo.telefono),
    correo: limpiarTexto(crudo.correo ?? crudo.email),
    redes: normalizarRedes(crudo.redes),
    url_logo: limpiarTexto(crudo.url_logo ?? crudo.logo),
    moneda: limpiarTexto(crudo.moneda),
    propina_sugerida_pct:
      Number.isFinite(propinaNum) && propinaNum >= 0 ? propinaNum : null,
  };
}

export function tieneDatosRestaurante(config) {
  if (!config || typeof config !== 'object') return false;
  return Boolean(
    config.direccion ||
      (Array.isArray(config.horario) && config.horario.length > 0) ||
      config.telefono ||
      config.correo ||
      (Array.isArray(config.redes) && config.redes.length > 0)
  );
}

export function recargarConfiguracion() {
  cacheConfigPromise = null;
}

async function fetchConfiguracionRaw() {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const modulo = await import('../mocks/configuracion-simulada.json');
    return modulo.default || modulo;
  }
  return pedirJson('/configuracion');
}

export function obtenerConfiguracionRaw({ forzar = false } = {}) {
  if (forzar) {
    cacheConfigPromise = null;
  }
  if (!cacheConfigPromise) {
    cacheConfigPromise = fetchConfiguracionRaw().catch((err) => {
      cacheConfigPromise = null;
      throw err;
    });
  }
  return cacheConfigPromise;
}

export async function obtenerConfiguracionPublica(opciones = {}) {
  const raw = await obtenerConfiguracionRaw(opciones);
  return normalizarConfiguracion(raw);
}

export default {
  normalizarConfiguracion,
  normalizarHorario,
  normalizarRedes,
  tieneDatosRestaurante,
  obtenerConfiguracionRaw,
  obtenerConfiguracionPublica,
  recargarConfiguracion,
};
