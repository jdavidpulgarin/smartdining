# ⚡ Módulo Socket Server (WebSockets & Tiempo Real)

**Responsable:** Roberto Buelvas (Integrante 4)

## Descripción
Servidor de comunicación bidireccional en tiempo real con **Socket.io** para sincronizar las mesas, comandas de cocina y notificaciones de pedidos.

## Levantar en local

1. `npm install`
2. Copia `.env.example` a `.env` y completa:
   - `JWT_SECRET`: el **mismo** que usa `backend/`, o los tokens que emite el backend
     (o `npm run token:comensal`) no van a validar aquí.
   - `INTERNAL_API_KEY`: la **misma** que usa `backend/` para llamar a `/internal/*`.
   - `CORS_ORIGINS` ya trae por defecto los puertos de Vite 5173 a 5175
     (`frontend-cliente`, `frontend-restaurante`, `frontend-kds`); ajústalo si usas otro.
3. `npm run dev` → escucha en `http://localhost:4001` (el backend REST usa el `4000`).
4. Token de prueba sin depender del backend: `npm run token:comensal -- --mesa 5`
   (opcional `--sid <texto>` y `--horas <n>`, por defecto 3). Se niega a correr si falta
   `JWT_SECRET` o si `NODE_ENV=production`.

### Para frontend-cliente

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4001', { auth: { token } }); // token de arriba
socket.emit('join:table', {}, (ack) => { /* ack.carrito trae el snapshot inicial */ });

socket.emit('cart:update', {
  eventId: crypto.randomUUID(),
  accion: 'set',
  id_linea: crypto.randomUUID(), // uno por línea añadida; reusarlo edita esa línea
  comensal: 'Ana',
  id_plato: 3,
  cantidad: 2,
  notas: 'sin cebolla',
}, (ack) => { /* ack.carrito trae el snapshot resultante */ });
```

`id_linea`, roles, `clear` (solo personal) y el resto de eventos están documentados en
detalle en [EVENTS.md](EVENTS.md).

## Tareas Iniciales
1. **Definición de eventos:** Documentar los eventos de WebSocket (nombres de eventos, payloads y salas/rooms por mesa).
   - `join:table`: Unirse a la sala de una mesa mediante token.
   - `cart:update`: Sincronizar el carrito de compras colaborativo entre comensales de la misma mesa.
   - `order:created`: Notificar nueva comanda a la cocina (KDS).
   - `order:status`: Notificar al cliente y al restaurante el cambio de estado del pedido.
2. **Generación de Token QR:** Definir formato de token y validación para el acceso a las mesas.
3. **Módulo de Notificaciones Push & Pagos:** Integración de suscripciones Web Push y lógica de webhook/confirmación de pagos.
