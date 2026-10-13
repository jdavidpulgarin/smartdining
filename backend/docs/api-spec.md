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
| Forma del JSON del menú (categorías, platos, pasos, ingredientes) | Función `obtener_menu_completo()`; el backend solo la cachea 60 s |
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

### Regla de cierre: `entregado` **y** pagado, en cualquier orden

> Un pedido pasa a `estado = 'pagado'` en el momento en que está **entregado** y
> **totalmente pagado**. Da igual cuál de las dos cosas pase primero.

`entregado → pagado` sigue siendo la única transición que llega a `pagado` (la valida
`tr_validar_transicion_estado`), pero **pagar y entregar son dos ejes distintos** desde
el script 22 de Jarrison (H-03), que separó el estado financiero en la columna
`pedidos.estado_pago` (`pendiente` | `parcial` | `pagado`). Esa columna la mantiene el
trigger `tr_sincronizar_estado_pago_pedido` sobre `transacciones`; el backend solo la
lee, nunca la escribe.

Los dos órdenes existen de verdad y cada uno lo cierra un endpoint distinto:

| Orden | Quién cobra | Quién cierra el pedido |
|---|---|---|
| Se entrega y después se cobra | `POST /transacciones` (caja) | el propio cobro, al dejar el saldo en 0 |
| Se paga y después sale la comida | `POST /transacciones/internal` (pago en línea) o la caja cobrando por adelantado | `PATCH /pedidos/:id/estado` con `entregado` |

- **Cobrar un pedido que aún no se entregó ya no falla.** La transacción se registra
  (201), `estado_pago` queda en `pagado` y el `estado` de cocina **no se toca**: el
  pedido sigue su curso. Antes se intentaba el `UPDATE` a `pagado` igualmente, el trigger
  lo abortaba con 409 y el `ROLLBACK` **se llevaba el pago entero** (medido: pedido en
  `listo` cobrado completo → 409 y cero filas en `transacciones`).
- **Marcar `entregado` un pedido con la cuenta ya cubierta lo cierra en `pagado`** en la
  misma transacción, y libera la mesa si no le quedan otros pedidos abiertos. Sin esto un
  pago en línea dejaba la mesa `ocupada` con su QR vivo **para siempre**: el pedido nunca
  volvía a `pagado`, así que seguía contando como abierto y ni el mesero ni la caja
  podían cerrar la mesa.
- El cierre pide que **las dos fuentes digan lo mismo**: `estado_pago = 'pagado'` y
  `obtener_saldo_pendiente(:id) <= 0`. `estado_pago` se recalcula al tocar
  `transacciones`, así que es esa columna la que podría quedarse atrás respecto del
  total; con una sola fuente se podría cerrar un pedido con saldo vivo.
- **La mesa se libera al entregar y pagar, nunca solo al pagar.** Pagar antes de recibir
  la comida no suelta la mesa ni invalida el QR: el comensal sigue sentado y su sesión
  tiene que seguir en pie.
- `historial_estados` guarda **los dos saltos**, no solo el último: `listo → entregado`
  con las observaciones de quien entregó, y `entregado → pagado` con
  `'Cuenta ya cubierta al entregar'`.
- Solo un `estado_transaccion = 'completada'` cuenta para la cuenta: una transacción
  `pendiente`, `fallida` o `reembolsada` se guarda en `transacciones` pero no mueve
  `estado_pago` ni cierra nada (si liquidara, un pago rechazado liberaría la mesa y la
  cuenta quedaría como cobrada).

**Orden de bloqueos.** Como marcar `entregado` puede ahora cerrar el pedido y tocar la
tabla `mesas`, ese camino bloquea **la mesa antes del pedido**, igual que los dos
endpoints de pago. Un camino que fuera pedido → mesa se interbloquearía con ellos
(SQLSTATE `40P01`, medido en 19 de 20 intentos en su momento). Las transiciones del KDS
(`en_preparacion`, `listo`) no tocan la mesa y por eso no la bloquean: hacerlo
serializaría sin motivo las comandas de una misma mesa.

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
| `comensal` | **No existe en la tabla usuarios.** Se emite al escanear el QR de la mesa, vía `POST /mesas/qr/:token/sesion` | `{ id_mesa, sid, rol: "comensal", comensal }` (`comensal` = su alias, único en la sesión) | 3 h, y cae antes si la mesa se libera (ver *Ciclo de vida de la sesión de mesa*) |

Notas del flujo del comensal (definido por Jarrison):

- El rol `cliente` ya no existe.
- La sesión del comensal pertenece a **la mesa**, no a una persona: el modelo ER no
  relaciona `pedidos` con `usuarios`, el pedido es de la mesa.
- Varios comensales comparten la misma mesa y, por tanto, el mismo pedido. A cada uno
  lo identifica su **alias**, que viaja por ítem en `comensal` y se guarda en
  `detalles_pedido.comensal` (columna propia desde D-03, para poder dividir la cuenta
  por persona sin parsear texto libre). `notas_especiales` lleva **solo la nota** del
  ítem.
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

## Seguridad del transporte y del acceso

### Cabeceras y CORS (H-10)

El backend usa **helmet** (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, CSP por
defecto…) y ya **no anuncia `x-powered-by`**.

**CORS con lista blanca**, nunca `*`. Los orígenes salen de `CORS_ORIGINS` (separados por
comas):

| Entorno | Si falta `CORS_ORIGINS` |
|---|---|
| `NODE_ENV=production` | **Ningún origen cruzado permitido**: un despliegue sin configurar se queda corto, no abierto |
| desarrollo y pruebas | `http://localhost:5173`, `:5174`, `:5175` (cliente, restaurante y KDS) |

Cabeceras permitidas: `Content-Type`, `Authorization` y `x-internal-key`. **No** se
habilitan credenciales: la API autentica con `Authorization: Bearer`, no con cookies.

Una petición **sin** cabecera `Origin` (curl, el socket-server, una prueba) se deja pasar:
CORS protege al navegador y esas peticiones no vienen de uno. Lo que decide el acceso ahí
es el JWT o la clave interna.

### Límite de intentos (H-04 y H-27)

Las dos rutas públicas —las que no piden sesión previa— están limitadas y responden **429**
con `Retry-After`:

| Ruta | Límite por defecto | Clave del contador | Qué cuenta |
|---|---|---|---|
| `POST /auth/login` | **5 / minuto** | IP **+ email** | Solo los intentos **fallidos** |
| `POST /mesas/qr/:token/sesion` | **20 / minuto** | IP | Todos los intentos |

```json
{ "error": "Demasiados intentos de inicio de sesión. Espera un momento y vuelve a intentarlo." }
```

La clave del login combina IP y email a propósito: por IP sola, una botnet esquiva el
límite; por email solo, cualquiera podría bloquear la cuenta de otro. Y solo cuentan los
fallos, para que un cajero que entra y sale varias veces no se bloquee a sí mismo. El QR
va más holgado porque una mesa entera escanea desde la misma IP del local, y ahí sí
cuentan los aciertos: reusar un token válido muchas veces por segundo tampoco debería
pasar.

**Variables:** `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_VENTANA_MS`, `RATE_LIMIT_QR_MAX`,
`RATE_LIMIT_QR_VENTANA_MS`. Los límites se desactivan solos dentro de las pruebas.

