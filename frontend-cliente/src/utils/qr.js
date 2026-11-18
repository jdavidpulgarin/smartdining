/**
 * Decodifica de forma segura el número de mesa incluido en el payload de un token QR.
 *
 * Formato del token: v1.<payload base64url>.<firma>
 * Payload esperado: { m: id_mesa, iat, exp, sid }
 *
 * @param {string} token
 * @returns {number|null} El número de mesa si es un entero positivo válido, o null en cualquier otro caso.
 */
export function leerMesaDelQr(token) {
  if (typeof token !== 'string') return null;

  const partes = token.trim().split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return null;

  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );

    let jsonStr = '';
    if (typeof atob === 'function') {
      jsonStr = atob(padded);
    } else if (typeof Buffer !== 'undefined') {
      jsonStr = Buffer.from(padded, 'base64').toString('utf-8');
    } else {
      return null;
    }

    const payload = JSON.parse(jsonStr);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const m = payload.m;
    if (typeof m === 'number' && Number.isInteger(m) && m > 0) {
      return m;
    }

    return null;
  } catch {
    return null;
  }
}

export default {
  leerMesaDelQr,
};
