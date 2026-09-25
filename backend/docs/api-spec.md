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
| Liberar la mesa y rotar su `token_qr` | Trigger `tr_regenerar_token_qr` |
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
| `comensal` | **No existe en la tabla usuarios.** Se emite al escanear el QR de la mesa, vía `POST /mesas/qr/:token/sesion` | `{ id_mesa, rol: "comensal" }` | 3 h (`JWT_COMENSAL_EXPIRES_IN`) |

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
| GET | /mesas/qr/:token | No | Busca la mesa por su `token_qr` (no emite sesión) |
| **POST** | **/mesas/qr/:token/sesion** | **No** | **Abre la sesión del comensal y devuelve su JWT** |
| GET | /mesas/:id | No | Obtiene una |
| POST | /mesas | admin | Crea |
| PATCH | /mesas/:id/estado | admin, cajero, mesero | Cambia estado (`disponible`, `ocupada`, `reservada`, `mantenimiento`) |
| DELETE | /mesas/:id | admin | Elimina |

```json
{ "id_mesa": 5, "numero": 5, "capacidad": 4, "ubicacion": "Terraza", "estado": "ocupada", "token_qr": "..." }
```

### POST /mesas/qr/:token/sesion *(nuevo — punto de entrada del comensal)*

Valida que el `token_qr` exista en la tabla `mesas` y emite el JWT de la sesión de mesa.

201:

```json
{
  "token": "<jwt con id_mesa y rol comensal>",
  "expira_en": "3h",
  "mesa": { "id_mesa": 5, "numero": 5, "capacidad": 4, "ubicacion": "Terraza", "estado": "ocupada" }
}
```

404: `{ "error": "Token de mesa inválido" }` — si el token no corresponde a ninguna
mesa, no se emite ningún JWT.

> El `token_qr` lo genera y firma Roberto (socket-server); este backend solo lo lee.
> La vigencia (TTL) del token QR vive en Redis — **pendiente acordar con Roberto** si
> ese chequeo se hace aquí o ya viene validado. Las 3 h de este endpoint son la
> vigencia de la *sesión* del comensal, no la del token QR.

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

## Pendiente por acordar con el equipo

Ya resueltos contra el `schema.sql` de Jarrison: `mesas.estado` es
`disponible`/`ocupada`/`reservada`/`mantenimiento` y `detalles_pedido.estado_item` es
`pendiente`/`cocinando`/`listo`/`servido`/`cancelado`. El backend usa esos valores.

Sigue abierto:

- **Nadie marca la mesa como `ocupada`.** Lo hacía la función `crear_pedido()`, que este
  backend no usa (hace `INSERT` directo para que actúen los triggers). Ningún trigger lo
  cubre, así que una mesa con pedidos activos sigue en `disponible`. Sí se libera al
  pagar (`tr_regenerar_token_qr`). **Falta decidir** si lo hace el backend o un trigger
  nuevo de Jarrison.
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
