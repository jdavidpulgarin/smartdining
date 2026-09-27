const { createClient } = require('redis');
require('dotenv').config();

// Cliente Redis para cache de sesiones activas.
// OJO: coordinar con Roberto el prefijo de llaves (ej. "session:") para no
// chocar con el TTL de tokens QR que maneja su socket-server.
const redisClient = createClient({ url: process.env.REDIS_URL });

redisClient.on('error', (err) => console.error('Error de Redis:', err));

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
}

module.exports = { redisClient, connectRedis };
