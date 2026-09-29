# Contrato de la API REST — SmartDining Backend

Responsable: Carlos Ospino (Integrante 3 / Desarrollador 2)
Base URL local: `http://localhost:4000/api`
Formato de errores estándar: `{ "error": "mensaje" }`
Auth: `Authorization: Bearer <token>`

Los nombres de tablas y columnas de este contrato siguen **[modelo-er.md](./modelo-er.md)**,
el modelo entidad-relación oficial de Jarrison (dueño de la base de datos).

## Reparto de responsabilidades (acordado con el equipo)

**La base de datos es la fuente de verdad** y el backend no replica su lógica:

| Responsabilidad | Dónde vive |
|---|---|
| Totales y subtotales | Triggers `tr_validar_detalle_pedido` y `tr_actualizar_total_pedido` |
| Transiciones de estado del pedido | Trigger `tr_validar_transicion_estado` contra la tabla `transiciones_validas` |
| Disponibilidad del plato | Trigger `tr_validar_disponibilidad_plato` |
| Precios históricos | Se congelan leyendo `platos.precio` dentro del propio INSERT |
| Validación de pagos (monto vs total) | Trigger `tr_validar_transaccion_financiera` |
| Firmar y validar los tokens QR | **socket-server** (`POST /qr/generar`, `POST /qr/validar`) |
| Ciclo de vida de `mesas.token_qr` y del estado de la mesa | **Backend** (el trigger `tr_regenerar_token_qr` fue retirado) |
| Autenticación, roles (RBAC) | **Backend** |
| Que el body venga bien formado | **Backend** (zod) |

### Errores de la base de datos

Se traducen en un solo lugar (`src/middleware/errores.middleware.js`):

- **409 Conflict** — `RAISE EXCEPTION` de un trigger (SQLSTATE `P0001`). El mensaje
  del trigger se devuelve tal cual porque está redactado para el usuario final:
  `{ "error": "Transición de estado no autorizada: de \"recibido\" hacia \"listo\"" }`
- **400 Bad Request** — el body no cumple el esquema (dominio de un enum, tipos, campos faltantes).
- **500** genérico — cualquier otro error de PostgreSQL (CHECK `23514`, FK `23503`,
  unique `23505`). El detalle queda solo en el log del servidor, nunca en la respuesta.

### Transiciones válidas (tabla `transiciones_validas`)

```
recibido        -> en_preparacion | cancelado
en_preparacion  -> listo | cancelado
listo           -> entregado
entregado       -> pagado
```

Es la máquina de estados completa: cualquier otro salto responde **409**. `pagado` es
terminal. Verificado contra la base real de Jarrison, estado por estado:

| Desde | → `pagado` | → `cancelado` |
|---|---|---|
| `recibido` | 409 | **permitido** |
| `en_preparacion` | 409 | **permitido** |
| `listo` | 409 | 409 |
| `entregado` | **permitido** | 409 |

### Regla de cobro: solo desde `entregado`

`entregado → pagado` es la única transición que llega a `pagado`, así que
`POST /transacciones` exige que el pedido esté en `entregado`. Cobrar un pedido en
`recibido`, `en_preparacion` o `listo` responde 409 con el mensaje del trigger. En sala,
el mesero tiene que marcar `entregado` **antes** de que caja cobre.

Además, solo un `estado_transaccion = 'completada'` liquida el pedido: una transacción
`pendiente`, `fallida` o `reembolsada` se guarda en `transacciones` pero deja el pedido
en `entregado` (si liquidara, un pago rechazado liberaría la mesa y la cuenta quedaría
como cobrada).

### Regla de cancelación: solo desde `recibido` o `en_preparacion`

`POST /pedidos/:id/cancelar` solo funciona mientras el pedido no se haya entregado.
Desde `listo` o `entregado` responde 409: a esa altura la comida ya salió de cocina, así
que la salida es cobrar, no cancelar. Un pedido `pagado` tampoco se puede cancelar.
La función `cancelar_pedido()` de Jarrison aplica la misma regla.

---

## Roles y sesiones

