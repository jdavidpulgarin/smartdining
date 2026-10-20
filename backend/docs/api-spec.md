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

| Código | Cuerpo | Cuándo |
|---|---|---|
| 200 | `{ usuario, token }` | Credenciales correctas y cuenta activa |
| 400 | `{ "error": "..." }` | El body no cumple el esquema (email inválido, contraseña de menos de 6) |
| **401** | `{ "error": "Credenciales inválidas" }` | **El email no existe, la contraseña es incorrecta o la cuenta está inactiva: los tres responden lo mismo** |
| 429 | `{ "error": "Demasiados intentos..." }` | Límite de intentos (H-04): 5 fallos por minuto y por IP+email |

#### Un solo código y un solo mensaje (H-12)

Antes este endpoint distinguía los tres casos, y eso permitía **enumerar usuarios**:

- un email inexistente respondía en **~3 ms** y uno existente en **~70 ms**, porque solo el
  segundo llegaba a bcrypt;
- una cuenta desactivada respondía **403 `Usuario inactivo`**, confirmando que el email
  existe, y además **antes** de validar la contraseña.

Con eso se podía recorrer una lista de correos y quedarse con los que sí tienen cuenta sin
acertar una sola contraseña. Ahora:

- el login **siempre** pasa por `bcrypt.compare`, exista el usuario o no. Si no existe (o
  no tiene hash) se compara contra un **hash ficticio** generado al arrancar a partir de
  una cadena aleatoria y con el **mismo costo** que los hashes reales (`$2b$10$`, el de
  `register` y el del seed), así que los tres casos tardan lo mismo;
- la decisión **no depende** de esa comparación: sin usuario, o con la cuenta inactiva, se
  rechaza siempre;
- un **único** 401 con un **único** mensaje para los tres casos.

> La cuenta desactivada sí se explica, pero en el **middleware** (H-09, más abajo): allí ya
> hay un JWT válido, así que no queda nada que enumerar.

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
| desarrollo y pruebas | `http://localhost:5173`, `:5174`, `:5175` (restaurante, cliente y KDS) |
| `NODE_ENV=development` (modo red local) | lo anterior **más** cualquier `http://<IPv4 privada>` en los puertos 5173, 5174 o 5175 (solo `http`), para probar desde un celular de la misma Wi-Fi (ver `backend/README.md`) |

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
| PATCH | /platos/:id/disponible | **admin, cocina** | Agota o repone (D-05, ver abajo) |

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

### PATCH /platos/:id/disponible — agotar o reponer (D-05)

El interruptor de "se acabó" / "volvió" del plato, **gemelo del de ingredientes**
(§`PATCH /ingredientes/:id/disponible`) y con las mismas reglas. Cuerpo con **un solo
campo**:

```json
{ "disponible": false }
```

- `disponible` es **booleano estricto**: `"false"`, `0` o `null` responden **400**. Sin
  coerción a propósito — un `"false"` en texto es `true` para JavaScript, y aquí eso
  significaría reponer algo que está agotado.
- El cuerpo es `.strict()`: una clave de más es **400**. Colar un `precio` por aquí sería
  editar la carta con permisos de `cocina`; para eso está el `PUT`, que es solo de admin.
- `:id` tiene que ser un **entero positivo**, o **400**. Un plato que no existe, **404**.
- **Idempotente**: ponerlo al valor que ya tenía responde **200**, no 409.
- **200** devuelve la fila del plato, con la misma forma que el `PUT`. Es lo que espera hoy
  el panel (`agotadosApi.togglePlato`), que manda ese cuerpo y solo exige un 2xx.

**La excepción al "solo de admin" (D-05).** Es la única escritura de la carta que también
puede hacer `cocina`, por la misma razón que en ingredientes: **agotar un plato no es
editar la carta, es reportar lo que pasa en la cocina.** `cajero`, `mesero` y el comensal
reciben 403.

**El orden es parte del contrato**, igual que en ingredientes:

1. `UPDATE` dentro de la transacción, con la fila bloqueada (`SELECT … FOR UPDATE`), y
   **COMMIT**. El `UPDATE` toca **solo la columna `disponible`**: a diferencia del `PUT`,
   que reescribe la fila entera, agotar un plato no puede perder por el camino un precio
   que otro acabara de guardar.
2. **Invalidar `cache:menu`.**
3. **Recién entonces** avisar al socket-server.

El paso 2 va antes del 3 y no al revés: si se avisara primero, un cliente que reaccione al
evento pidiendo `GET /menu` podría recibir la copia vieja de la caché (TTL 60 s) y seguir
mostrando el plato como disponible.

**El aviso es un extra, no parte de la operación.** Se manda
`POST /internal/plato-disponibilidad` con `{ id_plato, disponible, eventId }`, y el
socket-server difunde `plato:disponibilidad` a todos los sockets
([EVENTS.md §5.4](../../socket-server/EVENTS.md)). `emitidoEn` **lo pone él** al emitir, no
el backend. Si el socket-server está caído, lento o responde mal: **no se revierte nada**, se
registra en el log y **la respuesta sigue siendo 200**, porque el cambio ya está guardado.
Su idempotencia va por una clave propia (`backend:plato:{eventId}`), independiente de la de
ingredientes.

**Un `eventId` nuevo por llamada, incluso si el valor no cambió**, como en ingredientes: así
un reenvío lo recuperan los clientes que se perdieron el anterior.

**El `PUT /platos/:id` NO avisa.** Diferencia con ingredientes, donde el `PUT` del editor
también avisa si el valor cambió: aquí el `PUT` reescribe la fila con lo que ya había leído,
así que no sabe si `disponible` cambió de verdad. Para agotar está este `PATCH`, que es lo
que usa el panel. La caché sí se invalida en los dos casos.

