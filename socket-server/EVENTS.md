# Catálogo de eventos — socket-server

Contrato de tiempo real entre `socket-server` y los frontends
(`frontend-cliente`, `frontend-restaurante`, `frontend-kds`) y el `backend`.
Responsable: Roberto Buelvas.

- URL local: `http://localhost:4001` (backend REST: `4000`).
- Librería cliente: `socket.io-client` v4.
- Todos los eventos y ejemplos usan JSON.

---

## 1. Conexión y autenticación

El socket se autentica con **el mismo JWT que emite el backend** (mismo `JWT_SECRET`).
Se envía en el handshake:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4001', {
  auth: { token: jwt },          // JWT del comensal o del personal
});

socket.on('connect_error', (err) => {
  // err.message: 'AUTH_REQUERIDA' | 'TOKEN_INVALIDO' | 'MESA_LLENA' | 'SERVIDOR_CERRANDO' | 'ERROR_INTERNO'
});
```

| Rol (`rol` del JWT) | Payload del JWT | Salas a las que entra |
|---|---|---|
| `comensal` | `{ id_mesa, rol }` | Solo `room:mesa-{su id_mesa}` (con `join:table`) |
| `pantalla` | `{ id_mesa, rol }` | Solo `room:mesa-{su id_mesa}` (automático al conectar, sin `join:table`) |
| `cocina` | `{ id_usuario, rol }` | `room:kds` (automático al conectar) |
| `admin` | `{ id_usuario, rol }` | `room:kds` y `room:admin` (automático) + cualquier mesa |
| `mesero`, `cajero` | `{ id_usuario, rol }` | `room:admin` (automático) + cualquier mesa |

`pantalla` es la tablet fija montada en la mesa (modelo **"QR en vidrio"**: ya no se
imprime el QR, la pantalla lo muestra y se refresca sola). Su JWT lo emite este mismo
servicio (`POST /qr/pantalla`, ver §6) y es de larga duración porque la tablet no se
retira al cerrar la mesa. Solo escucha `qr:actualizado`; no puede tocar el carrito ni
emitir pedidos (no está en ninguna de las listas de roles permitidos de esos eventos).

Si el JWT expira, el servidor no corta el socket a mitad de sesión, pero **la reconexión
fallará** con `TOKEN_INVALIDO`: el frontend debe pedir un JWT nuevo (para el comensal,
`POST /api/mesas/qr/:token/sesion` del backend; para la pantalla, `POST /qr/pantalla`
de nuevo).

---

### 1.1. Límites de la conexión

| Límite | Valor | Qué pasa al superarlo |
|---|---|---|
| Tamaño de un mensaje | 16 KB | El servidor corta esa conexión (`transport close`) |
| Eventos por socket | 20 en cualquier ventana de 1 s | El evento no se procesa; su ack es `RATE_LIMIT` |
| Comensales conectados por mesa | capacidad de la mesa + 4 | `connect_error` con `MESA_LLENA` |
| Durante un reinicio | — | `connect_error` con `SERVIDOR_CERRANDO`: Socket.io reintenta solo y entra a la instancia nueva |

## 2. Salas (rooms)

| Sala | Quién recibe |
|---|---|
| `room:mesa-{ID}` | Los comensales de esa mesa y el personal que hizo `join:table` a esa mesa |
| `room:kds` | Pantallas de cocina (`cocina`, `admin`) |
| `room:admin` | Panel del restaurante (`admin`, `mesero`, `cajero`) |

**Aislamiento:** el `id_mesa` de un comensal sale **siempre de su JWT**, nunca del
payload. Un comensal no puede unirse ni escuchar otra mesa; si lo intenta, recibe
`NO_AUTORIZADO`. Todo evento de una mesa se emite únicamente a su sala.

---

## 3. Convenciones

### 3.1. Idempotencia: `eventId` + ack

Todo evento **cliente → servidor** que modifica estado compartido (`cart:update`,
`order:created`, `order:status`, `push:subscribe`) debe llevar un **`eventId`**:
un UUID v4 generado por el cliente **una sola vez por acción del usuario**.

- Si el cliente no recibe el ack (corte de red), **reenvía el mismo evento con el mismo
  `eventId`**. El servidor detecta el duplicado, **no vuelve a aplicar el cambio** y
  responde `duplicado: true`. En `cart:update` el ack de un duplicado trae el snapshot
  **vigente** del carrito (no el de la primera vez), para que el cliente se resincronice.
- La ventana de deduplicación es de 10 minutos.
- Los eventos se envían con **callback de ack**:

```js
socket.emit('cart:update', payload, (ack) => { /* ... */ });
```

### 3.2. Formato del ack

Éxito:

```json
{ "ok": true, "eventId": "3f2b...", "duplicado": false }
```

Error:

```json
{ "ok": false, "eventId": "3f2b...", "codigo": "PAYLOAD_INVALIDO", "mensaje": "cantidad debe ser un entero entre 1 y 99" }
```

| `codigo` | Significado |
|---|---|
| `PAYLOAD_INVALIDO` | Falta un campo o tiene un tipo/valor inválido |
| `NO_AUTORIZADO` | El rol no puede emitir ese evento o tocar esa mesa |
| `SIN_SALA` | El comensal no hizo `join:table` antes de emitir |
| `RATE_LIMIT` | Se superó el límite de frecuencia del evento (p. ej. llamar al mesero) |
| `ERROR_INTERNO` | Fallo inesperado del servidor |

### 3.3. Reconexión

Al conectar **y en cada reconexión** el cliente debe:

1. Emitir `join:table` (comensal/mesero) → el ack trae el **snapshot completo del carrito**.
2. **Reemplazar** su carrito local por ese snapshot (no mezclarlo): así no se duplica
   estado aunque se hayan perdido eventos.
3. Reenviar los eventos sin ack con su mismo `eventId`.

---

## 4. Eventos cliente → servidor

### `join:table`

Unirse a la sala de una mesa. Roles: `comensal`, `mesero`, `cajero`, `admin`.

```json
{ "id_mesa": 5 }
```

- Comensal: `id_mesa` es opcional; si viene y no coincide con su JWT → `NO_AUTORIZADO`.
- Personal: `id_mesa` es obligatorio.
- Comensal: `comensal` (alias, 1–40 caracteres) es **opcional** y recomendado:
  `{ "comensal": "Ana" }`. Es como lo ven el panel (`mesa:presencia`) y el mesero
  (`mesa:llamar_mesero`). Si no es un texto válido → `PAYLOAD_INVALIDO`. Repetir
  `join:table` con otro alias lo cambia.

Ack:

```json
{
  "ok": true,
  "id_mesa": 5,
  "sala": "room:mesa-5",
  "carrito": {
    "version": 12,
    "items": [
      { "id_linea": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "comensal": "Ana", "id_plato": 3, "cantidad": 2, "notas": "sin cebolla" }
    ]
  }
}
```

### `leave:table`

Salir de la sala de una mesa. Payload: `{ "id_mesa": 5 }`. Ack: `{ "ok": true }`.

### `cart:update`

Modifica el carrito grupal de la mesa. Roles: `comensal` (y `mesero`/`admin` con
`join:table` previo). Requiere `join:table` previo.

```json
{
  "eventId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "accion": "set",
  "id_linea": "6f1c1b1a-2222-4b3c-8d4e-5f6a7b8c9d0e",
  "comensal": "Ana",
  "id_plato": 3,
  "cantidad": 2,
  "notas": "sin cebolla",
  "ingredientes": [
    { "id_ingrediente": 10, "porcion": "normal" },
    { "id_ingrediente": 12, "porcion": "extra" }
  ]
}
```

| Campo | Tipo | Reglas |
|---|---|---|
| `eventId` | string | UUID, obligatorio |
| `id_mesa` | entero > 0 | Solo personal (`mesero`/`admin`). El comensal no lo envía: se toma de su JWT |
| `accion` | string | `set` (fija la cantidad), `remove` (quita la línea), `clear` (vacía todo el carrito, **solo `mesero`/`admin`**) |
| `id_linea` | string | UUID, obligatorio en `set` y `remove`. Lo genera el cliente **una sola vez por línea** añadida (no por plato) |
| `comensal` | string | 1–40 caracteres. Obligatorio en `set` y `remove` |
| `id_plato` | entero > 0 | Obligatorio en `set`. **Ya no se envía en `remove`**: la línea se borra por `id_linea` |
| `cantidad` | entero 1–99 | Obligatorio en `set`. Es la cantidad **final**, no un incremento |
| `notas` | string ≤ 200 | Opcional, solo en `set` |
| `ingredientes` | array | Opcional, solo en `set`. Platos armables (constructor). Ver reglas abajo. Sin el campo (o `null`) la línea es un plato simple |

Reglas de `ingredientes` (si viene y no es `null`; si no cumple → `PAYLOAD_INVALIDO`):

- Arreglo de **0 a 30** elementos.
- Cada elemento es un **objeto plano** `{ id_ingrediente, porcion }`:
  - `id_ingrediente`: entero > 0 (entero seguro de JavaScript).
  - `porcion`: `"ligera"`, `"normal"` o `"extra"`.
- Sin `id_ingrediente` repetidos en la misma línea.
- **Se guarda y se difunde solo `{ id_ingrediente, porcion }`**: `precio_aplicado`, `nombre` o
  cualquier otro campo se **descarta** en silencio. El precio de cada porción lo calcula el
  **backend** con la base de datos al crear el pedido; el cliente nunca decide montos.

> **Cambio de contrato (compatible):** hasta ahora se aceptaba `precio_aplicado` dentro de
> `ingredientes`. Sigue sin dar error enviarlo, pero ya no se guarda ni llega a los demás
> comensales. Si la PWA lo usaba para mostrar el subtotal, debe calcularlo con los precios
> del menú (`GET /api/menu`).

Por qué `set` y no `+1`/`-1`: fijar el valor absoluto hace que reenviar el evento
nunca duplique unidades. Cada ítem se identifica por `id_linea`: dos líneas del
mismo comensal y el mismo plato (p. ej. una hamburguesa término medio y otra bien
asada) conviven porque tienen `id_linea` distinto. Repetir `set` con un `id_linea`
ya existente **edita esa línea** (cantidad o notas), no crea una línea nueva.

`clear` vacía el carrito de **toda la mesa**, así que un comensal no puede emitirlo
(respondería `NO_AUTORIZADO` y el carrito quedaría intacto): borraría también lo que
pidieron los demás. Para quitar sus propios platos, el comensal usa `remove` por cada
una de sus líneas (por `id_linea`).

Ack (incluye el snapshot resultante):

```json
{ "ok": true, "eventId": "9b1d...", "duplicado": false, "carrito": { "version": 13, "items": [ ... ] } }
```

### `order:created`

Difunde una comanda recién creada. **Solo `mesero` y `admin`** por socket. El flujo
normal es que **el backend** lo dispare por HTTP (ver sección 6), porque el backend es
la fuente de verdad; un comensal **no** puede emitirlo.

```json
{
  "eventId": "c2f3...",
  "pedido": {
    "id_pedido": 87,
    "codigo_pedido": "PED-260922-K3F9AQ",
    "id_mesa": 5,
    "estado": "recibido",
    "total": 56000,
    "notas_generales": null,
    "items": [
      { 
        "id_plato": 3, 
        "nombre": "Bowl", 
        "cantidad": 2, 
        "comensal": "Ana", 
        "notas_especiales": "sin cebolla",
        "ingredientes": [
          { "id_ingrediente": 10, "nombre": "Arroz", "porcion": "normal", "precio_aplicado": 0 },
          { "id_ingrediente": 12, "nombre": "Pollo", "porcion": "extra", "precio_aplicado": 1500 }
        ]
      }
    ]
  }
}
```

`id_pedido`, `id_mesa` y `estado` son obligatorios; el resto se reenvía tal cual.
Al crear la comanda el **carrito de la mesa se vacía** (ya pasó a ser pedido).

### `order:status`

Notifica un cambio de estado. Roles por socket: `cocina`, `mesero`, `cajero`, `admin`
(o el backend por HTTP).

```json
{
  "eventId": "a71e...",
  "id_pedido": 87,
  "id_mesa": 5,
  "codigo_pedido": "PED-260922-K3F9AQ",
  "estado_anterior": "recibido",
  "estado": "en_preparacion"
}
```

`estado` ∈ `recibido`, `en_preparacion`, `listo`, `entregado`, `pagado`, `cancelado`
(mismos valores que el backend). El socket-server **no valida la transición**: la
autoridad es el trigger de la base de datos; este evento solo propaga.

### `push:subscribe`

Registra la suscripción Web Push del comensal (alternativa al endpoint HTTP).
Rol: `comensal`.

```json
{
  "eventId": "e5c0...",
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": { "p256dh": "BN...", "auth": "k8..." }
  }
}
```

### `push:unsubscribe`

`{ "endpoint": "https://fcm.googleapis.com/fcm/send/..." }` → ack `{ "ok": true }`.

### `mesa:llamar_mesero`

El comensal pide que vaya un mesero. Rol: **solo `comensal`**, con `join:table` previo.

```json
{ "eventId": "0c9e...", "motivo": "Más servilletas, por favor" }
```

| Campo | Tipo | Reglas |
|---|---|---|
| `eventId` | string | UUID, obligatorio |
| `motivo` | string | Opcional, 0–100 caracteres |

- Límite: **1 llamada por mesa cada 60 s** (cuenta para toda la mesa, no por persona). Al
  excederlo el ack es `{ "ok": false, "codigo": "RATE_LIMIT" }` y no se avisa al panel.
- Reenviar el mismo `eventId` responde `duplicado: true` sin chocar con el límite.
- El servidor reenvía a `room:admin` con `id_mesa` (del JWT), `comensal` (el alias del
  `join:table`) y `emitidoEn`. Los comensales no lo reciben.

### `cuenta:solicitada`

El comensal pide la cuenta. Rol: **solo `comensal`**, con `join:table` previo.
Payload: `{ "eventId": "..." }`. Idempotente por `eventId`.

Llega a `room:admin` y a la sala de la mesa (los demás comensales lo ven) como
`{ eventId, id_mesa, comensal, emitidoEn }`. La mesa queda marcada (`sd:mesa:{ID}:cuenta = 1`)
hasta que se libere.

---

## 5. Eventos servidor → cliente

| Evento | Destino | Payload |
|---|---|---|
| `cart:updated` | `room:mesa-{ID}` (todos **menos** quien emitió) | `{ eventId, origen, carrito: { version, items } }` |
| `order:created` | `room:kds`, `room:admin`, `room:mesa-{ID}` | `{ eventId, pedido, emitidoEn }` |
| `order:status` | `room:kds`, `room:admin`, `room:mesa-{ID}` | `{ eventId, id_pedido, id_mesa, codigo_pedido, estado_anterior, estado, emitidoEn }` |
| `payment:confirmed` | `room:admin`, `room:mesa-{ID}` | `{ eventId, id_mesa, comensal, monto, saldo_restante, monto_centavos, saldo_restante_centavos, referencia_externa, emitidoEn }` (§8.3) |
| `pago:alerta` | `room:admin` | `{ eventId, id_mesa, referencia_externa, id_transaccion_pasarela, motivo, emitidoEn }` (§8.5) |
| `qr:actualizado` | `room:mesa-{ID}` (incluye a la `pantalla` de esa mesa) | `{ id_mesa, token_qr, emitidoEn }` |
| `mesa:llamar_mesero` | `room:admin` | `{ eventId, id_mesa, comensal, motivo, emitidoEn }` |
| `cuenta:solicitada` | `room:admin`, `room:mesa-{ID}` | `{ eventId, id_mesa, comensal, emitidoEn }` |
| `mesa:presencia` | `room:admin` | `{ id_mesa, comensales: [alias], total }` (ver §5.2) |
| `ingrediente:disponibilidad` | todos los sockets (mesas, `room:kds`, panel) | `{ id_ingrediente, disponible, emitidoEn }` |
| `mesa:liberada` | `room:mesa-{ID}`, `room:admin` | `{ id_mesa, motivo, emitidoEn }` (`motivo`: `pagada` o `liberada`) |

Notas para el frontend:

- `cart:updated` trae el **snapshot completo**: reemplaza el carrito local, no lo sumes.
  Si `version` recibida ≤ la local, ignórala (llegó desordenada).
- `order:created` y `order:status` pueden llegar repetidos si el servidor reintenta;
  deduplica por `eventId`.
- El sender de `cart:update` **no** recibe `cart:updated` (usa el snapshot de su ack).
- `mesa:liberada`: la sesión de mesa terminó (pago o liberación manual). Ver §5.1.
- `qr:actualizado` no lleva `eventId` (no lo dispara un cliente, lo dispara el backend al
  rotar el token en la base). La pantalla de la mesa simplemente **redibuja el QR** con el
  `token_qr` recibido; no hace falta deduplicar porque redibujar con el mismo valor es
  inofensivo.

### 5.1. `mesa:liberada`

Lo emite el servidor cuando el backend llama a `POST /internal/mesa-liberada` **después** de
confirmar en la base que la mesa quedó libre (pago completo o liberación manual).

```json
{ "id_mesa": 5, "motivo": "pagada", "emitidoEn": "2026-10-11T20:15:00.000Z" }
```

Orden de lo que pasa en el servidor:

1. Se revocan todos los QR emitidos para esa mesa.
2. Se emite `mesa:liberada` a `room:mesa-{ID}` y a `room:admin` (**antes** de vaciar el carrito).
3. Se borran las suscripciones push y el carrito de la mesa.
4. Se **desconecta a los comensales** de la sala (`disconnect` con motivo `io server disconnect`).
   La **pantalla** de la mesa y el **personal** siguen conectados.
5. Desde ese momento, un JWT de comensal emitido **antes** de la liberación ya no conecta
   (`connect_error` → `TOKEN_INVALIDO`) ni puede hacer `join:table` (`NO_AUTORIZADO`).

Qué debe hacer cada cliente:

- **PWA del comensal:** mostrar "La mesa se cerró, gracias por tu visita", borrar el JWT y el
  carrito locales y **no** reconectar automáticamente (Socket.io no reintenta tras un
  `io server disconnect`).
- **Panel (`room:admin`):** pintar la mesa como libre.
- **Pantalla:** esperar el `qr:actualizado` del grupo siguiente.

Es idempotente: si el backend repite el aviso, responde `{ "ok": true, "duplicado": true }` y
no vuelve a emitir. La mesa vuelve a tener sesión cuando el personal genera un QR nuevo.

### 5.2. `mesa:presencia`

Quién está sentado en cada mesa, para el panel. Se emite a `room:admin` cada vez que un
**comensal** hace `join:table`, `leave:table` o se desconecta, con un máximo de **un aviso
por mesa cada 500 ms**: el primero sale al instante y, si hubo más cambios dentro de esa
ventana, se envía uno más al cerrarla (el último estado siempre llega).

```json
{ "id_mesa": 5, "comensales": ["Ana", "Beto"], "total": 3 }
```

- `comensales`: alias distintos, ordenados. Dos pestañas de "Ana" cuentan como una persona.
- `total`: personas en la mesa = alias distintos + sockets de comensal **sin** alias.
- El personal y la pantalla no cuentan.
- No lleva `eventId`: es un estado completo; quédate siempre con el último.

### 5.3. `ingrediente:disponibilidad`

El backend avisa que un ingrediente se agotó (`disponible: false`) o volvió (`true`) con
`POST /internal/ingrediente-disponibilidad`. El constructor de la PWA debe deshabilitar o
habilitar esa opción en vivo; el KDS puede mostrar una alerta. No lo puede emitir un cliente.

---

## 6. Endpoints HTTP

CORS con la misma lista blanca que el socket (`CORS_ORIGINS`).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | — | `200 { "estado": "ok", "redis": "conectado" }` (o `"memoria"` sin `REDIS_URL`). `503 { "estado": "degradado", "redis": "reconectando" }` si Redis está configurado y no responde |
| POST | `/qr/generar` | Bearer JWT `admin`/`mesero`/`cajero` | Genera un token QR. Body `{ "id_mesa": 5, "ttl_minutos": 360 }` → `{ token, id_mesa, expira_en }` |
| POST | `/qr/validar` | — | Body `{ "token": "..." }` → `{ valido: true, id_mesa }` o `{ valido: false, motivo }` |
| POST | `/qr/pantalla` | Bearer JWT `admin`/`mesero`/`cajero` | Emite el JWT de la tablet de mesa. Body `{ "id_mesa": 5 }` → `{ token, id_mesa, expira_en }` |
| GET | `/push/clave-publica` | — | `{ "clave": "<VAPID public key>" }` |
| POST | `/push/suscripcion` | Bearer JWT `comensal` | Body `{ "subscription": {...} }` → 201 |
| DELETE | `/push/suscripcion` | Bearer JWT `comensal` | Body `{ "endpoint": "..." }` → 200 |
| POST | `/internal/order-created` | Header `x-internal-key` | Solo backend. Mismo body que el evento `order:created` |
| POST | `/internal/order-status` | Header `x-internal-key` | Solo backend. Mismo body que `order:status` |
| POST | `/internal/qr-rotado` | Header `x-internal-key` | Solo backend. `{ "id_mesa": 5, "token_qr": "..." }` (token de 1 a 255 caracteres) → reenvía `qr:actualizado` a la pantalla de esa mesa |
| POST | `/internal/mesa-liberada` | Header `x-internal-key` | Solo backend. `{ "id_mesa": 5, "motivo": "pagada" }` (`motivo` opcional: `pagada` o `liberada`, por defecto `liberada`) → revoca los QR, emite `mesa:liberada`, desconecta a los comensales y borra carrito y suscripciones. Responde `{ ok, duplicado }` |
| POST | `/internal/ingrediente-disponibilidad` | Header `x-internal-key` | Solo backend. `{ "id_ingrediente": 12, "disponible": false, "eventId": "<uuid opcional>" }` → emite `ingrediente:disponibilidad`. Con `eventId`, un reintento responde `duplicado: true` |
| POST | `/pagos/intencion` | Bearer JWT `comensal` | Intención de pago (§8.1) |
| POST | `/pagos/webhook` | Checksum de Wompi | Eventos de Wompi (§8.3) |

### 6.1. Token QR

- Formato: `v1.<payload-base64url>.<firma-hmac-sha256-base64url>`; el payload lleva
  `m` (id_mesa), `iat` y `exp` (ambos en **milisegundos** Unix) y `sid` (id aleatorio).
- `ttl_minutos` es opcional (por defecto `QR_TTL_MINUTOS`); rango permitido 1–1440.
- `motivo` de un QR inválido: `formato`, `firma`, `expirado` o `revocado`. `/qr/validar`
  responde `200` si es válido y `401` si no.
- **Reutilizable durante la sesión de mesa**: se puede escanear cuantas veces se quiera
  hasta que expire o la mesa se libere.
- Se valida **en el servidor** (firma + expiración + mesa no liberada). El cliente no
  debe decidir nada por su cuenta.
- Al pagar y liberar la mesa, el backend llama `POST /internal/mesa-liberada` y los QR
  anteriores dejan de valer.

> **Pendiente de acordar con el equipo:** este token (`/qr/generar` + `/qr/validar`) y el
> `mesas.token_qr` de la base (el que de verdad valida `POST /api/mesas/qr/:token/sesion`
> en el backend) son **dos cosas distintas hoy**; el backend nunca llama a `/qr/validar`.
> Además este formato firmado (~150 caracteres) no cabe en el `varchar(64)` de
> `mesas.token_qr`, así que no puede ser el mismo valor sin acortarlo o sin ampliar la
> columna. Mientras eso no se decida, el QR que la pantalla de mesa debe mostrar y que
> `/internal/qr-rotado` (§6.2) reenvía es el `token_qr` que ya vive en la base, no el de
> este endpoint.

### 6.2. Cómo avisa el backend una rotación de `token_qr` (pantalla de mesa)

```
POST http://localhost:4001/internal/qr-rotado
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "id_mesa": 5, "token_qr": "qr-token-mesa-05-<nuevo>" }
```

Se llama cada vez que cambia el `token_qr` vigente de una mesa: al sembrarla, y cada vez
que el trigger `tr_regenerar_token_qr` lo rota (pago o cancelación). Responde
`200 { "ok": true }`. La pantalla de esa mesa recibe `qr:actualizado` y redibuja el QR
sin que nadie tenga que ir a cambiar ningún papel.

### 6.3. Cómo emite el backend `order:created` / `order:status`

```
POST http://localhost:4001/internal/order-created
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "eventId": "...", "pedido": { ... } }
```

Responde `200 { "ok": true, "duplicado": false }`. Reintentar con el mismo `eventId` es
seguro.

---

## 7. Web Push

El aviso **principal** es el evento de socket dentro de la página (`order:status`). El push es
un extra para cuando el comensal cerró la PWA. En **iPhone** Web Push solo funciona con la PWA
**instalada** en la pantalla de inicio (iOS 16.4 o posterior); en Safari normal no llega.

1. El frontend pide la clave pública: `GET /push/clave-publica`.
2. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
3. Hace `join:table` **con su alias** (`{ comensal: "Ana" }`) y envía la suscripción:
   - por socket: `push:subscribe { eventId, subscription }`. El alias es el del `join:table`
     de ese socket (`SIN_SALA` sin join; `PAYLOAD_INVALIDO` si el join no llevó alias); o
   - por HTTP: `POST /push/suscripcion { subscription, comensal }`. El alias debe estar sentado
     ahora en la mesa del JWT; si no, `403`.
4. Service worker de referencia: [`examples/sw-push.js`](examples/sw-push.js) (muestra la
   notificación y, al tocarla, abre `/seguimiento`).

> **Cambio de contrato:** la suscripción ahora queda ligada al **comensal** (alias). Sin alias
> ya no se puede suscribir.

Qué se envía:

| Estado del pedido | A quién | Título |
|---|---|---|
| `en_preparacion` | Todas las suscripciones de la mesa | Tu pedido está en preparación |
| `listo` | **Solo a los dueños del pedido** | ¡Tu plato está listo! |
| `cancelado` | Todas las suscripciones de la mesa | Tu pedido fue cancelado |

Los dueños se anotan al crear el pedido: el `comensal` de cada ítem (si el backend lo envía en
`order:created`) y los comensales de las líneas del carrito que se convirtieron en ese pedido.
Si no se sabe de quién es, el push de `listo` no se envía (la sala igual recibe `order:status`).

Payload **mínimo** (sin nombres, montos ni mesa). TTL de 30 min y `urgency: high`:

```json
{ "titulo": "¡Tu plato está listo!", "cuerpo": "PED-260922-K3F9AQ", "id_pedido": 87, "estado": "listo", "url": "/seguimiento" }
```

Reglas:

- El `endpoint` debe ser una URL `https` de un servicio push (no IPs ni `localhost`): evita
  que el servidor haga peticiones a la red interna (SSRF). Si no, `PAYLOAD_INVALIDO`.
  Máximo 20 suscripciones por mesa.
- Suscribirse dos veces con el mismo `endpoint` no duplica.
- Las suscripciones caducadas (HTTP 404/410 del servicio push) se eliminan solas.
- Son de la **sesión de mesa**: se borran al liberarla.

---

## 8. Pagos (Wompi, sandbox)

El comensal paga en el **Widget de Wompi**: los datos de tarjeta o cuenta nunca pasan por
SmartDining (alcance PCI DSS mínimo, SAQ A). El socket-server calcula el monto, firma la
intención y verifica el resultado. Todo va detrás de la interfaz `PasarelaPago`
(`src/pasarelas/`), así que cambiar de proveedor no toca el resto.

### 8.1. `POST /pagos/intencion`

Auth: `Authorization: Bearer <JWT del comensal>` (sesión de mesa vigente). La mesa sale del JWT.

```json
{ "modo": "igual", "eventId": "4b0d…", "comensal": "Ana" }
```

| Campo | Reglas |
|---|---|
| `modo` | `total` (saldo de la mesa), `igual` (total ÷ personas presentes), `propio` (lo de ese comensal) |
| `eventId` | UUID. Repetirlo devuelve la **misma** respuesta |
| `comensal` | Alias de quien paga (1–40). Debe estar **sentado ahora** en la mesa (`join:table` con ese alias); si no, `403` |

Cualquier otro campo (`monto`, `id_mesa`, `precio`…) **se ignora**: el monto lo calcula el
servidor con la cuenta del backend.

`201` (o `200` si es la misma intención pendiente o el mismo `eventId`):

```json
{
  "referencia": "SD-5-1760212345678-Qm9vX2FfdGVzdF9f",
  "monto_en_centavos": 3333300,
  "moneda": "COP",
  "llave_publica": "pub_test_…",
  "firma_integridad": "37c8407747e5…",
  "expira_en": "2026-10-11T20:45:00.000Z"
}
```

| Error | Cuándo |
|---|---|
| `400 PAYLOAD_INVALIDO` | `modo`, `eventId` o `comensal` inválidos |
| `401 NO_AUTORIZADO` | Sin JWT, JWT inválido o la mesa ya se liberó |
| `403 NO_AUTORIZADO` | No es comensal, o el alias no está en la mesa |
| `409 SIN_SALDO` | Saldo 0 (o `propio` sin consumos de ese alias) |
| `429 RATE_LIMIT` | Más de 5 intenciones por minuto del mismo comensal |
| `502/503 ERROR_INTERNO` | El backend no respondió o respondió mal |
| `503 NO_CONFIGURADO` | Pagos apagados (sin `WOMPI_*`) |

Reglas de la cuenta dividida:

- **total**: el saldo completo de la mesa.
- **igual**: el **total** de la cuenta entre las personas presentes (`mesa:presencia.total`),
  redondeado a pesos. Quien paga de último cubre el residuo del redondeo; nunca se cobra más
  que el saldo.
- **propio**: el saldo de ese alias según el backend (nunca más que el saldo de la mesa).
- **Una sola intención pendiente por comensal**: si ya tiene una sin pagar, se devuelve esa.
- La intención vive `PAGOS_TTL_MINUTOS` (30). Después el widget la rechaza (`expiration-time`
  va dentro de la firma).

Uso en la PWA (Widget de Wompi):

```html
<script src="https://checkout.wompi.co/widget.js"></script>
```

```js
const i = await (await fetch(`${SOCKET_URL}/pagos/intencion`, { method: 'POST', headers, body })).json();
const checkout = new WidgetCheckout({
  currency: i.moneda,
  amountInCents: i.monto_en_centavos,
  reference: i.referencia,
  publicKey: i.llave_publica,
  signature: { integrity: i.firma_integridad },
  expirationTime: i.expira_en,
  redirectUrl: `${location.origin}/seguimiento`,
});
checkout.open(() => { /* el resultado oficial llega por payment:confirmed, no por aquí */ });
```

El resultado que muestra el widget **no** es la confirmación: la confirmación es el evento
`payment:confirmed`, que solo se emite después de verificar el webhook y registrar el pago.

### 8.2. Contrato que necesita del backend (pendiente: Daniel)

```
GET /api/mesas/:id/cuenta/interno
x-internal-key: <INTERNAL_API_KEY>