| Rol | Origen | Payload del JWT | Vigencia |
|---|---|---|---|
| `admin`, `mesero`, `cajero`, `cocina` | Tabla `usuarios` (`usuarios.rol`), vía `POST /auth/login` | `{ id_usuario, rol }` | `JWT_EXPIRES_IN` (8 h) |
| `comensal` | **No existe en la tabla usuarios.** Se emite al escanear el QR de la mesa, vía `POST /mesas/qr/:token/sesion` | `{ id_mesa, sid, rol: "comensal" }` | 3 h, y cae antes si la mesa se libera (ver *Ciclo de vida de la sesión de mesa*) |

Notas del flujo del comensal (definido por Jarrison):

- El rol `cliente` ya no existe.
- La sesión del comensal pertenece a **la mesa**, no a una persona: el modelo ER no
  relaciona `pedidos` con `usuarios`, el pedido es de la mesa.
- Varios comensales comparten la misma mesa y, por tanto, el mismo pedido. A cada uno
  lo identifica su **apodo**, que viaja por ítem y se guarda en
  `detalles_pedido.notas_especiales`.
- En `historial_estados`, `id_usuario` va `null` cuando el cambio lo hizo un comensal.

**Estados de un pedido (flujo estricto):**
`recibido → en_preparacion → listo → entregado → pagado`. `cancelado` solo se alcanza
desde `recibido` o `en_preparacion` (ver *Transiciones válidas* arriba).

---

## Autenticación

### POST /auth/register — solo `admin`

Da de alta personal del restaurante. El comensal no se registra.
El primer `admin` sale del `seed.sql` de Jarrison, no de este endpoint.

Body: `{ "nombre": "Ana Ríos", "email": "ana@mail.com", "password": "123456", "rol": "mesero" }`

`rol` es obligatorio y solo acepta `admin`, `mesero`, `cajero`, `cocina`.

201: `{ "usuario": { "id_usuario": 1, "nombre": "Ana Ríos", "email": "ana@mail.com", "rol": "mesero", "activo": true } }`

400: `{ "error": "Ese email ya está registrado" }` · 401 sin token · 403 si el token no es de un admin

### POST /auth/login

Body: `{ "email": "ana@mail.com", "password": "123456" }`

200: `{ "usuario": { "id_usuario": 1, "nombre": "...", "email": "...", "rol": "mesero" }, "token": "..." }`

401: `{ "error": "Credenciales inválidas" }` · 403: `{ "error": "Usuario inactivo" }`

---

## Categorías

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /categorias | No | Lista todas, ordenadas por `orden_visualizacion` |
| GET | /categorias/:id | No | Obtiene una |
| POST | /categorias | admin | Crea |
| PUT | /categorias/:id | admin | Actualiza |
| DELETE | /categorias/:id | admin | Elimina |

```json
{ "id_categoria": 1, "nombre": "Entradas", "descripcion": "...", "orden_visualizacion": 1, "activo": true }
```

---

## Platos

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /platos?id_categoria= | No | Lista (filtro opcional) |
| GET | /platos/:id | No | Obtiene uno |
| POST | /platos | admin | Crea |
| PUT | /platos/:id | admin | Actualiza |
| DELETE | /platos/:id | admin | Elimina |

```json
{
  "id_plato": 12, "id_categoria": 3, "nombre": "Bandeja paisa", "descripcion": "...",
  "precio": 28000, "url_imagen": "https://...", "disponible": true,
  "tiempo_preparacion_estimado": 20
}
```

> El modelo ER no tiene `personalizaciones` ni `alergenos` en `platos`: ese campo se
> eliminó del backend. Las preferencias del comensal van por ítem del pedido, en
> `detalles_pedido.notas_especiales`.

---

## Mesas

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /mesas | admin, cajero, mesero | Lista todas |
| **POST** | **/mesas/:id/abrir** | **mesero, admin** | **Abre la mesa: obtiene su QR y la marca `ocupada`** |
| **POST** | **/mesas/:id/liberar** | **mesero, admin** | **Cierra la mesa: `disponible` y `token_qr` a NULL. 409 si tiene pedidos abiertos** |
| POST | /mesas/qr/:token/sesion | No | Abre la sesión del comensal y devuelve su JWT |
| GET | /mesas/:id | No | Obtiene una |
| POST | /mesas | admin | Crea |
| PATCH | /mesas/:id/estado | admin, cajero, mesero | Cambia estado (`disponible`, `ocupada`, `reservada`, `mantenimiento`) |
| DELETE | /mesas/:id | admin | Elimina |

