// Dobles para las pruebas de pagos: llaves de Wompi con el formato real pero
// aleatorias (ninguna llave real en el repositorio) y un backend falso.
const crypto = require('node:crypto');

const hex = (n = 32) => crypto.randomBytes(n).toString('hex');

const WOMPI_ENV = {
  WOMPI_PUBLIC_KEY: `pub_test_${hex(16)}`,
  WOMPI_PRIVATE_KEY: `prv_test_${hex(16)}`,
  WOMPI_INTEGRITY_SECRET: `test_integrity_${hex(16)}`,
  WOMPI_EVENTS_SECRET: `test_events_${hex(16)}`,
  WOMPI_API_URL: 'https://sandbox.wompi.co/v1',
  BACKEND_URL: 'http://backend-falso:4000',
};

/** Cuenta con la forma del contrato GET /api/mesas/:id/cuenta/interno. */
const cuenta = (id_mesa, total, saldo = total, porComensal = {}) => ({
  id_mesa,
  moneda: 'COP',
  total_centavos: total,
  saldo_centavos: saldo,
  por_comensal: Object.entries(porComensal).map(([comensal, s]) => ({ comensal, saldo_centavos: s })),
});

/**
 * Backend falso. `rutas` mapea "GET /api/..." o "POST /api/..." a una función
 * (cuerpo) => { status, cuerpo } | Error (simula sin respuesta).
 */
function backendFalso(rutas = {}) {
  const llamadas = [];
  const pedir = async (metodo, ruta, cuerpo) => {
    llamadas.push({ metodo, ruta, cuerpo });
    const fn = rutas[`${metodo} ${ruta}`];
    if (!fn) return { ok: false, status: 404, cuerpo: null };
    const r = await fn(cuerpo);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, cuerpo: r.cuerpo };
  };
  return {
    llamadas,
    rutas,
    get: (ruta) => pedir('GET', ruta),
    post: (ruta, cuerpo) => pedir('POST', ruta, cuerpo),
  };
}

const sinRespuesta = () => Object.assign(new Error('El backend no respondió a tiempo'), { codigo: 'BACKEND_TIMEOUT' });

module.exports = {
  WOMPI_ENV, cuenta, backendFalso, sinRespuesta, hex,
};