200 {
  "id_mesa": 5,
  "moneda": "COP",
  "total_centavos": 9000000,
  "saldo_centavos": 6000000,
  "por_comensal": [ { "comensal": "Ana", "saldo_centavos": 3000000 } ]
}
```

- Montos en **centavos enteros** (`total` del pedido × 100), calculados en SQL.
- `total_centavos`: suma de los pedidos no cancelados de la sesión actual de la mesa.
- `saldo_centavos`: `total_centavos` menos las transacciones `completada`.
- `por_comensal`: por alias (el `apodo`/`comensal` de cada ítem), menos lo que ya pagó.
- `404` si la mesa no existe. El socket-server trata cualquier otra forma como error (`502`).

### 8.3. Webhook: `POST /pagos/webhook` (capas 4, 5 y 6)

Lo llama **Wompi** (URL de eventos del panel de Wompi). No lo llama ningún frontend.

> **Cambio de contrato:** el formato anterior (`x-signature: t=…,v1=…` y
> `type: "payment.succeeded"`, con `PAYMENT_WEBHOOK_SECRET`) se reemplazó por el de Wompi.
> Nadie lo usaba en producción: el backend nunca lo llamó.

1. **Checksum** sobre el cuerpo crudo: SHA-256 de los valores de `signature.properties` (en el
   orden recibido, rutas dentro de `data`) + `timestamp` + `WOMPI_EVENTS_SECRET`. Se compara
   en tiempo constante con `signature.checksum` y, si viene, con `X-Event-Checksum`. Si falla
   → `400 FIRMA_INVALIDA` sin detalles.
2. **Antigüedad**: se aceptan eventos de hasta **25 h** de antigüedad (Wompi reintenta a los
   30 min, 3 h y 24 h si no recibe `200`) y hasta 5 min en el futuro
   (`PAGOS_WEBHOOK_TOLERANCIA_SEG`). El replay de un evento viejo no tiene efecto: la
   idempotencia lo descarta y el estado siempre se consulta en la API.
3. Solo se procesa `transaction.updated`; cualquier otro evento → `200 { ignorado: true }`.
4. **Idempotencia** por (transacción, estado): un duplicado → `200 { duplicado: true }` sin
   efectos.
5. `DECLINED`, `ERROR`, `VOIDED`: la intención queda `rechazada`, `error` o `anulada` y el
   comensal puede pedir otra. No se registra ni se anuncia nada.
6. `APPROVED` → **reverificación** con `GET /v1/transactions/{id}` (llave privada, 5 s de
   timeout). Debe coincidir: `status APPROVED`, la misma referencia, una intención conocida y
   **pendiente**, `amount_in_cents` **exactamente** igual al esperado y `currency COP`.
   Si algo no cuadra → intento fallido + `pago:alerta` (§8.5), `200`.
7. **Registro** en el backend (`POST /api/transacciones/internal`, §8.4). **Solo si el backend
   confirma** se emite `payment:confirmed`.
8. Si la pasarela o el backend no responden (o dan 5xx) → `503`, se libera la marca de
   idempotencia y **no se emite nada**; Wompi reintenta.

`payment:confirmed` → `room:admin` y `room:mesa-{ID}`:

```json
{
  "eventId": "1132-903100443-27458",
  "id_mesa": 5,
  "comensal": "Ana",
  "monto": 33333,
  "saldo_restante": 66667,
  "monto_centavos": 3333300,
  "saldo_restante_centavos": 6666700,
  "referencia_externa": "SD-5-1760212345678-Qm9vX2FfdGVzdF9f",
  "emitidoEn": "2026-10-11T20:15:00.000Z"
}
```

> **Cambio de contrato:** ya no lleva `id_pedido` (el pago es de la mesa, no de un pedido) y
> agrega `comensal` y `saldo_restante`. `monto` sigue en pesos. Cuando `saldo_restante` llega a
> 0, el backend libera la mesa y llega `mesa:liberada` con `motivo: "pagada"`.

### 8.4. Contrato de registro que necesita del backend (pendiente: Daniel)

```
POST /api/transacciones/internal
x-internal-key: <INTERNAL_API_KEY>

