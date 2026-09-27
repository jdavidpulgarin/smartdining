// Genera un par de llaves VAPID para Web Push e imprime las líneas listas
// para pegar en .env. Se ejecuta UNA vez por entorno: si cambias la llave
// pública, todas las suscripciones existentes dejan de funcionar y cada
// comensal tendría que volver a suscribirse.
//
// Uso: npm run vapid
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('# Pega estas líneas en socket-server/.env (la privada NO se sube al repositorio)');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('# El subject identifica al emisor ante el servicio push: mailto: o https://');
console.log('VAPID_SUBJECT=mailto:tu-correo@ejemplo.com');
