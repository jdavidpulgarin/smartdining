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
// Igual con NODE_ENV: este archivo se carga ANTES de que server.js llame a
// dotenv.config(), y dotenv no sobrescribe lo que ya existe, así que fijarlo
// aquí gana sobre el .env de quien corra la suite. Hace falta desde que hay
// comportamiento que depende de NODE_ENV === 'development' (el modo red local):
// sin esto, la suite se comportaría de una forma en una máquina con
// NODE_ENV=development en su .env y de otra en el CI, que no tiene .env. Las
// pruebas que quieren el modo desarrollo lo inyectan ellas, por parámetro.
process.env.NODE_ENV = 'test';