**La bitácora la escribe la base.** El trigger `tr_auditar_cambios` audita todo `UPDATE` de
`platos` en `auditoria_cambios` (modelo-er.md §11); el backend no registra nada por su
cuenta.

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
- Toda mutación de la carta (`POST`/`PUT`/`DELETE` de `/platos` y `/categorias`, y las 6
  escrituras del constructor: pasos e ingredientes) borra `cache:menu` con
  `invalidarMenu()`, así que un cambio del admin se ve de inmediato sin esperar el TTL. Con
  Redis caído, `invalidarMenu()` tampoco falla: devuelve `false` y la mutación sigue su
  curso.
- Un error de la base **no** se cachea.

---

## Constructor: pasos e ingredientes (D-04)

Administración de los pasos de un plato personalizable y de las opciones de cada paso.
Tablas en `database/scripts/13_constructor.sql`. Lo consume el panel del restaurante
(`constructorApi`).

| Método | Ruta | Roles | Respuesta | Errores |
|---|---|---|---|---|
| GET | `/platos/:id/pasos` | admin, cajero, mesero | 200, **array** de pasos con `ingredientes` anidados | 400 id inválido · 404 plato |
| POST | `/platos/:id/pasos` | **admin** | 201, el paso creado con `ingredientes: []` | 400 · 404 plato · 409 |
| PUT | `/pasos/:id` | **admin** | 200, el paso actualizado | 400 · 404 · 409 |
| DELETE | `/pasos/:id` | **admin** | 204 sin cuerpo | 400 · 404 · 409 |
| POST | `/pasos/:id/ingredientes` | **admin** | 201, el ingrediente creado | 400 · 404 paso · 409 |
| PUT | `/ingredientes/:id` | **admin** | 200, el ingrediente actualizado | 400 · 404 · 409 |
| DELETE | `/ingredientes/:id` | **admin** | 204 sin cuerpo | 400 · 404 · 409 |
| PATCH | `/ingredientes/:id/disponible` | **admin, cocina** | 200, el ingrediente actualizado | 400 · 403 · 404 |

Escribir el constructor es **solo de admin**, con **una excepción**: el `PATCH` de
disponibilidad, que se detalla abajo. Leerlo lo necesita todo el personal de sala, así que
el `GET` lo abren también `cajero` y `mesero`; `cocina` y el comensal reciben 403 en el
resto (la cocina trabaja con `GET /kds/comandas`, y el comensal ve el constructor dentro de
`GET /menu`).

**La excepción al "solo de admin" (D-05).** `PATCH /ingredientes/:id/disponible` es la única
escritura del constructor que también puede hacer `cocina`, y es deliberado: **agotar un
ingrediente no es editar la carta, es reportar lo que pasa en la cocina.** Quien ve que se
acabó la panceta está frente al KDS, no en el panel de administración, y el panel de
agotados que la llama (**D-10**) vive justamente ahí. `cajero`, `mesero` y el comensal
siguen recibiendo 403.

### PATCH /ingredientes/:id/disponible — agotar o reponer (D-05)

El interruptor de "se acabó" / "volvió". Cuerpo con **un solo campo**:

```json
{ "disponible": false }
```

- `disponible` es **booleano estricto**: `"false"`, `0` o `null` responden **400**. Sin
  coerción a propósito — un `"false"` en texto es `true` para JavaScript, y aquí eso
  significaría reponer algo que está agotado.
- Es el **único** cuerpo del constructor con `.strict()`: tiene un campo, así que una clave
  de más es un error de quien llama y no la costumbre del editor de reenviar la fila entera
  (ver §`id_plato` e `id_paso` salen de la URL).
- **Idempotente**: ponerlo al valor que ya tenía responde **200**, no 409.
- **200** devuelve la fila del ingrediente, con la misma forma que el `PUT`.

**El orden es parte del contrato:**

1. `UPDATE` dentro de la transacción que ya abre el servicio (`SELECT … FOR UPDATE`), y
   **COMMIT**.
2. **Invalidar `cache:menu`.**
3. **Recién entonces** avisar al socket-server.

El paso 2 va antes del 3 y no al revés: si se avisara primero, un cliente que reaccione al
evento pidiendo `GET /menu` podría recibir la copia vieja de la caché (TTL 60 s) y seguir
mostrando el ingrediente como disponible. Es una carrera real.

**El aviso es un extra, no parte de la operación.** Se manda
`POST /internal/ingrediente-disponibilidad` con `{ id_ingrediente, disponible, eventId }`, y
el socket-server difunde `ingrediente:disponibilidad` a todos los sockets
([EVENTS.md §5.3](../../socket-server/EVENTS.md)). `emitidoEn` **lo pone él** al emitir, no
el backend. Si el socket-server está caído, lento o responde mal: **no se revierte nada**, se
registra en el log del servidor y **la respuesta sigue siendo 200**, porque el cambio ya está
guardado. Tampoco se espera el aviso para responder.

**Un `eventId` nuevo por llamada, incluso si el valor no cambió.** Así un reenvío lo
recuperan los clientes que se perdieron el anterior; con el mismo `eventId`, el
socket-server lo deduplicaría (`duplicado: true`, sin emitir) y el aviso se perdería en
silencio.

**El `PUT /ingredientes/:id` también avisa**, porque también puede cambiar `disponible`:
agotar algo desde el editor del panel llega en vivo igual que por el PATCH. Pero **solo
cuando el valor cambió de verdad** — un `PUT` que toca el nombre o el precio no es una
noticia de disponibilidad y no debe mover el constructor de nadie. La caché, en cambio, se
invalida en los dos casos, porque el nombre y el precio viajan dentro del menú.

**Un paso no se agota.** `pasos_constructor` no tiene columna `disponible`: lo que se apaga
son las opciones, no la pregunta. D-05 es solo de ingredientes.