{
  "referencia_externa": "SD-5-1760212345678-Qm9vX2FfdGVzdF9f",
  "id_transaccion_pasarela": "1132-903100443-27458",
  "pasarela": "wompi",
  "id_mesa": 5,
  "comensal": "Ana",
  "modo": "igual",
  "monto_centavos": 3333300,
  "moneda": "COP",
  "metodo_pago": "online"
}

→ 201 { "ok": true, "duplicado": false, "saldo_restante_centavos": 6666700, "mesa_liberada": false }
→ 200 { "ok": true, "duplicado": true, … }   (misma referencia_externa: no registra dos veces)
→ 409 { "error": "…" }                       (excede el saldo, mesa sin cuenta abierta…)
```

- **Idempotente por `referencia_externa`** (índice único). Un reintento devuelve el mismo
  resultado.
- `transacciones` se liga a `id_pedido`: el backend reparte el monto entre los pedidos abiertos
  de la mesa (los más antiguos primero), con la misma `referencia_externa`, en **una
  transacción SQL**. Los triggers (`tr_validar_transaccion_financiera`) siguen siendo la
  autoridad.
- Si con este pago el saldo llega a 0: liberar la mesa en la misma transacción y, **después
  del commit**, llamar a `/internal/mesa-liberada` con `{ "id_mesa": 5, "motivo": "pagada" }`.
- 5xx o sin respuesta en 1,5 s → el socket-server responde 503 a Wompi y reintenta más tarde.

### 8.5. `pago:alerta` e intentos fallidos

`pago:alerta` → `room:admin`, para que el personal revise. Sin datos del pagador:

```json
{ "eventId": "1132-903100443-27458:monto_distinto", "id_mesa": 5, "referencia_externa": "SD-5-…", "id_transaccion_pasarela": "1132-903100443-27458", "motivo": "monto_distinto", "emitidoEn": "…" }
```

`motivo`: `monto_distinto`, `moneda_distinta`, `estado_no_aprobado`, `transaccion_inexistente`,
`transaccion_distinta`, `referencia_distinta`, `referencia_desconocida`,
`intencion_no_pendiente`, `backend_rechazo_<status>`.

Contrato pendiente (Daniel; y Jarrinson para la tabla):

```
POST /api/pagos/intentos-fallidos/interno
x-internal-key: <INTERNAL_API_KEY>

