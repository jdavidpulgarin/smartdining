/**
 * Service worker de referencia para las notificaciones push de SmartDining.
 *
 * Cópialo al service worker de la PWA (con vite-plugin-pwa en modo
 * injectManifest, impórtalo desde tu sw.js). Maneja dos eventos:
 *  - push: muestra la notificación con el payload mínimo que envía el
 *    socket-server: { titulo, cuerpo, id_pedido, estado, url }.
 *  - notificationclick: enfoca la PWA si ya está abierta (y la lleva a
 *    /seguimiento) o la abre en /seguimiento.
 *
 * Importante: en iPhone (iOS 16.4+) Web Push solo funciona si la PWA está
 * INSTALADA en la pantalla de inicio. Por eso el aviso principal es el evento
 * de socket dentro de la página (order:status); el push es un extra para
 * cuando el comensal cerró la app.
 */
/* eslint-env serviceworker */

const URL_POR_DEFECTO = '/seguimiento';

/** Solo rutas de la propia PWA: nunca se abre una URL externa que venga en el push. */
function rutaSegura(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return URL_POR_DEFECTO;
  return url;
}

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }
  const titulo = typeof datos.titulo === 'string' ? datos.titulo : 'SmartDining';
  const opciones = {
    body: typeof datos.cuerpo === 'string' ? datos.cuerpo : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    // Un aviso por pedido: si llega "listo" después de "en preparación", lo
    // reemplaza en vez de apilar dos notificaciones.
    tag: datos.id_pedido ? `pedido-${datos.id_pedido}` : 'smartdining',
    renotify: datos.estado === 'listo',
    requireInteraction: datos.estado === 'listo',
    data: { url: rutaSegura(datos.url) },
  };
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(rutaSegura(event.notification.data && event.notification.data.url), self.location.origin).href;

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const ventana of ventanas) {
      if (new URL(ventana.url).origin === self.location.origin) {
        await ventana.focus();
        if ('navigate' in ventana) await ventana.navigate(destino);
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
