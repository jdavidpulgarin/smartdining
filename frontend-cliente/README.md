# 📱 Frontend Cliente (PWA)

**Responsable:** Juan Buelvas (Integrante 1)

## Descripción
Aplicación web progresiva (PWA) diseñada para dispositivos móviles utilizando **React + Vite**. Permite a los comensales interactuar con el restaurante directamente desde su navegador tras escanear el código QR.

## Características Clave
- Lectura / ingreso por token QR de mesa.
- Menú digital visual e interactivo (filtros por categoría, alérgenos, descripciones).
- Carrito colaborativo en tiempo real (múltiples personas en la misma mesa agregando platos).
- Envío de pedido y seguimiento de estado en vivo (Recibido -> En Preparación -> Listo -> Entregado).
- Solicitud de cuenta y opciones de pago.

## Configuración y Ejecución

El proyecto cuenta con soporte para Progressive Web App (PWA) mediante `vite-plugin-pwa`, generando el Service Worker y manifiesto de forma automática para funcionamiento offline e instalación móvil.

### Scripts disponibles

- `npm run dev`: Inicia el servidor de desarrollo en local con soporte para PWA en modo dev.
- `npm run build`: Genera el build de producción en la carpeta `dist`, incluyendo el Service Worker (`sw.js`) y `manifest.webmanifest`.
- `npm run preview`: Previsualiza la versión de producción generada.
- `npm run lint`: Ejecuta el linter del proyecto con Oxlint.