**Un ingrediente agotado no se puede pedir.** No lo comprueba el backend: lo rechaza el
trigger `tr_validar_detalle_ingrediente` con `El ingrediente "X" está agotado`, que sale
como **409** con ese mensaje (§`Códigos de error de la base de datos`). La condición del
trigger permite **conservarlo** en un `UPDATE` que no lo cambie, así que agotar algo no
rompe los pedidos ya tomados.

### `id_plato` e `id_paso` salen de la URL

El panel los manda **también en el cuerpo**. Se **ignoran**: el que vale es siempre el de
la URL. No se responde 400 por mandarlos, porque toda llamada del panel los incluye hoy.
Mover un paso de plato o un ingrediente de paso no es parte de este contrato.

### Los PUT son parciales

Se manda solo lo que cambia; el resto se conserva. La fila se lee con
`SELECT … FOR UPDATE` y se escribe **dentro de la misma transacción**, así que las reglas
cruzadas se validan contra la fila ya mezclada y dos ediciones simultáneas no se pisan.

### GET /platos/:id/pasos

Devuelve el **array pelado**, no `{ pasos }`. Mismo orden y misma forma que
`obtener_menu_completo`: pasos por `orden`, ingredientes por `id_ingrediente`. Los
ingredientes agotados **sí** se devuelven (con `disponible: false`), para poder reactivarlos.

```json
[
  {
    "id_paso": 31,
    "id_plato": 7,
    "nombre": "Elige tu Base",
    "orden": 1,
    "min_sel": 1,
    "max_sel": 1,
    "obligatorio": true,
    "ingredientes": [
      {
        "id_ingrediente": 10,
        "id_paso": 31,
        "nombre": "Arroz",
        "precio_extra": "0.00",
        "calorias": 150,
        "alergenos": [],
        "url_imagen": null,
        "disponible": true
      }
    ]
  }
]
```

### Validación (400)

