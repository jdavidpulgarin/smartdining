// Se carga con `node --test --require` ANTES que cualquier prueba (H-16).
//
// src/config/redis.js y db.js llaman a dotenv.config(). Si el .env de quien
// corre la suite trae REDIS_URL, las pruebas que no usan el doble de Redis
// abren un cliente real que nadie cierra (o que reintenta para siempre si
// Redis está apagado) y `npm test` nunca termina; además los alias quedan
// reservados en ese Redis y alias-comensal.test.js falla al repetirse.
//
// dotenv no sobrescribe variables que ya existen, aunque estén vacías: al
// dejarla vacía aquí, el .env se ignora para REDIS_URL y las pruebas se
// comportan igual que en el CI (sin .env). Las que necesitan Redis usan
// tests/helpers/fake-redis.js, que fija su propia REDIS_URL falsa.
process.env.REDIS_URL = '';