> **Detrás de un proxy** (nginx, Docker), `req.ip` es la IP del proxy y el límite contaría
> a todo el mundo como un solo visitante. Hay que poner **`TRUST_PROXY`** (`true`, un
> número de saltos, o una lista de IPs/rangos). Está **apagada por defecto**: confiar en
> `X-Forwarded-For` sin un proxy delante permite falsificar la IP.
>
> **Limitación:** el contador vive en memoria del proceso. Con varias instancias el límite
> es por instancia (con N instancias, el techo real es 5×N). Para hacerlo global haría
> falta un store compartido en Redis.

### Cuenta desactivada (H-09)

El middleware de autenticación comprueba en **cada petición del personal** que la cuenta
siga `activo`, no solo que el JWT sea válido. Antes, al desactivar a alguien su token
seguía abriendo la API hasta caducar (8 h).

- Cuenta desactivada o borrada → **401** `Tu cuenta está desactivada, habla con administración`.
- Se comprueba **antes** del rol, así que un desactivado recibe 401 y no 403.
- **No afecta** al token del **comensal** (el rol `comensal` no existe en `usuarios`), ni
  al **canal interno** con `x-internal-key` (detrás no hay un usuario, es un servicio), ni
  al **login** (todavía no hay JWT que comprobar).

El resultado se guarda en Redis (`sd:usuario:{id}:activo`) con TTL **`CACHE_USUARIO_TTL_SEG`**,
60 s por defecto, para no añadir una consulta por petición.

> **Ventana aceptada:** con la caché de 60 s, **un usuario recién desactivado puede seguir
> entrando hasta un minuto**. Es el precio de no consultar la base en cada llamada; si hace
> falta cerrar antes, se baja el TTL o se borra la llave al desactivar
> (`usuario-activo.olvidar`).
>
> Redis aquí es **solo caché** y nunca tumba una petición: si falla al leer o al escribir,
> se consulta PostgreSQL y se sigue. Si falla **la base**, la petición falla cerrada (no se
> deja pasar a ciegas).

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
>
> Lo que agregó el constructor (`personalizable`, `calorias` en `platos`;
> `alergenos` en `ingredientes`) sale por `GET /menu`, no por estas rutas.

---

## Menú digital (constructor de platos)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /menu | No | Carta completa: categorías → platos → pasos → ingredientes |

Público y de solo lectura: el comensal carga la carta antes de tener sesión de mesa.

La forma del JSON la define la base, no el backend: se devuelve tal cual lo entrega
`obtener_menu_completo()` (`database/scripts/13_constructor.sql`), envuelto en la clave
`categorias` para ser consistente con `GET /categorias`. El backend no filtra, ordena ni
recalcula nada.

200:

