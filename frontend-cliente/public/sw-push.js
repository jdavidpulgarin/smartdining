/* eslint-env serviceworker */

const URL_POR_DEFECTO = '/seguimiento';
const ICONO_PUSH = '/icons/pwa-192x192.png';

/**
 * Valida que la URL destino pertenezca a la propia PWA (ruta relativa).
 */
function rutaSegura(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) {
    return URL_POR_DEFECTO;
  }
  return url;
}

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }

  const titulo =
    typeof datos.titulo === 'string' && datos.titulo.trim()
      ? datos.titulo.trim()
      : 'SmartDining';
  const cuerpo = typeof datos.cuerpo === 'string' ? datos.cuerpo : '';
  const url = rutaSegura(datos.url);
  const idPedido = datos.id_pedido ?? null;
  const estado = typeof datos.estado === 'string' ? datos.estado : null;

  const opciones = {
    body: cuerpo,
    icon: ICONO_PUSH,
    badge: ICONO_PUSH,
    tag: idPedido ? `pedido-${idPedido}` : 'smartdining',
    renotify: estado === 'listo',
    requireInteraction: estado === 'listo',
    data: {
      url,
      id_pedido: idPedido,
      estado,
    },
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlGuardada =
    event.notification.data && event.notification.data.url;
  const destino = new URL(rutaSegura(urlGuardada), self.location.origin).href;

  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const ventana of ventanas) {
        try {
          if (new URL(ventana.url).origin === self.location.origin) {
            await ventana.focus();
            if ('navigate' in ventana) {
              await ventana.navigate(destino);
            }
            return;
          }
        } catch {
          // Ignorar ventanas con URL no parseable
        }
      }

      await self.clients.openWindow(destino);
    })()
  );
});
