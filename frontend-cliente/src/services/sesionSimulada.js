import { ErrorApi } from './api';

function codificarBase64Url(objeto) {
  const json = JSON.stringify(objeto);
  const bytes = new TextEncoder().encode(json);
  let binario = '';
  for (const byte of bytes) {
    binario += String.fromCharCode(byte);
  }
  return btoa(binario)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function crearSesionSimulada(tokenQr, comensal) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  const tokenLimpio = String(tokenQr || '').trim();
  const comensalLimpio = String(comensal || '').trim();

  if (tokenLimpio === 'simulado-expirado') {
    throw new ErrorApi({
      status: 401,
      motivo: 'expirado',
      mensaje: 'El QR de la mesa expiró, pide uno nuevo al mesero',
    });
  }

  if (tokenLimpio === 'simulado-revocado') {
    throw new ErrorApi({
      status: 401,
      motivo: 'revocado',
      mensaje: 'La sesión de esa mesa ya se cerró, escanea el QR nuevo',
    });
  }

  if (tokenLimpio === 'simulado-caido') {
    throw new ErrorApi({
      status: 503,
      motivo: 'servicio_no_disponible',
      mensaje:
        'No se pudo validar el QR: el servicio de tiempo real no responde',
    });
  }

  if (comensalLimpio.toLowerCase() === 'ocupado') {
    throw new ErrorApi({
      status: 409,
      motivo: 'alias_en_uso',
      mensaje: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
    });
  }

  if (tokenLimpio.startsWith('simulado')) {
    const expSegundos = Math.floor(Date.now() / 1000) + 4 * 3600;
    const header = codificarBase64Url({ alg: 'HS256', typ: 'JWT' });
    const payload = codificarBase64Url({
      id_mesa: 5,
      rol: 'comensal',
      comensal: comensalLimpio,
      exp: expSegundos,
    });

    return {
      token: `${header}.${payload}.simulada`,
      comensal: comensalLimpio,
      expira_en: '4h',
      qr_expira_en: '20m',
      mesa: {
        id_mesa: 5,
        numero: 5,
        capacidad: 4,
        ubicacion: 'Terraza',
        estado: 'ocupada',
      },
    };
  }

  throw new ErrorApi({
    status: 401,
    motivo: 'formato',
    mensaje: 'El código QR no es válido',
  });
}

export default {
  crearSesionSimulada,
};