```json
{
  "categorias": [
    {
      "id_categoria": 2,
      "categoria": "Hamburguesas",
      "descripcion": "Arma la tuya",
      "orden": 1,
      "platos": [
        {
          "id_plato": 7,
          "nombre": "Hamburguesa Smart",
          "descripcion": "Base para personalizar",
          "precio": 32000,
          "url_imagen": "https://...",
          "tiempo_estimado": 15,
          "personalizable": true,
          "calorias": 650,
          "pasos": [
            {
              "id_paso": 1,
              "nombre": "Proteína",
              "orden": 1,
              "min_sel": 1,
              "max_sel": 1,
              "obligatorio": true,
              "ingredientes": [
                {
                  "id_ingrediente": 10,
                  "nombre": "Carne de res",
                  "precio_extra": 0,
                  "calorias": 250,
                  "alergenos": null,
                  "url_imagen": null,
                  "disponible": true
                },
                {
                  "id_ingrediente": 11,
                  "nombre": "Pollo crispy",
                  "precio_extra": 2000,
                  "calorias": 300,
                  "alergenos": "gluten",
                  "url_imagen": null,
                  "disponible": false
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Reglas del contenido (las aplica la función de la base):

- Solo categorías con `activo = true` y platos con `disponible = true`.
- `pasos` llega como `[]` en los platos no personalizables.
- Los ingredientes agotados **sí** se devuelven, con `disponible: false`, para que el
  constructor los muestre deshabilitados en vez de hacerlos desaparecer.

### Caché de 60 segundos

La respuesta se guarda en Redis bajo la clave `cache:menu` con TTL de 60 s (cache-aside:
la primera llamada lee de la base y guarda; las siguientes salen del caché hasta que
expire).

- El caché es un extra, no parte del contrato: si Redis está caído, falla o no hay
  `REDIS_URL`, el endpoint responde igual leyendo de la base. **Nunca da 500 por culpa del
  caché.**
- Toda mutación de la carta (`POST`/`PUT`/`DELETE` de `/platos` y `/categorias`) borra
  `cache:menu` con `invalidarMenu()`, así que un cambio del admin se ve de inmediato sin
  esperar el TTL. Con Redis caído, `invalidarMenu()` tampoco falla: devuelve `false` y la
  mutación sigue su curso.
- Un error de la base **no** se cachea.

---

## Mesas

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /mesas | admin, cajero, mesero | Lista todas |
| **GET** | **/mesas/:id/cuenta** | **admin, cajero, mesero** | **Cuenta de la mesa por comensal (pesos)** |
| **POST** | **/mesas/:id/abrir** | **mesero, admin** | **Abre la mesa: obtiene su QR y la marca `ocupada`** |
| **POST** | **/mesas/:id/rotar-qr** | **mesero, admin** | **Cambia el QR de una mesa `ocupada` y avisa a la tablet** |
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
comensal→ POST /api/mesas/qr/:token/sesion { comensal } → JWT { id_mesa, sid, rol: 'comensal', comensal }
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
construye.

Cuando el token es **nuevo**, después del commit se avisa a
`POST /internal/qr-rotado` para que la tablet de la mesa lo muestre (ver *Tablet fija en
la mesa* más abajo). Si el token se **reutiliza**, no se avisa. 404 mesa inexistente · 403 si el socket-server rechaza el rol · **503 si el
socket-server no responde** (sin QR no se puede abrir, y la mesa no se toca).

### POST /mesas/:id/rotar-qr — mesero, admin

Cambia el QR de una mesa **ocupada** (por ejemplo, si alguien fotografió la tablet). Con la
fila bloqueada (`FOR UPDATE`) pide un token nuevo a `/qr/generar` del socket-server
reenviando el JWT del personal, lo guarda en `mesas.token_qr` y, **después del commit**,
avisa a la tablet con `/internal/qr-rotado` (socket.notifier). Ningún frontend llama a
`/internal/*`: la clave interna solo vive en los servidores.

`201`:

```json
{ "url": "http://localhost:5173/?token=v1....", "expira_en": 1760000000000, "mesa": { "id_mesa": 5, "numero": 5, "estado": "ocupada" } }
```

El token solo viaja dentro de `url`. 400 id inválido · 404 mesa inexistente · **409 si la mesa
no está `ocupada`** · 403 si el socket-server rechaza el rol · 503 si el socket-server no
responde (no se guarda nada). Si falla solo el aviso a la tablet, responde 201 igual.

> Hoy el middleware de sesión compara el `sid` del JWT del comensal con el `token_qr`
> vigente, así que **rotar cierra las sesiones de quienes ya estaban sentados**. Si se quiere
> que conserven su sesión tras una rotación, hay que cambiar ese criterio (pendiente).

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

### Tablet fija en la mesa — modelo "QR en vidrio" (opción A)

El QR ya no se imprime: lo muestra una tablet montada en la mesa. La opción que eligió el
equipo es la **A**, o sea que **la tablet solo muestra el QR cuando el mesero abre la
mesa**; mientras la mesa esté libre no hay QR que escanear.

```
mesero  → POST /api/mesas/:id/abrir
            backend: guarda el token en mesas.token_qr, mesa a 'ocupada'
            backend → POST /internal/qr-rotado  { id_mesa, token_qr }
socket-server → qr:actualizado  { id_mesa, token_qr, emitidoEn }  a room:mesa-{id}
            tablet: arma FRONTEND_CLIENTE_URL/?token=<token_qr> y dibuja el QR
comensal→ escanea → POST /api/mesas/qr/:token/sesion
            ...pide, cambia de estado, paga...
mesero  → POST /api/mesas/:id/liberar   (o se libera sola al cerrarse el último pedido)
            backend → POST /internal/mesa-liberada  { id_mesa }
```

Reglas del aviso:

- Solo se avisa cuando el token es **nuevo**. Si `/abrir` reutiliza el QR de una mesa que ya
  estaba `ocupada`, la tablet ya lo está mostrando y reenviarlo solo la haría parpadear.
- El aviso va **después del commit** y **aislado**: si el socket-server está caído o
  responde error, la mesa se abre igual. El mesero siempre puede volver a pulsar "abrir",
  que es idempotente, y eso reintenta el aviso.
- El token se envía **completo**. No se recorta para caber en ningún límite: un token
  recortado no valida.
- En la **liberación** el backend no cambia: sigue llamando solo a
  `/internal/mesa-liberada`. Avisar a la tablet de que se apague el QR es del
  socket-server.

> **Pendiente del lado de Roberto:** hoy `/internal/qr-rotado` rechaza `token_qr` de más de
> 128 caracteres (`MAX_TOKEN_QR_MOSTRADO`) y los tokens `v1` miden ~150, así que responde
> 400 y la tablet no refresca. Roberto va a subir el límite a 255. El backend registra ese
> 400 con el motivo y la longitud enviada, y abrir la mesa sigue funcionando: es solo la
> tablet la que no se actualiza hasta que suba el límite.

### Liberación automática

Cuando un pedido queda **`pagado`** —por un cobro que lo liquida estando entregado, o
por entregarlo cuando ya estaba pagado (ver *Regla de cierre*)— o **`cancelado`**, en la
misma transacción se bloquea la mesa y se cuentan sus pedidos abiertos; si no queda ninguno, se
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

Body (obligatorio):

```json
{ "comensal": "Ana" }
```

El **alias** del comensal se valida, se reserva y va **firmado dentro del JWT**. El
socket-server toma el alias solo del JWT (carrito, push, llamar al mesero, pedir la
cuenta, presencia y pago "propio"), así nadie puede editar, quitar o pagar como otro
comensal de su mesa.

- Se recortan los espacios y se colapsan los dobles. De 2 a 40 caracteres: letras (con
  tildes y ñ), números, espacio y `. _ ' -`.
- **Único dentro de la sesión de la mesa.** `Ana`, `ana`, `ÁNA` y `A.na` cuentan como el
  mismo. La reserva vive en Redis (`sd:mesa:{id}:alias`, `HSETNX`) con la vigencia del
  JWT, y se borra al abrir una sesión nueva de la mesa o al liberarla.
- En producción, sin Redis no hay sesión (503): sin unicidad garantizada volvería la
  suplantación. Fuera de producción y sin `REDIS_URL` se usa un respaldo en memoria.

201:

```json
{
  "token": "<jwt con { id_mesa, sid, rol: 'comensal', comensal: 'Ana' }>",
  "comensal": "Ana",
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

**400** `{ "error": "...", "campo": "comensal" }` si falta el alias o no cumple las reglas.

**409** `{ "motivo": "alias_en_uso" }` si otro comensal de la sesión ya tiene ese alias:
la PWA debe pedir otro nombre.

**503** si el socket-server no responde (sin validar no se puede dejar entrar a nadie) o,
con `motivo: "alias_no_disponible"`, si no se pudo reservar el alias.

El QR se valida **antes** de reservar el alias: un QR inválido no gasta el nombre.
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
  mesa, y cada uno pide con su alias sobre la cuenta compartida.
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
| **GET** | **/pedidos/mesa/cuenta** | **comensal** | **Cuenta de SU mesa por comensal; la mesa sale del JWT** |
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
    { "id_plato": 12, "cantidad": 2, "comensal": "Ana", "notas": "sin cebolla" },
    {
      "id_plato": 1001,
      "cantidad": 2,
      "comensal": "Pipe",
      "ingredientes": [
        { "id_ingrediente": 1, "porcion": "normal" },
        { "id_ingrediente": 4, "porcion": "normal" },
        { "id_ingrediente": 10, "porcion": "extra" }
      ]
    }
  ]
}
```

- **Si el token es de un comensal:** `id_mesa` se toma del JWT y **se ignora el del
  body**. Así una mesa no puede ordenar a nombre de otra.
- **Si el token es de staff (mesero/admin):** `id_mesa` es obligatorio en el body
  (400 si falta).
- `comensal` (1 a 40 caracteres, se recorta) se guarda en `detalles_pedido.comensal` y
  `notas` en `detalles_pedido.notas_especiales`, cada uno en su columna. `apodo` sigue
  aceptándose como **alias de compatibilidad**; si llegan los dos, manda `comensal`.
- **El alias de un comensal sale SOLO de su JWT (H-05).** Si el token de sesión de mesa
  trae `comensal`, ese valor manda; y si **no** lo trae, el ítem queda **sin alias**
  (`null`). Lo que venga en el body (`comensal` o `apodo`) se ignora por completo cuando
  quien pide es un comensal.

  El alias no es decoración: es a quién se le cobra. Con el body como respaldo, cualquiera
  en la mesa podía escribir el nombre de otro y cargarle sus platos, y la cuenta por
  persona dejaba de ser fiable. Para **mesero y admin** el body sigue valiendo, porque
  piden de parte de alguien y su JWT no lleva alias.
- **Topes del pedido (H-06):** hasta **50 ítems** por pedido y `cantidad` entre **1 y 20**
  por ítem. Más que eso responde **400**. Antes `cantidad` solo pedía ser positiva y un
  `100000000` llegaba a la base, desbordaba el `DECIMAL` del subtotal y salía como 500.
  Son números de sala, no técnicos: 20 unidades del mismo plato ya es una mesa grande
  pidiendo lo mismo, y 50 ítems distintos no caben en una comanda.

  > El CHECK equivalente en `detalles_pedido.cantidad` es de Jarrison (`database/`): este
  > tope vive solo en el backend, así que un INSERT directo a la base lo esquiva.

- **Platos personalizables (constructor):** `ingredientes` es un arreglo de hasta **20**
  `{ id_ingrediente, porcion }` por ítem, con `porcion` en `ligera | normal | extra`
  (por omisión `normal`). Repetir un `id_ingrediente` dentro del mismo ítem responde
  **400**; en ítems distintos sí se permite.
- **No se aceptan campos de precio en el body** (`precio`, `precio_unitario`,
  `precio_extra`, `precio_aplicado`, `precio_extras`, `subtotal`, `total`), ni en el
  ítem ni en el ingrediente: responde **400**. El precio lo fija siempre la base.
- **`comensal`, `apodo`, `notas` y `notas_generales` no pueden contener `OVERRIDE_ADMIN`** (sin
  distinguir mayúsculas): responde 400. El trigger `tr_validar_disponibilidad_plato`
  usa ese marcador en `notas_especiales` como bypass administrativo para comandar un
  plato agotado, y ese campo lo escribe el comensal — sin este filtro bastaría con
  ponerse de alias `OVERRIDE_ADMIN` para saltarse el control de disponibilidad.
- `precio_unitario` se congela desde `platos.precio` dentro del propio INSERT (regla
  de negocio "Inmutabilidad de Precios"), nunca se toma del body.
- `subtotal` y `total` los calculan los triggers; el backend relee el pedido antes de
  responder, así que el `total` de la respuesta es el que dejó la base.
- `codigo_pedido` lo genera el backend (formato `PED-AAMMDD-XXXXX`, 16 caracteres, que
  es el largo de la columna) y es único.
- Cada ítem nace con `estado_item = 'pendiente'` (DEFAULT de la columna).
- `precio_aplicado` de cada ingrediente **lo fija el trigger**
  `tr_validar_detalle_ingrediente`: solo la porción `extra` cobra
  `ingredientes.precio_extra`; `ligera` y `normal` van en 0. El backend inserta
  `(id_detalle, id_ingrediente, porcion)` y nada más.
- `detalles_pedido.precio_extras` (suma por unidad de los recargos) y el `subtotal` los
  calculan los triggers del script 13.
- Tras insertar los ingredientes de un ítem, el backend llama
  `validar_selecciones_detalle(id_detalle)` **en la misma transacción**: ahí se revisan
  `min_sel`/`max_sel` de cada paso. Cualquier error revierte el pedido completo — no
  queda un pedido a medio armar.
- 409 si el plato no existe o no está disponible: lo decide el trigger.
- **409** también para todo lo que rechaza la base sobre los ingredientes, con **su
  mensaje tal cual**: ingrediente agotado (*El ingrediente "Panceta Crujiente" está
  agotado*), ingrediente que no pertenece al plato, plato no personalizable, y
  `min_sel`/`max_sel` incumplido (*En "Elige tu Base" debes elegir al menos 1
  opción(es) (elegiste 0)*). Un plato personalizable **sin** `ingredientes` cae aquí si
  algún paso es obligatorio.

201:

```json
{ "id_pedido": 87, "codigo_pedido": "PED-260922-K3F9AQ", "id_mesa": 5, "estado": "recibido", "total": 56000 }
```

400: plato inexistente o no disponible, `id_mesa` faltante para staff · 403: rol no permitido

### GET /pedidos/:id

200: el pedido con `detalles`. Cada detalle trae `comensal` (quién pidió el ítem),
`notas_especiales` (solo la nota), `precio_extras` y sus `ingredientes`:

```json
{
  "id_pedido": 87, "codigo_pedido": "PED-261011-ABC12", "id_mesa": 5,
  "estado": "recibido", "total": "43000.00",
  "detalles": [
    {
      "id_detalle": 700, "id_plato": 1001, "plato_nombre": "Bowl Personalizado",
      "cantidad": 2, "comensal": "Ana", "notas_especiales": "sin cebolla",
      "precio_unitario": "20000.00", "precio_extras": "1500.00", "subtotal": "43000.00",
      "ingredientes": [
        { "id_ingrediente": 1, "nombre": "Arroz Integral", "porcion": "normal", "precio_aplicado": "0.00", "id_paso": 1, "paso": "Elige tu Base" },
        { "id_ingrediente": 10, "nombre": "Aguacate", "porcion": "extra", "precio_aplicado": "1500.00", "id_paso": 3, "paso": "Añade Toppings" }
      ]
    }
  ]
}
```

Los `ingredientes` van **ordenados por el orden del paso** (Base, Proteína, Toppings,
Salsa), no por el orden en que los mandó el cliente. Un plato simple trae `[]`. Un
comensal solo ve los pedidos de su mesa (403 si no).

### GET /pedidos/mesa

200: `{ "id_mesa": 5, "pedidos": [ ... ] }` — los pedidos de la **visita actual** de la
mesa del token, más recientes primero, cada uno con sus `detalles` en el mismo formato
que `GET /pedidos/:id` (ítems con `comensal` e `ingredientes`, que es lo que necesita la
cuenta dividida por persona).

**Solo la visita actual** (`creado_en >= mesas.sesion_iniciada_en`): sin ese filtro el
grupo que se acaba de sentar vería lo que pidió el anterior, con sus alias y sus platos.
Un pedido creado en el instante exacto de la apertura **sí** entra. Con
`sesion_iniciada_en` en `null` se devuelven todos, como antes del script 17.

La misma regla se aplica a **`GET /pedidos/:id` cuando quien pregunta es un comensal**:
un pedido de su mesa pero de otra visita responde **403**. El personal sí ve el histórico
completo.

### PATCH /pedidos/:id/estado

Body: `{ "estado": "listo", "observaciones": "Sale de cocina" }`

Cada cambio queda en `historial_estados` con `estado_anterior`, `estado_nuevo`,
`observaciones`, `fecha_cambio` y el `id_usuario` que lo hizo (`null` si fue un comensal).

400 si el estado no existe; **409 si la transición no está en `transiciones_validas`**,
con el mensaje del trigger.

**`entregado` puede cerrar el pedido.** Si al entregarlo la cuenta ya está cubierta
(`estado_pago = 'pagado'` y saldo 0, el caso del pago en línea), el pedido pasa a
`pagado` en la misma transacción y la mesa se libera si no le quedan otros pedidos
abiertos. La respuesta lo dice: `estado` llega como `"pagado"` —no como el `"entregado"`
que se pidió—, `estado_anterior` es el estado del que se venía de verdad, y aparecen
`cerradoPorPago: true` y `mesaLiberada: true`. El `order:status` que sale hacia el
socket-server anuncia `pagado`, así que el KDS saca la comanda del tablero y el comensal
ve su pedido cerrado. Con cuenta pendiente o abono parcial, el pedido se queda en
`entregado` y la mesa sigue `ocupada`. Ver *Regla de cierre*.

> Punto de integración con Roberto: en el código (marcado con un comentario `NOTA`)
> es donde se debe emitir `order:created` / `order:status` hacia el socket-server.

---

## KDS — Kitchen Display System

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /kds/comandas | **cocina, admin** | Comandas del tablero (`recibido`, `en_preparacion`, `listo`), con ítems enriquecidos con plato, categoría, comensal e ingredientes, mesa y minutos transcurridos |
| PATCH | /kds/comandas/:id/estado | **cocina, admin** | Cambia a `en_preparacion` o `listo` (únicos estados permitidos desde cocina). **Idempotente** |

Devuelve los **tres estados del tablero**: `recibido`, `en_preparacion` y `listo`.

`listo` se incluye aunque la cocina ya terminó, porque la comanda sigue en el pase
esperando que el mesero la recoja y la marque `entregado`. Si no viniera aquí, la
columna "Listas" del KDS se vaciaría en cada recarga o reconexión y la cocina perdería de
vista lo que está esperando salir. Una comanda sale del tablero cuando pasa a
`entregado`, `pagado` o `cancelado`.

**Las `listo` se recortan a las últimas 12 horas** (`HORAS_VISIBLES_LISTO` en
`kds.service.js`). Si el mesero nunca marca `entregado`, la comanda se quedaría en el
pase para siempre y las de días pasados taparían las de hoy; doce horas cubren un turno
con margen. El recorte es **solo para `listo`**: una comanda `recibido` o
`en_preparacion` aparece por antigua que sea, porque eso sí es trabajo pendiente de
cocina y esconderlo sería peor. Una `listo` **sin** fila de historial (no se sabe cuándo
quedó lista) también se muestra: no se oculta nada por un dato que falta.

Cada comanda trae **`listo_en`**: la hora en que pasó a `listo`, tomada de la última
transición en `historial_estados`. Es `null` mientras no haya pasado por ese estado. El
KDS la usa para contar el tiempo **en el pase**, que no es el mismo que el total desde
que se pidió. No se usa `pedidos.actualizado_en` porque cambia con cualquier UPDATE.

Respuesta de `GET /kds/comandas`:

```json
{
  "comandas": [
    {
      "id_pedido": 87, "codigo_pedido": "PED-260922-K3F9AQ", "id_mesa": 5, "mesa_numero": 5,
      "estado": "recibido", "notas_generales": null, "minutos_transcurridos": 3.2,
      "listo_en": null,
      "items": [
        {
          "id_detalle": 201, "id_pedido": 87, "cantidad": 2, "plato_nombre": "Bowl Personalizado",
          "categoria_nombre": "Platos fuertes", "tiempo_preparacion_estimado": 20,
          "personalizable": true, "comensal": "Ana",
          "notas_especiales": "sin cebolla", "estado_item": "pendiente",
          "ingredientes": [
            { "id_ingrediente": 1, "nombre": "Arroz Integral", "porcion": "normal", "id_paso": 1, "paso": "Elige tu Base" },
            { "id_ingrediente": 10, "nombre": "Aguacate", "porcion": "extra", "id_paso": 3, "paso": "Añade Toppings" }
          ]
        }
      ]
    }
  ]
}
```

> El semáforo (verde/amarillo/rojo a los 15 min) se calcula en el frontend-kds a
> partir de `minutos_transcurridos` — el backend solo entrega el dato crudo.

### PATCH /kds/comandas/:id/estado

Body: `{ "estado": "en_preparacion" | "listo" }`. Mueve la **comanda completa**, no plato
a plato. Cualquier otro estado responde **400**; `404` si la comanda no existe (también si
el id no es un entero positivo).

**Es idempotente.** Si la comanda ya está en el estado pedido, responde **200** con la
comanda tal como está y añade `"sin_cambios": true`; no ejecuta el `UPDATE`, no escribe en
`historial_estados` (y por tanto tampoco en `kds_metricas`, que la alimenta un trigger de
esa tabla) y **no avisa al socket-server**. Cuando sí cambia, la respuesta trae
`"sin_cambios": false` y el flujo normal: historial, métricas y `order:status`.

```json
{ "id_pedido": 87, "estado": "listo", "estado_anterior": "listo", "sin_cambios": true }
```

Hace falta porque el trigger de transiciones **no rechaza** pasar a `listo` estando en
`listo`: sin este guard, dos toques en la pantalla táctil o el reintento de una petición
cuya respuesta se perdió dejarían dos entradas de historial y dos filas de métricas, y el
comensal vería "pedido listo" dos veces.

La comprobación y el cambio van bajo un **advisory lock de PostgreSQL por `id_pedido`**
(`pg_advisory_lock`), no bajo `SELECT … FOR UPDATE`: el `UPDATE` ocurre en la transacción
propia de `pedidos.service.actualizarEstado`, y retener aquí el bloqueo de la fila la
bloquearía contra sí misma.

> **Alcance del guard:** serializa a quien toma el mismo lock, o sea las peticiones del
> KDS entre sí, incluso entre instancias del backend (el lock vive en el servidor de base
> de datos). Un `PATCH /pedidos/:id/estado` del panel de sala **no** lo toma, así que esa
> carrera concreta sigue abierta; cerrarla pide mover el guard dentro de la transacción de
> `actualizarEstado` —compartida con los demás endpoints— o un UPDATE condicional en
> `database/`.

Los ingredientes llegan con su `porcion` y **sin precio**: a la cocina el precio no le
sirve. Van ordenados por el orden del paso, igual que en la API de pedidos, y un plato
simple trae `[]`.

Son **dos consultas fijas** (una de pedidos y una de ítems de todas las comandas), no
una por comanda: el tablero se refresca cada pocos segundos y el número de viajes a la
base no debe crecer con la cantidad de comandas abiertas.

---

### GET /mesas/:id/cuenta — admin, cajero, mesero

La cuenta de la mesa con el desglose **por comensal**: es lo que el cajero mira para
cobrar y para dividir la cuenta. Sale de `obtener_cuenta_mesa_json()` (scripts 15, 16
y 17) y se devuelve tal cual: sus campos son el contrato.

**Es la cuenta de la VISITA ACTUAL, no el histórico de la mesa.** `mesas.sesion_iniciada_en`
marca cuándo se sentó el grupo que está ahora, y solo cuentan los pedidos creados desde
entonces: si el grupo anterior dejó algo sin pagar, no se le cobra a este. La respuesta
incluye ese `sesion_iniciada_en` para que el cliente sepa de qué visita habla (es `null`
en una mesa que nunca se ha abierto desde el script 17, y entonces entran todos los
pedidos no cancelados).

El backend fija `sesion_iniciada_en = NOW()` **solo cuando la mesa pasa de no ocupada a
`ocupada`**, en la misma sentencia que el estado y el token:

| Momento | Qué pasa con `sesion_iniciada_en` |
|---|---|
| `POST /mesas/:id/abrir` con la mesa libre, reservada o en mantenimiento | **Se fija**: visita nueva |
| `POST /mesas/:id/abrir` con la mesa ya `ocupada` y QR vigente (idempotente) | No se toca |
| `POST /mesas/:id/abrir` con la mesa ya `ocupada` y QR caducado | **No se toca**: el QR es nuevo pero la visita es la misma, y lo ya pedido sigue en su cuenta |
| `POST /mesas/:id/rotar-qr` | No se toca: cambia la credencial, no el grupo |
| `POST /mesas/:id/liberar` y la liberación automática | No se borra: queda como historial hasta la próxima apertura |
| `PATCH /mesas/:id/estado` a `ocupada` desde otro estado | **Se fija**: también empieza una visita |
| `POST /mesas` creando la mesa ya `ocupada` | **Se fija** al insertar |

> **Unidad: pesos con decimales**, como los guarda la base (`total_mesa: 90000`). La
> versión en **centavos enteros** es `GET /mesas/:id/cuenta/interno`, que es solo para el
> socket-server. Son la misma cuenta en dos unidades, a propósito: esta la leen personas
> y aquella la consume una pasarela.

200:

```json
{
  "id_mesa": 5,
  "numero": 5,
  "estado_mesa": "ocupada",
  "ubicacion": "Terraza",
  "total_mesa": 90000,
  "pagado_mesa": 30000,
  "saldo_mesa": 60000,
  "items_totales": 6,
  "pedidos": [
    { "id_pedido": 87, "codigo_pedido": "PED-261012-ABC12", "estado": "entregado", "total": 90000, "creado_en": "…" }
  ],
  "comensales": [
    { "comensal": "Ana",  "items_pedidos": 2, "subtotal": 30000, "pagado": 0,     "saldo": 30000 },
    { "comensal": "Cami", "items_pedidos": 2, "subtotal": 30000, "pagado": 30000, "saldo": 0 }
  ]
}
```

- `comensales` incluye **a todos**, también a quien ya pagó (con `saldo: 0`): el cajero
  necesita ver quién va cubierto. La ruta interna, en cambio, solo lista a quien debe.
- Los ítems sin alias se agrupan bajo `"General"`, y los pagos sin `comensal` también:
  así la suma por comensal cuadra con el total de la mesa.
- **400** si el id no es un entero positivo · **404** si la mesa no existe (se comprueba
  antes de llamar a la función, que lanzaría un `RAISE` y saldría como 409).

### GET /pedidos/mesa/cuenta — comensal

La **misma** respuesta, para el comensal desde su sesión de QR.

**La mesa sale del JWT y de ningún otro sitio**: la ruta no tiene parámetro, y un id en la
URL o en el query string no sirve para nada. Si se aceptara, un comensal podría leer la
cuenta y los alias de otra mesa.

- **401** sin token o con la sesión de mesa ya cerrada · **403** si el token no es de
  comensal (el personal usa la ruta de arriba).

---

## Transacciones

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | /transacciones | admin, cajero | Registra un pago: crea la transacción, marca el pedido `pagado` y **libera la mesa automáticamente** |
| GET | /transacciones/pedido/:id_pedido | admin, cajero | Lista las transacciones de un pedido |

### POST /transacciones

Body:

```json
{ "id_pedido": 87, "monto": 56000, "metodo_pago": "tarjeta_credito", "referencia_externa": "ch_123", "estado_transaccion": "completada", "comensal": "Ana" }
```

- `metodo_pago` es obligatorio, con los valores del CHECK del schema: `efectivo`,
  `tarjeta_debito`, `tarjeta_credito`, `transferencia`, `online`.
- **`estado_transaccion` lo fija el servidor (H-07).** Se acepta omitirlo (queda
  `completada`) o mandar exactamente `"completada"` por compatibilidad con el panel;
  **`pendiente`, `fallida` y `reembolsada` responden 400**. Antes el body decidía el
  estado, así que con el token de un cajero se podía registrar un pago como
  `reembolsada` y dejar la cuenta sin cobrar pero con una transacción encima, sin rastro
  de quién lo decidió. **Un reembolso no se registra por esta ruta**: es otra operación,
  con su propia autorización, y todavía no existe.
- `referencia_externa` es la referencia de la pasarela de pago que integra Roberto —
  este endpoint solo la guarda.
- `comensal` es **opcional** (1 a 40 caracteres, o `null`) y se guarda en
  `transacciones.comensal`. Es lo que permite que `obtener_cuenta_mesa` descuente el
  pago del saldo **de esa persona** en vez del montón, o sea lo que hace posible dividir
  la cuenta. Un cobro de la mesa completa no lo lleva y queda en `NULL` (cae bajo
  `"General"` en la cuenta).
- Si el **JWT trae un alias firmado** (`comensal` en el payload), **ese manda** y el del
  body se ignora: un alias firmado por el servidor no se puede suplantar escribiendo otro
  nombre en el cuerpo, que es justo lo que permitiría cargarle un pago a otra persona de
  la mesa. Es la misma regla que al crear un pedido. Hoy esta ruta es de admin/cajero, así
  que en la práctica el alias viene del body; la regla queda puesta para cuando el
  comensal pague desde su propia sesión.

201: fila insertada en `transacciones`.

**Se puede cobrar en cualquier estado menos `cancelado`.** El pedido pasa a `pagado`
solo si ya estaba en `entregado`; si todavía está en cocina, el pago queda registrado
(201), `estado_pago` pasa a `pagado` y el `estado` no se toca: lo cerrará el `PATCH` a
`entregado` (ver *Regla de cierre*). Esta ruta ya **no** responde 409 por cobrar antes
de entregar — antes lo hacía y el pago se perdía con el `ROLLBACK`.

**Solo `estado_transaccion = 'completada'` liquida el pedido.** Con `pendiente`,
`fallida` o `reembolsada` la transacción se registra igual (201) pero el saldo no baja,
el pedido no se cierra y la mesa no se libera, así que se puede reintentar el cobro.

**Los pagos de un mismo pedido se serializan (H-01).** Al abrir la transacción se bloquea
la fila de la mesa y después la del pedido (`SELECT … FOR UPDATE`), antes de calcular el
saldo y de insertar. Sin ese bloqueo, dos cobros simultáneos leían el mismo saldo y los
dos pasaban la validación del trigger —que mira "lo pagado hasta ahora"—, así que un
pedido de $34.000 se podía cobrar dos veces de $20.000. Está comprobado con una prueba
de concurrencia real (`npm run test:integracion`): 5 pagos en paralelo dan **1 × 201 y
4 × 409**, diez veces seguidas.

El **orden de los bloqueos es siempre el mismo** —mesa primero, pedidos por `id_pedido`
después— en esta ruta y en `POST /transacciones/internal`. Dos caminos que bloqueen en
orden distinto sobre las mismas filas se interbloquean: la caja tendría el pedido
esperando la mesa mientras la pasarela tiene la mesa esperando el pedido.

> El `FOR UPDATE` dentro del trigger `fn_tr_validar_transaccion_financiera` es de
> Jarrison (`database/`) y cerraría el hueco también para un INSERT directo a la base.

**Se admiten abonos parciales.** Un cobro `completada` por menos del saldo se registra
(201) y **no** cambia el estado del pedido ni el de la mesa: el pedido pasa a `pagado`
únicamente cuando el saldo llega a **0** y está en `entregado`. Tras insertar la transacción, el backend
le pregunta el saldo a la base (`obtener_saldo_pendiente`) dentro de la misma
transacción SQL, así que la cuenta la cierra la base y no una suma en JavaScript.

Hace falta porque `tr_validar_transaccion_financiera` solo rechaza que se pague de
**más**, nunca de menos: sin esta comprobación, abonar $1.000 de una cuenta de $56.000
dejaría el pedido como cobrado, liberaría la mesa, invalidaría el QR del grupo y el resto
no se volvería a cobrar.

Mientras quede saldo tampoco se avisa al socket-server (`order:status` y
`mesa:liberada` salen solo cuando el pedido se liquida de verdad). Para ver cuánto falta:
`GET /transacciones/pedido/:id_pedido`, o la cuenta de la mesa en el canal interno.

409 también si el monto excede el saldo del pedido (`tr_validar_transaccion_financiera`,
que además deja constancia en `intentos_pago_fallidos`).

Liberar la mesa lo hace el backend en la misma transacción del cobro, y solo cuando el
pedido quedó liquidado y a la mesa no le quedan otros pedidos abiertos (ver *Liberación
automática*, en la sección de Mesas). Con un abono parcial la mesa sigue `ocupada` y su
QR vale: el grupo no ha terminado. El trigger `tr_regenerar_token_qr` que hacía esto
antes fue retirado por Jarrison.

---

## Tiempo real (socket-server)

El backend avisa al socket-server por HTTP interno, con la cabecera `x-internal-key` y un
`eventId` UUID v4 por acción (reintentar con el mismo `eventId` es seguro: él deduplica).
Contrato completo en [socket-server/EVENTS.md](../../socket-server/EVENTS.md).

| Cuándo | Aviso |
|---|---|
| Se crea un pedido | `POST /internal/order-created` con el pedido y sus ítems |
| Cambia el estado (pedidos y KDS) | `POST /internal/order-status` con `estado_anterior` |
| Se abre una mesa con un token **nuevo** | `POST /internal/qr-rotado` → `qr:actualizado` a la tablet |
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

## Canal interno (socket-server)

Tres rutas que **no llevan JWT**: las llama el socket-server de Roberto, servidor a
servidor, con la clave compartida en la cabecera

```
x-internal-key: <INTERNAL_API_KEY>
```

Contrato: `socket-server/EVENTS.md` §8.2, §8.4 y §8.5. Ningún frontend las usa.

| Método | Ruta | Descripción |
|---|---|---|
| GET | /mesas/:id/cuenta/interno | Cuenta de la mesa en centavos, con el saldo de cada comensal |
| POST | /transacciones/internal | Registra un pago ya cobrado por la pasarela y lo reparte entre los pedidos de la mesa |
| POST | /pagos/intentos-fallidos/interno | Bitácora de un pago rechazado o descartado al reverificarlo |

Respuestas del middleware:

- **401** si falta la cabecera o la clave no coincide (se compara en tiempo constante,
  con `crypto.timingSafeEqual`).
- **503** si el servidor **no tiene** `INTERNAL_API_KEY`, o todavía tiene el
  placeholder del `.env.example`. Falla cerrada a propósito: con el canal abierto
  cualquiera en la red podría registrar pagos y liberar mesas, y un 503 se nota y se
  arregla.

Todos los montos de estas rutas viajan en **centavos enteros** (`monto_centavos`,
`saldo_centavos`…) y la conversión a pesos se hace **en SQL**
(`($n::bigint)::numeric / 100`), nunca con coma flotante en JavaScript.

### GET /mesas/:id/cuenta/interno

200:

```json
{
  "id_mesa": 5,
  "moneda": "COP",
  "total_centavos": 9000000,
  "saldo_centavos": 6000000,
  "por_comensal": [ { "comensal": "Ana", "saldo_centavos": 3000000 } ]
}
```

- Sale de `obtener_cuenta_mesa_json()`; los centavos se calculan con
  `ROUND(x * 100)::bigint` en la misma consulta.
- `por_comensal` solo incluye a quien **todavía debe algo** (saldo > 0).
- **404** si la mesa no existe (se comprueba antes de llamar a la función, que
  lanzaría un `RAISE` y saldría como 409). **400** si el id no es un entero.

> ⚠️ **Limitación conocida (no es de este endpoint):** `obtener_cuenta_mesa` toma todos
> los pedidos de la mesa con `estado != 'cancelado'`, **sin distinguir la sesión**, así
> que un pedido ya pagado de un grupo anterior sigue sumando en `total_centavos` y
> descuadra `por_comensal`. Ver *Pendiente por acordar con el equipo*.

### POST /transacciones/internal

Body:

```json
{
  "referencia_externa": "SD-5-1760212345678-Qm9vX2E",
  "id_transaccion_pasarela": "1132-903100443-27458",
  "pasarela": "wompi",
  "id_mesa": 5,
  "comensal": "Ana",
  "modo": "igual",
  "monto_centavos": 3000000,
  "moneda": "COP",
  "metodo_pago": "online"
}
```

- `moneda` solo acepta `"COP"`; `monto_centavos` es un entero > 0; `comensal` puede
  ir `null` (pago de la mesa completa); `metodo_pago` por omisión es `online`.
- `modo` e `id_transaccion_pasarela` se validan porque son del contrato, pero hoy **no
  hay columna** donde guardarlos.
- **El pago es de la mesa, no de un pedido.** Todo ocurre en una sola transacción SQL:
  se bloquea la fila de la mesa (`FOR UPDATE`), se reparte el monto entre sus pedidos
  no cancelados con saldo, **del más antiguo al más nuevo** (orden de la base, por
  `creado_en`), y cada pedido recibe hasta su propio saldo.
- **Una fila de `transacciones` por pedido.** `transacciones.referencia_externa` tiene
  un índice único (`uq_transacciones_referencia_externa`), así que **la primera fila
  lleva la referencia tal cual** —es la que se busca para la idempotencia y la que
  cuadra con el extracto de la pasarela— y las siguientes llevan
  `referencia#2`, `referencia#3`… El sufijo es un detalle del almacenamiento: el
  contrato con el socket-server sigue hablando de una sola referencia.