{ "referencia_externa": "SD-5-…", "id_transaccion_pasarela": "1132-…", "pasarela": "wompi", "id_mesa": 5,
  "motivo": "monto_distinto", "monto_centavos": 100, "monto_esperado_centavos": 3333300, "moneda": "COP", "metodo_pago": "online" }
→ 201 { "ok": true }
```

Guarda en `intentos_pago_fallidos` (`razon_rechazo` = motivo). Ojo: hoy `id_pedido` es
`NOT NULL` y una referencia desconocida no tiene pedido; hace falta permitir `NULL` o agregar
`id_mesa` y `referencia_externa`. Si responde 5xx, el webhook responde 503 y Wompi reintenta.

Guía práctica: [docs/pagos-sandbox.md](docs/pagos-sandbox.md).

---

## 9. Variables de entorno

| Variable | Uso |
|---|---|
| `PORT` | Puerto (4001) |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma (sin `*`) |
| `JWT_SECRET` | Igual al del backend |
| `INTERNAL_API_KEY` | Clave que el backend envía en `x-internal-key` |
| `QR_SECRET` | Secreto de firma de los tokens QR |
| `QR_TTL_MINUTOS` | Vigencia por defecto del QR (360) |
| `PANTALLA_TOKEN_EXPIRES_IN` | Vigencia del JWT de la pantalla de mesa (30d por defecto) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (`npm run vapid` las genera) |
| `PAGOS_WEBHOOK_TOLERANCIA_SEG` | Antigüedad máxima de un evento de Wompi (90000 = 25 h) |
| `BACKEND_URL` | URL del backend para llamadas servidor a servidor (cuenta, registro de pagos, rotación de QR) |
| `WOMPI_PUBLIC_KEY` | Llave pública (`pub_test_…`). La **única** que llega al cliente |
| `WOMPI_PRIVATE_KEY` | Llave privada (`prv_test_…`). Solo para consultar transacciones en la API |
| `WOMPI_INTEGRITY_SECRET` | Secreto de integridad (`test_integrity_…`). Firma las intenciones |
| `WOMPI_EVENTS_SECRET` | Secreto de eventos (`test_events_…`). Verifica el webhook |
| `WOMPI_API_URL` | `https://sandbox.wompi.co/v1` o `https://production.wompi.co/v1` (lista blanca) |
| `PAGOS_TTL_MINUTOS` | Vida de una intención de pago (30) |
| `REDIS_URL` | Estado persistente (obligatoria en producción) |
| `ROTACION_QR_MINUTOS` | Rotación automática del QR con la mesa vacía (3) |
| `MESA_CAPACIDAD_POR_DEFECTO` | Capacidad si el backend no la informa; comensales por mesa = capacidad + 4 (6) |
| `TRUST_PROXY` | IPs o CIDR del proxy (nginx) del que se cree `X-Real-IP` para logs y límites. Vacía = la IP de la conexión. `/0` no se admite |
| `LOG_NIVEL` | `debug`, `info` (por defecto), `warn`, `error` o `silencio`. Logs en JSON, sin secretos |
