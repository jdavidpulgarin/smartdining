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
4. Token de prueba sin depender del backend: `npm run token:comensal -- --mesa 5 --comensal Ana`
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
  id_plato: 3,                   // sin `comensal`: el servidor usa el alias del JWT
  cantidad: 2,
  notas: 'sin cebolla',
}, (ack) => { /* ack.carrito trae el snapshot resultante */ });
```

### Notificaciones push y iPhone

El aviso principal de "tu plato está listo" es el evento de socket `order:status` dentro de la
PWA. El Web Push es un extra para cuando el comensal cerró la app:

- **Android (Chrome, Edge, Firefox) y escritorio:** funciona desde el navegador.
- **iPhone/iPad:** solo con **iOS 16.4 o posterior** y con la PWA **instalada** (Compartir →
  "Agregar a pantalla de inicio"), abierta desde ese ícono y después de que el comensal
  acepte el permiso. En Safari sin instalar, `PushManager` no existe y el push no llega.
- Por eso la PWA no debe depender del push: tiene que mostrar el estado del pedido en vivo
  con el socket, y ofrecer las notificaciones solo cuando `'PushManager' in window`.

Service worker de referencia: [examples/sw-push.js](examples/sw-push.js).

### Persistencia con Redis

Con `REDIS_URL` el estado vive en Redis y sobrevive a reinicios (sin ella, solo en desarrollo,
vive en memoria; con `NODE_ENV=production` el servidor no arranca sin Redis):

| Llave | Tipo | Contenido | TTL |
|---|---|---|---|
| `sd:carrito:{mesa}` | string (JSON) | `{ version, items }`, actualizado con WATCH/MULTI | 24 h |
| `sd:idem:{ámbito}:{eventId}` | string | eventos ya procesados (`SET NX`) | 10 min (pagos: 7 días) |
| `sd:qr:revocado:{mesa}` | string | ms de la última liberación de la mesa | 25 h |
| `sd:push:{mesa}` | hash | endpoint → suscripción Web Push | 24 h |

El ámbito de `sd:idem` empieza por el rol cuando el evento viene de un socket (por ejemplo
`sd:idem:comensal:cart:5:<eventId>`) y por el tipo de evento cuando viene del backend
(`sd:idem:order:status:<eventId>`), para que el mismo UUID en otra mesa no sea un duplicado.

Si Redis se cae: `/health` responde `503 degradado`, los eventos que cambian estado
responden `ERROR_INTERNO` (el cliente reintenta con el mismo `eventId`) y las conexiones de
comensal se rechazan con `ERROR_INTERNO`. Nunca se pasa a memoria en silencio.

**Prueba manual (persistencia tras reinicio):**

1. `docker compose up -d redis` en la raíz y `REDIS_URL=redis://localhost:6379` en `.env`.
2. `npm run dev` y `npm run token:comensal -- --mesa 5 --comensal Ana` (copia el token).
3. Conecta un cliente, haz `join:table` y dos `cart:update` (ver el ejemplo de abajo).
4. Detén el servidor (Ctrl+C) y vuelve a correr `npm run dev`.
5. Conecta otro cliente con el mismo token y haz `join:table`: el `carrito` del ack debe ser
   **idéntico** (misma `version` y mismos `items`) al último snapshot antes del reinicio.
6. Reenvía uno de los `cart:update` anteriores con su mismo `eventId`: responde
   `duplicado: true` y la `version` no cambia.

`id_linea`, roles, `clear` (solo personal) y el resto de eventos están documentados en
detalle en [EVENTS.md](EVENTS.md).

## Diagramas de secuencia

Los cuatro momentos de una visita, tal como los implementa el servidor. Los
contratos exactos están en [EVENTS.md](EVENTS.md); lo que todavía depende del
backend va marcado como *pendiente*.

### 1. Apertura de la mesa con QR

```mermaid
sequenceDiagram
  autonumber
  participant M as Mesero (panel)
  participant B as backend
  participant S as socket-server
  participant P as Pantalla de la mesa
  participant C as Comensal (PWA)
  M->>B: POST /api/mesas/:id/abrir (JWT del mesero)
  B->>B: FOR UPDATE · mesa ocupada
  B->>S: POST /qr/generar (reenvía el JWT del mesero)
  S-->>B: token v1.payload.HMAC (expira, sid aleatorio)
  B->>B: guarda mesas.token_qr y hace commit
  B->>S: POST /internal/qr-rotado (x-internal-key)
  S->>P: qr:actualizado { id_mesa, token_qr }
  Note over S,P: Mientras no haya comensales, el QR rota cada 3 min (docs/rotacion-qr.md)
  C->>B: escanea · POST /api/mesas/qr/:token/sesion { comensal: Ana }
  B-->>C: JWT de comensal { id_mesa, rol, sid, comensal } (alias único en la mesa)
  C->>S: connect · auth.token
  S->>S: JWT válido · mesa no liberada · cupo (capacidad + 4)
  C->>S: join:table (el alias sale del JWT)
  S-->>C: ack { carrito: snapshot completo }
  S->>M: mesa:presencia { comensales, total } (room:admin)
  Note over S: Con el primer comensal sentado, el QR deja de rotar
  Note over C,S: Un QR viejo (rotado o de una mesa liberada) recibe TOKEN_INVALIDO
```