- Un pedido pasa a `pagado` **solo si se cumplen las dos cosas**: su saldo llegó a **0**
  **y** ya estaba en **`entregado`** (es la única transición que acepta
  `tr_validar_transicion_estado`). Si todavía está en cocina, el pago queda registrado y
  el pedido sigue su curso; **al marcarlo `entregado` se cierra en `pagado` y la mesa se
  libera** (ver *Regla de cierre*), y la caja no vuelve a cobrarlo porque su saldo ya es
  0. El cambio se registra en `historial_estados` con `id_usuario`
  **NULL** y `observaciones` `"Pago en linea"`: no lo cobró una persona.
- **La mesa se libera solo si algún pedido llegó a `pagado` por este pago y a la mesa no
  le queda ningún otro pedido abierto**, todo en la misma transacción. Dos consecuencias
  que conviene tener claras: un pago que deja saldo **no** libera la mesa, y un pago que
  liquida el saldo de un pedido que sigue en cocina **tampoco** la libera (el pedido no
  pasó a `pagado`, así que sigue contando como abierto). Después del commit —y aislado—
  se avisa `order:status` por cada pedido liquidado y `/internal/mesa-liberada` con
  `{ "motivo": "pagada" }`.

201:

```json
{ "ok": true, "duplicado": false, "saldo_restante_centavos": 6000000, "mesa_liberada": false }
```

