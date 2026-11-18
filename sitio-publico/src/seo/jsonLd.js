const DIAS_SCHEMA = [
  { clave: 'lunes', dayOfWeek: 'Monday' },
  { clave: 'martes', dayOfWeek: 'Tuesday' },
  { clave: 'miercoles', dayOfWeek: 'Wednesday' },
  { clave: 'jueves', dayOfWeek: 'Thursday' },
  { clave: 'viernes', dayOfWeek: 'Friday' },
  { clave: 'sabado', dayOfWeek: 'Saturday' },
  { clave: 'domingo', dayOfWeek: 'Sunday' },
];

function normalizarUrl(url = 'http://localhost:5176') {
  if (!url || typeof url !== 'string') return 'http://localhost:5176';
  return url.replace(/\/+$/, '');
}

function esValorValido(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function limpiarObjeto(obj) {
  const limpio = {};
  for (const [clave, valor] of Object.entries(obj)) {
    if (esValorValido(valor)) {
      limpio[clave] = valor;
    }
  }
  return Object.keys(limpio).length > 0 ? limpio : null;
}

export function construirJsonLd(datos = {}, sitioUrl = 'http://localhost:5176') {
  const base = normalizarUrl(sitioUrl);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
  };

  if (datos.nombre) {
    jsonLd.name = datos.nombre;
  }

  const descRaw = datos.eslogan || datos.historia || '';
  if (descRaw.trim()) {
    const limpia = descRaw.trim();
    jsonLd.description = limpia.length > 160 ? `${limpia.slice(0, 157).trim()}...` : limpia;
  }

  jsonLd.url = `${base}/`;
  jsonLd.logo = `${base}/logo.png`;
  jsonLd.image = `${base}/og.png`;
  jsonLd.hasMenu = `${base}/#carta`;
  jsonLd.acceptsReservations = false;

  if (datos.direccion) {
    const rawAddress = {
      '@type': 'PostalAddress',
      streetAddress: datos.direccion.calle,
      addressLocality: datos.direccion.ciudad,
      addressRegion: datos.direccion.region,
      postalCode: datos.direccion.codigoPostal,
      addressCountry: datos.direccion.pais || 'CO',
    };
    const addressLimpia = limpiarObjeto(rawAddress);
    // Solo agregar address si tiene al menos una propiedad además de @type
    if (addressLimpia && Object.keys(addressLimpia).length > 1) {
      jsonLd.address = addressLimpia;
    }
  }

  if (datos.telefono) {
    jsonLd.telephone = datos.telefono;
  }

  if (datos.correo) {
    jsonLd.email = datos.correo;
  }

  if (datos.anioFundacion) {
    jsonLd.foundingDate = String(datos.anioFundacion);
  }

  if (Array.isArray(datos.redes)) {
    const sameAsUrls = datos.redes
      .map((r) => r?.url)
      .filter((u) => typeof u === 'string' && u.trim().startsWith('http'));
    if (sameAsUrls.length > 0) {
      jsonLd.sameAs = sameAsUrls;
    }
  }

  if (datos.horario && typeof datos.horario === 'object') {
    const specs = [];
    for (const def of DIAS_SCHEMA) {
      const entrada = datos.horario[def.clave];
      if (entrada && typeof entrada === 'object' && entrada.abre && entrada.cierra) {
        specs.push({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: def.dayOfWeek,
          opens: entrada.abre,
          closes: entrada.cierra,
        });
      }
    }
    if (specs.length > 0) {
      jsonLd.openingHoursSpecification = specs;
    }
  }

  return jsonLd;
}

export function construirMetaDescription(datos = {}) {
  const nombre = datos.nombre || 'SmartDining Restaurante';
  const ciudad = datos.direccion?.ciudad || 'Valledupar';
  const frase = `Descubre la carta digital de ${nombre} en ${ciudad}. Conoce nuestros platos, ingredientes de la región y pide desde tu mesa con el QR.`;
  if (frase.length >= 140 && frase.length <= 160) {
    return frase;
  }
  if (frase.length < 140) {
    const expandida = `Explora la carta digital de ${nombre} en la ciudad de ${ciudad}. Conoce nuestra historia, platos y bebidas, y pide desde tu mesa con el QR.`;
    return expandida.length > 160 ? `${expandida.slice(0, 157)}...` : expandida;
  }
  return `${frase.slice(0, 157)}...`;
}

export function serializarJsonLdSeguro(jsonLd) {
  return JSON.stringify(jsonLd, null, 2).replace(/</g, '\\u003c');
}

export default {
  construirJsonLd,
  construirMetaDescription,
  serializarJsonLdSeguro,
};