### 2. Pedido en vivo

```mermaid
sequenceDiagram
  autonumber
  participant A as Comensal A
  participant Z as Comensal B
  participant S as socket-server
  participant R as Redis
  participant B as backend
  participant K as Cocina (KDS)
  A->>S: cart:update { eventId, accion: set, id_linea, ingredientes }
  S->>S: valida lista blanca · descarta precios del cliente
  S->>R: WATCH/MULTI: carrito + marca de idempotencia
  S-->>A: ack { carrito: version 13 }
  S->>Z: cart:updated { carrito: version 13 }
  Note over A,S: Reenviar el mismo eventId → duplicado: true, sin cambios
  A->>B: POST /api/pedidos (precios calculados en la base)
  B->>B: commit del pedido
  B->>S: POST /internal/order-created { eventId, pedido }
  S->>R: anota los dueños de cada ítem · vacía el carrito
  S->>K: order:created (room:kds)
  S->>A: order:created (room:mesa-ID y room:admin)
  S->>Z: order:created
  K->>B: PATCH /api/kds/comandas/:id/estado { listo }
  B->>S: POST /internal/order-status
  S->>A: order:status { estado: listo }
  S->>Z: order:status { estado: listo }
  S-->>A: Web Push "¡Tu plato está listo!" (solo a los dueños)
```

### 3. Pago dividido (las 6 capas)

```mermaid
sequenceDiagram
  autonumber
  participant C as Comensal (PWA)
  participant S as socket-server
  participant R as Redis
  participant B as backend
  participant W as Wompi
  participant M as Panel (room:admin)
  C->>S: POST /pagos/intencion { modo: igual, eventId, comensal }
  S->>B: GET /api/mesas/:id/cuenta/interno (pendiente: Daniel)
  B-->>S: { total_centavos, saldo_centavos, por_comensal }
  Note over S: Capa 1 · el monto lo calcula el servidor (total ÷ presentes)
  S->>R: Capa 2 · sd:pago:ref:SD-5-… con 12 bytes aleatorios (pendiente, 30 min)
  S->>S: Capa 3 · firma de integridad SHA-256 (secreto nunca sale)
  S-->>C: { referencia, monto_en_centavos, COP, llave_publica, firma }
  C->>W: Widget de Wompi (la tarjeta nunca pasa por SmartDining)
  W->>S: POST /pagos/webhook (transaction.updated)
  S->>S: Capa 4 · checksum en tiempo constante · antigüedad · idempotencia
  S->>W: Capa 5 · GET /v1/transactions/{id} (llave privada, 5 s)
  alt APPROVED, referencia pendiente, monto y moneda exactos
    S->>B: Capa 6 · POST /api/transacciones/internal (pendiente: Daniel)
    alt el backend confirma
      B-->>S: { saldo_restante_centavos }
      S->>C: payment:confirmed { comensal, monto, saldo_restante }
      S->>M: payment:confirmed
    else backend caído o 5xx
      S-->>W: 503 (Wompi reintenta) · no se emite nada
    end
  else no coincide
    S->>B: intento fallido (pendiente)
    S->>M: pago:alerta { motivo: monto_distinto, … }
  end
```

### 4. Liberación de la mesa

```mermaid
sequenceDiagram
  autonumber
  participant B as backend
  participant S as socket-server
  participant C as Comensales
  participant P as Pantalla de la mesa
  participant M as Panel (room:admin)
  Note over B: saldo 0 tras el último pago, o el mesero libera a mano
  B->>B: commit: mesa disponible
  B->>S: POST /internal/mesa-liberada { id_mesa, motivo } (x-internal-key)
  S->>S: revoca todos los QR emitidos para esa mesa
  S->>C: mesa:liberada { motivo: pagada }
  S->>M: mesa:liberada
  S->>S: borra el carrito y las suscripciones push
  S--xC: disconnect (solo el rol comensal)
  Note over P: La pantalla y el personal siguen conectados
  C->>S: reconectar con el JWT viejo
  S--xC: connect_error TOKEN_INVALIDO
  B->>S: el mismo aviso repetido
  S-->>B: { ok: true, duplicado: true } (no se vuelve a emitir)
```

## Tareas Iniciales
1. **Definición de eventos:** Documentar los eventos de WebSocket (nombres de eventos, payloads y salas/rooms por mesa).
   - `join:table`: Unirse a la sala de una mesa mediante token.
   - `cart:update`: Sincronizar el carrito de compras colaborativo entre comensales de la misma mesa.
   - `order:created`: Notificar nueva comanda a la cocina (KDS).
   - `order:status`: Notificar al cliente y al restaurante el cambio de estado del pedido.
2. **Generación de Token QR:** Definir formato de token y validación para el acceso a las mesas.
3. **Módulo de Notificaciones Push & Pagos:** Integración de suscripciones Web Push y lógica de webhook/confirmación de pagos.