- **200** con `"duplicado": true` si esa `referencia_externa` ya estaba registrada (un
  reintento de la pasarela no vuelve a cobrar ni a avisar al socket-server). Si la
  carrera la pierde el `INSERT` y choca con el índice único (`23505`), se revierte y se
  responde igual como duplicado.
Errores:

| Status | Cuándo | Cuerpo |
|---|---|---|
| **404** | La mesa no existe (se comprueba con la fila bloqueada, antes de repartir nada) | `{ "error": "Mesa no encontrada" }` |
| **409** | El pago **excede el saldo** de la mesa | `{ "error": "El pago excede el saldo de la mesa", "saldo_centavos": 2400000 }` |
| **409** | La mesa **no tiene cuenta abierta** (ningún pedido no cancelado con saldo > 0) | `{ "error": "La mesa no tiene una cuenta abierta por pagar" }` |
| **409** | Cualquier regla que rechace un trigger de la base | El mensaje del trigger, tal cual |
| **400** | El cuerpo no cumple el esquema | El primer problema que encontró zod |
| **401** / **503** | Clave interna inválida / canal interno sin configurar | Ver el inicio de esta sección |

A diferencia de la bitácora de intentos fallidos, **aquí sí se rechaza de verdad**:
este endpoint mueve dinero, y registrar un pago a medias sería peor que devolver un
error. El cuerpo exige `referencia_externa`, `id_transaccion_pasarela`, `pasarela`,
`id_mesa`, `modo`, `monto_centavos` (entero > 0) y `moneda` **exactamente `"COP"`**;
solo `comensal` admite `null` y solo `metodo_pago` tiene valor por omisión.
Nada se degrada a NULL en silencio.