Replica los CHECK de la base para dar un mensaje que se entienda, en vez del mensaje fijo
y opaco del 422 al que el manejador central traduce un `23514` (la frontera entre los dos
está en §[La frontera entre 400 y 422](#la-frontera-entre-400-y-422-h-11)):

| Campo | Regla |
|---|---|
| `nombre` (paso) | 1 a 60 caracteres |
| `nombre` (ingrediente) | 1 a 80 caracteres |
| `orden` | entero ≥ 1 |
| `min_sel` | entero ≥ 0 |
| `max_sel` | entero ≥ 1 |
| `min_sel` / `max_sel` | `min_sel <= max_sel` |
| `obligatorio` | si es `true`, `min_sel >= 1` |
| `precio_extra` | número ≥ 0 |
| `calorias` | entero ≥ 0 |
| `alergenos` | arreglo de texto |
| `url_imagen` | hasta 255 caracteres |

**Normalización de lo que manda el panel:**

- `calorias: null` → en el **POST** se omite la columna y actúa el `DEFAULT 0`; en el
  **PUT** se guarda `0` (la columna es `NOT NULL` y ya tiene valor, no hay default que
  invocar).
- `url_imagen: ""` (o solo espacios) → `null` en los dos. Guardar una cadena vacía sería
  basura que el constructor intentaría cargar como imagen.

### Códigos 409

| Situación | Mensaje |
|---|---|
| Otro paso del plato ya ocupa ese `orden` (`uq_pasos_plato_orden`) | `Ya hay otro paso de este plato en esa posición` |
| Otro paso del plato ya tiene ese nombre (`uq_pasos_plato_nombre`) | `Ya hay otro paso de este plato con ese nombre` |
| Otro ingrediente del paso ya tiene ese nombre (`uq_ingredientes_paso_nombre`) | `Ya hay otro ingrediente de este paso con ese nombre` |
| Crear un paso en un plato no personalizable | `Ese plato no es personalizable: actívalo antes de agregarle pasos` |
| Borrar un paso con ingredientes ya vendidos | `Ese paso tiene ingredientes que ya se usaron en pedidos: no se puede borrar, marca sus ingredientes como no disponibles` |
| Borrar un ingrediente ya vendido | `Ese ingrediente ya se usó en pedidos: no se puede borrar, márcalo como no disponible` |

`uq_pasos_plato_orden` es `DEFERRABLE INITIALLY DEFERRED`, así que su violación llega en el
**COMMIT**, no en el `UPDATE`. El servicio lo captura igual y responde 409.

### Regla de borrado: lo vendido no se borra

`detalles_ingredientes.id_ingrediente` es `ON DELETE RESTRICT` a propósito, para que los
pedidos históricos conserven su composición. Por eso:

- Un ingrediente que ya se usó en algún pedido **no se borra**: responde **409**. Para
  sacarlo de la carta hay que marcarlo como no disponible con
  `PATCH /ingredientes/:id/disponible` (D-05, ya disponible: ver arriba).
- **Un paso también queda protegido**, de rebote: `ingredientes.id_paso` es
  `ON DELETE CASCADE`, pero la cascada se topa con ese `RESTRICT` y PostgreSQL aborta todo.

Se eligió responder 409 y no desactivar en silencio: un `DELETE` que en realidad apaga algo
sería una sorpresa, y el interruptor correcto es el de D-05.

### Caché

Las 6 escrituras invalidan `cache:menu` (los pasos e ingredientes viajan dentro de
`obtener_menu_completo`). Con Redis caído la escritura sigue su curso: `invalidarMenu()`
devuelve `false` y no lanza. **No se avisa al socket-server:** no existe un evento de
"cambió el menú" en `EVENTS.md`, y `/platos` tampoco avisa.

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
  "url": "http://localhost:5174/?token=v1.eyJtIjoxLCJpYXQiOjE3OTA2…",
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
{ "url": "http://localhost:5174/?token=v1....", "expira_en": 1760000000000, "mesa": { "id_mesa": 5, "numero": 5, "estado": "ocupada" } }
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
| GET | /pedidos/activos | admin, cajero, mesero | Pedidos **activos** (`recibido`, `en_preparacion`, `listo`, `entregado`) con sus ítems y `mesa_numero` |
| **GET** | **/pedidos/mesa** | **comensal** | **Pedidos de la mesa de la sesión** *(reemplaza a `/pedidos/historial`)* |
| **GET** | **/pedidos/mesa/cuenta** | **comensal** | **Cuenta de SU mesa por comensal; la mesa sale del JWT** |
| GET | /pedidos/:id | **admin, cajero, mesero, comensal** | Detalle con sus ítems; un comensal solo ve los de su mesa y de su visita (403 si no). **`cocina` no entra (S-26)** |
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

### GET /pedidos/activos — admin, cajero, mesero

Lista para el **panel del restaurante**. Devuelve `{ pedidos }` con cada pedido en el
**mismo formato** que `GET /pedidos/:id`: sus `detalles`, cada uno con el nombre del plato
y los ingredientes elegidos. Añade `mesa_numero`.

**Estados que cuentan como activos:** `recibido`, `en_preparacion`, `listo` y `entregado`.
Quedan fuera `pagado` (ya se cobró y la mesa se liberó) y `cancelado`. El orden sigue
siendo `creado_en ASC`: los más antiguos primero, que es el orden de atención.

> `listo` y `entregado` **antes no entraban**. Un pedido `listo` es justo el que el mesero
> tiene que llevar y uno `entregado` el que hay que cobrar: sin ellos el panel perdía de
> vista los pedidos en el tramo donde más falta hace verlos.

Campos nuevos respecto a lo que devolvía antes:

| Campo | Tipo | Qué es |
|---|---|---|
| `mesa_numero` | número | Número de la mesa en el salón (`mesas.numero`), no el `id_mesa` interno |
| `detalles` | array | Los ítems del pedido, igual que en `GET /pedidos/:id` (antes no venían) |

Todo lo que ya devolvía (`id_pedido`, `id_mesa`, `codigo_pedido`, `estado`, `estado_pago`,
`total`, `notas_generales`, `creado_en`, `actualizado_en`) **sigue igual**: la consulta usa
`p.*`, así que solo se agrega.

200:

```json
{
  "pedidos": [
    {
      "id_pedido": 87,
      "codigo_pedido": "PED-261013-A1B2C",
      "id_mesa": 5,
      "mesa_numero": 12,
      "estado": "listo",
      "estado_pago": "pendiente",
      "total": "43000.00",
      "notas_generales": null,
      "creado_en": "2026-10-13T19:40:00.000Z",
      "detalles": [
        {
          "id_detalle": 700,
          "id_plato": 1001,
          "plato_nombre": "Bowl Personalizado",
          "cantidad": 2,
          "precio_unitario": "20000.00",
          "precio_extras": "1500.00",
          "subtotal": "43000.00",
          "comensal": "Ana",
          "notas_especiales": "sin cebolla",
          "ingredientes": [
            { "id_ingrediente": 1, "nombre": "Arroz", "porcion": "normal", "precio_aplicado": "0.00", "paso": "Elige tu Base" }
          ]
        }
      ]
    }
  ]
}
```

Son **dos consultas fijas** (los pedidos y los detalles de todos ellos de golpe), no una
por pedido. Si no hay pedidos activos responde `{ "pedidos": [] }` sin consultar detalles.

403: rol no permitido (`cocina` usa `GET /kds/comandas`; el comensal, `GET /pedidos/mesa`).

> **Sobre el nombre del mesero:** se pidió como opcional, vía
> `LEFT JOIN usuarios ON usuarios.id_usuario = pedidos.id_usuario`. **No se puede hacer
> hoy: la tabla `pedidos` no tiene columna `id_usuario`** (ver `database/schema.sql`, tabla
> 6). Quién interviene en un pedido se guarda en `historial_estados.id_usuario`, no en el
> pedido. Sacar de ahí "el mesero" obliga a decidir qué fila representa al responsable
> (¿quién lo creó? ¿quién lo entregó?), así que queda pendiente de acordar y no se inventó.

### GET /pedidos/:id

Roles: **admin, cajero, mesero y comensal**. `cocina` responde **403** (S-26): esta ruta
devuelve el pedido completo —el total y, por cada ítem, el alias de quién lo pidió— y la
cocina no necesita nada de eso. Trabaja con `GET /kds/comandas` y
`PATCH /kds/comandas/:id/estado`, que no pasan por aquí; ningún frontend del KDS la usa.

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

Mientras quede saldo no se avisa el **cierre** al socket-server (`order:status` y
`mesa:liberada` salen solo cuando el pedido se liquida de verdad), pero el **cobro sí se
anuncia**: cada abono manda su `POST /internal/payment-confirmed` con el saldo que le
queda a la mesa, para que las demás cajas y la propia mesa vean bajar la cuenta en vivo
(ver *Tiempo real*). Para ver cuánto falta: `GET /transacciones/pedido/:id_pedido`, o la
cuenta de la mesa en el canal interno.

409 también si el monto excede el saldo del pedido (`tr_validar_transaccion_financiera`,
que además deja constancia en `intentos_pago_fallidos`).

Liberar la mesa lo hace el backend en la misma transacción del cobro, y solo cuando el
pedido quedó liquidado y a la mesa no le quedan otros pedidos abiertos (ver *Liberación
automática*, en la sección de Mesas). Con un abono parcial la mesa sigue `ocupada` y su
QR vale: el grupo no ha terminado. El trigger `tr_regenerar_token_qr` que hacía esto
antes fue retirado por Jarrison.

---

## Reportes (D-07)

| Método | Ruta | Roles | Respuesta | Errores |
|---|---|---|---|---|
| GET | `/reportes?rango=hoy\|semana\|mes` | **admin** | 200, el reporte del rango | 400 rango inválido · 401 · 403 |

**Solo `admin`.** Son cifras de negocio —ventas, ticket promedio, reparto por método de
pago— y ni la cocina ni la caja las necesitan para trabajar. `cajero`, `mesero`, `cocina` y
el comensal reciben **403**, y la petición no llega a tocar la base.

`rango` es **opcional** y por defecto vale `hoy`. Cualquier otro valor —`ayer`, `HOY`, `7`,
vacío, repetido— responde **400** con `rango debe ser hoy, semana o mes`. El valor nunca
entra en el SQL: se traduce a un número de días por un mapa del código.

| `rango` | Cubre |
|---|---|
| `hoy` | el día de hoy |
| `semana` | los **7** últimos días, hoy incluido |
| `mes` | los **30** últimos días, hoy incluido |

### Todo lo numérico sale como número

El panel formatea; el backend no. `totalVentas` es `1250000`, no `'$1.250.000,00'`;
`tiempoCocinaPromedio` es `13.1`, no `'13.1 min'`; `ocupacionMesas` es `60.0`, no `'60%'`.
Las **etiquetas** sí son texto: `metodosPago[].metodo`, `horasPico[].hora`, los nombres de
platos e ingredientes y `tiemposKds[].fecha`.

Un backend que devuelve `'$8.940,00'` obliga al cliente a parsear su propio texto para
cualquier cuenta, y el panel ya hace cuentas con estos valores: normaliza alturas de barra,
busca máximos y compara periodos.

```json
{
  "rango": "hoy",
  "totalVentas": 1250000,
  "totalPedidos": 42,
  "pedidosLiquidados": 38,
  "ticketPromedio": 32894.74,
  "tiempoCocinaPromedio": 13.1,
  "ocupacionMesas": 60.0,
  "kdsAlertsCount": 3,
  "topPlatos": [
    { "id_plato": 1042, "nombre": "Hamburguesa Smart Angus", "categoria": "Hamburguesas & Fuertes",
      "unidades": 20, "total": 680000, "porcentaje": 100 }
  ],
  "metodosPago": [
    { "metodo": "Tarjeta", "monto": 700000, "porcentaje": 56.0 }
  ],
  "horasPico": [
    { "hora": "12:00 - 13:00", "volumen": 100, "pedidos": 18 }
  ],
  "topIngredientes": [
    { "id_ingrediente": 7, "nombre_ingrediente": "Panceta Crujiente",
      "nombre_paso": "Elige tu Proteína", "nombre_plato": "Bowl Personalizado",
      "veces_solicitado": 14, "porciones_extra": 4, "porciones_normal": 10,
      "ingresos_extras": 12000 }
  ],
  "tiemposKds": [
    { "fecha": "2026-10-14", "platos_preparados": 56, "tiempo_estimado_promedio_min": 15,
      "tiempo_real_promedio_min": 13.1, "variacion_promedio_porcentaje": -12.7 }
  ]
}
```

### De dónde sale cada campo

| Campo | Origen | Nota |
|---|---|---|
| `totalVentas` | `v_ventas_diarias.total_recaudado` | **transacciones `completada`**, no totales de pedido |
| `totalPedidos` | `v_ventas_diarias.total_pedidos` | excluye cancelados |
| `pedidosLiquidados` | `v_ventas_diarias.pedidos_liquidados` | `estado = 'pagado'` **o** `estado_pago = 'pagado'` |
| `ticketPromedio` | derivado | `totalVentas / pedidosLiquidados`, **recalculado sobre el rango** |
| `tiempoCocinaPromedio` | `v_tiempos_kds` | media **ponderada por comandas**. `null` si no hubo ninguna |
| `ocupacionMesas` | `pedidos` + `mesas` | mesas distintas con pedido no cancelado / total de mesas × 100 |
| `kdsAlertsCount` | `kds_alertas` | por `fecha_alerta` |
| `topPlatos` | consulta propia | **no** usa `v_platos_top`: ver abajo. Máx. 5 |
| `topIngredientes` | consulta propia | **no** usa `v_ingredientes_top`. Máx. 6, agrupado por `id_ingrediente` |
| `metodosPago` | `transacciones` | ver la agrupación abajo |
| `horasPico` | `pedidos` | ver `volumen` abajo. Máx. 24 |
| `tiemposKds` | `v_tiempos_kds` | una fila por día. Máx. 30 |

**Por qué `topPlatos` y `topIngredientes` no usan las vistas.** `v_platos_top` y
`v_ingredientes_top` **no tienen columna de fecha**: agrupan todo el histórico. Con ellas,
los tres rangos devolverían lo mismo y el selector del panel mentiría. El service hace su
propia consulta con el `JOIN pedidos` y el filtro del rango.

**`ticketPromedio` no se promedia desde la vista.** Promediar los `ticket_promedio` diarios
sería un promedio de promedios: cada día pesaría igual, tenga 2 pedidos u 80.

**`tiempoCocinaPromedio` va ponderado** por `platos_preparados`, por lo mismo.

### Agrupación de `metodosPago`

La base acepta **cinco** métodos (CHECK de `transacciones`) y el reporte devuelve **cuatro
etiquetas**, en español:

| `metodo_pago` en la base | Etiqueta |
|---|---|
| `tarjeta_debito` | **Tarjeta** |
| `tarjeta_credito` | **Tarjeta** |
| `efectivo` | Efectivo |
| `transferencia` | Transferencia |
| `online` | Online |

Débito y crédito se **juntan**: lo que interesa es cuánto entró por datáfono, no de qué
tipo era el plástico. `porcentaje` es sobre el **monto** total del rango, no sobre el número
de transacciones.

### `horasPico.volumen` está normalizado de 0 a 100

El panel lo usa como **altura de barra** (`height: ${volumen}%`), así que no puede ser el
conteo: una hora con 3 pedidos se pintaría como una barra del 3 %. `volumen` es
`pedidos / pedidos_de_la_hora_pico × 100`, y el conteo real va aparte en **`pedidos`**.

### Sin datos no es un error

Una base recién sembrada responde **200** con `0` en los números, `null` en
`tiempoCocinaPromedio` y **listas vacías**. Nunca 404: *"hoy no se ha vendido nada"* es un
dato, no un fallo. `tiempoCocinaPromedio` es `null` y no `0` porque `0 min` diría que se
cocina al instante.

### Zona horaria

Todos los filtros y agrupaciones usan **`AT TIME ZONE 'America/Bogota'` explícito**, no
`CURRENT_DATE`. El servidor tiene esa zona por defecto, pero un contenedor que arranque con
`TZ=UTC` correría "hoy" cinco horas y el corte de caja saldría mal sin que nadie lo notara.

> **Límite conocido:** `v_ventas_diarias` y `v_tiempos_kds` agrupan internamente por
> `DATE(columna)`, que usa la zona de la **sesión**. El backend filtra sus filas con fechas
> ya calculadas en Bogotá, así que el rango es correcto; lo que no puede garantizar desde
> aquí es el corte interno de la vista. Arreglarlo es de
> [`database/scripts/24_vistas_reportes.sql`](../../database/scripts/24_vistas_reportes.sql).

### Caché y rendimiento

Caché de **60 s** en Redis, clave `cache:reportes:<rango>` (una por rango). Un reporte con
un minuto de antigüedad sirve igual para decidir, y a cambio una pestaña que se deje
recargando no castiga la base. **Nunca lanza**: con Redis caído se lee de la base y la
respuesta sale igual (`services/cache.js`).

Nueve consultas, lanzadas en paralelo, todas con `LIMIT` en las listas. `transacciones` y
`kds_metricas` tienen índice por estado+fecha y por fecha. **`pedidos` no tiene un índice
por `creado_en` solo** —los que hay son parciales por estado—, así que el filtro por rango
hace *seq scan*; con el volumen actual es irrelevante, y el arreglo
(`CREATE INDEX … ON pedidos (creado_en)`) sería de `database/`.

### Seguridad

- Solo `admin`; el resto 403 y sin consultar nada.
- **Cero SQL concatenado**: todo por `$1`/`$2`.
- **Sin datos de clientes**: no sale ningún `comensal`, alias, `referencia_externa` ni id de
  transacción. Solo agregados.

### Cambios que necesita el panel

Para consumir números crudos, [`frontend-restaurante/src/pages/Reportes.jsx`](../../frontend-restaurante/src/pages/Reportes.jsx)
necesita **tres** ajustes (son de Jarrison; aquí solo quedan anotados):

1. **Quitar el `×1000` de `formatoCOP`** (líneas 17-30). Hoy multiplica por 1000 cualquier
   número entre 0 y 100 000, porque los datos del fallback están en escala de dólares. Con
   ventas reales en COP, un pedido de `70000` se pintaría como **$70.000.000**.
2. **Quitar el `×1000` de `calcularTicketComensal`** (líneas 32-40), por lo mismo, con el
   umbral en 1000.
3. **Añadir `" min"` a `tiempoCocinaPromedio`** (línea 354): hoy se pinta crudo, así que un
   número aparecería como `13.1` sin unidad. El resto de los tiempos (`tiemposKds`) ya
   recibe números y el panel ya les añade la unidad.

**No hace falta tocar nada más:** `totalVentas` y `metodosPago[].monto` ya pasan por
`formatoCOP`; `tiemposKds`, `topPlatos[].porcentaje` y `topIngredientes[].veces_solicitado`
ya se tratan como números. Y mientras no se cambie, su *fallback* sigue funcionando: solo se
activa cuando la ruta da 404 o falla la red.

> El panel hoy **no pinta** `ocupacionMesas` ni `kdsAlertsCount`, y de `topPlatos` solo usa
> `unidades` y `porcentaje` (los nombres los tiene fijos). Se devuelven igual, porque el
> contrato los pide y son datos legítimos del reporte.

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
| **La caja cobra** (efectivo, datáfono o abono parcial) | `POST /internal/payment-confirmed` → `payment:confirmed` |
| Se libera una mesa (manual o automática) | `POST /internal/mesa-liberada`, con `motivo` si la cerró un pago |

### Cobros de caja: `payment:confirmed` (EVENTS.md §8.6)

Un cobro en caja no pasa por la pasarela, así que nadie más se enteraría de él hasta
recargar la cuenta. Después del COMMIT, `POST /api/transacciones` avisa a
`/internal/payment-confirmed` y el socket-server lo reemite como `payment:confirmed`, el
**mismo evento y el mismo payload** que un pago de Wompi.

| Campo | Qué lleva |
|---|---|
| `eventId` | UUID v4, **uno por cobro** (primera guardia de idempotencia) |
| `id_mesa` | Mesa del pedido cobrado |
| `monto_centavos` | `Math.round(monto * 100)`, entero ≥ 1 |
| `saldo_restante_centavos` | Saldo de **la mesa** (no el del pedido) después de este cobro |
| `comensal` | Alias de quien pagó, o `null` en un cobro de la mesa completa |
| `referencia_externa` | Voucher del datáfono, o `null` |
| `id_transaccion` | Fila de `transacciones` (segunda guardia de idempotencia) |

Todo va en **centavos enteros**: sumar abonos en coma flotante desajustaría el saldo, y
el contrato rechaza un monto con decimales con 400. El saldo de la mesa se calcula
**dentro** de la transacción del cobro, con la fila de la mesa bloqueada, para que sea
exactamente el de después de ese pago y no el de un cobro ajeno que entró en medio.

**Orden cuando el cobro liquida la cuenta.** Los tres avisos salen encadenados, en este
orden y no en otro:

```
POST /internal/payment-confirmed   → payment:confirmed
POST /internal/order-status        → order:status (pagado)
POST /internal/mesa-liberada       → mesa:liberada (motivo "pagada")
```

`mesa-liberada` **desconecta a los comensales**: si saliera antes, la mesa nunca llegaría
a ver el pago que la cerró. La cadena es secuencial pero el handler **no la espera**: el
201 sale en cuanto está el COMMIT.

**Dónde NO se avisa**, y por qué:

- **Pago en línea** (`POST /api/transacciones/internal`): el socket-server ya emite
  `payment:confirmed` desde su propio webhook. Avisar también desde aquí anunciaría el
  mismo pago dos veces.
- **Cierre al entregar** (`PATCH /api/pedidos/:id/estado` → `entregado` de un pedido ya
  pagado) y **cierre a mano** a `pagado`: salen `order:status` y `mesa:liberada`, pero no
  `payment:confirmed`. No entra dinero nuevo; anunciarlo sería un pago fantasma.
- **Cancelar un pedido** o **liberar la mesa a mano**: no hay cobro.
- Un estado de transacción que no sea `completada`: ese dinero no entró.

### Motivo de `mesa:liberada` (H-22)

El motivo sale del **estado final del pedido**, no de la ruta por la que se llegó:

| Causa | `motivo` |
|---|---|
| Cobro en caja que liquida la cuenta | `pagada` |
| Pago en línea (Wompi) | `pagada` |
| Entrega que cierra un pedido ya pagado | `pagada` |
| Pedido cancelado | `liberada` |
| `POST /api/mesas/:id/liberar` (manual) | *(no se manda: `liberada` es el valor por omisión del socket-server)* |

Antes el cobro en caja no mandaba `motivo`, así que el socket-server anunciaba la mesa
como `liberada` —"el mesero cerró la mesa"— cuando en realidad el grupo había pagado. Las
pantallas distinguen las dos cosas, de ahí la corrección.

**Aislamiento:** salvo en `/qr/generar` y `/qr/validar` (donde sin respuesta no se puede
abrir mesa ni sesión, y por eso se responde 503), el tiempo real es un extra. El cliente
(`src/services/socket.notifier.js`) **nunca lanza**: timeout corto (`SOCKET_TIMEOUT_MS`),
registra el motivo y sigue. Un socket-server caído no hace fallar un pedido ni un cobro.

En `order:created` los ítems se envían con `nombre` (no `plato_nombre`), que es el nombre
de campo del contrato de Roberto.

Cada ingrediente de un ítem va con `id_ingrediente`, `nombre`, `porcion`, `precio_aplicado`
y **`paso`**, el nombre del paso del constructor al que pertenece:

```json
"ingredientes": [
  { "id_ingrediente": 2, "nombre": "Quinoa", "porcion": "normal", "precio_aplicado": 0, "paso": "Elige tu Base" },
  { "id_ingrediente": 4, "nombre": "Pollo a la Plancha", "porcion": "extra", "precio_aplicado": 3000, "paso": "Elige tu Proteína" }
]
```

`paso` va porque el KDS agrupa los ingredientes por él para leer el plato en el orden en
que se arma. Sin ese campo, una comanda que entraba **en vivo** se veía plana
(*"Ingredientes: a · b · c"*) mientras que la misma comanda, tras recargar y venir de
`GET /api/kds/comandas`, salía agrupada: los mismos datos de dos formas distintas según por
dónde hubieran llegado.

Los ingredientes mantienen el orden de la consulta (`pasos_constructor.orden`), así que
agrupar por `paso` respeta el orden del constructor sin ordenar nada en el receptor. Cuando
el ingrediente no viene de un paso, `paso` es `null` —el campo va igual, para no tener que
distinguir *"sin paso"* de *"este evento no trae el dato"*—. `id_paso` **no** se envía: es
clave interna y quien recibe agrupa por el nombre; sigue estando en la API REST.

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
| **Choque de concurrencia**: **40P01** (deadlock) y **40001** (fallo de serialización) | **409** | `La operación chocó con otra en curso, vuelve a intentarlo` |
| **23505** `unique_violation` | **409** | `Ya existe un registro con esos datos` |
| **23503** `foreign_key_violation` | **409** | `La operación choca con otro registro relacionado` |
| **23514** `check_violation` | **422** | `No se pudo registrar esta operación: un dato está fuera del rango permitido. Avisa al equipo.` (el mismo de la clase 22) |
| **57014** `query_canceled` — venció `statement_timeout` | **503** | `La operación tardó demasiado y se canceló, vuelve a intentarlo en un momento` |
| Cualquier otro error de PostgreSQL (23502 NOT NULL, 23P01 exclusión…) o inesperado | **500** | `Error interno del servidor` |

### La frontera entre 400 y 422 (H-11)

Los dos significan "esto no se va a arreglar reintentando", pero **no son lo mismo** y el
cliente puede y debe distinguirlos:

| | **400** | **422** |
|---|---|---|
| Qué pasó | El cuerpo **no cumple el esquema**: falta un campo, sobra uno, el tipo o el rango no son los declarados | El cuerpo **está bien formado**, pero el valor **no cabe o no sirve** en la base |
| Quién lo decide | El controller, con zod, **antes** de tocar la base | PostgreSQL, y lo traduce el manejador central |
| Mensaje | **Dice qué campo falla** y por qué: `min_sel no puede ser mayor que max_sel` | **Fijo y opaco**, siempre el mismo: `No se pudo registrar esta operación: un dato está fuera del rango permitido. Avisa al equipo.` |
| Qué hacer en el cliente | Resaltar el campo y dejar corregir | Mostrar el mensaje tal cual: no hay nada que el usuario pueda corregir |
| Códigos | — | clase 22 (22003, 22001, 22012, 22P02…) y **23514** |

Por eso el mensaje del 422 **no** se puede volver específico y el del 400 **sí**: el del
400 lo redacta el backend sobre su propio esquema, mientras que el del 422 vendría del
texto de PostgreSQL, que nombra funciones, columnas y precisiones internas (ver más
abajo). Y por eso **la validación de zod sigue en 400**: moverla a 422 fusionaría las dos
filas de esta tabla y le quitaría al cliente la única señal que le dice si resaltar un
campo o decir "avisa al equipo".

Un 400 también puede venir de una validación del backend que no es de esquema (un `id` de
la URL que no es un entero positivo, un alias de comensal con formato inválido, un estado
que el KDS no acepta). Mismo contrato: mensaje que explica qué está mal.

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

### El 409 de concurrencia: el único que se puede reintentar

`La operación chocó con otra en curso, vuelve a intentarlo`

Significa que PostgreSQL abortó la transacción porque chocó con otra que corría a la vez,
no que la petición estuviera mal:

- **40P01** `deadlock_detected`: dos transacciones se esperaban en círculo y el servidor
  mató a una de las dos.
- **40001** `serialization_failure`: la transacción no se pudo serializar con otra
  concurrente.

**El cliente puede reintentar la misma petición una vez**, y es el único 4xx del que eso
se puede decir: un 409 de trigger (P0001), un 422 o un 400 van a fallar igual por mucho
que se insista. Una vez, no en bucle: si el segundo intento también choca, hay algo que
mirar en el servidor y conviene mostrarlo al usuario en vez de seguir golpeando. En un
cobro, reintentar es seguro porque la transacción abortada **no dejó nada escrito** (el
`ROLLBACK` es completo); un pago en línea además lleva su `referencia_externa` con índice
único, así que un reintento se detecta como duplicado.

Antes estos dos códigos caían en el 500 genérico, que empuja justo a lo contrario:
parecía una caída del servidor y no una colisión pasajera.

Son **solo esos dos**, no la clase 40 entera: `40002` (violación de integridad diferida)
y `40003` (resultado de la transacción desconocido) siguen dando 500, porque reintentar a
ciegas con un resultado desconocido es lo que cobra dos veces.

El mensaje es siempre el mismo y no dice qué filas ni qué transacción: el texto real de
PostgreSQL nombra procesos, relaciones y modos de bloqueo (`el proceso 12345 espera
ShareLock en la transacción 678; bloqueado por el proceso 12346`), que es un mapa del
esquema y de la carga del servidor. El detalle completo —código, `detail` y `where`— se
registra en el log del servidor junto al método y la ruta, igual que en el 422.

> Esto es una red de seguridad, no el arreglo: el camino normal es que no haya deadlocks.
> El backend toma los bloqueos **siempre en el mismo orden** (la mesa antes del pedido,
> los pedidos por `id_pedido`) en los dos endpoints de pago y en los cambios de estado que
> cierran un pedido, y está medido con `npm run test:integracion`: **0 deadlocks de 20
> intentos**. El 409 cubre lo que se escape por ahí — un `INSERT` directo a la base, una
> ruta nueva que se despiste, o un bloqueo que tome un trigger de `database/`.

### Integridad: 23505, 23503 y 23514 (H-11)

Los tres **caían antes en el 500 genérico**, a propósito, para no filtrar el esquema. El
problema es que un 500 los vuelve indistinguibles de una caída: el cliente no sabe si
corregir algo, reintentar o avisar al equipo. Ahora se traducen, **manteniendo el mensaje
genérico**:

| Código | Status | Qué significa |
|---|---|---|
| **23505** `unique_violation` | **409** | Ya existe una fila con esos datos |
| **23503** `foreign_key_violation` | **409** | Choca con otra fila relacionada |
| **23514** `check_violation` | **422** | El valor no cumple una regla de la base |

- **El 23503 no dice en qué sentido choca.** Una FK se viola de dos maneras —la fila
  referenciada no existe, o sigue referenciada y por eso no se puede borrar— y
  distinguirlas obligaría a mirar el nombre del constraint, que es justo lo que no debe
  salir. Un 409 cubre ambas sin filtrar cuál.
- **El 23514 va al 422 y no al 400** porque es exactamente el caso de la clase 22: el
  cuerpo pasó el esquema y el valor no sirve. Reutiliza su mismo mensaje, así que sigue
  habiendo **un solo 422 con un solo mensaje**.
- **Es una lista explícita, no la clase 23 entera:** `23502` (NOT NULL) y `23P01`
  (violación de exclusión) significan otra cosa —el backend dejó de mandar una columna
  obligatoria, que sí es un fallo nuestro— y siguen dando 500.
- **Nombres de constraint y `detail` nunca salen**, igual que en las clases 22 y 40: van
  al log del servidor con el método y la ruta.

**Lo que un service ya tradujo, manda.** La primera rama del manejador es la del error de
negocio (`{ status, message }`), así que
[`constructor.service.js`](../src/services/constructor.service.js) —que captura esos tres
códigos por `constraint` y dice **qué** choca: `Ya hay otro paso de este plato en esa
posición`— sale por ahí y nunca llega a la tabla genérica. Las rutas del constructor
conservan sus mensajes de §`Códigos 409`; el resto de la API gana los genéricos.

### 57014: la consulta tardó demasiado → 503

`La operación tardó demasiado y se canceló, vuelve a intentarlo en un momento`

PostgreSQL aborta una consulta cuando vence el `statement_timeout` del pool
(`PG_STATEMENT_TIMEOUT_MS`, 10 s por defecto — ver [`README.md`](../README.md)) y devuelve
**57014** `query_canceled`.

Es **503 y no 500** porque no se escribió nada (la transacción se abortó completa) y el
problema es de carga o de bloqueos, no de la petición: es momentáneo, y **reintentar más
tarde sí sirve**. Un 500 sugiere un bug del servidor y no invita a nada.

Es el segundo caso —con el 409 de concurrencia— en que reintentar tiene sentido, pero la
espera no es la misma: ante un 409 de concurrencia el cliente puede reintentar **ya, una
vez**; ante un 503 conviene dejar pasar unos segundos, porque lo que sobra es carga.

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
