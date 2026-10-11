const { PREFIJO } = require('./redis');
const { TTL_MAX_MINUTOS } = require('../qr');

// Un QR vive como máximo TTL_MAX_MINUTOS y un JWT de comensal unas horas: pasado
// ese tiempo ya nada emitido antes de la revocación puede seguir vigente, así
// que la marca puede expirar sola (con un margen de 1 h).
const TTL_REVOCACION_SEG = TTL_MAX_MINUTOS * 60 + 60 * 60;

/** Revocaciones de QR por mesa en `sd:qr:revocado:{mesa}` (ms desde la época). */
function crearRevocacionesRedis({ cliente }) {
  const llave = (idMesa) => `${PREFIJO}qr:revocado:${idMesa}`;
  return {
    async obtener(idMesa) {
      const v = await cliente.get(llave(idMesa));
      return v === null ? null : Number(v);
    },
    async fijar(idMesa, ms) {
      await cliente.set(llave(idMesa), String(ms), { EX: TTL_REVOCACION_SEG });
    },
  };
}

module.exports = { crearRevocacionesRedis, TTL_REVOCACION_SEG };