### POST /pagos/intentos-fallidos/interno

Body: solo tres campos son **obligatorios** — `referencia_externa`,
`id_transaccion_pasarela` y `motivo` (lo que identifica la alerta y por qué se rechazó).
El resto es opcional y admite `null`: `pasarela`, `id_mesa`, `monto_centavos`,
`monto_esperado_centavos`, `moneda`, `metodo_pago`.

201: `{ "ok": true }`

- Guarda en `intentos_pago_fallidos` con `razon_rechazo` = `motivo` tal cual,
  `monto` = centavos / 100 e `id_pedido` en **NULL** (una referencia rechazada puede no
  corresponder a ningún pedido).
- **Idempotente** por (`referencia_externa`, `id_transaccion_pasarela`,
  `razon_rechazo`): un reintento no inserta otra fila y responde 201 igual, porque para
  el socket-server lo que importa es que quedó registrado.

**Por qué este endpoint es tan tolerante.** El socket-server **solo reintenta ante 5xx o
error de red**: un 4xx lo da por resuelto y la alerta se pierde para siempre. Como esto
es una bitácora y no un cobro, guardar un registro incompleto siempre es mejor que
rechazarlo, así que lo que no se puede guardar se degrada a `NULL`:

| Caso | Qué hace |
|---|---|
| `id_mesa: null`, ausente, o una mesa que no existe | Guarda `id_mesa` en **NULL** (la FK `fk_intento_mesa` no se rompe). Con `null` ni se consulta la tabla `mesas` |
| `moneda` distinta de COP (`"USD"`) | **Se guarda tal cual** y responde 201: una moneda inesperada *es* la alerta (motivo `moneda_distinta`). Se normaliza a mayúsculas, para que `usd` y `USD` no queden como dos monedas en la bitácora. La columna es `VARCHAR(3)`, así que más de 3 caracteres sí da 400 |
| `monto_centavos` ausente, `null`, `0` o negativo | Guarda `monto` en **NULL**. `intentos_pago_fallidos` tiene `CHECK (monto > 0)`: un 0 reventaría el INSERT y se perdería el registro |
| `monto_esperado_centavos` (incl. `null`) | **Se valida pero no se guarda**: la tabla no tiene columna para él |
| Sin `pasarela` o sin `moneda` | Se guardan en `NULL`; `metodo_pago` mantiene su valor por omisión (`online`) |