```json
{ "id_mesa": 5, "numero": 5, "capacidad": 4, "ubicacion": "Terraza", "estado": "ocupada" }
```

### `token_qr` no sale en ninguna respuesta salvo /abrir

El `token_qr` es la **credencial** con la que se abre la sesión de la mesa: quien lo tenga
puede pedir a nombre de ese grupo. Por eso **ninguna** respuesta de la API lo incluye,
excepto `POST /mesas/:id/abrir`, que es justamente quien lo necesita para imprimir el QR y
está restringido a mesero/admin.

- `GET /mesas/:id` es **pública** (la PWA la usa para mostrar el número de mesa) y devuelve
  solo `id_mesa`, `numero`, `capacidad`, `ubicacion` y `estado`.
- `GET /mesas` (personal) devuelve lo mismo más **`sesion_abierta`** (booleano), y **no** el
  token. El panel de sala solo necesita saber qué mesas tienen sesión viva; para volver a
  mostrar un QR llama a `POST /mesas/:id/abrir`, que es idempotente y devuelve el mismo
  token. Mandar el token en un listado lo multiplicaría por pantallas, cachés y logs sin
  que nadie lo use.
- `POST /mesas` y `PATCH /mesas/:id/estado` siguen la misma vista del personal.

`GET /mesas/qr/:token` **se eliminó**: nadie la consumía (ni los frontends, que aún son solo
READMEs, ni el socket-server, ni las pruebas), el camino del comensal es
`POST /mesas/qr/:token/sesion`, y al responder 200 con la mesa servía de oráculo para
adivinar tokens válidos sin abrir sesión.

---

## Ciclo de vida de la sesión de mesa

Modelo aprobado por el equipo:

- El **QR impreso de la mesa es fijo durante la sesión** y su token vive en
  `mesas.token_qr` (la columna es `VARCHAR(255)` y **nullable**: NULL significa "mesa sin
  sesión abierta").
- Los tokens los **genera y valida el socket-server** de Roberto (`POST /qr/generar` y
  `POST /qr/validar`): son tokens firmados con HMAC, con formato
  `v1.<datos base64url>.<firma>` y datos `{ m: id_mesa, iat, exp, sid }`. El backend no
  los firma ni verifica su firma; solo guarda el token y compara.
- Jarrison **retiró el trigger `tr_regenerar_token_qr`**, así que el ciclo de vida de
  `token_qr` es responsabilidad exclusiva del backend.

```
mesero  → POST /api/mesas/:id/abrir      → token del QR (+ url para imprimirlo)
comensal→ POST /api/mesas/qr/:token/sesion → JWT { id_mesa, sid, rol: 'comensal' }
          …pide, cambia de estado, paga…
          → la mesa se libera (manual o automáticamente) y token_qr queda en NULL
          → las sesiones de ese grupo caen en la siguiente petición (401)
```

### El `sid` cierra la sesión sin esperar a que expire el JWT

El JWT del comensal lleva el `sid` del QR con el que entró. En **cada petición de
comensal**, el middleware lee `mesas.token_qr`, le extrae el `sid` y lo compara:

- columna en NULL → la mesa se liberó;
- `sid` distinto → se generó otro QR y ese JWT es del grupo anterior.

En ambos casos responde **401** `{ "error": "Sesión de mesa cerrada, escanea el QR de nuevo" }`.
Va en el middleware, no en los controllers, para que ninguna ruta pueda olvidarlo.
No aplica al personal.

### POST /mesas/:id/abrir — mesero, admin

**Idempotente.** Todo ocurre con la fila de la mesa bloqueada (`SELECT … FOR UPDATE`),
así que dos meseros pulsando "abrir" a la vez reciben el mismo token:

1. **Solo si la mesa está `ocupada`** y su `token_qr` sigue vigente según `/qr/validar`,
   devuelve **ese mismo** (`reutilizado: true`).
2. En cualquier otro caso —sin token, token caducado, o la mesa **no** está `ocupada`—
   pide uno a `POST /qr/generar` **reenviando el JWT del mesero** (esa ruta exige
   `Authorization: Bearer` con rol admin/mesero/cajero: es el socket-server quien
   autoriza, el backend no suplanta a nadie con la clave interna), lo guarda en
   `mesas.token_qr` reemplazando lo que hubiera, y deja la mesa `ocupada`.

> El estado de la mesa es lo que decide si hay una sesión viva. Una mesa `disponible` (o
> `reservada`, o `mantenimiento`) con `token_qr` es un resto de una sesión ya cerrada, así
> que **se genera siempre uno nuevo**: el grupo que llega nunca hereda el QR del anterior,
> ni siquiera si el token viejo todavía estuviera firmado y sin expirar.

201:

```json
{
  "token": "v1.eyJtIjoxLCJpYXQiOjE3OTA2…",
  "url": "http://localhost:5173/?token=v1.eyJtIjoxLCJpYXQiOjE3OTA2…",
  "reutilizado": false,
  "mesa": { "id_mesa": 5, "numero": 5, "estado": "ocupada" }
}
```

`url` se arma con `FRONTEND_CLIENTE_URL` para que la sala no tenga que saber cómo se
construye. 404 mesa inexistente · 403 si el socket-server rechaza el rol · **503 si el
socket-server no responde** (sin QR no se puede abrir, y la mesa no se toca).

### POST /mesas/:id/liberar — mesero, admin

**Es solo para grupos que se van sin pedir.** Con la fila bloqueada y dentro de la misma
transacción se cuentan los pedidos de la mesa que no estén `pagado` ni `cancelado`:

- **409** si hay alguno, y **no cambia nada**:
  `{ "error": "La mesa tiene pedidos abiertos; cóbralos o cancélalos antes de liberarla", "pedidos_abiertos": 2 }`
- si no hay ninguno, deja la mesa `disponible` y `token_qr` en NULL.

El conteo va con la mesa ya bloqueada para que no se cuele un pedido nuevo entre la
comprobación y el UPDATE. Una mesa con pedidos se cierra **cobrándolos o cancelándolos**:
al cerrarse el último, la mesa se libera sola (ver abajo).

Después del commit avisa a `/internal/mesa-liberada` de forma **aislada**: si ese aviso
falla, la liberación **no** se revierte (solo queda registrado el error).

200: `{ "id_mesa": 5, "numero": 5, "estado": "disponible", "token_qr": null }`

### Liberación automática

Cuando un pedido queda **`pagado`** (cobro `completada`) o **`cancelado`**, en la misma
transacción se bloquea la mesa y se cuentan sus pedidos abiertos; si no queda ninguno, se
libera igual que arriba. El `SELECT … FOR UPDATE` serializa los cierres simultáneos, así
que **dos pedidos de la misma mesa cerrándose a la vez la liberan una sola vez**. Si no se
puede leer el conteo, la mesa se queda ocupada (es más seguro que soltarla con pedidos
vivos).

### POST /mesas/qr/:token/sesion — punto de entrada del comensal

Doble comprobación, porque cada una cubre algo distinto:

1. **`POST /qr/validar`** del socket-server: que el token esté bien firmado y no haya
   expirado (la firma y la vigencia son suyas).
2. **Que sea idéntico al guardado en `mesas.token_qr`**: así un QR de una sesión anterior,
   aunque siga firmado y sin expirar, no sirve una vez que la mesa se liberó o se le
   generó otro.

201:

```json
{
  "token": "<jwt con { id_mesa, sid, rol: 'comensal' }>",
  "expira_en": "3h",
  "qr_expira_en": 1790651940443,
  "mesa": { "id_mesa": 5, "numero": 5, "capacidad": 4, "ubicacion": "Terraza", "estado": "ocupada" }
}
```

**401** con el `motivo`, sin emitir JWT:

| `motivo` | Cuándo |
|---|---|
| `expirado` / `revocado` | Lo dice `/qr/validar` |
| `formato` / `firma` | El token no tiene forma válida o la firma no cuadra |
| `no_es_el_vigente` | Está bien firmado, pero la mesa ya tiene otro QR |
| `mesa_sin_sesion` | `mesas.token_qr` está en NULL: la mesa no está abierta |

**503** si el socket-server no responde: sin validar no se puede dejar entrar a nadie.
Las 3 h son la vigencia de la *sesión*, no la del token QR (`qr_expira_en`).

### Criterios de aceptación del QR (propuesta de Roberto)

Los seis criterios acordados, con la prueba que cubre cada uno. Todas están en
`backend/tests/criterios-aceptacion.test.js` y recorren el flujo de punta a punta
(tablet → QR → sesión → pedido → liberación) con dobles de la base y del socket-server,
sin tocar la red.

| # | Criterio | Prueba |
|---|---|---|
| 1 | El QR generado desde la tablet permite abrir sesión y hacer un pedido | `CA1: el QR generado desde la tablet permite abrir sesión y hacer un pedido` |
| 2 | Varios comensales pueden escanear el mismo QR dentro de la misma sesión | `CA2: varios comensales pueden escanear el mismo QR dentro de la misma sesión` |
| 3 | Después de liberar la mesa, ese mismo QR responde error al intentar abrir sesión | `CA3: después de liberar la mesa, ese mismo QR da error al abrir sesión` (+ el caso de defensa en profundidad) |
| 4 | Después de liberar la mesa, un JWT de la sesión anterior no puede crear pedidos (401) | `CA4: después de liberar la mesa, un JWT de la sesión anterior no puede crear pedidos (401)` |
| 5 | El siguiente grupo recibe un QR nuevo que funciona con normalidad | `CA5: el siguiente grupo recibe un QR nuevo que funciona con normalidad` |
| 6 | Un grupo que se va sin pedir queda cerrado con "Liberar mesa" | `CA6: un grupo que se va sin pedir queda cerrado con "Liberar mesa"` |

Notas de lo que quedó demostrado al escribirlas:

- **CA2** es la razón por la que el QR es *de la sesión* y no de un solo uso: los tres
  comensales reciben JWT distintos pero con el **mismo `sid`**, o sea una sola sesión de
  mesa, y cada uno pide con su apodo sobre la cuenta compartida.
- **CA3** está cubierto por **dos defensas independientes**: el socket-server revoca los
  tokens de la mesa al recibir `/internal/mesa-liberada` (`motivo: revocado`), y además el
  backend rechaza el QR porque `mesas.token_qr` quedó en NULL (`motivo: mesa_sin_sesion`).
  Hay una prueba para cada una, así que si el aviso al socket-server se pierde el QR viejo
  sigue sin servir.
- **CA6** es el caso sin pedidos, y es el único en el que "Liberar mesa" aplica: con
  pedidos abiertos ese botón responde 409, porque la liberación automática solo se dispara
  al cerrarse un pedido. La prueba hermana cubre el otro lado: si el grupo pidió y pagó, la
  mesa se cierra sola.

---

## Pedidos

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | /pedidos | **comensal, mesero, admin** | Crea un pedido con sus ítems |
| GET | /pedidos/activos | admin, cajero, mesero | Pedidos en `recibido`/`en_preparacion` |
| **GET** | **/pedidos/mesa** | **comensal** | **Pedidos de la mesa de la sesión** *(reemplaza a `/pedidos/historial`)* |
| GET | /pedidos/:id | autenticado | Detalle con sus ítems; un comensal solo ve los de su mesa (403 si no) |
| PATCH | /pedidos/:id/estado | admin, cajero, mesero | Cambia el estado (cualquiera de los 6 válidos) |
| POST | /pedidos/:id/cancelar | admin, cajero, mesero | Atajo que fija `estado = cancelado`. **Solo desde `recibido` o `en_preparacion`**; desde `listo`/`entregado` responde 409 |

### POST /pedidos

Body:

```json
{
  "id_mesa": 5,
  "notas_generales": "Somos alergicos al mani",
  "items": [
    { "id_plato": 12, "cantidad": 2, "apodo": "Ana", "notas": "sin cebolla" },
    { "id_plato": 31, "cantidad": 1, "apodo": "Pipe" }
  ]
}
```

- **Si el token es de un comensal:** `id_mesa` se toma del JWT y **se ignora el del
  body**. Así una mesa no puede ordenar a nombre de otra.
- **Si el token es de staff (mesero/admin):** `id_mesa` es obligatorio en el body
  (400 si falta).
- `apodo` + `notas` se guardan juntos en `detalles_pedido.notas_especiales`
  (`"Ana: sin cebolla"`).
- **`apodo`, `notas` y `notas_generales` no pueden contener `OVERRIDE_ADMIN`** (sin
  distinguir mayúsculas): responde 400. El trigger `tr_validar_disponibilidad_plato`
  usa ese marcador en `notas_especiales` como bypass administrativo para comandar un
  plato agotado, y ese campo lo escribe el comensal — sin este filtro bastaría con
  ponerse de apodo `OVERRIDE_ADMIN` para saltarse el control de disponibilidad.
- `precio_unitario` se congela desde `platos.precio` dentro del propio INSERT (regla
  de negocio "Inmutabilidad de Precios"), nunca se toma del body.
- `subtotal` y `total` los calculan los triggers; el backend relee el pedido antes de
  responder, así que el `total` de la respuesta es el que dejó la base.
- `codigo_pedido` lo genera el backend (formato `PED-AAMMDD-XXXXX`, 16 caracteres, que
  es el largo de la columna) y es único.
- Cada ítem nace con `estado_item = 'pendiente'` (DEFAULT de la columna).
- 409 si el plato no existe o no está disponible: lo decide el trigger.

201:

```json
{ "id_pedido": 87, "codigo_pedido": "PED-260922-K3F9AQ", "id_mesa": 5, "estado": "recibido", "total": 56000 }
```

400: plato inexistente o no disponible, `id_mesa` faltante para staff · 403: rol no permitido

### GET /pedidos/mesa

200: `{ "id_mesa": 5, "pedidos": [ ... ] }` — todos los pedidos de la mesa del token,
más recientes primero.

### PATCH /pedidos/:id/estado

Body: `{ "estado": "listo", "observaciones": "Sale de cocina" }`

Cada cambio queda en `historial_estados` con `estado_anterior`, `estado_nuevo`,
`observaciones`, `fecha_cambio` y el `id_usuario` que lo hizo (`null` si fue un comensal).

400 si el estado no existe; **409 si la transición no está en `transiciones_validas`**,
con el mensaje del trigger.

> Punto de integración con Roberto: en el código (marcado con un comentario `NOTA`)
> es donde se debe emitir `order:created` / `order:status` hacia el socket-server.

---

## KDS — Kitchen Display System

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /kds/comandas | **cocina, admin** | Comandas activas, con ítems enriquecidos con plato y categoría, mesa y minutos transcurridos |
| PATCH | /kds/comandas/:id/estado | **cocina, admin** | Cambia a `en_preparacion` o `listo` (únicos estados permitidos desde cocina) |

Respuesta de `GET /kds/comandas`:

```json
{
  "comandas": [
    {
      "id_pedido": 87, "codigo_pedido": "PED-260922-K3F9AQ", "id_mesa": 5, "mesa_numero": 5,
      "estado": "recibido", "notas_generales": null, "minutos_transcurridos": 3.2,
      "items": [
        {
          "id_detalle": 201, "cantidad": 2, "plato_nombre": "Bandeja paisa",
          "categoria_nombre": "Platos fuertes", "tiempo_preparacion_estimado": 20,
          "notas_especiales": "Ana: sin cebolla", "estado_item": "pendiente"
        }
      ]
    }
  ]
}
```

> El semáforo (verde/amarillo/rojo a los 15 min) se calcula en el frontend-kds a
> partir de `minutos_transcurridos` — el backend solo entrega el dato crudo.

---

## Transacciones

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | /transacciones | admin, cajero | Registra un pago: crea la transacción, marca el pedido `pagado` y **libera la mesa automáticamente** |
| GET | /transacciones/pedido/:id_pedido | admin, cajero | Lista las transacciones de un pedido |

### POST /transacciones

Body:

```json
{ "id_pedido": 87, "monto": 56000, "metodo_pago": "tarjeta_credito", "referencia_externa": "ch_123", "estado_transaccion": "completada" }
```

- `metodo_pago` es obligatorio, con los valores del CHECK del schema: `efectivo`,
  `tarjeta_debito`, `tarjeta_credito`, `transferencia`, `online`.
- `estado_transaccion`: `completada` (por defecto), `pendiente`, `fallida` o `reembolsada`.
- `referencia_externa` es la referencia de la pasarela de pago que integra Roberto —
  este endpoint solo la guarda.

201: fila insertada en `transacciones`.

**El pedido debe estar en `entregado`**: es la única transición que lleva a `pagado`.
Cobrar desde otro estado responde 409 con el mensaje del trigger (ver *Regla de cobro*).

**Solo `estado_transaccion = 'completada'` liquida el pedido.** Con `pendiente`,
`fallida` o `reembolsada` la transacción se registra igual (201) pero el pedido se queda
en `entregado` y la mesa no se libera, así que se puede reintentar el cobro.

409 también si el monto excede el saldo del pedido (`tr_validar_transaccion_financiera`,
que además deja constancia en `intentos_pago_fallidos`).

Liberar la mesa y rotar su `token_qr` lo hace el trigger `tr_regenerar_token_qr` cuando
el pedido llega a `pagado` o `cancelado` y la mesa no tiene otros pedidos abiertos: el
backend **no** toca la tabla `mesas` al cobrar. El QR impreso queda invalidado y el token
anterior se archiva en `token_qr_historico`.

---

## Tiempo real (socket-server)

El backend avisa al socket-server por HTTP interno, con la cabecera `x-internal-key` y un
`eventId` UUID v4 por acción (reintentar con el mismo `eventId` es seguro: él deduplica).
Contrato completo en [socket-server/EVENTS.md](../../socket-server/EVENTS.md).

| Cuándo | Aviso |
|---|---|
| Se crea un pedido | `POST /internal/order-created` con el pedido y sus ítems |
| Cambia el estado (pedidos y KDS) | `POST /internal/order-status` con `estado_anterior` |
| Se libera una mesa (manual o automática) | `POST /internal/mesa-liberada` |

**Aislamiento:** salvo en `/qr/generar` y `/qr/validar` (donde sin respuesta no se puede
abrir mesa ni sesión, y por eso se responde 503), el tiempo real es un extra. El cliente
(`src/services/socket.notifier.js`) **nunca lanza**: timeout corto (`SOCKET_TIMEOUT_MS`),
registra el motivo y sigue. Un socket-server caído no hace fallar un pedido ni un cobro.

En `order:created` los ítems se envían con `nombre` (no `plato_nombre`), que es el nombre
de campo del contrato de Roberto.

Los importes (`total`, `precio`, `subtotal`, `monto`) salen como **número**, no como string:
se registra un parser por OID 1700 en `src/config/db.js`.

---

## Pendiente por acordar con el equipo

Ya resueltos contra el `schema.sql` de Jarrison: `mesas.estado` es
`disponible`/`ocupada`/`reservada`/`mantenimiento` y `detalles_pedido.estado_item` es
`pendiente`/`cocinando`/`listo`/`servido`/`cancelado`. El backend usa esos valores.

Sigue abierto:

- ~~Nadie marca la mesa como `ocupada`~~ → resuelto: lo hace `POST /mesas/:id/abrir`.
- **`transiciones_validas.requiere_usuario` está declarado pero no se aplica.** Cuatro
  transiciones lo tienen en `TRUE`; el trigger `tr_validar_transicion_estado` no lo
  valida (solo lo mira `cambiar_estado_pedido()`, que no usamos). El backend manda
  `id_usuario = null` cuando el cambio lo hace un comensal: si Jarrison llega a
  aplicarlo, esos cambios empezarían a fallar.
- Validación de vigencia del token QR contra Redis: ¿la hace este backend o confía en
  que Roberto ya la hizo?
- `suscripciones_push` está en el modelo ER pero todavía no la consume ningún endpoint
  de este backend (las notificaciones Web Push son módulo de Roberto).
- ¿Debe el comensal poder cancelar su propio pedido? Hoy cancelar es solo de staff.
