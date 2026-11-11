/* eslint-env serviceworker */

const URL_POR_DEFECTO = '/seguimiento';
const ICONO_PUSH = '/icons/pwa-192x192.png';
// No hay ícono monocromo dedicado en public/icons/; se reutiliza ICONO_PUSH.
const BADGE_PUSH = ICONO_PUSH;

// Copia sincronizada con src/utils/notificacionPush.js (formatearNotificacionPush):
// public/sw-push.js se carga vía importScripts() en un service worker clásico y
// no puede importar módulos ES de src/.
const TEXTOS_POR_ESTADO = {
  en_preparacion: {
    titulo: 'Tu pedido está en preparación 👨🍳',
    cuerpo: (ref) => `${ref}Te avisamos cuando esté listo.`,
  },
  listo: {
    titulo: '¡Tu plato está listo! 🍽️',
    cuerpo: (ref) => `${ref}Ya sale de cocina hacia tu mesa.`,
  },
  cancelado: {
    titulo: 'Tu pedido fue cancelado',
    cuerpo: (ref) => `${ref}Pregúntale al mesero si necesitas ayuda.`,
  },
};

function formatearNotificacionPush(datos = {}) {
  const payload = datos && typeof datos === 'object' ? datos : {};
  const estado = typeof payload.estado === 'string' ? payload.estado : '';
  const cuerpoCrudo = typeof payload.cuerpo === 'string' ? payload.cuerpo : '';
  const plantilla = TEXTOS_POR_ESTADO[estado];

  if (plantilla) {
    const cuerpoLimpio = cuerpoCrudo.trim();
    const ref = cuerpoLimpio ? `Pedido ${cuerpoLimpio}. ` : '';
    return {
      titulo: plantilla.titulo,
      cuerpo: plantilla.cuerpo(ref),
    };
  }

  const titulo =
    typeof payload.titulo === 'string' && payload.titulo.trim()
      ? payload.titulo.trim()
      : 'SmartDining';
  return {
    titulo,
    cuerpo: cuerpoCrudo,
  };
}

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

  const { titulo, cuerpo } = formatearNotificacionPush(datos);
  const url = rutaSegura(datos.url);
  const idPedido = datos.id_pedido ?? null;
  const estado = typeof datos.estado === 'string' ? datos.estado : null;

  const opciones = {
    body: cuerpo,
    icon: ICONO_PUSH,
    badge: BADGE_PUSH,
    tag: idPedido !== null ? `pedido-${idPedido}` : 'smartdining',
    renotify: true,
    requireInteraction: estado === 'listo',
    vibrate: [200, 100, 200],
    actions: [{ action: 'ver', title: 'Ver mi pedido' }],
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
  if (event.action && event.action !== 'ver') return;

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
            if (ventana.url !== destino && 'navigate' in ventana) {
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