**400** solo si falta uno de los tres obligatorios, o si un campo presente no cumple su
forma (p. ej. `moneda` de más de 3 caracteres, `monto_centavos` no entero).

---

## Códigos de error de la base de datos

El manejador central ([`errores.middleware.js`](../src/middleware/errores.middleware.js))
es el único sitio donde se decide el status. Traduce lo que lanza PostgreSQL así:

| Origen | Status | Cuerpo |
|---|---|---|
| Error de negocio del backend (`{ status, message }`) | ese status | su mensaje |
| `RAISE EXCEPTION` de un trigger (**P0001**) | **409** | el mensaje del trigger, tal cual — está escrito para leerse ("Transición de estado no autorizada: de \"listo\" hacia \"en_preparacion\"") |
| Error de **datos** de PostgreSQL (**clase 22**: 22003 desbordamiento numérico, 22001 texto largo, 22012 división por cero, 22P02 sintaxis…) | **422** | `No se pudo registrar esta operación: un dato está fuera del rango permitido. Avisa al equipo.` |
| Cualquier otro error de PostgreSQL (CHECK 23514, FK 23503, unique 23505…) o inesperado | **500** | `Error interno del servidor` |

**Por qué 422 y no 500 en la clase 22.** Un dato que no cabe no es una caída del
servidor: reintentar nunca va a funcionar, y un 500 lo hace indistinguible de un fallo
pasajero. Con 422 el cliente sabe que el problema es el dato y no insiste.

