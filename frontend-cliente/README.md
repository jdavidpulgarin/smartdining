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

- `npm run dev`: Inicia el servidor de desarrollo Vite en el puerto `5174`, expuesto a la red local (`host: true`).
- `npm run build`: Genera el build de producción en la carpeta `dist`, incluyendo el Service Worker (`sw.js`) y `manifest.webmanifest`.
- `npm run preview`: Previsualiza la versión de producción generada.
- `npm run lint`: Ejecuta el linter del proyecto con Oxlint.
- `npm test`: Ejecuta las pruebas unitarias con Vitest.

### Pruebas en el celular (Red Local)

Para probar la aplicación desde un celular o dispositivo móvil conectado a la misma red:

1. Conecta el celular y el computador a la misma red Wi-Fi o red local.
2. Inicia los servicios del sistema:
   - Base de datos (PostgreSQL).
   - Backend en puerto `4000` (`npm run dev` en `backend/`).
   - Socket-server en puerto `4001` (`npm run dev` en `socket-server/`).
   - Panel de administración en puerto `5173` (`npm run dev` en `frontend-restaurante/`).
   - Frontend-cliente en puerto `5174` (`npm run dev` en `frontend-cliente/`).
   *(El resto de la configuración general se encuentra en el README de la raíz).*
3. **Firewall (Windows):** La primera vez que arranca Node.js en estos puertos suele aparecer el aviso del firewall de Windows; es indispensable marcar **"Redes privadas"** y hacer clic en **"Permitir acceso"**, o el celular no podrá conectarse.
4. Identifica la IP local de tu computador (ej. con `ipconfig` en Windows o `ifconfig` / `ip a` en Linux/macOS).
5. Abre la aplicación en el celular:
   - Lo normal es escanear el código QR que muestra el panel de administración (`frontend-restaurante`, puerto 5173) al abrir la mesa.
   - También puedes ingresar manualmente desde el navegador del celular a:
     ```text
     http://<IP-del-PC>:5174/?token=<token>
     ```
6. En desarrollo, el cliente detecta automáticamente la IP desde la que se abrió y conecta a la API (`http://<IP-del-PC>:4000/api`) y al socket (`http://<IP-del-PC>:4001`) sin necesidad de configurar variables de entorno en `.env`.
