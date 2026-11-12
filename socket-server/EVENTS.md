# Catálogo de eventos — socket-server · v2

Contrato de tiempo real entre `socket-server` y los frontends
(`frontend-cliente`, `frontend-restaurante`, `frontend-kds`) y el `backend`.
Responsable: Roberto Buelvas. **Fuente única de verdad del tiempo real**: si el
código y este documento no coinciden, es un error y se corrige en el mismo PR.

- URL local: `http://localhost:4001` (backend REST: `4000`). En producción:
  `https://rt.<dominio>` ([docs/despliegue.md](../docs/despliegue.md)).
- Librería cliente: `socket.io-client` v4. Guía de integración:
  [docs/cliente.md](docs/cliente.md). Diagramas de secuencia: [README.md](README.md#diagramas-de-secuencia).
- Todos los eventos y ejemplos usan JSON.

## Índice

- [Alias del comensal (R-18)](#alias-del-comensal-r-18)
- [Catálogo completo](#catálogo-completo)
- [Códigos de error](#códigos-de-error)
- [1. Conexión y autenticación](#1-conexión-y-autenticación) · [1.1. Límites](#11-límites-de-la-conexión)
- [2. Salas](#2-salas-rooms)
- [3. Convenciones](#3-convenciones): idempotencia, formato del ack, reconexión
- [4. Eventos cliente → servidor](#4-eventos-cliente--servidor)
- [5. Eventos servidor → cliente](#5-eventos-servidor--cliente) · [5.5. `inventario:alerta`](#55-inventarioalerta) · [5.6. `item:cancelado`](#56-itemcancelado)
- [6. Endpoints HTTP](#6-endpoints-http) · [6.4. Comensales sin celular](#64-comensales-sin-celular-post-internalmesa-comensal)
- [7. Web Push](#7-web-push)
- [8. Pagos (Wompi, sandbox)](#8-pagos-wompi-sandbox) · [8.6. Cobros de caja](#86-cobros-de-caja-post-internalpayment-confirmed)
- [9. Variables de entorno](#9-variables-de-entorno)
- [10. Historial de cambios de contrato](#10-historial-de-cambios-de-contrato)

## Alias del comensal (R-18)

El alias ("Ana") identifica al comensal ante su mesa: quién pidió cada plato, a quién avisar
que su plato está listo y cuánto paga en el modo "propio". Por eso **lo fija el backend una
sola vez** (`POST /api/mesas/qr/:token/sesion` con `{ comensal }`, único en la sesión de la
mesa) y lo **firma en el JWT**. El socket-server lo toma **solo del JWT**:

| Dónde | Regla |
|---|---|
| Handshake | JWT de comensal sin alias (o con uno inválido) → `connect_error` `TOKEN_INVALIDO` |
| `join:table`, `cart:update`, `push:subscribe` | `comensal` opcional; distinto del JWT → `NO_AUTORIZADO` |
| `cart:update` | Un comensal solo edita o quita sus propias líneas; el personal, cualquiera |
| `mesa:llamar_mesero`, `cuenta:solicitada`, `mesa:presencia` | El servidor pone el alias del JWT |
| `/pagos/intencion`, `/push/suscripcion` | `comensal` opcional; distinto → 403; JWT sin alias → 401 `TOKEN_INVALIDO` |

## Catálogo completo

Estado: **Estable** = implementado, probado y usable hoy. **Espera backend** =
el socket-server ya lo implementa y lo prueba contra dobles, pero falta la parte
del backend que lo dispara o lo alimenta (contrato en la sección indicada).
**Conectado (falta prueba E2E con Wompi sandbox)** = las dos partes existen y sus
contratos coinciden, pero aún no se ha hecho un pago real de punta a punta.
**Propuesta (v1.1)** = contrato acordado o por acordar en G-06; aún no implementado.
Nadie debe depender de él en producción hasta que pase a Estable.

### Cliente → servidor (por socket, con ack)

| Evento | Roles | `eventId` | Estado | Detalle |
|---|---|---|---|---|
| `join:table` | `comensal`, `mesero`, `cajero`, `admin` | — | Estable | [§4](#jointable) |
| `leave:table` | los mismos | — | Estable | [§4](#leavetable) |
| `cart:update` | `comensal`; `mesero`/`admin` con `join:table` | Obligatorio | Estable | [§4](#cartupdate) |
| `order:created` | `mesero`, `admin` (lo normal es el backend por HTTP) | Obligatorio | Estable | [§4](#ordercreated) |
| `order:status` | `cocina`, `mesero`, `cajero`, `admin` | Obligatorio | Estable | [§4](#orderstatus) |
| `push:subscribe` | `comensal` | Obligatorio | Estable | [§4](#pushsubscribe), [§7](#7-web-push) |
| `push:unsubscribe` | `comensal` | — | Estable | [§4](#pushunsubscribe) |
| `mesa:llamar_mesero` | `comensal` | Obligatorio | Estable | [§4](#mesallamar_mesero) |
| `cuenta:solicitada` | `comensal` | Obligatorio | Estable | [§4](#cuentasolicitada) |
| `mesa:presencia:solicitar` | `admin`, `mesero`, `cajero` | — | Estable (nuevo) | [§4](#mesapresenciasolicitar) |

`pantalla` no puede emitir ningún evento: solo escucha.

### Servidor → cliente

| Evento | Destino | `eventId` | Estado | Detalle |
|---|---|---|---|---|
| `cart:updated` | `room:mesa-{ID}` menos quien emitió | Sí | Estable | [§5](#5-eventos-servidor--cliente) |
| `order:created` | `room:kds`, `room:admin`, `room:mesa-{ID}` | Sí | Estable | [§5](#5-eventos-servidor--cliente) |
| `order:status` | `room:kds`, `room:admin`, `room:mesa-{ID}` | Sí | Estable | [§5](#5-eventos-servidor--cliente) |
| `item:cancelado` | `room:kds`, `room:admin`, `room:mesa-{ID}` | Sí | Lista; el backend la llama desde J-14 (#180, `origen: "comensal"`) y la llamará desde D-13 (`origen: "personal"`). Falta que KDS, panel y PWA la escuchen | [§5.6](#56-itemcancelado) |
| `qr:actualizado` | `room:mesa-{ID}` (incluye la pantalla) | No | Estable | [§6.2](#62-cómo-avisa-el-backend-una-rotación-de-token_qr-pantalla-de-mesa) |
| `mesa:llamar_mesero` | `room:admin` | Sí | Estable | [§4](#mesallamar_mesero) |
| `cuenta:solicitada` | `room:admin`, `room:mesa-{ID}` | Sí | Estable | [§4](#cuentasolicitada) |
| `mesa:presencia` | `room:admin`, `room:mesa-{ID}` | No (estado completo) | Estable (con `sin_celular` desde R-19.2) | [§5.2](#52-mesapresencia) |
| `mesa:liberada` | `room:mesa-{ID}`, `room:admin` | No (idempotente en el servidor) | Estable. `motivo: "pagada"`: caja Estable (PR #58); en línea Conectado (falta prueba E2E con Wompi sandbox) (PR #33) | [§5.1](#51-mesaliberada) |
| `ingrediente:disponibilidad` | todos los sockets | Opcional | Estable (el backend lo llama desde PR #70) | [§5.3](#53-ingredientedisponibilidad) |
| `plato:disponibilidad` | todos los sockets | Opcional | Lista, espera que el backend la llame | [§5.4](#54-platodisponibilidad) |
| `inventario:alerta` | `room:admin` | Sí | Estable (el backend la llama desde D-17; el panel la escucha, P-22) | [§5.5](#55-inventarioalerta) |
| `payment:confirmed` | `room:admin`, `room:mesa-{ID}` | Sí | Caja: Estable vía `/internal/payment-confirmed` (PR #58). Wompi: Conectado (falta prueba E2E con Wompi sandbox), vía webhook con cuenta ([§8.2](#82-contrato-que-necesita-del-backend)) y registro ([§8.4](#84-contrato-de-registro-que-necesita-del-backend)) en el backend (PR #33) | [§8.3](#83-webhook-post-pagoswebhook-capas-4-5-y-6), [§8.6](#86-cobros-de-caja-post-internalpayment-confirmed) |
| `pago:alerta` | `room:admin` | Sí | Conectado (falta prueba E2E con Wompi sandbox); el backend guarda el intento (PR #33) | [§8.5](#85-pagoalerta-e-intentos-fallidos) |

### HTTP

| Ruta | Quién la llama | Estado | Detalle |
|---|---|---|---|
| `GET /health` | Docker, nginx, Deploy | Estable | [§6](#6-endpoints-http) |
| `POST /qr/generar`, `/qr/validar`, `/qr/pantalla` | personal / cualquiera / personal | Estable | [§6.1](#61-token-qr) |
| `GET /push/clave-publica`, `POST`/`DELETE /push/suscripcion` | PWA del comensal | Estable | [§7](#7-web-push) |
| `POST /pagos/intencion` | PWA del comensal | Conectado (falta prueba E2E con Wompi sandbox); el backend expone `GET /api/mesas/:id/cuenta/interno` (PR #33) | [§8.1](#81-post-pagosintencion) |
| `POST /pagos/webhook` | Wompi | Conectado (falta prueba E2E con Wompi sandbox); el backend expone `POST /api/transacciones/internal` (PR #33) | [§8.3](#83-webhook-post-pagoswebhook-capas-4-5-y-6) |
| `POST /internal/order-created`, `/internal/order-status` | backend | Estable (el backend ya las usa) | [§6.3](#63-cómo-emite-el-backend-ordercreated--orderstatus) |
| `POST /internal/qr-rotado`, `/internal/mesa-liberada` | backend | Estable (el backend ya las usa) | [§6](#6-endpoints-http) |
| `POST /internal/ingrediente-disponibilidad` | backend | Estable (el backend ya la usa, PR #70) | [§5.3](#53-ingredientedisponibilidad) |
| `POST /internal/plato-disponibilidad` | backend (`PATCH /api/platos/:id/disponible`) | Lista, espera que el backend la llame | [§5.4](#54-platodisponibilidad) |
| `POST /internal/payment-confirmed` | backend (cobros de caja) | Estable (el backend la llama desde `registrarPago`, PR #58) | [§8.6](#86-cobros-de-caja-post-internalpayment-confirmed) |
| `POST /internal/mesa-comensal` | backend (tras el COMMIT de D-18) | Estable (el backend ya la llama, D-18/D-18b) | [§6.4](#64-comensales-sin-celular-post-internalmesa-comensal) |
| `POST /internal/inventario-alerta` | backend (D-17, oyente del canal `inventario`) | Estable (el backend ya la llama, D-17) | [§5.5](#55-inventarioalerta) |
| `POST /internal/item-cancelado` | backend (tras el COMMIT de J-14, el comensal quita un plato, o de D-13, el personal cancela uno) | Lista; el backend la llama desde #180 | [§5.6](#56-itemcancelado) |

`/internal/*` es solo servidor a servidor (`x-internal-key`). En producción nginx
responde 404 a esas rutas desde Internet; ningún frontend debe llamarlas.

## Códigos de error

Los mensajes al cliente son genéricos a propósito: el detalle (firma inválida,
motivo exacto) va solo al log del servidor.

### `connect_error` (al conectar el socket)

| `err.message` | Cuándo | Qué hacer |
|---|---|---|
| `AUTH_REQUERIDA` | No se envió `auth.token` | Pedir sesión (escanear el QR o iniciar sesión) |
| `TOKEN_INVALIDO` | JWT inválido, vencido, de una sesión de mesa ya liberada o de comensal **sin alias** (sesión antigua) | Pedir un JWT nuevo; no reintentar con el mismo |
| `MESA_LLENA` | La mesa ya tiene capacidad + 4 comensales conectados | Avisar al comensal; reintentar más tarde |
| `SERVIDOR_CERRANDO` | El servidor se está reiniciando | Nada: Socket.io reintenta solo |
| `ERROR_INTERNO` | Fallo inesperado (p. ej. Redis caído) | Reintentar con espera |

### `codigo` en el ack de un evento

| `codigo` | Cuándo |
|---|---|
| `PAYLOAD_INVALIDO` | Falta un campo o tiene un tipo/valor inválido |
| `NO_AUTORIZADO` | El rol no puede emitir ese evento o tocar esa mesa; o el comensal manda otro alias que el de su JWT, o toca una línea de otro comensal |
| `SIN_SALA` | El comensal no hizo `join:table` antes de emitir |
| `RATE_LIMIT` | 20 eventos/s por socket, 1 llamada al mesero por mesa cada 60 s, o 1 `mesa:presencia:solicitar` por socket cada 2 s |
| `ERROR_INTERNO` | Fallo inesperado del servidor o de Redis; reenviar con el **mismo** `eventId` |

### Respuestas HTTP (`{ ok: false, codigo, mensaje }`)

| Status · `codigo` | Cuándo |
|---|---|
| `400 PAYLOAD_INVALIDO` | Cuerpo o campo inválido |
| `400 JSON_INVALIDO` | El cuerpo no es JSON |
| `400 FIRMA_INVALIDA` | Webhook con checksum o antigüedad inválidos |
| `401 NO_AUTORIZADO` | Sin credencial, credencial inválida o sesión de mesa liberada |
| `401 TOKEN_INVALIDO` | JWT de comensal antiguo, sin alias (`/pagos/intencion`, `/push/suscripcion`) |
| `403 NO_AUTORIZADO` | Credencial válida sin permiso (rol, alias que no está en la mesa) |
| `404` | Ruta inexistente (y toda `/internal/*` desde Internet, en nginx) |
| `409 SIN_SALDO` | Intención de pago sin nada que cobrar |
| `409 MESA_LIBERADA` | La mesa figura liberada y no se ha generado un QR nuevo ([§6.4](#64-comensales-sin-celular-post-internalmesa-comensal)) |
| `409 ALIAS_EN_USO` | La clave del alias ya está en uso en la mesa ([§6.4](#64-comensales-sin-celular-post-internalmesa-comensal)) |
| `409 LIMITE_COMENSALES` | La mesa ya tiene 20 comensales sin celular ([§6.4](#64-comensales-sin-celular-post-internalmesa-comensal)) |
| `413 CUERPO_DEMASIADO_GRANDE` | Cuerpo de más de 100 KB |
| `429 RATE_LIMIT` | Más de 5 intenciones de pago por minuto (o límite de nginx en login y pagos) |
| `500/502/503 ERROR_INTERNO` | Fallo propio, del backend o reinicio en curso; reintentar |
| `503 NO_CONFIGURADO` | Pagos, Web Push o `INTERNAL_API_KEY` sin configurar |

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
| `comensal` | `{ id_mesa, rol, comensal, sid }` (`comensal` = su alias, **obligatorio**) | Solo `room:mesa-{su id_mesa}` (con `join:table`) |
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
- Comensal: su alias sale **del JWT** (lo firma el backend al abrir la sesión; ver
  [Alias del comensal](#alias-del-comensal-r-18)). No hace falta enviarlo; si se envía
  `comensal` distinto del JWT → `NO_AUTORIZADO`.

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
| `comensal` | string | **Comensal:** opcional; se usa el alias del JWT y, si viene distinto, `NO_AUTORIZADO`. Un comensal solo edita o quita **sus** líneas (las de otro → `NO_AUTORIZADO`, sin cambios). **Personal:** obligatorio en `set` y `remove` (1–40); puede corregir cualquier línea |
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
          { "id_ingrediente": 10, "nombre": "Arroz", "porcion": "normal", "precio_aplicado": 0, "paso": "Elige tu Base" },
          { "id_ingrediente": 12, "nombre": "Pollo", "porcion": "extra", "precio_aplicado": 1500, "paso": "Elige tu Proteína" }
        ]
      }
    ]
  }
}
```

`id_pedido`, `id_mesa` y `estado` son obligatorios; el resto se reenvía tal cual.
Cada ingrediente lleva `paso`: el nombre del paso del constructor al que pertenece, o `null` si no viene de un paso (el campo va siempre, nunca se omite). Los ingredientes llegan ordenados por `pasos_constructor.orden`, así que el KDS los agrupa por `paso` sin ordenar nada. El socket-server no valida ni filtra este campo: lo reenvía tal cual.
Qué pasa con el carrito al crear la comanda (cada comensal envía **solo sus platos**):

- **Con alias** (`items[].comensal`, que el backend toma del JWT de quien pidió): se quitan
  del carrito **solo las líneas de esos alias**; las de los demás comensales se quedan. Se
  emite `cart:updated` a `room:mesa-{ID}` con `origen: "sistema"` y el snapshot resultante
  (la `version` sube en 1). Si esos alias no tenían líneas, no se emite nada.
- **Sin alias** (pedido del personal sin `comensal` en los ítems): el carrito **no se toca**
  y no se emite `cart:updated`.
- Alias válido: texto no vacío de hasta 40 caracteres (tras quitar espacios); se usan los
  valores únicos.
- Quitar las líneas es **una sola operación atómica** (en memoria y en Redis): un
  `cart:update` simultáneo de otro comensal no se pierde ni se borra. Un reintento del
  mismo pedido (mismo `eventId` o mismo `id_pedido`) responde `duplicado: true` y no quita
  nada otra vez, aunque el comensal ya haya agregado platos nuevos.

**Orden y reintentos ("primero confirmar, después avisar").** El servidor procesa así:

1. Quita las líneas de los alias del pedido y, si cambió algo, emite `cart:updated`.
2. Guarda los dueños del pedido (para el push de "¡Tu plato está listo!").
3. Reserva el aviso del pedido (una sola operación atómica, `SET NX` en Redis) y emite
   `order:created`.
4. Marca el `eventId` para responder al instante a un reintento exacto.

Consecuencias para quien emite y para quien escucha:

- **En `room:mesa-{ID}`, `cart:updated` (`origen: "sistema"`) llega ANTES que
  `order:created`.** No dependas del orden inverso.
- **Reintento ante `5xx` (HTTP) o `ERROR_INTERNO` (socket):** reenvía el **mismo
  `eventId`**. Si falló el paso 1, el 2 o el 3, todavía no se había reservado nada, así
  que el reintento completa lo que faltó: las líneas se quitan una sola vez y
  `order:created` sale una sola vez. Si el aviso ya había salido, el reintento responde
  `duplicado: true`, no reemite y no toca el carrito.
- Si falla solo la marca del paso 4, la respuesta igual es `ok: true` (el fallo se
  registra en el log): la reserva por pedido ya protege el aviso, y el siguiente reintento
  responde `duplicado: true`.

Claves de idempotencia de este evento (en Redis llevan el prefijo `sd:idem:`):

| Clave | Para qué | TTL |
|---|---|---|
| `sistema:cart:{id_mesa}:pedido:{id_pedido}` | Quitar las líneas una sola vez (va en la misma transacción que el carrito) | 10 min |
| `order:created:pedido:{id_pedido}` | Emitir `order:created` una sola vez | 10 min |
| `order:created:{eventId}` | Responder `duplicado` a un reintento exacto (secundaria) | 10 min |
| `sd:pedido:{id_pedido}:duenos` (sin `idem:`) | Dueños del pedido para el push | 24 h |

Pasados los 10 min, el mismo pedido se procesaría como nuevo.

Límites conocidos:

- **El proceso muere entre la reserva (paso 3) y la emisión.** Esa comanda no se anuncia
  en vivo (se prefiere perder un aviso a mostrarlo dos veces). El pedido sí existe en la
  base: el KDS y el panel lo recuperan al recargar o al reconectar (carga inicial por la
  API).
- **Líneas nuevas mientras Redis estaba caído.** El pedido no trae `id_linea`, así que se
  quitan **todas** las líneas de esos alias. Si Redis se cae antes del paso 1 y, cuando
  vuelve, el comensal agrega platos antes de que llegue el reintento, el reintento también
  se los lleva. La ventana es corta: mientras Redis está caído nadie puede editar el
  carrito.

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
- El servidor reenvía a `room:admin` con `id_mesa` y `comensal` (ambos del JWT) y
  `emitidoEn`. Un `comensal` en el payload se ignora. Los comensales no lo reciben.

### `cuenta:solicitada`

El comensal pide la cuenta. Rol: **solo `comensal`**, con `join:table` previo.
Payload: `{ "eventId": "..." }`. Idempotente por `eventId`.

Llega a `room:admin` y a la sala de la mesa (los demás comensales lo ven) como
`{ eventId, id_mesa, comensal, emitidoEn }`. La mesa queda marcada (`sd:mesa:{ID}:cuenta = 1`)
hasta que se libere.

---

### `mesa:presencia:solicitar`

El panel pide la presencia de **todas** las mesas con algo y la recibe **en el ack**: no se
emiten eventos sueltos, así que funciona aunque sus listeners todavía no estén registrados.
Solo `admin`, `mesero` y `cajero`. No lleva payload ni `eventId` (es una lectura).

```js
socket.emit('mesa:presencia:solicitar', {}, (r) => { /* … */ })
```

| ack | Cuándo |
|---|---|
| `{ ok: true, mesas: [ <mesa:presencia>, … ] }` | Siempre que se pueda calcular. Cada elemento tiene el payload de [§5.2](#52-mesapresencia), ordenados por `id_mesa`. La lista es **completa**: una mesa que no aparece no tiene nadie |
| `{ ok: false, codigo: 'NO_AUTORIZADO' }` | Lo pide un comensal, una tablet o la cocina |
| `{ ok: false, codigo: 'RATE_LIMIT' }` | Otra solicitud del mismo socket hace menos de 2 s; no se calcula nada. Basta con usar la respuesta anterior |
| `{ ok: false, codigo: 'ERROR_INTERNO' }` | Redis no responde. La conexión sigue y el panel puede reintentar más tarde |

**Recomendado en el panel:** pedirla en cada `connect` (al abrir, al recargar y al
reconectar), **después** de registrar los listeners. Por ejemplo, en `TablesContext.jsx`,
debajo de los `useSocketListener`:

```jsx
useEffect(() => {
  const pedir = () => socket.emit('mesa:presencia:solicitar', {}, (r) => {
    if (!r?.ok) return // RATE_LIMIT o ERROR_INTERNO: queda el envío automático de respaldo
    setPresenciaPorMesa(Object.fromEntries(r.mesas.map((p) => [Number(p.id_mesa), p])))
  })
  if (socket.connected) pedir()
  socket.on('connect', pedir)
  return () => socket.off('connect', pedir)
}, [socket])
```

Como la lista es completa, **reemplaza** `presenciaPorMesa` en lugar de mezclarla. Sin este
cambio el panel funciona igual, con el envío automático de 500 ms como respaldo (§5.2).

## 5. Eventos servidor → cliente

| Evento | Destino | Payload |
|---|---|---|
| `cart:updated` | `room:mesa-{ID}` (todos **menos** quien emitió; tras `order:created`, **todos**) | `{ eventId, origen, carrito: { version, items } }` (`origen`: alias de quien editó, o `"sistema"` tras `order:created`) |
| `order:created` | `room:kds`, `room:admin`, `room:mesa-{ID}` | `{ eventId, pedido, emitidoEn }` |
| `order:status` | `room:kds`, `room:admin`, `room:mesa-{ID}` | `{ eventId, id_pedido, id_mesa, codigo_pedido, estado_anterior, estado, emitidoEn }` |
| `item:cancelado` | `room:kds`, `room:admin`, `room:mesa-{ID}` | `{ eventId, id_pedido, id_mesa, codigo_pedido, id_detalle, nombre, comensal, total, estado_pedido, origen, emitidoEn }` (§5.6) |
| `payment:confirmed` | `room:admin`, `room:mesa-{ID}` | `{ eventId, id_mesa, comensal, monto, saldo_restante, monto_centavos, saldo_restante_centavos, referencia_externa, emitidoEn }` (mismo payload para Wompi, §8.3, y caja, §8.6) |
| `pago:alerta` | `room:admin` | `{ eventId, id_mesa, comensal, monto_centavos, monto_esperado_centavos, referencia_externa, id_transaccion_pasarela, motivo, emitidoEn }` (§8.5) |
| `qr:actualizado` | `room:mesa-{ID}` (incluye a la `pantalla` de esa mesa) | `{ id_mesa, token_qr, emitidoEn }` |
| `mesa:llamar_mesero` | `room:admin` | `{ eventId, id_mesa, comensal, motivo, emitidoEn }` |
| `cuenta:solicitada` | `room:admin`, `room:mesa-{ID}` | `{ eventId, id_mesa, comensal, emitidoEn }` |
| `mesa:presencia` | `room:admin`, `room:mesa-{ID}` (solo la de esa mesa) | `{ id_mesa, comensales: [alias], total, pagaron: [alias], sin_celular: [alias] }` (ver §5.2) |
| `ingrediente:disponibilidad` | todos los sockets (mesas, `room:kds`, panel) | `{ id_ingrediente, disponible, emitidoEn }` |
| `plato:disponibilidad` | todos los sockets (mesas, `room:kds`, panel) | `{ id_plato, disponible, emitidoEn }` |
| `inventario:alerta` | `room:admin` | `{ eventId, id_insumo, nombre, unidad, stock_actual, stock_minimo, agotado, emitidoEn }` (§5.5) |
| `mesa:liberada` | `room:mesa-{ID}`, `room:admin` | `{ id_mesa, motivo, emitidoEn }` (`motivo`: `pagada` o `liberada`) |

Notas para el frontend:

- `cart:updated` trae el **snapshot completo**: reemplaza el carrito local, no lo sumes.
  Si `version` recibida ≤ la local, ignórala (llegó desordenada).
- `order:created` y `order:status` pueden llegar repetidos si el servidor reintenta;
  deduplica por `eventId`.
- El sender de `cart:update` **no** recibe `cart:updated` (usa el snapshot de su ack).
- `cart:updated` con `origen: "sistema"` llega a **toda** la mesa cuando un pedido quita las
  líneas de quien lo envió (ver [`order:created`](#ordercreated)); el `eventId` es el del pedido.
- `payment:confirmed` trae el **mismo payload** venga de Wompi (§8.3) o de la caja (§8.6):
  el panel y la mesa no necesitan distinguir el origen. Deduplica por `eventId`.
- `mesa:liberada`: la sesión de mesa terminó (pago o liberación manual). Ver §5.1.
- `qr:actualizado` no lleva `eventId` (no lo dispara un cliente). Llega en dos casos: cuando
  el backend rota el token en la base y avisa por `/internal/qr-rotado` (§6.2), y en la
  **rotación automática** de una mesa abierta y vacía, que el socket-server emite solo
  después de que el backend guarde el QR nuevo (`POST /api/mesas/:id/token-qr/interno`, #168;
  ver [docs/rotacion-qr.md](docs/rotacion-qr.md)). La pantalla de la mesa simplemente
  **redibuja el QR** con el `token_qr` recibido; no hace falta deduplicar porque redibujar con
  el mismo valor es inofensivo.

### 5.1. `mesa:liberada`

Lo emite el servidor cuando el backend llama a `POST /internal/mesa-liberada` **después** de
confirmar en la base que la mesa quedó libre.

**Cuándo se libera una mesa (regla del backend, la fuente de verdad):**

- Un pedido se cierra (`pagado`) solo cuando está `entregado` **y** su saldo es 0, en
  cualquiera de los dos órdenes: si se paga antes de que salga la comida, el pago queda
  registrado y el pedido se cierra cuando el mesero lo marca `entregado`.
- La mesa se libera **sola** cuando **todos** los pedidos de la visita actual quedan en
  `pagado` o `cancelado` (`liberarSiNoQuedanPedidosAbiertos`, en la misma transacción que
  cerró el último). Es `motivo: "pagada"` si lo cerró un pago o una entrega con la cuenta
  ya pagada, y `"liberada"` si lo cerró una cancelación.
- **Saldo 0 no basta:** si la mesa pagó todo pero algún pedido sigue en `recibido`,
  `en_preparacion` o `listo`, la mesa sigue ocupada y no llega `mesa:liberada` hasta que ese
  pedido se entregue.
- A mano (`motivo: "liberada"`) solo se puede si la visita no tiene pedidos abiertos. Es
  para grupos que se van sin pedir; con pedidos abiertos el backend responde `409`.

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

Quién está sentado en cada mesa y quién ya pagó. Se emite a `room:admin` (panel) **y a
`room:mesa-{ID}`** (los comensales y la pantalla de **esa** mesa; ninguna otra mesa lo
recibe) cada vez que:

- un **comensal** hace `join:table`, `leave:table` o se desconecta;
- se confirma un pago con alias: un pago en línea (webhook, §8.3) o un cobro de caja con
  `comensal` (§8.6), siempre que quede saldo;
- el personal agrega o quita a alguien sin celular (§6.4) y la lista cambia.

Máximo **un aviso por mesa cada 500 ms**: el primero sale al instante y, si hubo más cambios
dentro de esa ventana, se envía uno más al cerrarla (el último estado siempre llega).

**Al conectar el panel.** El panel tiene dos formas de saber, al conectar o al recargar la
página, quién está en cada mesa, sin esperar al siguiente cambio:

1. **Recomendada: [`mesa:presencia:solicitar`](#mesapresenciasolicitar)** en cada `connect`,
   después de registrar los listeners. La lista llega **en el ack**, así que no depende de
   que haya listeners.
2. **Respaldo automático, sin cambios en el panel:** **500 ms** después de que un socket de
   personal (`admin`, `mesero`, `cajero`) se conecta, el servidor le envía **solo a él** un
   `mesa:presencia` por cada mesa con algo, con el mismo evento y el mismo payload. Basta con
   guardar el último por `id_mesa`, como ya hace el panel. Si el socket se desconecta antes,
   no se calcula ni se envía nada.

¿Por qué el retraso? El panel crea el socket al renderizar y registra los listeners después,
en un `useEffect`. Si la presencia sale justo al conectar y el handshake gana, Socket.io la
descarta en el cliente porque nadie la escucha todavía. Pasó en una prueba local: conectó a
los 13 ms y el listener se registró a los 16 ms. Los 500 ms dan margen de sobra, pero no
garantizan nada si el primer render tarda más. Por eso se recomienda la opción 1.

En los dos casos:

- No llega a nadie más: ni a los otros paneles, ni a las mesas, ni a la cocina, ni a las
  tablets.
- Las mesas sin nada (una tablet sola en su sala, o una mesa cerrada) no se incluyen. Para el
  panel, que no llegue una mesa equivale a 0 comensales.
- Se incluyen las mesas **sin ningún socket**, por ejemplo un grupo de personas sin celular
  con la tablet apagada. Para eso el servidor lleva el índice `sd:mesas:con-estado` (en
  memoria si no hay Redis), que vence a las 24 h de la última anotación y se borra al liberar
  la mesa.
- **Limitación conocida:** si una mesa cambia justo mientras se arma la lista, el panel puede
  recibir primero el estado nuevo (el aviso normal) y después el de la lista, un poco más
  viejo. El evento no lleva versión y la ventana dura milisegundos. Queda corregido en el
  siguiente cambio de esa mesa.

```json
{ "id_mesa": 5, "comensales": ["Ana", "Beto"], "total": 2, "pagaron": ["Ana"], "sin_celular": [] }
```

- `comensales`: alias distintos, ordenados. Dos pestañas de "Ana" cuentan como una persona.
- `total`: personas en la mesa = alias distintos (cada JWT de comensal trae el suyo).
- `pagaron`: alias que ya pagaron algo **en esta sesión de mesa**, en cualquier modo, estén
  sentados o no; ordenados. Se borra al liberarse la mesa. Un cobro de caja sin `comensal`
  no aparece (no se sabe de quién es). Un pago que deja el saldo en 0 tampoco: el
  socket-server lo toma como el último pago. Ojo: la mesa solo se libera cuando además todos
  los pedidos están entregados ([§5.1](#51-mesaliberada)); mientras tanto, quien pagó ese
  último saldo no figura en `pagaron`. Con saldo 0 «igual» ya responde `409 SIN_SALDO`, así
  que el reparto no cambia.
- El personal y la pantalla no cuentan.
- No lleva `eventId`: es un estado completo; quédate siempre con el último.
- La PWA lo usa para mostrar cuánto es «igual» antes de pedir la intención
  ([§8.1](#81-post-pagosintencion)).

**Campo `sin_celular`** (Estable desde R-19.2; compatible hacia atrás). Las
personas sin celular las agrega el personal con
[`POST /internal/mesa-comensal`](#64-comensales-sin-celular-post-internalmesa-comensal):

```json
{ "id_mesa": 5, "comensales": ["Abuela", "Ana", "Beto"], "total": 3, "pagaron": ["Ana"], "sin_celular": ["Abuela"] }
```

- `sin_celular` (nuevo): alias agregados por el personal, ordenados. Siempre presente (`[]` si
  no hay).
- `comensales`: unión de los alias conectados y `sin_celular`, sin repetidos, ordenada.
- `total`: cuenta ambos.
- `pagaron`: sin cambios; un alias sin celular aparece si se cobra en caja con `comensal` (§8.6).
- Se emite también cuando cambia `sin_celular`, con la misma ventana de 500 ms.
- Los clientes viejos que ignoran `sin_celular` siguen funcionando.

### 5.3. `ingrediente:disponibilidad`

El backend avisa que un ingrediente se agotó (`disponible: false`) o volvió (`true`) con
`POST /internal/ingrediente-disponibilidad`. El constructor de la PWA debe deshabilitar o
habilitar esa opción en vivo; el KDS puede mostrar una alerta. No lo puede emitir un cliente.

### 5.4. `plato:disponibilidad`

El backend avisa que un plato se agotó (`disponible: false`) o volvió (`true`) con
`POST /internal/plato-disponibilidad`, **después del COMMIT** de
`PATCH /api/platos/:id/disponible` (roles `admin` y `cocina`). Se comporta igual que
[`ingrediente:disponibilidad`](#53-ingredientedisponibilidad):

```http
POST /internal/plato-disponibilidad
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "id_plato": 7, "disponible": false, "eventId": "<uuid opcional>" }
```

- `id_plato`: entero positivo (seguro). `disponible`: `true` o `false` estricto. Si no,
  `400 PAYLOAD_INVALIDO`; un cuerpo que no es un objeto JSON, `400 JSON_INVALIDO`. Sin
  `x-internal-key` o con una equivocada, `401 NO_AUTORIZADO`. En ningún error se emite nada.
- `eventId` opcional; si viene, debe ser un UUID. Un reintento con el mismo `eventId`
  responde `{ "ok": true, "duplicado": true }` y no reemite (clave propia
  `backend:plato:{eventId}`, independiente de la de ingredientes). Sin `eventId`, cada
  llamada se difunde.
- Respuesta normal: `200 { "ok": true, "duplicado": false }`.
- Emite a **todos** los sockets `plato:disponibilidad { id_plato, disponible, emitidoEn }`.
  Cualquier otro campo del cuerpo se descarta. La PWA debe mostrar u ocultar (o marcar
  como agotado) el plato en el menú en vivo; el KDS y el panel pueden refrescar su lista.
  No lo puede emitir un cliente.

### 5.5. `inventario:alerta`

> **Estable · R-20.2.** Implementado en `src/sala.js` (pruebas: `tests/sala-inventario.test.js`).
> El backend la llama desde D-17 (`services/inventario-avisos.js` → `notificarInventarioAlerta`)
> y el panel escucha `inventario:alerta` en la pestaña de insumos (P-22). Los campos son los de la
> tabla `insumos` (`database/scripts/27_inventario.sql`).

El backend (D-17, `LISTEN 'inventario'`) detecta que un insumo cruzó su stock mínimo y avisa al
panel de administración en vivo con `POST /internal/inventario-alerta`:

```http
POST /internal/inventario-alerta
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "id_insumo": 12, "nombre": "Queso costeño", "unidad": "g", "stock_actual": 450, "stock_minimo": 500, "eventId": "<uuid>" }
```

**Quién la llama:** el backend, cuando el insumo **pasa** de estar sobre el mínimo a estar en o
bajo el mínimo (o llega a 0). No en cada movimiento. Esa decisión es del backend; el
socket-server solo retransmite. Ningún frontend la llama; nginx responde 404 desde Internet
(igual que toda `/internal/*`).

| Campo | Obligatorio | Regla |
|---|---|---|
| `id_insumo` | Sí | Entero positivo seguro |
| `nombre` | Sí | Texto de 1 a 80 caracteres (se cuentan caracteres, como `VARCHAR(80)`) |
| `unidad` | Sí | Texto de 1 a 15 caracteres |
| `stock_actual` | Sí | Número JSON finito ≥ 0 (puede tener decimales) |
| `stock_minimo` | Sí | Número JSON finito ≥ 0 (puede tener decimales) |
| `eventId` | Sí | UUID |

`stock_actual` y `stock_minimo` deben ser números JSON, no texto: D-17 debe convertir los
`NUMERIC` que devuelve `pg` (llegan como texto); si no, recibe `400 PAYLOAD_INVALIDO`.

Errores, sin emitir nada en ningún caso: `400 PAYLOAD_INVALIDO`, `400 JSON_INVALIDO`,
`401 NO_AUTORIZADO` (sin clave o clave errada) y `503 NO_CONFIGURADO`.

- Respuesta normal: `200 { "ok": true, "duplicado": false }`.
- **Idempotencia:** clave propia `backend:inventario-alerta:{eventId}`, TTL de 10 min. Repetido
  → `200 { "ok": true, "duplicado": true }` sin reemitir. Se reserva el `eventId`, se emite y,
  si falla la emisión, se libera la clave y se responde `500 ERROR_INTERNO` (también si el
  almacén de idempotencia, Redis, no responde). Todo se valida antes de reservar: un `4xx` no
  consume el `eventId`.
- **Reintentos:** el backend solo reintenta, con el mismo `eventId`, ante
  `500/502/503 ERROR_INTERNO`; nunca ante `503 NO_CONFIGURADO` ni ante un `4xx`.

Emite `inventario:alerta` **solo a `room:admin`** (`admin`, `mesero` y `cajero`: el mesero
necesita saber qué se agota); nunca a las mesas ni a `room:kds`:

```json
{ "eventId": "7d3f0c52-8a41-4e6b-b1f7-3c9a2e5d6f10", "id_insumo": 12, "nombre": "Queso costeño", "unidad": "g", "stock_actual": 450, "stock_minimo": 500, "agotado": false, "emitidoEn": "2026-11-09T20:15:00.000Z" }
```

- `agotado`: `stock_actual === 0`, calculado por el socket-server. Cualquier otro campo del
  cuerpo se descarta.
- **No se guarda:** si el panel estaba desconectado, se pierde el aviso. El panel debe cargar al
  iniciar la lista de stock bajo por REST (vista `v_stock_bajo` del backend, ruta a definir por
  Daniel y Jarrinson) y usar `inventario:alerta` solo para avisos en vivo. Deduplica por
  `eventId`.

### 5.6. `item:cancelado`

> **Lista · R-24.** Implementado en `src/item-cancelado.js` (pruebas: `tests/item-cancelado.test.js`).
> El backend la llama desde J-14 (#180: `POST /api/pedidos/:id/items/:id_detalle/cancelar` →
> `notificarItemCancelado`, con `origen: "comensal"`) y lo hará desde D-13 (el personal cancela un plato,
> `origen: "personal"`). Falta que el KDS, el panel y la PWA escuchen `item:cancelado`.

Se cancela **una línea entera** de un pedido:

- el **comensal** la quita mientras el pedido sigue `recibido`, antes de que la cocina lo empiece (J-14);
- o el **personal** la cancela desde el panel, también con el pedido ya en cocina (D-13).

El backend cancela la línea, la base devuelve el stock y recalcula el total, y **después del COMMIT**
avisa:

```http
POST /internal/item-cancelado
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "id_pedido": 42, "id_mesa": 5, "codigo_pedido": "PED-20261111-0042", "id_detalle": 310, "id_plato": 1001,
  "nombre": "Bowl Personalizado", "comensal": "Ana", "total": 18000, "estado_pedido": "recibido", "origen": "comensal",
  "eventId": "<uuid>" }
```

**Quién la llama:** solo el backend. Ningún frontend la llama; nginx responde 404 desde Internet
(igual que toda `/internal/*`).

| Campo | Obligatorio | Regla |
|---|---|---|
| `id_pedido`, `id_mesa`, `id_detalle`, `id_plato` | Sí | Entero de 1 a 2147483647 (`INTEGER`) |
| `codigo_pedido` | Sí (puede ser `null`) | `null` o texto de 1 a 40 caracteres |
| `nombre` | Sí | Nombre del plato: texto de 1 a 120 caracteres (`VARCHAR(120)`, se cuentan caracteres) |
| `comensal` | Sí (puede ser `null`) | `null` o texto de 1 a 40 caracteres: el alias de la línea |
| `total` | Sí | **Total nuevo del pedido** (no de la mesa), en pesos, sin la línea quitada: número JSON de 0 a 99999999.99 (`DECIMAL(10,2)`). Texto como `"18000.00"` → `400` |
| `estado_pedido` | Sí | Estado del pedido **después** de quitar la línea: uno de los estados en que el backend deja cancelar un plato (`recibido`; con el personal, también `en_preparacion` o `listo`), o `cancelado` si era su última línea viva (entonces `total` es 0). Nunca `entregado` ni `pagado`: el backend no deja cancelar ahí → `400` |
| `origen` | No | Quién la quitó: `comensal` (su sesión de QR, #180) o `personal` (el panel, D-13). Si no viene, se emite `comensal`, el único origen que había antes de este campo. Si viene, tiene que ser uno de los dos: `null` u otro texto → `400` |
| `eventId` | Sí | UUID |

**Validación estricta:** un campo de más es `400 PAYLOAD_INVALIDO` (no se descarta en
silencio), igual que un campo ausente o de otro tipo. Errores, sin emitir nada:
`400 PAYLOAD_INVALIDO`, `400 JSON_INVALIDO`, `401 NO_AUTORIZADO` (sin clave o clave errada,
comparada en tiempo constante; se comprueba antes del cuerpo) y `503 NO_CONFIGURADO`.

- Respuesta normal: `200 { "ok": true, "duplicado": false }`.
- **Idempotencia:** clave propia `backend:item-cancelado:{eventId}`, TTL de 10 min. Repetido →
  `200 { "ok": true, "duplicado": true }` sin reemitir. Todo se valida antes de reservar: un `4xx`
  no consume el `eventId`. Se reserva, se emite y, si la emisión falla, se libera la clave y se
  responde `500 ERROR_INTERNO` (también si Redis no responde).
- **Reintentos:** el backend reintenta, con el mismo `eventId`, solo ante `500/502/503
  ERROR_INTERNO`; nunca ante `503 NO_CONFIGURADO` ni ante un `4xx`.

Emite `item:cancelado` a `room:kds` (la cocina tacha la línea), `room:admin` (la Caja ve el
total nuevo) y `room:mesa-{ID}` (los demás comensales y la pantalla de esa mesa). Un admin, que
está en `room:kds` y en `room:admin`, lo recibe una sola vez. Nunca a otras mesas:

```json
{ "eventId": "7d3f0c52-8a41-4e6b-b1f7-3c9a2e5d6f10", "id_pedido": 42, "id_mesa": 5, "codigo_pedido": "PED-20261111-0042",
  "id_detalle": 310, "nombre": "Bowl Personalizado", "comensal": "Ana", "total": 18000, "estado_pedido": "recibido",
  "origen": "comensal", "emitidoEn": "2026-11-11T20:15:00.000Z" }
```

- **Payload mínimo:** `id_plato` se valida pero no se reenvía (las pantallas ubican la línea por
  `id_detalle`). `emitidoEn` lo pone el socket-server, y `origen` siempre viene (con `comensal` si el
  backend no lo mandó).
- **Última línea:** si `estado_pedido` es `cancelado`, el backend manda **además** el
  `order:status` `… → cancelado` de siempre, encadenado después de este aviso. El KDS
  puede quitar la comanda con cualquiera de los dos; el socket-server no deriva nada de
  `estado_pedido`.
- **No libera la mesa:** el grupo sigue sentado y puede volver a pedir.
- **No se guarda:** quien estaba desconectado lo ve al recargar por REST (`GET /api/pedidos/...`
  o las comandas del KDS, que ya excluyen las líneas canceladas). Deduplica por `eventId`.

---

## 6. Endpoints HTTP

CORS con la misma política que el socket: la lista blanca `CORS_ORIGINS` y, solo con `NODE_ENV=development`, el modo red local (ver §9).

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
| POST | `/internal/plato-disponibilidad` | Header `x-internal-key` | Solo backend, tras el COMMIT de `PATCH /api/platos/:id/disponible`. `{ "id_plato": 7, "disponible": false, "eventId": "<uuid opcional>" }` → emite `plato:disponibilidad` (§5.4). Con `eventId`, un reintento responde `duplicado: true` |
| POST | `/internal/payment-confirmed` | Header `x-internal-key` | Solo backend. Cobro de caja (efectivo, datáfono o abono) ya registrado → emite `payment:confirmed` con el mismo payload que Wompi (§8.6) |
| POST | `/internal/item-cancelado` | Header `x-internal-key` | Solo backend, tras el COMMIT de J-14 (el comensal quita un plato) o de D-13 (el personal cancela uno). `{ id_pedido, id_mesa, codigo_pedido, id_detalle, id_plato, nombre, comensal, total, estado_pedido, origen?, eventId }`, validación estricta (un campo de más → `400`) → emite `item:cancelado` a `room:kds`, `room:admin` y `room:mesa-{ID}` (§5.6) |
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

La **rotación automática** (mesa abierta y sin comensales, cada 3 min) va en el sentido
contrario: el socket-server firma el QR y llama a `POST /api/mesas/:id/token-qr/interno` del
backend (implementado en #168). Ese endpoint **no** llama a `/internal/qr-rotado`: el
socket-server emite `qr:actualizado` cuando recibe el `200`. Contrato y respuestas en
[docs/rotacion-qr.md](docs/rotacion-qr.md).

### 6.3. Cómo emite el backend `order:created` / `order:status`

```
POST http://localhost:4001/internal/order-created
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "eventId": "...", "pedido": { ... } }
```

Responde `200 { "ok": true, "duplicado": false }`. Reintentar con el mismo `eventId` es
seguro. En `order-created`, ante un `5xx` hay que reintentar con el mismo `eventId`: el
reintento termina de quitar las líneas del carrito sin volver a emitir la comanda (ver
[`order:created`](#ordercreated), "Orden y reintentos").

### 6.4. Comensales sin celular: `POST /internal/mesa-comensal`

> **Estable · R-19.2.** Implementada en `src/mesa-comensal.js` (regla del alias en `src/alias.js`;
> pruebas: `tests/mesa-comensal.test.js` y `tests/alias-paridad.test.js`). El backend la llama
> desde D-18/D-18b (`notificarMesaComensal`, con reintentos y una cola por mesa).

Alguien en la mesa no tiene celular y el mesero (o el admin) pide por esa persona desde el panel
(D-18: `POST /api/mesas/:id/comensales` en el backend). Debe contar como persona en
[`mesa:presencia`](#52-mesapresencia) y en «igual» ([§8.1](#81-post-pagosintencion)), y puede
pagar en caja con su alias ([§8.6](#86-cobros-de-caja-post-internalpayment-confirmed)).

**Quién la llama:** el backend, **después del COMMIT** de D-18, tanto al agregar como al quitar.
Ningún frontend la llama; nginx responde 404 desde Internet (igual que toda `/internal/*`).

```http
POST /internal/mesa-comensal
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "id_mesa": 5, "alias": "Abuela", "accion": "agregar", "eventId": "<uuid>" }
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `id_mesa` | Sí | Entero positivo seguro |
| `alias` | Sí | La regla del alias de abajo |
| `accion` | Sí | `"agregar"` o `"quitar"`, estricto |
| `eventId` | Sí | UUID. Obligatorio porque el backend reintenta estos avisos (ver "Idempotencia y reintentos") |

Cualquier otro campo del cuerpo se descarta.

**Regla del alias:** la misma de [R-18](#alias-del-comensal-r-18), definida en
[`backend/src/services/alias-comensal.js`](../backend/src/services/alias-comensal.js):

- Se normaliza con NFC, sin espacios a los lados y con los espacios dobles reducidos a uno.
- De 2 a 40 puntos de código.
- Solo letras, marcas, números, espacio y `. _ ' -`.
- La unicidad se mide por **clave**: sin tildes, en minúsculas y sin espacios ni `. _ ' -`
  («Ana», «ana» y «Ána» tienen la misma). Una clave vacía es inválida.
- La clave `general` está **reservada** (D-18c): «General» es el cajón de los platos sin dueño en
  la cuenta. «General», « GENERAL » o «Géneral» son `400 PAYLOAD_INVALIDO`; un nombre que solo la
  contiene («General Pérez») es válido.
- Se guarda la forma **normalizada** («  Abuela » se guarda como «Abuela»).

`tests/alias-paridad.test.js` compara `src/alias.js` con `normalizarAlias` del backend en más de
70 casos. Carga el módulo del backend con un sustituto de `backend/src/config/redis.js` (el CI del
socket-server no instala el backend) y falla con un mensaje claro si ese módulo se mueve, deja de
exportar la función o importa algo nuevo.

Respuestas (`{ ok: false, codigo, mensaje }` en los errores; **en ningún error se emite nada**):

| Status · `codigo` | Cuándo |
|---|---|
| `200 { "ok": true, "duplicado": false }` | Cambio aplicado, o sin cambio: `agregar` un alias idéntico que ya está en `sin_celular`, o `quitar` cuando ningún alias guardado tiene esa clave. Sin cambio **no** se emite `mesa:presencia` |
| `200 { "ok": true, "duplicado": true }` | Ese `eventId` ya se procesó; no reemite |
| `400 PAYLOAD_INVALIDO` | Algún campo no cumple la tabla o la regla del alias |
| `400 JSON_INVALIDO` | El cuerpo no es un objeto JSON |
| `401 NO_AUTORIZADO` | Falta `x-internal-key` o no coincide |
| `409 MESA_LIBERADA` | La mesa figura liberada y no se ha generado un QR nuevo (al agregar y al quitar) |
| `409 ALIAS_EN_USO` | Al agregar: la clave coincide con la de un alias conectado, o con la de un alias **distinto** que ya está en `sin_celular` (p. ej. `ana` cuando existe `Ana`) |
| `409 LIMITE_COMENSALES` | Al agregar: la mesa ya tiene 20 sin celular. Es una protección contra errores o abuso, no la capacidad de la mesa |
| `500/502/503 ERROR_INTERNO` | Fallo propio o de Redis, o reinicio en curso; reintentar |
| `503 NO_CONFIGURADO` | El socket-server no tiene `INTERNAL_API_KEY` |

**`quitar` compara por clave**, igual que el backend (`normalizarAlias`): busca en `sin_celular`
el alias guardado cuya clave coincida con la del alias recibido y elimina **ese** alias guardado.
Si ninguno coincide, responde `200 { "ok": true, "duplicado": false }` sin emitir
`mesa:presencia`.

Ejemplo: la reservada es «Abuela»; el panel llama `DELETE /api/mesas/5/comensales/abuela`; el
backend libera por clave; el socket recibe `{ "accion": "quitar", "alias": "abuela" }` y quita
«Abuela».

Defensa doble: además, el backend envía el alias guardado en la reserva (D-18b).

**Las guardias no reemplazan al backend:**

- `ALIAS_EN_USO`: la fuente de verdad es la reserva del backend. D-18 reserva el alias con la
  misma función que R-18; el `409` del socket es solo una guardia.
- `MESA_LIBERADA`: el backend valida la sesión de la mesa antes del COMMIT; este `409` es solo
  una guardia.

**Idempotencia y reintentos:**

- Clave propia `backend:mesa-comensal:{eventId}`, TTL de 10 min (el de las demás rutas internas).
- Se reserva el `eventId`, se aplica el cambio y, si falla, se libera la clave, para que el
  reintento lo aplique. Un `4xx` (`400`, `401`, `409`) no consume el `eventId`.
- El backend solo reintenta, con el mismo `eventId`, ante `500/502/503 ERROR_INTERNO`; nunca ante
  `503 NO_CONFIGURADO` ni ante un `4xx`. La función `enviar` del notificador no reintenta hoy:
  D-18 debe agregarlo.
- El `eventId` evita aplicar dos veces un reintento, pero **no ordena** los avisos. El backend
  envía los de una misma mesa en serie, reutilizando `encadenarAvisos` (hoy solo ordena los pasos
  de una misma llamada: hace falta una cadena por mesa), y no reintenta un `agregar` viejo después
  de haber enviado un `quitar` posterior de ese alias.

**Efectos:**

- Si cambió el estado, emite `mesa:presencia` respetando la ventana de 500 ms
  ([§5.2](#52-mesapresencia)).
- La lista vive en `sd:mesa:{ID}:sin_celular` con TTL de 24 h, igual que `pagaron`, y se borra al
  liberarse la mesa, en el mismo momento que `pagaron`.
- **«Igual»:** cuenta a los sin celular porque van en `comensales`.
- **Cobro en caja:** el `comensal` se normaliza con la regla del alias antes de anotarlo en
  `pagaron` (§8.6), así «Abuela » de la cuenta marca a «Abuela». Si después de normalizar no
  coincide con el alias de `sin_celular`, esa persona sigue contando en «igual».
- **Rotación del QR:** con un sin celular `total` es mayor que 0 y el QR deja de rotar, igual que
  con el primer comensal conectado: hay alguien sentado.
- **Mesa solo con sin celular:** al liberarla no sale `mesa:presencia`, porque no hay comensales
  que desconectar. El panel la limpia con `mesa:liberada`.

**Pendiente (R-15):** la marca de mesa liberada que usa `409 MESA_LIBERADA` (`mesasLiberadas`)
sigue en memoria: tras un reinicio del socket-server no hay marca y esta guardia no actúa (el
backend valida igual la sesión de la mesa). Llevarla a Redis toca `liberarMesa` y `/qr/generar`:
si el borrado de la marca fallara al generar el QR, la siguiente liberación se tomaría como
duplicada y no revocaría los QR ni limpiaría el estado de la sesión nueva.

---

## 7. Web Push

El aviso **principal** es el evento de socket dentro de la página (`order:status`). El push es
un extra para cuando el comensal cerró la PWA. En **iPhone** Web Push solo funciona con la PWA
**instalada** en la pantalla de inicio (iOS 16.4 o posterior); en Safari normal no llega.

1. El frontend pide la clave pública: `GET /push/clave-publica`.
2. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
3. Hace `join:table` y envía la suscripción. El alias es **el del JWT**:
   - por socket: `push:subscribe { eventId, subscription }` (`SIN_SALA` sin join); o
   - por HTTP: `POST /push/suscripcion { subscription }`. `comensal` es opcional y, si
     viene distinto del JWT, responde `403`.
4. Service worker de referencia: [`examples/sw-push.js`](examples/sw-push.js) (muestra la
   notificación y, al tocarla, abre `/seguimiento`).

> **Cambio de contrato:** la suscripción queda ligada al **comensal** (alias del JWT).

Qué se envía:

| Estado del pedido | A quién | Título |
|---|---|---|
| `en_preparacion` | Todas las suscripciones de la mesa | Tu pedido está en preparación |
| `listo` | **Solo a los dueños del pedido** | ¡Tu plato está listo! |
| `cancelado` | Todas las suscripciones de la mesa | Tu pedido fue cancelado |

Los dueños se anotan al crear el pedido: **solo** los alias de `items[].comensal` de
`order:created` (quienes lo enviaron), no todos los que tienen líneas en el carrito de la mesa.
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
{ "modo": "igual", "eventId": "4b0d…" }
```

| Campo | Reglas |
|---|---|
| `modo` | `total` (saldo de la mesa), `igual` (saldo ÷ personas que aún no pagaron, fórmula abajo), `propio` (lo de ese comensal) |
| `eventId` | UUID. Repetirlo devuelve la **misma** respuesta, salvo que esa intención ya no siga vigente (ver abajo): entonces se trata como una petición nueva |
| `comensal` | Opcional. Quien paga es el alias **del JWT**; si viene uno distinto → `403 NO_AUTORIZADO` (nadie paga ni consulta "lo propio" de otro) |

Cualquier otro campo (`monto`, `id_mesa`, `precio`…) **se ignora**: el monto lo calcula el
servidor con la cuenta del backend.

`201` (o `200` si es la misma intención pendiente, con el mismo modo y monto, o el mismo `eventId`):

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
| `400 PAYLOAD_INVALIDO` | `modo` o `eventId` inválidos |
| `401 NO_AUTORIZADO` | Sin JWT, JWT inválido o la mesa ya se liberó |
| `401 TOKEN_INVALIDO` | JWT de comensal antiguo, sin alias: volver a escanear el QR |
| `403 NO_AUTORIZADO` | No es comensal, o `comensal` distinto del alias del JWT. Cualquier valor que no sea ese alias, aunque esté mal formado (`""`, `123`, `null`), es `403` y nunca `400` |
| `409 SIN_SALDO` | Saldo 0 (o `propio` sin consumos de ese alias) |
| `429 RATE_LIMIT` | Más de 5 intenciones por minuto del mismo comensal |
| `502/503 ERROR_INTERNO` | El backend no respondió o respondió mal |
| `503 NO_CONFIGURADO` | Pagos apagados (sin `WOMPI_*`) |

Reglas de la cuenta dividida:

- **total**: el saldo completo de la mesa.
- **igual**: el **saldo** que queda, entre las personas presentes que **aún no han pagado**
  más quien paga. Así ningún pago `propio` o de caja deja saldo sin dueño, ni a uno le toca
  la parte de otro. Quien se va sin pagar deja de contar. Fórmula exacta, en centavos
  enteros (la PWA debe replicarla tal cual con los datos de `mesa:presencia` y la cuenta):

  ```js
  // saldo:      saldo_centavos de la cuenta de la mesa
  // comensales: mesa:presencia.comensales · pagaron: mesa:presencia.pagaron
  // yo:         alias de quien paga (el del JWT)
  const pendientes = new Set(comensales.filter((a) => !pagaron.includes(a)));
  pendientes.add(yo);                 // quien paga siempre cuenta
  const n = Math.max(1, pendientes.size);
  const parte = Math.round(saldo / n / 100) * 100;   // a pesos; .5 redondea hacia arriba
  const monto = (n === 1 || parte <= 0 || parte >= saldo) ? saldo : parte;
  ```

  Con `saldo` = 0 → `409 SIN_SALDO`. El último (n = 1) paga el saldo exacto, centavos
  incluidos; nunca se cobra más que el saldo. Ejemplos:

  | Mesa | Pagos (en orden) |
  |---|---|
  | 2 personas, $85.000 | Ana propio $20.000 → Beto igual **$65.000** |
  | 3 personas, $100.000 | Ana propio $30.000 → Beto igual **$35.000** → Carlos igual **$35.000** |
  | 4 personas, $120.000 | Ana propio $45.000 → Beto, Carlos y Dani igual **$25.000** c/u |
  | 4 personas, $120.000 | Ana propio $10.000 → Beto **$36.667** → Carlos **$36.667** → Dani **$36.666** |
  | 3 personas, $100.000 | Ana **$33.333** → Beto **$33.334** → Carlos **$33.333** (todos igual) |

  Las «personas presentes» incluyen los alias de `sin_celular`
  ([§5.2](#52-mesapresencia)), que ya van en `comensales`; la PWA debe usar `comensales` y
  `pagaron` de `mesa:presencia`, tal como dice la fórmula, y no calcular con `total`. Ejemplo:
  3 personas (1 sin celular), $90.000, nadie ha pagado → igual **$30.000** cada uno.

  Si la presencia o `pagaron` cambian entre lo que mostró la PWA y la petición, manda el
  cálculo del servidor (y una pendiente anterior se reemplaza, ver abajo).
- **propio**: el saldo de ese alias según el backend (nunca más que el saldo de la mesa).
- **Una sola intención pendiente por comensal**, reutilizada **solo si sigue valiendo**. En
  cada petición el servidor consulta la cuenta y recalcula el monto:
  - mismo `modo` **y** mismo monto recalculado, y `expira_en` a más de 5 min → `200` con la
    misma intención (misma referencia y firma);
  - otro `modo`, el monto cambió (pedido nuevo, otro pago, cambio de presencia en `igual`) o
    está por vencer → `201` con una intención **nueva**. La vieja no se borra: queda `reemplazada` 7 días y
    su webhook se sigue aceptando por **su** monto exacto (§8.3), por si ya se pagó en otra
    pestaña;
  - si el backend no responde → `503 ERROR_INTERNO`, aunque haya una pendiente: nunca se
    cobra con un monto viejo.
- **Dos plazos, a propósito:**
  - **Pago y marca de pendiente:** `PAGOS_TTL_MINUTOS` (30). Después el widget la rechaza
    (`expiration-time` va dentro de la firma) y el comensal puede pedir otra.
  - **Registro de la intención:** `PAGOS_TTL_MINUTOS` × 60 + tolerancia del webhook
    (`PAGOS_WEBHOOK_TOLERANCIA_SEG`, 25 h) + 30 min. Son **26 h** por defecto. Se conserva para
    reconocer un webhook que llega tarde: Wompi solo cobra antes de `expira_en`, pero puede
    avisar hasta un día después (§8.3).

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

### 8.2. Contrato que necesita del backend

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
   **pendiente o reemplazada** (§8.1), `amount_in_cents` **exactamente** igual al esperado
   por **esa** intención y `currency COP`.
   Si algo no cuadra → intento fallido + `pago:alerta` (§8.5), `200`.
   - Un `APPROVED` con `expira_en` ya pasado **se acepta**: Wompi solo cobra antes de que
     venza, así que el pago fue válido. Por eso el registro dura más que el pago (§8.1). Pasado
     ese plazo (26 h por defecto) la referencia ya no se reconoce: `referencia_desconocida`.
     Lo mismo vale para un `DECLINED` tardío, que marca la intención como `rechazada`.
   - Pago de una **reemplazada** (el comensal la pagó en otra pestaña): se registra como
     cualquier otro. Si además pagó la nueva y la suma excede el saldo, el backend responde
     `409` a la segunda → intento fallido + `pago:alerta` (`backend_rechazo_409`) para que
     caja devuelva el dinero. Ningún pago real se pierde en silencio.
   - Al resolverse una intención solo se libera la marca de pendiente del comensal **si
     apunta a esa referencia**: pagar o rechazar una reemplazada no toca la intención nueva.
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
> agrega `comensal` y `saldo_restante`. `monto` sigue en pesos. `saldo_restante` en 0 **no**
> significa mesa libre: el backend la libera (y llega `mesa:liberada` con `motivo: "pagada"`)
> solo cuando además todos los pedidos de la visita están entregados ([§5.1](#51-mesaliberada)).

### 8.4. Contrato de registro que necesita del backend

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
- Si con este pago se cierra el último pedido abierto (todos `pagado` o `cancelado`, y solo
  pasa a `pagado` uno ya `entregado`, [§5.1](#51-mesaliberada)): liberar la mesa en la misma
  transacción, responder `mesa_liberada: true` y, **después del commit**, llamar a
  `/internal/mesa-liberada` con `{ "id_mesa": 5, "motivo": "pagada" }`. Con saldo 0 y algún
  pedido sin entregar, `mesa_liberada` es `false` y no se llama.
- 5xx o sin respuesta en 1,5 s → el socket-server responde 503 a Wompi y reintenta más tarde.

### 8.5. `pago:alerta` e intentos fallidos

`pago:alerta` → **solo** `room:admin`, para que el personal revise. Lleva cuánto y quién,
pero no datos de tarjeta ni del pagador: la pasarela no nos los entrega y no se agrega ninguno.
`comensal` es el alias de la mesa, el mismo que el panel ya ve en `payment:confirmed`.

```json
{ "eventId": "1132-903100443-27458:monto_distinto", "id_mesa": 5, "comensal": "Ana",
  "monto_centavos": 100, "monto_esperado_centavos": 3333300,
  "referencia_externa": "SD-5-…", "id_transaccion_pasarela": "1132-903100443-27458",
  "motivo": "monto_distinto", "emitidoEn": "…" }
```

- `comensal`: alias firmado en el JWT de quien creó la intención de pago; `null` si no hay
  intención.
- `monto_centavos`: lo **cobrado**, según la API de la pasarela. Si la API no conoce la
  transacción (`transaccion_inexistente`), lo que dice el evento: está firmado, pero la API no
  lo confirmó. `null` si no es un entero.
- `monto_esperado_centavos`: lo que este servidor esperaba cobrar (la intención); `null` si
  no hay intención.

| `motivo` | `id_mesa` | `comensal` | `monto_centavos` | `monto_esperado_centavos` |
| :--- | :--- | :--- | :--- | :--- |
| `monto_distinto`, `moneda_distinta` | sí | sí | API | sí |
| `estado_no_aprobado`, `transaccion_distinta`, `referencia_distinta` | si hay intención | si hay intención | API | si hay intención |
| `transaccion_inexistente` | si hay intención | si hay intención | **evento** | si hay intención |
| `referencia_desconocida` (o vencida) | `null` | `null` | API | `null` |
| `intencion_no_pendiente` (por ejemplo, un aprobado después de un rechazo) | sí | sí | API | sí |
| `backend_rechazo_<status>` (por ejemplo, `409` por una reemplazada pagada dos veces, §8.3) | sí | sí | API | sí |

Contrato (el backend lo expone desde PR #33):

```
POST /api/pagos/intentos-fallidos/interno
x-internal-key: <INTERNAL_API_KEY>

{ "referencia_externa": "SD-5-…", "id_transaccion_pasarela": "1132-…", "pasarela": "wompi", "id_mesa": 5,
  "motivo": "monto_distinto", "monto_centavos": 100, "monto_esperado_centavos": 3333300, "moneda": "COP", "metodo_pago": "online" }
→ 201 { "ok": true }
```

Guarda en `intentos_pago_fallidos` (`razon_rechazo` = motivo), con `id_pedido` en `NULL`:
`database/scripts/16_pagos_integracion.sql` ya permite `NULL` ahí y agregó `id_mesa`,
`referencia_externa`, `id_transaccion_pasarela`, `pasarela` y `moneda`.

- **Idempotente** por (`referencia_externa`, `id_transaccion_pasarela`, `motivo`): un reintento
  responde `201` sin guardar dos filas.
- **Tolerante**: un `id_mesa` que no existe, o un monto ausente, cero o negativo, se guardan como
  `NULL` en vez de rechazar la alerta. `monto_esperado_centavos` se valida pero no se guarda (no
  hay columna).
- Un `4xx` se da por resuelto (la alerta no se reintenta). Si responde 5xx, el webhook responde
  503 y Wompi reintenta.

### 8.6. Cobros de caja: `POST /internal/payment-confirmed`

Cuando la caja cobra en efectivo o con datáfono, o registra un **abono parcial**, el pago no
pasa por Wompi: lo guarda el backend. Esta ruta sirve para que **todas las cajas** y la
**mesa** vean el saldo nuevo al instante, con el mismo `payment:confirmed` que emite el
webhook (§8.3). No depende de la pasarela: funciona aunque Wompi no esté configurado.

**Quién la llama:** el backend, desde `registrarPago`, **después del COMMIT** (nunca antes:
no se anuncia un pago que podría revertirse). La llamada va aislada con `try/catch` y un
timeout corto (p. ej. 1,5 s): si el socket-server no responde, el pago **ya quedó guardado**
y no se revierte; solo se pierde el aviso en vivo (las pantallas lo verán al recargar la
cuenta).

```
POST http://localhost:4001/internal/payment-confirmed
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{
  "eventId": "6f1c2b9e-4d3a-4f8e-9a51-2c7d8e0b1a34",
  "id_mesa": 5,
  "comensal": "Ana",
  "monto_centavos": 2000000,
  "saldo_restante_centavos": 1450000,
  "referencia_externa": "CAJA-123",
  "id_transaccion": 901
}
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `eventId` | Sí | UUID (`crypto.randomUUID()`), uno por cobro |
| `id_mesa` | Sí | Entero positivo |
| `monto_centavos` | Sí | Entero > 0 y ≤ 10 000 000 000 (centavos: `Math.round(monto * 100)`) |
| `saldo_restante_centavos` | Sí | Entero ≥ 0 y ≤ 10 000 000 000. Saldo de la mesa **después** de este cobro |
| `comensal` | No | Texto de 1 a 40 caracteres (alias), o `null` si se paga la mesa completa. Para `pagaron` se normaliza (ver abajo) |
| `referencia_externa` | No | Texto de 1 a 255 caracteres (voucher del datáfono, recibo…), o `null` |
| `id_transaccion` | No (recomendado) | Entero positivo: id de la fila en `transacciones`. Segunda guardia de idempotencia |

Cualquier otro campo (`metodo_pago`, notas…) se **descarta**: no llega a las pantallas.

**Por qué en centavos:** el dinero en `float` pierde precisión (`0.1 + 0.2 !== 0.3`). Con
enteros en centavos no hay redondeos al sumar abonos ni al comparar con el saldo; el
socket-server convierte a pesos (`monto`, `saldo_restante`) solo para mostrar. Por eso un
monto con decimales o como texto se rechaza.

**Idempotencia:** se reserva `eventId` y, si viene, `id_transaccion`. Si **cualquiera** ya se
había visto, responde `duplicado: true` y no emite nada. Así un reintento del backend con el
mismo `eventId`, o con un `eventId` nuevo pero el mismo `id_transaccion`, no muestra el pago
dos veces.

Respuestas:

| Status | Cuerpo | Cuándo |
|---|---|---|
| `200` | `{ "ok": true, "eventId": "…", "duplicado": false }` | Emitido |
| `200` | `{ "ok": true, "eventId": "…", "duplicado": true }` | Ya se había anunciado (mismo `eventId` o `id_transaccion`); no emite |
| `400` | `{ "ok": false, "codigo": "PAYLOAD_INVALIDO", "mensaje": "…", "eventId": "…" }` | Algún campo no cumple la tabla |
| `400` | `{ "ok": false, "codigo": "JSON_INVALIDO", … }` | El cuerpo no es un objeto JSON |
| `401` | `{ "ok": false, "codigo": "NO_AUTORIZADO", … }` | Falta `x-internal-key` o no coincide |
| `503` | `{ "ok": false, "codigo": "NO_CONFIGURADO", … }` | El socket-server no tiene `INTERNAL_API_KEY` |

`payment:confirmed` → `room:admin` y `room:mesa-{ID}`, con el **mismo payload** que §8.3:

```json
{
  "eventId": "6f1c2b9e-4d3a-4f8e-9a51-2c7d8e0b1a34",
  "id_mesa": 5,
  "comensal": "Ana",
  "monto": 20000,
  "saldo_restante": 14500,
  "monto_centavos": 2000000,
  "saldo_restante_centavos": 1450000,
  "referencia_externa": "CAJA-123",
  "emitidoEn": "2026-10-13T20:15:00.000Z"
}
```

**`comensal` y `pagaron` (R-19.2):** si queda saldo, el `comensal` se anota en `pagaron`
([§5.2](#52-mesapresencia)) **normalizado** con la regla del alias (§6.4): «Abuela » se anota
como «Abuela» y deja de contar en «igual». Si no es un alias válido (p. ej. «Mesa #5»), se anota
tal cual, como antes: el cobro nunca falla por esto. `payment:confirmed` lleva el `comensal`
tal como llegó.

**Abonos parciales:** una llamada **por abono**, cada una con su `eventId` (y su
`id_transaccion`) y el `saldo_restante_centavos` que queda después de ese abono.

**Si el cobro libera la mesa** (saldo 0 **y** todos los pedidos entregados, [§5.1](#51-mesaliberada)):
llamar **primero** a `/internal/payment-confirmed` y **después** a `/internal/mesa-liberada` con
`{ "id_mesa": 5, "motivo": "pagada" }`. Con saldo 0 y algún pedido sin entregar no se llama a
`mesa-liberada`: eso pasa cuando el mesero lo entrega. El orden importa:
`mesa-liberada` desconecta a los comensales, y si se llama antes, la mesa nunca ve el
pago final.

Guía práctica: [docs/pagos-sandbox.md](docs/pagos-sandbox.md).

---

## 9. Variables de entorno

| Variable | Uso |
|---|---|
| `PORT` | Puerto (4001) |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma (sin `*`) |
| `NODE_ENV` | `production` exige `REDIS_URL`. Solo `development` **escrito** activa el modo red local: CORS acepta también `http://<IPv4 privada>:5173-5175` ([README](README.md#probar-desde-el-celular-modo-red-local)). Sin `NODE_ENV`, el CORS es solo `CORS_ORIGINS` |
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
| `PAGOS_TTL_MINUTOS` | Plazo para pagar una intención (30). Su registro dura más: ver §8.1 |
| `REDIS_URL` | Estado persistente (obligatoria en producción) |
| `ROTACION_QR_MINUTOS` | Rotación automática del QR con la mesa vacía (3) |
| `MESA_CAPACIDAD_POR_DEFECTO` | Capacidad si el backend no la informa; comensales por mesa = capacidad + 4 (6) |
| `TRUST_PROXY` | IPs o CIDR del proxy (nginx) del que se cree `X-Real-IP` para logs y límites. Vacía = la IP de la conexión. `/0` no se admite |
| `LOG_NIVEL` | `debug`, `info` (por defecto), `warn`, `error` o `silencio`. Logs en JSON, sin secretos |

---

## 10. Historial de cambios de contrato

Todos son **compatibles hacia atrás** salvo el webhook de pagos, que nadie usaba, y el alias en
el JWT (R-18), que obliga a abrir sesiones nuevas: un JWT de comensal sin alias deja de servir.

| Cambio | Antes | Ahora | Quién debe adaptarse |
|---|---|---|---|
| `cart:update` · `ingredientes` | Solo se validaba que fuera arreglo; se guardaba `precio_aplicado` | 0–30 `{ id_ingrediente, porcion }` validados; el resto se descarta | PWA: calcular subtotales con `GET /api/menu` |
| `mesa:liberada` | El panel lo escuchaba, pero nunca se emitía | Se emite y desconecta a los comensales; `motivo` opcional | PWA: pantalla de cierre. Backend: enviar `motivo: "pagada"` |
| `join:table` | Solo `id_mesa` | `comensal` (alias) opcional | PWA: enviarlo (lo necesitan presencia, push y pagos) |
| `mesa:llamar_mesero`, `cuenta:solicitada`, `mesa:presencia`, `ingrediente:disponibilidad` | — | Nuevos | Panel y PWA: escucharlos |
| Suscripción push | Por mesa | Por mesa **y** alias del comensal | PWA: hacer `join:table` con alias antes de suscribirse |
| `POST /pagos/webhook` | `x-signature` propio y `payment.succeeded` | Checksum y eventos de Wompi | Nadie (no se usaba) |
| `payment:confirmed` | Con `id_pedido` | Sin `id_pedido`; con `comensal`, `saldo_restante` y centavos | Panel (Caja): dejar de emitirlo desde el navegador |
| `POST /internal/payment-confirmed` | Los cobros de caja no se anunciaban en vivo | Nueva: emite `payment:confirmed` (mismo payload que Wompi) para efectivo, datáfono y abonos | Backend: llamarla desde `registrarPago` después del COMMIT (§8.6) |
| `/internal/qr-rotado` | `token_qr` de hasta 128 caracteres | Hasta 255 (caben los tokens v1 reales) | Nadie |
| Arranque | Aceptaba secretos cortos o de ejemplo | No arranca sin secretos de 32+ caracteres, distintos y propios | Todo el equipo: regenerar `.env` |
| Alias del comensal (R-18) | Lo mandaba el cliente en cada evento (`join:table`, `cart:update`, pago, push) | Sale **solo del JWT**; otro alias → `NO_AUTORIZADO`; JWT sin alias → `TOKEN_INVALIDO`; solo se tocan las líneas propias | PWA: enviar `{ comensal }` al abrir la sesión y dejar de mandarlo en los eventos. Backend: `feature/mesas-alias-en-jwt` |
| `order:created` · `ingredientes[].paso` | Los ingredientes no traían su paso | Cada ingrediente lleva `paso` (nombre del paso o `null`) | Nadie: compatible hacia atrás. KDS: agrupar por `paso` |
| `order:created` · carrito y dueños | Vaciaba el carrito de **toda** la mesa; dueños = todos los alias del carrito | Quita solo las líneas de `items[].comensal`; sin alias no toca el carrito; dueños = solo esos alias | PWA: nada (sigue reemplazando el carrito con `cart:updated`). Backend: mantener `comensal` en cada ítem |
| `order:created` · orden y reintentos | Reservaba el aviso antes de tocar el carrito: si Redis fallaba a mitad de camino, el reintento llegaba como duplicado y las líneas nunca se quitaban | Primero quita líneas y guarda dueños, después reserva por `id_pedido` y emite; un reintento ante `5xx`/`ERROR_INTERNO` completa lo que faltó. `cart:updated` llega **antes** que `order:created` | Nadie que dependa del orden. Backend: reintentar ante `5xx` con el mismo `eventId` es seguro |
| Catálogo · estado de endpoints | `/pagos/intencion`, `/pagos/webhook`, `/internal/ingrediente-disponibilidad`, `/internal/payment-confirmed` y sus eventos (`payment:confirmed`, `pago:alerta`, `ingrediente:disponibilidad`, `mesa:liberada` con `motivo: "pagada"`) figuraban como «Espera backend» | Estables `/internal/ingrediente-disponibilidad` (PR #70) y `/internal/payment-confirmed` (PR #58). Los pagos en línea (`/pagos/*`, `pago:alerta` y la parte Wompi de `payment:confirmed` y `mesa:liberada`) quedan «Conectado (falta prueba E2E con Wompi sandbox)» (PR #33) | Nadie: solo documentación |
| `POST /internal/plato-disponibilidad` · `plato:disponibilidad` | — | Nuevos: el backend avisa tras el COMMIT de `PATCH /api/platos/:id/disponible`; se difunde `{ id_plato, disponible, emitidoEn }` a todos los sockets (mismas reglas que `ingrediente:disponibilidad`, idempotencia propia `backend:plato:{eventId}`) | Backend: llamarla después del COMMIT. PWA, KDS y panel: escuchar `plato:disponibilidad` |
| `POST /pagos/intencion` · reutilizar la pendiente | Si el comensal tenía una intención pendiente se devolvía esa, sin mirar `modo` ni monto (se cobraba el monto viejo hasta 30 min) | Se reutiliza solo con el mismo `modo` y el mismo monto recalculado; si no, intención nueva y la vieja queda `reemplazada` 7 días. El webhook acepta una reemplazada por su monto exacto. Sin backend → `503` aunque haya pendiente | PWA: usar siempre la respuesta más reciente (puede traer otra `referencia`). Backend: nada |
| `POST /pagos/intencion` · modo `igual` | Total ÷ personas presentes; mezclar modos podía dejar saldo sin dueño (p. ej. quedaban $3.334 de $100.000) | **Saldo** ÷ (presentes que aún no pagaron + quien paga), redondeado a pesos; el último paga el saldo exacto. Fórmula exacta en §8.1 | PWA: replicar la fórmula con `mesa:presencia` y la cuenta. Backend: nada |
| `mesa:presencia` · destino y `pagaron` | Solo `room:admin`; `{ id_mesa, comensales, total }` | También `room:mesa-{ID}` (solo esa mesa) y nuevo campo `pagaron: [alias]`; también se emite al confirmarse un pago con alias | PWA: escucharlo para mostrar «igual». Panel: nada (campo nuevo, compatible) |
| Propuesta (v1.1) · `POST /internal/mesa-comensal` · `mesa:presencia.sin_celular` | Una persona sin celular no contaba en la presencia ni en «igual» | Nueva ruta para agregar o quitar comensales sin celular y campo `sin_celular`; `comensales` y `total` los incluyen (§6.4, §5.2) | Backend: llamarla tras el COMMIT de D-18. PWA (J-11/J-16): usar `comensales` y `pagaron`, que ya incluyen a los sin celular. Panel: mostrarlos en la mesa |
| Propuesta (v1.1) · `POST /internal/inventario-alerta` · `inventario:alerta` | — | Nuevos: el backend avisa cuando un insumo cruza su stock mínimo y se difunde solo a `room:admin` (§5.5) | Backend (D-17): llamarla en la transición. Panel (P-22): escuchar `inventario:alerta` en `room:admin` y cargar stock bajo por REST al iniciar |
| `POST /pagos/intencion` · `POST /pagos/webhook` · plazos de la intención (R-13.4b) | El registro duraba `PAGOS_TTL_MINUTOS` (30 min): un webhook posterior no lo encontraba y un `APPROVED` quedaba como `referencia_desconocida`, sin registrar | Marca de pendiente: `PAGOS_TTL_MINUTOS`. Registro: `PAGOS_TTL_MINUTOS` × 60 + tolerancia del webhook + 30 min (26 h por defecto). Una intención a 5 min o menos de vencer no se reutiliza, ni al repetir el `eventId` | Nadie: mismo contrato; solo se acepta tarde lo que antes se perdía |
| Estable (R-20.2) · `POST /internal/inventario-alerta` · `inventario:alerta` | Propuesta (v1.1): sin implementar; el backend (D-17) ya la llamaba y recibía `404` y el aviso se perdía | Implementada según §5.5 sin cambios de contrato: validación estricta, solo `room:admin`, idempotencia `backend:inventario-alerta:{eventId}` (se libera si la emisión falla → `500 ERROR_INTERNO`) | Nadie: backend (D-17) y panel (P-22) ya usan este contrato |
| Estable (R-19.2) · `POST /internal/mesa-comensal` · `mesa:presencia.sin_celular` | Propuesta (v1.1): sin implementar; el backend (D-18) ya la llamaba y recibía `404`, y la persona sin celular no contaba en «igual» | Implementada según §6.4 y §5.2: `sin_celular` siempre presente; `comensales` y `total` lo incluyen; misma regla de alias que el backend, con paridad probada; además rechaza la clave reservada `general` (D-18c) con `400` | Nadie: backend (D-18) y PWA ya usan este contrato |
| Lista (R-24) · `POST /internal/item-cancelado` · `item:cancelado` | — (el backend del #180 ya la llamaba y recibía `404`: el aviso se perdía) | Nuevos según §5.6: validación estricta (un campo de más → `400`), emisión a `room:kds`, `room:admin` y `room:mesa-{ID}` con `emitidoEn`, idempotencia `backend:item-cancelado:{eventId}` (se libera si la emisión falla → `500 ERROR_INTERNO`). `origen` opcional (`comensal` o `personal`; sin él se emite `comensal`) y `estado_pedido` `recibido`, `en_preparacion`, `listo` o `cancelado` (D-13) | Backend: nada (#180 ya manda `origen: "comensal"`; D-13 mandará `personal`). KDS, panel (Caja) y PWA: escuchar `item:cancelado` y mostrar quién lo quitó con `origen` |
| `POST /internal/payment-confirmed` · `comensal` en `pagaron` (R-19.2) | Se anotaba en `pagaron` el texto tal cual («Abuela » no coincidía con «Abuela») | Se anota normalizado con la regla del alias; si no es válido, tal cual (§8.6). `payment:confirmed` no cambia | Nadie: compatible hacia atrás |
| `pago:alerta` · cuánto y quién (pedido del panel) | Solo `eventId`, `id_mesa`, referencias, `motivo` y `emitidoEn`: el panel no podía mostrar cuánto ni quién | Agrega `comensal` (alias de la intención o `null`), `monto_centavos` (lo cobrado, según la API o el evento) y `monto_esperado_centavos` (de la intención o `null`). Sin datos de tarjeta ni del pagador; sigue yendo solo a `room:admin` (§8.5) | Panel: mostrarlos si quiere; los campos nuevos no rompen nada |
| `mesa:presencia` · al conectar el panel | El panel recibía la presencia solo cuando cambiaba algo: al conectar o recargar no sabía quién estaba sentado | **500 ms** después de que un socket de personal entra a `room:admin`, recibe solo él un `mesa:presencia` por cada mesa con algo, incluidas las mesas sin ningún socket (índice `sd:mesas:con-estado`, 24 h). Si se desconecta antes, no se envía. Mismo evento y payload (§5.2) | Nadie: el panel ya lo guarda por `id_mesa`. Es el respaldo de `mesa:presencia:solicitar` |
| `mesa:presencia:solicitar` (nuevo) | — | El personal pide la presencia de todas las mesas con algo y la recibe en el ack `{ ok, mesas }`, sin depender de listeners. Comensal, tablet y cocina → `NO_AUTORIZADO`; 1 por socket cada 2 s (`RATE_LIMIT`) (§4) | Panel (recomendado): pedirla en cada `connect`, después de registrar los listeners (ejemplo en §4) |