El mensaje del 422 es **siempre el mismo** y no dice qué dato ni dónde: el texto real de
PostgreSQL nombra funciones, columnas y precisiones internas (`función PL/pgSQL
fn_tr_calcular_tiempo_preparacion() en la línea 28`), que es un mapa del esquema para
quien lo lea. El detalle completo —código, `detail` y `where`— se registra en el log del
servidor junto al método y la ruta.

> **Caso real:** `PATCH /kds/comandas/:id/estado` sobre una comanda que lleva días en
> `en_preparacion` da 22003, porque `fn_tr_calcular_tiempo_preparacion` calcula la
> variación porcentual en `NUMERIC(6,2)` (tope 9999.99 %) y una comanda parada 20.000
> minutos la desborda. Se cruza cuando el tiempo real supera ~101× el estimado (unas 8 h
> para un plato de 5 min). El arreglo de fondo es ampliar esa precisión en `database/`;
> hasta entonces, el KDS al menos muestra un mensaje que se entiende.

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
- **`obtener_cuenta_mesa` mezcla sesiones de la misma mesa.** Filtra por
  `estado != 'cancelado'`, así que los pedidos ya pagados del grupo anterior siguen
  contando. Con un pedido viejo de $10.000 pagado (ítem de 'Ana', pago sin alias) y uno
  nuevo de $30.000 de 'Beto': `total_mesa` = 40.000 en vez de 30.000, y por comensal sale
  Ana debiendo 10.000 que ya pagó, mientras el pago aparece bajo 'General'. La suma de
  los saldos por comensal (40.000) no cuadra con `saldo_mesa` (30.000). Hace falta
  delimitar la sesión: una columna de apertura en `mesas` o un `id_sesion` en
  `pedidos` (hoy `mesas` no tiene ninguna columna que sirva).
- **`registrarPago` marca el pedido `pagado` con cualquier cobro `completada`, aunque
  sea parcial.** El trigger solo rechaza el exceso, no el pago de menos, así que abonar
  $1 de una cuenta de $56.000 la deja como cobrada y libera la mesa. `POST
  /transacciones/internal` no tiene ese problema (compara contra el saldo), pero
  `POST /transacciones` sí.
