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

Body: `{ "nombre": "Ana Ríos", "email": "ana@mail.com", "password": "12345678", "rol": "mesero" }`

`rol` es obligatorio y solo acepta `admin`, `mesero`, `cajero`, `cocina`.

`password`: mínimo **8 caracteres** (antes 6; el mismo que el cambio de clave y el que exige el
panel) y como mucho **72 bytes** en UTF-8 (ver
[La clave máxima: 72 bytes](#la-clave-máxima-72-bytes)).

201: `{ "usuario": { "id_usuario": 1, "nombre": "Ana Ríos", "email": "ana@mail.com", "rol": "mesero", "activo": true } }`

400: `{ "error": "Ese email ya está registrado" }` · 400 `{ "error", "motivo": "clave_demasiado_larga" }` · 401 sin token · 403 si el token no es de un admin

#### La clave máxima: 72 bytes

bcrypt solo usa los **primeros 72 BYTES** de una contraseña y descarta el resto **en
silencio**: con una clave más larga, cualquier texto con el mismo comienzo entraría. Por eso
toda clave que se **fija o cambia** (`POST /auth/register` y `POST /usuarios/:id/clave`, los
dos únicos sitios que llaman a `bcrypt.hash`) se rechaza si pasa de 72 bytes en UTF-8:

```json
400 { "error": "La contraseña no puede pasar de 72 bytes; las letras con tilde y los emojis ocupan más de uno", "motivo": "clave_demasiado_larga" }
```

- Se cuentan **bytes**, no caracteres: una `ñ` o una tilde son 2 bytes y un emoji, 4. 72 `a`
  entran; 25 `ñ` (50 bytes) entran; 37 `ñ` (74 bytes) no; 69 letras y un emoji (73 bytes, 70
  caracteres) no.
- Los **demás** 400 de validación de esas rutas no cambian de forma: `{ "error" }` sin
  `motivo`. El `motivo` solo acompaña a este caso, para que el panel lo distinga sin comparar
  textos.
- **El login no lleva tope**, a propósito: quien creó una clave más larga antes de esta regla
  sigue entrando con ella (bcrypt la compara truncada, igual que la guardó).
- **El mínimo es el mismo en las dos rutas: 8 caracteres** (`CARACTERES_MINIMOS_CLAVE`, en el
  mismo módulo), con 400 `{ "error": "La contraseña debe tener al menos 8 caracteres" }`. Se
  mide en **caracteres**, que es lo que la persona escribe y cuenta. Antes el registro pedía 6.
- **El login tampoco aplica el mínimo**: una clave de 6 o 7 caracteres creada antes sigue
  entrando.
- La regla vive en un solo sitio: `src/utils/clave-bcrypt.js`.

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

## Usuarios del personal (D-16)

Administración de las cuentas del personal. **Todo es solo de `admin`**, sin excepciones:
aquí se reparte quién entra y con qué permisos, así que no hay ninguna lectura
"inofensiva" que abrir a otro rol.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /usuarios | **admin** | Lista el personal |
| PATCH | /usuarios/:id | **admin** | Cambia `nombre`, `rol` y `activo` |
| POST | /usuarios/:id/clave | **admin** | Guarda una clave nueva |

El **alta** sigue en [`POST /auth/register`](#post-authregister--solo-admin), que ya es de
admin: no se duplica aquí. **No hay baja**: `usuarios` está referenciada por pedidos y
pagos, así que borrar una fila sería perder quién cobró qué. Lo que se hace es desactivar
(`activo: false`), que es lo que el middleware comprueba en cada petición (H-09).

**El hash de la clave no sale de ninguna de las tres rutas.** Las lecturas piden las
columnas una por una (`id_usuario`, `nombre`, `email`, `rol`, `activo`, `creado_en`), nunca
`SELECT *`, para que agregar una columna sensible a la tabla no la publique sola.

### GET /usuarios

200:

```json
{ "usuarios": [
  { "id_usuario": 1, "nombre": "Carlos Ospino", "email": "admin@mail.com",
    "rol": "admin", "activo": true, "creado_en": "2026-01-01T00:00:00.000Z" }
] }
```

Ordenada por `id_usuario`: es el orden de alta, que es estable (dos personas pueden
llamarse igual) y el que espera quien acaba de crear una cuenta y la busca al final.

### PATCH /usuarios/:id

Body, **todos los campos opcionales** pero al menos uno:

```json
{ "nombre": "Ana María Ríos", "rol": "cajero", "activo": false }
```

- El cuerpo es `.strict()`: una clave de más es **400**. El **`email` queda fuera a
  propósito**: es la credencial de entrada y la clave de unicidad de la tabla, así que
  cambiarlo es dar de alta otra identidad, no editar un perfil. Sin `.strict()`, un panel
  que reenviara la fila entera colaría `email` o `password_hash` y el `COALESCE` los
  ignoraría en silencio: quien llama creería haber cambiado algo que no cambió.
- Un cuerpo vacío `{}` es **400**: no es una edición.
- `rol` solo acepta `admin`, `mesero`, `cajero`, `cocina` — los del CHECK de la tabla.
  `comensal` **no** está: no es una fila de `usuarios`, es un rol que solo existe dentro
  del JWT de una mesa.
- `:id` tiene que ser un **entero positivo**, o **400**. Un usuario que no existe, **404**.
- Lo que no se manda **no se toca** (`COALESCE`), así que el panel puede enviar solo lo que
  cambió.
- 200 devuelve `{ "usuario": { … } }` con la fila actualizada, sin el hash.

#### Los dos 409

```json
{ "error": "No se puede dejar el sistema sin ningún admin activo: asciende o activa a otro antes." }
{ "error": "No puedes desactivarte ni cambiarte el rol a ti mismo: pídeselo a otro admin." }
```

- **Siempre tiene que quedar al menos un admin activo.** Sin esta regla, el último admin
  puede desactivarse o quitarse el rol y no queda nadie que pueda volver a repartir
  permisos: habría que entrar a la base a mano. Se comprueba **dentro de la transacción y
  con la fila bloqueada** (`SELECT … FOR UPDATE`), porque si no dos admins podrían
  desactivarse a la vez, cada uno viendo al otro como activo.
- **Un admin no puede desactivarse ni cambiarse el rol a sí mismo.** No es paternalismo: es
  el error que deja a alguien fuera de su propio panel, con la sesión abierta y sin forma
  de deshacerlo. **Otro** admin sí puede hacerlo, y cambiarse el **nombre** a sí mismo
  también se puede. Reafirmar el rol que ya se tiene no cuenta como cambio, para que un
  panel que reenvía el rol sin tocarlo no choque.
- Reactivar a alguien o devolverle el rol de admin **nunca** se bloquea: esas operaciones
  suman admins, no los quitan.

### POST /usuarios/:id/clave

Body: `{ "password": "clave-nueva-larga" }`, `.strict()`.

- **Mínimo 8 caracteres** (400 si no), el mismo que `/auth/register` desde que se igualaron.
  El mínimo se mide en **caracteres**, que es lo que la persona escribe y cuenta.
- **Máximo 72 BYTES** (no 72 caracteres), medidos con `Buffer.byteLength(clave, 'utf8')`.
  Es por bytes como trunca bcrypt: a partir del byte 72 ignora el resto **en silencio**. Y
  la diferencia no es teórica en español: una `ñ` o una tilde ocupan **dos** bytes en
  UTF-8, así que una clave de 40 caracteres puede pasarse de 72 bytes. Contando caracteres,
  esa clave entraría, bcrypt la cortaría por la mitad y el usuario acabaría con una
  contraseña que no es la que escribió. Rechazarla es mejor que cortarla sin avisar.
  Responde 400 `{ "error", "motivo": "clave_demasiado_larga" }`; es la misma regla que
  `POST /auth/register` (ver [La clave máxima: 72 bytes](#la-clave-máxima-72-bytes)), que
  antes no la tenía.
- Se guarda con el **mismo bcrypt y el mismo costo** que `/auth/register` (`COSTO_BCRYPT`,
  importado y no copiado): dos costos distintos en el proyecto producen hashes que el login
  reconoce pero que cuestan tiempos distintos, y eso es justo lo que evita H-12.
- 200 devuelve `{ "usuario": { … } }` **sin la clave ni el hash**: la respuesta de un cambio
  de clave no tiene ninguna razón para llevar la clave. **404** si el usuario no existe.

### La caché de usuario activo se invalida (H-09)

Al **desactivar**, **cambiar el rol** o **cambiar la clave** se borra la llave
`sd:usuario:{id}:activo`. Sin eso, el cambio tardaría hasta el TTL (60 s por defecto) en
surtir efecto, porque `estaActivo` contesta desde Redis sin preguntarle a la base: el token
de alguien recién desactivado seguiría abriendo la API hasta un minuto.

Se invalida **después del COMMIT**, no antes: hacerlo antes sería peor que no hacerlo, ya
que una petición en vuelo podría volver a cachear el valor viejo justo antes de que el
cambio se guarde. Cambiar **solo el nombre** no toca la caché: el middleware solo mira
`activo`, y tirar la llave por un nombre sería perder caché sin ninguna razón.

**Si Redis no responde, la operación NO falla**: el cambio ya está guardado en PostgreSQL,
que es quien manda, y lo único que se pierde es que tarde el TTL en verse.

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

### Límite de peticiones (H-04, H-27 y D-21)

Hay **tres** límites. Los dos de ruta cubren las públicas —las que no piden sesión
previa— y el global es un techo de respaldo para todo lo demás. Todos responden **429**
con `Retry-After` y el mismo cuerpo `{ "error": … }` que el resto de la API:

| Ruta | Límite por defecto | Clave del contador | Qué cuenta |
|---|---|---|---|
| `POST /auth/login` | **5 / minuto** | IP **+ email** | Solo los intentos **fallidos** |
| `POST /mesas/qr/:token/sesion` | **20 / minuto** | IP | Todos los intentos |
| **todas las demás** (D-21) | **2000 / minuto** | IP | Todas las peticiones |

Los contadores son **independientes**: una petición al login gasta cupo del límite de
login **y** del global, pero agotar uno no agota el otro.

```json
{ "error": "Demasiados intentos de inicio de sesión. Espera un momento y vuelve a intentarlo." }
```

La clave del login combina IP y email a propósito: por IP sola, una botnet esquiva el
límite; por email solo, cualquiera podría bloquear la cuenta de otro. Y solo cuentan los
fallos, para que un cajero que entra y sale varias veces no se bloquee a sí mismo. El QR
va más holgado porque una mesa entera escanea desde la misma IP del local, y ahí sí
cuentan los aciertos: reusar un token válido muchas veces por segundo tampoco debería
pasar.

#### El límite global (D-21)

```json
{ "error": "Demasiadas peticiones desde esta red. Espera un momento y vuelve a intentarlo." }
```

**No cuenta** dos cosas:

- **`GET /api/health`**: es la sonda de Docker y del balanceador. Si contara, un límite
  agotado haría que el contenedor se declarara enfermo y se reiniciara solo.
- **El canal interno**: `POST /api/transacciones/internal` y
  `GET /api/mesas/:id/cuenta/interno`. Los llama el socket-server con `x-internal-key`,
  toda esa máquina sale con **una** IP, y ya tienen su propia autenticación.

**Por qué 2000 por minuto, que parece muchísimo:** los comensales de un local comparten
**una sola IP pública**, la del wifi, así que el cupo no es de una persona sino del
restaurante entero. Con 20 mesas de 4 son 80 teléfonos y, en el pico, cada uno hace del
orden de 15 a 20 peticiones en ese minuto (80 × 20 = 1600), más las tablets del personal.
2000 deja pasar ese pico y aun así corta a una sola máquina que intente raspar la API: 33
por segundo sostenidos no los hace ningún comensal.

**Variables:** `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_VENTANA_MS`, `RATE_LIMIT_QR_MAX`,
`RATE_LIMIT_QR_VENTANA_MS`, `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_GLOBAL_VENTANA_MS`. Los
tres límites se desactivan solos dentro de las pruebas.

> **Detrás de un proxy** (nginx, Docker), `req.ip` es la IP del proxy y el límite contaría
> a todo el mundo como un solo visitante. Hay que poner **`TRUST_PROXY`** (`true`, un
> número de saltos, o una lista de IPs/rangos). Está **apagada por defecto**: confiar en
> `X-Forwarded-For` sin un proxy delante permite falsificar la IP.
>
> **Limitación:** el contador vive en memoria del proceso. Con varias instancias el límite
> es por instancia (con N instancias, el techo real es 5×N, o 2000×N en el global). Para
> hacerlo global de verdad haría falta un store compartido en Redis.

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

## Configuración del restaurante (D-16 parte B)

Los datos del local: cómo se llama, dónde está, a qué horas abre, en qué moneda cobra y
cuánta propina sugiere. Es **una sola fila** (`configuracion_restaurante`, `id = 1`, fijado
por el CHECK `ck_configuracion_fila_unica`), así que no hay nada que crear ni que borrar:
solo leer y actualizar. El script `database/scripts/26_configuracion.sql` ya inserta la fila
con los valores por defecto.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /configuracion | **No** | Los datos públicos del local (lista blanca) |
| GET | /configuracion/completa | **admin** | Todos los campos, incluida la auditoría |
| PUT | /configuracion | **admin** | Actualiza los campos enviados (parcial) |

### GET /configuracion — pública

Sin login: la PWA del comensal necesita el nombre, el horario, la moneda y la propina
sugerida **antes** de escanear nada, y son los mismos datos que cualquiera ve en la puerta
del local.

```json
{
  "nombre": "SmartDining",
  "telefono": "3001234567",
  "direccion": "Calle 1 #2-3",
  "url_logo": null,
  "horario": {
    "lunes": { "abre": "11:00", "cierra": "22:00" },
    "domingo": { "abre": "12:00", "cierra": "21:00" }
  },
  "propina_sugerida_pct": 10,
  "moneda": "COP",
  "correo": "hola@smartdining.co",
  "redes": {
    "instagram": "https://instagram.com/smartdining",
    "whatsapp": "+573001234567"
  }
}
```

Son **exactamente** esos nueve campos (los siete de siempre más `correo` y `redes`, del
script 29, para la sección "Nuestro restaurante" del sitio público), en una **lista blanca** y no un `delete` de lo
sensible: así una columna nueva en la tabla **no se publica sola** el día que alguien la
agregue. **`actualizado_en`, `actualizado_por` e `id` no salen por aquí**: dicen quién tocó
la configuración del local y cuándo, que es auditoría.

> La `COMMENT ON TABLE` de `26_configuracion.sql` menciona cinco campos públicos (sin
> `telefono` ni `direccion`). La lista de arriba es la que implementa el backend: el teléfono
> y la dirección de un restaurante son públicos —están en la carta y en la fachada— y la PWA
> los necesita para el pie de página. Queda anotado para alinear el comentario del script.

`propina_sugerida_pct` llega como **número** (10, 12.5), no como texto: el backend registra
un parser para `NUMERIC` (ver `src/config/db.js`). `horario` es un **objeto** por día; un día
ausente significa cerrado. `correo` es texto o `null` (sin correo publicado). `redes` es
**siempre un objeto**, `{}` si el local no tiene ninguna; solo trae las redes que tiene, con
las claves `instagram`, `facebook`, `tiktok` (URL `https`) y `whatsapp` (número E.164: el
enlace `wa.me` lo arma el frontend).

### GET /configuracion/completa — admin

Lo mismo más `id`, `actualizado_en` y `actualizado_por`:

```json
{
  "id": 1,
  "nombre": "SmartDining",
  "telefono": "3001234567",
  "direccion": "Calle 1 #2-3",
  "url_logo": null,
  "horario": { "lunes": { "abre": "11:00", "cierra": "22:00" } },
  "propina_sugerida_pct": 10,
  "moneda": "COP",
  "correo": "hola@smartdining.co",
  "redes": { "instagram": "https://instagram.com/smartdining" },
  "actualizado_en": "2026-11-08T12:00:00.000Z",
  "actualizado_por": 1
}
```

### PUT /configuracion — admin, parcial

Body con **los campos que se quieran cambiar**, al menos uno:

```json
{ "propina_sugerida_pct": 12.5, "moneda": "USD" }
```

**200** devuelve la configuración **completa ya actualizada**, con el `actualizado_en` y el
`actualizado_por` que acaba de poner el trigger: así el panel ve de una vez quién quedó
registrado como autor, sin una segunda llamada.

| Campo | Regla |
|---|---|
| `nombre` | Texto, 1–120 (la columna es `VARCHAR(120)`). No admite `null` (`NOT NULL`) |
| `telefono` | Texto hasta 30, o `null` |
| `direccion` | Texto hasta 200, o `null` |
| `url_logo` | Texto hasta 255, o `null` (quitar el logo es normal) |
| `horario` | **Objeto** JSON. La tabla lo exige con `ck_configuracion_horario_objeto`; un arreglo o un número son **400** aquí, no un 422 de la base |
| `propina_sugerida_pct` | Número **entre 0 y 30**, con **2 decimales como máximo** |
| `moneda` | **3 letras mayúsculas** (ISO 4217), como el CHECK `^[A-Z]{3}$` |
| `correo` | Texto hasta **254** con la forma `nombre@dominio.algo` (sin espacios ni dos arrobas), o **`null` para quitarlo**. Ausente = se conserva |
| `redes` | **Objeto** `.strict()` con las claves opcionales `instagram`, `facebook`, `tiktok` y `whatsapp`. Si viene, **reemplaza el objeto entero**: `{}` deja al local sin redes. **`null` es 400** (la columna es `NOT NULL`). Ausente = se conservan |

**Reglas de `correo` y `redes`.** Son **las mismas de la base** (script 29:
`ck_configuracion_correo` y `fn_redes_contacto_validas`), copiadas tal cual, y una prueba de
integración compara el veredicto de las dos en más de cincuenta casos:

| Red | Valor |
|---|---|
| `instagram` | `^https://([a-z0-9-]+\.)?instagram\.com/\S+$` **sin distinguir mayúsculas** (`https://instagram.com/x`, `https://www.instagram.com/x`, `https://m.instagram.com/x`) |
| `facebook` | `^https://([a-z0-9-]+\.)?(facebook\|fb)\.com/\S+$` sin distinguir mayúsculas (también `https://fb.com/x`) |
| `tiktok` | `^https://([a-z0-9-]+\.)?tiktok\.com/\S+$` sin distinguir mayúsculas |
| `whatsapp` | `^\+[1-9][0-9]{6,14}$`: E.164, con `+`, sin espacios, de 7 a 15 dígitos |

- Cada valor es **texto de 1 a 200 caracteres sin espacios**. Una red que no se usa **se
  omite**: `null` o `""` como valor de una red son **400**, igual que una clave desconocida
  (`twitter`) o un número en vez de texto.
- `http://` no vale (solo `https://`), ni un enlace sin perfil (`https://instagram.com/`), ni un
  dominio parecido (`https://xfacebook.com/…`).

```json
{ "correo": "hola@smartdining.co",
  "redes": { "instagram": "https://instagram.com/smartdining", "whatsapp": "+573001234567" } }
```

Errores de estos dos campos, **400 con `motivo`** (el resto de los 400 de este PUT conserva
`{ "error" }`):

```json
{ "error": "whatsapp debe ser el número en formato internacional, con + y sin espacios (+573001234567)", "motivo": "redes_invalidas" }
{ "error": "correo debe tener la forma nombre@dominio.com", "motivo": "correo_invalido" }
```

Si aun así la base rechazara el valor (23514 de `ck_configuracion_correo` o
`ck_configuracion_redes`, si algún día las reglas se separaran), sale el mismo **400** con
`correo_invalido` o `redes_invalidas`, no un 500. Los **demás** CHECK de la configuración
siguen yendo al manejador central (422 genérico).

- El cuerpo es `.strict()`: **una clave de más es 400**. En particular `actualizado_en`,
  `actualizado_por` e `id` **no se editan** —los pone el trigger, o el CHECK—, y sin
  `.strict()` el UPDATE los ignoraría en silencio: quien llama creería haber cambiado algo
  que no cambió.
- Un cuerpo vacío `{}` es **400**: no es una edición.
- Los límites de texto son los de las columnas, no inventados. El de los decimales es porque
  la columna es `NUMERIC(4,2)`: un tercer decimal se redondearía en silencio y el valor
  guardado no sería el que se mandó.
- **Es parcial de verdad**: el UPDATE se arma solo con las columnas enviadas, así que un PUT
  que manda el teléfono **no reescribe** el horario con un valor viejo que el cliente ni vio.

**El autor del cambio.** El UPDATE va en una **transacción** que primero hace

```sql
SELECT set_config('app.id_usuario', '<id del JWT>', true);
```

que es de donde el trigger `tr_configuracion_actualizada` saca `actualizado_por` (vía
`fn_usuario_de_sesion()`). El tercer argumento en `true` (`is_local`) hace que el valor viva
**solo hasta el fin de la transacción**: así no se filtra a la siguiente petición que use esa
conexión del pool. El id sale **del JWT**, nunca del cuerpo.

---

## Mesas activas e inactivas (D-16 parte B)

`mesas.activa` permite **retirar una mesa del servicio sin borrarla** (ADR-06). Hace falta
porque una mesa con pedidos **no se puede borrar**: `DELETE /mesas/:id` responde 409 para no
perder el historial. Desactivarla es la única salida real.

Una mesa inactiva **no se abre, no recibe QR y no aparece como disponible**: lo impone el
trigger `tr_validar_mesa_activa` y las funciones `obtener_mesa_por_qr` y
`obtener_mesas_disponibles` del script 26.

`activa` sale ahora en **todas** las respuestas de mesa (la vista pública y la del personal).

### Cambiarla: `PATCH /mesas/:id` — admin

Es la misma ruta del alta/baja del mobiliario (D-16 parte A), que es justo de lo que se
trata; `estado` sigue teniendo la suya (`PATCH /mesas/:id/estado`).

```json
{ "activa": false }
```

`activa` es **booleano estricto**: `"false"`, `0` o `null` son **400**. Se puede mandar junto
con `numero`, `capacidad` y `ubicacion`.

### 409 `mesa_ocupada` — una mesa ocupada no se desactiva

```json
{ "error": "Esa mesa está ocupada: libérala antes de desactivarla.", "motivo": "mesa_ocupada" }
```

Lo único que impide desactivar es que **haya gente sentada** (`estado = 'ocupada'`): si se
desactiva con comensales dentro, su sesión queda abierta y sin forma de cerrarla por el camino
normal. Se comprueba **en el backend, con la fila bloqueada, antes de tocar la base**: así el
mensaje dice qué pasa y qué hacer, y no se gasta un viaje para que el trigger lo rechace.

Un `token_qr` en una mesa **`disponible` no bloquea**: es el resto de una sesión que ya
terminó —el cierre deja el token hasta la próxima rotación—, así que no hay nadie a quien
dejar colgado.

**Al desactivar se borra el token**, en la **misma sentencia** del `UPDATE`
(`token_qr = CASE WHEN $5 IS FALSE THEN NULL ELSE token_qr END`): una mesa inactiva no
conserva un QR, o quedaría un código impreso que escanea a una mesa fuera de servicio. El
`CASE` solo dispara cuando `activa` llega en `false`: si el campo no viene, o viene en `true`,
**el token no se toca**.

**Reactivar nunca se bloquea**, ni con la mesa ocupada: activar no quita nada a nadie. Y
reafirmar `activa: false` en una mesa que ya lo está tampoco choca con la guarda.

### 409 `mesa_inactiva` — una mesa inactiva no se abre ni recibe QR

```json
{ "error": "Esa mesa está inactiva: actívala antes de abrirla o de generarle un QR.", "motivo": "mesa_inactiva" }
```

Lo rechaza el trigger con **SQLSTATE 23514** (`check_violation`), y lo devuelven
`POST /mesas/:id/abrir` y `POST /mesas/:id/rotar-qr`. **Sin traducirlo** el manejador central
lo convertiría en un **422** genérico («un dato está fuera del rango permitido»), que no dice
ni qué mesa ni qué hacer: son reglas de sala, así que salen como 409 con su `motivo`.

El mismo 23514 en el `PATCH` de `activa` sale como **409 `mesa_ocupada`**: es la red de
seguridad para los caminos que la guarda del backend no ve (una consulta a mano, o una
carrera entre el `SELECT` y el `UPDATE`). Cualquier **otro** SQLSTATE sube como venía, para no
tapar un CHECK distinto de la misma tabla.

> La convención de errores de esta API es **`{ error, motivo }`**. `motivo` es el código
> estable que el cliente compara; `error` es el texto para leer. No se usa `codigo`.

---

## Historial de precios (D-16 parte B)

Cada cambio de `platos.precio` y de `ingredientes.precio_extra` queda en
`historial_precios`, con quién lo hizo. Lo escriben los triggers
`tr_historial_precio_plato` y `tr_historial_precio_ingrediente`, y **solo cuando el valor
cambia de verdad**: un `PUT` que reenvía la fila entera sin tocar el precio no deja filas
vacías (el `WHEN` del trigger).

**Lo que le toca al backend es el autor.** Los triggers lo sacan de `app.id_usuario`, que se
fija con `set_config(..., true)` y vive **solo dentro de la misma transacción**. Por eso:

- `PUT /platos/:id` pasó a ser **transaccional** (antes era un `pool.query` suelto: el
  `set_config` y el `UPDATE` podían salir por **conexiones distintas** del pool y el
  historial quedaba con `id_usuario` NULL).
- `PUT /ingredientes/:id` y `PATCH /ingredientes/:id/disponible` ya eran transaccionales:
  solo se agregó el `set_config` al inicio.

El id sale **del JWT** (`req.user.id_usuario`), nunca del cuerpo. `historial_precios.id_usuario`
puede quedar en NULL: un cambio anterior a D-16 B, una consulta a mano, o un usuario que
después se borró (la FK es `ON DELETE SET NULL`).

### GET /platos/:id/historial-precios — admin

Los cambios de precio de un plato, **los más recientes primero**.

```json
{
  "historial": [
    {
      "id": 12,
      "tipo": "plato",
      "id_referencia": 7,
      "precio_anterior": 28000,
      "precio_nuevo": 30000,
      "id_usuario": 1,
      "cambiado_en": "2026-11-08T12:00:00.000Z"
    }
  ]
}
```

- `:id` tiene que ser un **entero positivo**, o **400**. Un plato que no existe, **404**.
- Un plato sin cambios devuelve `{ "historial": [] }`.
- `?limite=` acota el número de filas (1–500, por defecto 100).
- `id_usuario` puede ser `null` (ver arriba). No se devuelve el nombre del usuario: esta
  ruta no es un reporte, y unir con `usuarios` publicaría datos del personal en una lista que
  el panel ya sabe resolver.
- El orden sale gratis: el índice `idx_historial_precios_referencia` es exactamente
  `(tipo, id_referencia, cambiado_en DESC)`.

---

## Platos: `personalizable` y `calorias`

Las dos columnas existían desde `13_constructor.sql`, pero el esquema de `POST /platos` y
`PUT /platos/:id` no las aceptaba, así que un cuerpo que las mandara **las perdía en
silencio**. Ahora son **opcionales** en los dos:

| Campo | Regla |
|---|---|
| `personalizable` | Booleano. Decide si el plato se arma por pasos en el constructor |
| `calorias` | Entero **≥ 0**, o `null` ("no se sabe", que es distinto de 0) |

Si no se envían, **el comportamiento no cambia**: el plato conserva lo que tenía.

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
| **GET** | **/platos/:id/historial-precios** | **admin** | **Cambios de precio, el mas reciente primero (D-16 B)** |

```json
{
  "id_plato": 12, "id_categoria": 3, "nombre": "Bandeja paisa", "descripcion": "...",
  "precio": 28000, "url_imagen": "https://...", "disponible": true,
  "tiempo_preparacion_estimado": 20
}
```

#### Cuerpo de POST y PUT /platos

| Campo | Obligatorio al crear | Regla |
|---|---|---|
| `nombre` | Sí | Texto, 1–120 |
| `precio` | Sí | Número > 0. Cabe en `DECIMAL(10,2)`: más allá es **422** (desbordamiento), no 500 |
| `id_categoria` | Sí | Entero. Si la categoría no existe, **409 `categoria_inexistente`** |
| `descripcion`, `url_imagen` | No | Texto; `url_imagen` tiene que ser una URL. Son **nullable**: ponerlas en `null` las borra |
| `disponible` | No (por omisión `true`) | Booleano |
| `tiempo_preparacion_estimado` | **No** | Entero > 0. **Si no se envía, queda en 15**, el `DEFAULT` de la columna (`database/schema.sql:105`) |
| `personalizable` | No (por omisión `false`) | Booleano. Decide si el plato se arma por pasos en el constructor |
| `calorias` | No (por omisión `null`) | Entero ≥ 0, o `null` ("no se sabe", distinto de 0) |

> **Issue #132.** `tiempo_preparacion_estimado` ya era opcional en el esquema, pero el INSERT
> mandaba `NULL` explícito en esa columna, y un `NULL` **pisa el `DEFAULT`**: la columna es
> `NOT NULL DEFAULT 15`, así que PostgreSQL rechazaba la fila con 23502 y **`POST /platos` sin
> ese campo daba 500**. Ahora el INSERT usa `COALESCE($7, 15)`.
>
> En el mismo arreglo, **`personalizable` y `calorias` se guardan también al CREAR**: el
> esquema las aceptaba desde D-16 B, pero solo el `PUT` las escribía, así que un `POST` que las
> mandara las perdía en silencio. Lo cubre
> `backend/tests/integracion/platos-sql.test.js` contra PostgreSQL de verdad.

**Nada de un cuerpo válido acaba en 500:**

| Caso | Respuesta |
|---|---|
| Falta un campo, o un tipo o rango no es el declarado | **400** con el campo que falla (zod) |
| `id_categoria` que no existe | **409** `{ "error": "Esa categoria no existe", "motivo": "categoria_inexistente" }` |
| **El usuario del token ya no existe** (solo en el `PUT`, y solo si cambia el precio) | **409** `autor_inexistente` (ver [El autor que ya no existe](#el-autor-que-ya-no-existe-409-autor_inexistente)) |
| Un valor que no cabe en la columna (precio enorme) | **422** con el mensaje genérico de "dato fuera de rango" |
| Un `CHECK` de la base (precio negativo llamando al servicio suelto) | **422** |

> El modelo ER no tiene `personalizaciones` ni `alergenos` en `platos`: ese campo se
> eliminó del backend. Las preferencias del comensal van por ítem del pedido, en
> `detalles_pedido.notas_especiales`.
>
> `alergenos` (en `ingredientes`) sale por `GET /menu`, no por estas rutas.

#### `disponible`, `stock_suficiente` y el efectivo

`GET /platos` y `GET /platos/:id` devuelven la fila de la base, así que traen **las dos
columnas** de disponibilidad por separado. Son cosas distintas y el panel necesita las dos:

| Campo | Quién lo mueve | Qué significa |
|---|---|---|
| `disponible` | **La cocina**, con `PATCH /platos/:id/disponible` (y el admin con el `PUT`) | El **interruptor manual**: "se acabó" / "volvió". Es una decisión de una persona |
| `stock_suficiente` | **La base**, sola (P-19, `database/scripts/27_inventario.sql`) | Si el **inventario** alcanza para una unidad del plato. El backend **nunca** lo escribe. Un plato **sin receta** lo tiene en `true`: no controla inventario |
| *efectivo* | — | `disponible AND stock_suficiente`: **lo que ve el comensal**. No es una columna; lo publica `v_carta_disponible` como `disponible_efectivo` |

```json
{ "id_plato": 12, "nombre": "Arepa de Huevo", "disponible": true, "stock_suficiente": false }
```

Ese plato **no se puede pedir** (da **409 `sin_stock`**) aunque `disponible` sea `true`: la
cocina lo dio por repuesto, pero falta un insumo de su receta. Quien pinta una carta tiene que
mirar **las dos**, nunca `disponible` a secas:

- `GET /menu` ya hace la cuenta y **solo trae lo pedible**, así que la PWA del comensal no
  necesita estos campos.
- Un panel de administración (KDS de agotados, pestaña de Menú del restaurante) sí los
  necesita, porque tiene que **distinguir por qué** está agotado: el interruptor se puede
  cambiar con un botón, el stock no. Con solo `disponible`, un plato agotado por inventario
  se ve "DISPONIBLE" al recargar (issue #137).
- `motivo` de `GET /inventario/carta` dice lo mismo ya resuelto: `"manual"` o `"stock"`,
  y el manual gana cuando los dos están apagados.

**Los avisos en vivo llevan el EFECTIVO, en los tres caminos** (issue #136). El payload de
`plato:disponibilidad` e `ingrediente:disponibilidad` tiene **un solo** booleano, y es el AND:

| Camino | Quién avisa |
|---|---|
| `PATCH /platos/:id/disponible` y `PATCH /ingredientes/:id/disponible` | El controlador, con `disponible AND stock_suficiente` de la fila que acaba de guardar |
| Canal `inventario` de PostgreSQL | El oyente, con el `disponible` del payload, que la base ya calcula como el efectivo |
| Arranque y reconexión del canal | El oyente, con `disponible_efectivo` de `v_carta_disponible` |

Un solo booleano porque el evento va **a todos los sockets**, incluidas las mesas: a un
comensal le da igual por qué no hay arepa. Quien necesita el detalle lo pide por REST.

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

> **El `disponible` del aviso es el EFECTIVO, no el interruptor (issue #136).** Lo que viaja
> es `disponible AND stock_suficiente`, igual que en los otros dos caminos. Así que **encender
> a mano un plato sin stock responde 200 y deja el interruptor en `true`, pero avisa
> `disponible: false`**: la cocina queda apuntada como "este plato sí se puede hacer", y el
> plato volverá solo cuando haya inventario. Antes se mandaba el interruptor a secas, y la PWA
> y el KDS lo mostraban disponible mientras pedirlo daba **409 `sin_stock`**.
>
> La cuenta vive en un solo sitio (`src/services/disponibilidad-efectiva.js`) para que todos los
> tres caminos no puedan discrepar otra vez. El **cuerpo de la respuesta** sigue siendo la
> fila de la base, con sus dos columnas por separado: el panel necesita saber cuál de las dos
> apagó el plato.

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
- Un error de la base **no** se cachea.

#### Qué invalida `cache:menu`

Todo lo que cambia lo que ve el comensal borra la clave con `invalidarMenu()`, así que el
cambio se ve de inmediato sin esperar el TTL. Son **tres** caminos, y hacen falta los tres:

| Camino | Qué lo dispara |
|---|---|
| **Rutas REST de la carta** | `POST`/`PUT`/`DELETE` de `/platos` y `/categorias`, y las 6 escrituras del constructor (pasos e ingredientes) |
| **Avisos de disponibilidad** del canal `inventario` | Cualquier cambio de `stock_suficiente` de un plato o de una opción: un **pedido que consume stock**, un movimiento de inventario, una receta nueva, un insumo activado o desactivado |
| **Escrituras de inventario** | `POST /inventario/insumos`, `PUT /inventario/insumos/:id`, `POST /inventario/insumos/:id/movimientos`, `PUT /platos/:id/receta` y `PUT /ingredientes/:id/receta`, **después del COMMIT** |

> **Por qué el segundo camino (issue #135).** La disponibilidad por **stock** la cambia la
> **base**, no una ruta: un pedido que consume el último queso no pasa por ningún endpoint de
> la carta. Solo avisa por `pg_notify('inventario')`, y el oyente
> (`services/inventario-avisos.js`) no invalidaba nada: durante **hasta 60 s** el menú seguía
> ofreciendo un plato ya agotado. El comensal lo pedía y recibía un 409 `sin_stock` por algo
> que la carta le decía que había.

- La invalidación por aviso ocurre **antes** de reenviarlo al socket-server y **aunque el
  reenvío falle**: si el socket-server está caído, el aviso en vivo se pierde, pero la
  siguiente petición tiene que ver la carta real.
- **Al arrancar y en cada reconexión del canal** se invalida también, después de
  `fn_recalcular_toda_la_carta()`: mientras el backend no estaba escuchando, el stock pudo
  cambiar y el caché puede tener una carta anterior.
- El tercer camino es **redundante a propósito** (el aviso ya cubre el caso) y cuesta un `DEL`:
  cubre al admin que edita y recarga en el mismo segundo, sin depender de cuándo llegue el
  `NOTIFY`. **No se invalida por cada pedido**: el caché dejaría de servir en hora punta, y el
  stock que consume un pedido ya avisa por el canal.
- Con Redis caído, `invalidarMenu()` tampoco falla: devuelve `false` y la operación que la
  llamó sigue su curso.

**La carrera entre una lectura y una invalidación.** Una petición puede empezar a leer la base,
cambiar el stock mientras tanto, y terminar guardando en el caché el menú **viejo** —ya
invalidado— que el TTL mantendría 60 s. `menu.service.js` lleva un contador de **versión** que
`invalidarMenu()` incrementa: `obtenerMenu()` lo anota antes de consultar y **guarda solo si no
cambió** durante la lectura. Si cambió, responde con lo que leyó (como mucho, un instante
desfasado) pero no lo cachea, y la siguiente petición vuelve a leer. Es un contador en memoria
porque el backend corre en **un** proceso; no necesita Redis.

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

> **El `disponible` del aviso es el EFECTIVO (issue #136)**, igual que en platos:
> `disponible AND stock_suficiente`. Reponer a mano una opción cuyo insumo se agotó responde
> 200 y deja el interruptor encendido, pero avisa `disponible: false`, así que el constructor
> no la ofrece hasta que haya inventario. La respuesta incluye **`stock_suficiente`** junto a
> `disponible`, para que el panel vea cuál de las dos la apagó (ver
> [la tabla de los tres campos](#disponible-stock_suficiente-y-el-efectivo)).

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

`detalles_ingredientes.id_ingrediente` es `ON DELETE RESTRICT` a propósito, para que todos los
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
| **POST** | **/mesas/:id/rotar-qr** | **mesero, admin** | **Cambia el QR de una mesa `ocupada` y avisa a la tablet. Con `{ "solo_si_vacia": true }`, 409/503 si ya hay comensales (#174)** |
| **POST** | **/mesas/:id/liberar** | **mesero, admin** | **Cierra la mesa: `disponible` y `token_qr` a NULL. 409 si tiene pedidos abiertos** |
| POST | /mesas/qr/:token/sesion | No | Abre la sesión del comensal y devuelve su JWT |
| GET | /mesas/:id | No | Obtiene una |
| POST | /mesas | admin | Crea |
| PATCH | /mesas/:id/estado | admin, cajero, mesero | Cambia estado (`disponible`, `ocupada`, `reservada`, `mantenimiento`) |
| **PATCH** | **/mesas/:id** | **admin** | **Edita `numero`, `capacidad` y `ubicacion` (D-16, ver abajo)** |
| DELETE | /mesas/:id | admin | Elimina. **409 si está ocupada o tiene pedidos** (ver abajo) |
| **POST** | **/mesas/:id/comensales** | **mesero, admin** | **Da de alta a alguien sin celular (D-18, ver abajo)** |
| **DELETE** | **/mesas/:id/comensales/:alias** | **mesero, admin** | **Lo quita de la mesa (D-18, ver abajo)** |

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

### PATCH /mesas/:id — editar el mobiliario (D-16), solo `admin`

Body, **todos opcionales** pero al menos uno:

```json
{ "numero": 12, "capacidad": 6, "ubicacion": "Terraza" }
```

- `.strict()`: una clave de más es **400**. **`estado` y `token_qr` no se aceptan aquí.** El
  estado tiene su propia ruta (`PATCH /mesas/:id/estado`, con otros permisos: también
  mesero y cajero) porque moverlo es la operación del salón, con su propia lógica de
  `sesion_iniciada_en`; y el `token_qr` es una credencial que solo escribe el flujo de
  apertura. Esto es el alta/baja del mobiliario, que es de admin.
- Un cuerpo vacío es **400**. `numero` y `capacidad` son **enteros positivos**; `ubicacion`
  no puede ir vacía (máx. 50, como la columna).
- Una mesa que no existe, **404**. Lo que no se manda **no se toca** (`COALESCE`).
- 200 devuelve la **vista del personal**: `id_mesa`, `numero`, `capacidad`, `ubicacion`,
  `estado` y `sesion_abierta`. Nunca el `token_qr`.
- `actualizado_en` y `version_control` los pone el trigger
  `tr_control_concurrencia_mesa`: el backend no los escribe.

#### Los dos 409

```json
{ "error": "Ya hay otra mesa con ese número" }
{ "error": "Esa mesa está ocupada: no se puede cambiar su número mientras haya gente sentada. Libérala primero." }
```

- **Número repetido**: lo impone el `UNIQUE` de `mesas.numero`. El 23505 se traduce aquí con
  un mensaje que dice **qué** choca, en vez del "Ya existe un registro con esos datos"
  genérico del manejador central.
- **Una mesa ocupada no se renumera.** El número es lo que la gente ve en el QR impreso, lo
  que grita el mesero y lo que el comensal confirma al escanear: cambiárselo con gente
  sentada y pedidos en marcha deja los tiquetes de cocina apuntando a una mesa que ya no
  existe con ese nombre. **Capacidad y ubicación sí** se pueden corregir con la mesa
  ocupada, porque no identifican nada. Mandar el **mismo** número que ya tiene no cuenta
  como renumerar.

Todo va en una transacción con la fila **bloqueada** (`FOR UPDATE`): sin el bloqueo, el
estado podría cambiar entre la comprobación y el `UPDATE`.

### DELETE /mesas/:id — por qué puede responder 409

Cuando **sí** se puede borrar, el comportamiento es el de siempre: **204** sin cuerpo, y
**404** si la mesa no existe. Lo que cambia (D-16) es que las dos razones por las que no se
puede se comprueban **antes** y se explican:

```json
{ "error": "Esa mesa está ocupada: libérala antes de borrarla." }
{ "error": "Esa mesa tiene pedidos registrados: no se puede borrar sin perder el historial. Déjala en mantenimiento si ya no se usa." }
```

- **Mesa `ocupada`**: antes se borraba con **204** si todavía no tenía pedidos (recién
  abierta), y dejaba una sesión de QR viva apuntando a una mesa que ya no existe.
- **Mesa con pedidos**: el `ON DELETE RESTRICT` de `fk_pedidos_mesa` ya lo impedía, pero el
  error llegaba al manejador central y salía como el **409 genérico** ("La operación choca
  con otro registro relacionado"), que no dice ni cuál es el problema ni qué hacer.
- Se cuentan **todos** los pedidos, no solo los abiertos: el `RESTRICT` no distingue
  estados, así que uno pagado de hace un mes impide el borrado igual que uno en curso. Y
  con razón: borrar la mesa dejaría el histórico sin a qué mesa pertenecía.
- Si el conteo no se puede leer, **no se borra**: es más seguro negar el borrado que
  llevarse por delante el historial de una mesa.

Las dos comprobaciones van dentro de la transacción y con la fila bloqueada, para que no se
cuele un pedido entre el conteo y el `DELETE`.

### Comensales sin celular (D-18) — `mesero`, `admin`

Alguien se sienta en la mesa **sin teléfono**: no puede escanear el QR, así que no tiene
sesión ni alias propio. El personal de sala lo da de alta con su alias y pide por esa
persona. A partir de ahí cuenta como una persona más de la mesa, su consumo sale aparte en
la cuenta por comensal y puede pagar en caja con su alias.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| **POST** | **/mesas/:id/comensales** | **mesero, admin** | Da de alta a alguien sin celular |
| **DELETE** | **/mesas/:id/comensales/:alias** | **mesero, admin** | Lo quita de la mesa |

**No hay tabla nueva ni cambios en `database/`.** La persona sin celular vive en la **misma
reserva de alias** que las sesiones de QR (`sd:mesa:{id}:alias` en Redis, ver
[§`POST /mesas/qr/:token/sesion`](#post-mesasqrtokensesion--punto-de-entrada-del-comensal)),
con **la misma función de validación** (`normalizarAlias` de
`src/services/alias-comensal.js`, regla R-18). Dos formas de validar el alias en el mismo
proyecto acabarían aceptando en una lo que la otra rechaza, y entonces la unicidad —que es
lo que impide cargarle los platos a otro— dejaría de valer.

#### POST /mesas/:id/comensales

Body: `{ "alias": "Abuela" }`

- El alias sigue la **regla R-18**: NFC, sin espacios a los lados y sin dobles espacios, de
  2 a 40 caracteres, solo letras, marcas, números, espacio y `. _ ' -`. La unicidad se mide
  por **clave** (sin tildes, en minúsculas, sin espacios ni `. _ ' -`), así que «Abuela»,
  «abuela» y «Abuéla» son la misma persona. Un alias inválido es **400** con
  `{ "error": …, "campo": "alias" }`.
- **«General» está prohibido (D-18c).** Es el nombre que `obtener_cuenta_mesa` le pone al
  cajón de los ítems **sin dueño** (`COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')`),
  no una persona. Registrar a alguien así mezclaría su consumo con lo que todavía no es de
  nadie: su cuenta mostraría platos que no pidió y los platos sin dueño quedarían cobrados a
  esa persona. Se rechaza con **400** como cualquier otro alias inválido.

  Se compara por **clave**, igual que la unicidad, así que «General», « general », «GENERAL»
  y «Géneral» quedan fuera. Un nombre que solo **contiene** la palabra —«General Pérez»,
  «Generalísimo»— es válido: la clave tiene que ser **exactamente** la reservada.
- `:id` tiene que ser un **entero positivo**, o **400**. Una mesa que no existe, **404**.
- **201** devuelve `{ "id_mesa": 5, "alias": "Abuela" }` con el alias **tal como quedó
  reservado**: el escrito ya normalizado o, si esa persona ya tenía platos, el texto con el
  que aparece en la cuenta (ver abajo). **Puede no ser el que se mandó**, y es el que habrá
  que usar para pedir y para quitarlo después.

**El orden de las comprobaciones es parte del contrato:**

1. alias válido → **400**
2. la mesa existe → **404**
3. la mesa tiene **sesión abierta** (`estado = 'ocupada'`) → **409**
4. si esa persona **ya tiene platos en la cuenta**, se usa el texto de la cuenta (abajo)
5. reservar el alias → **409** si ya está en uso, **503** si no hay Redis
6. avisar al socket-server

El paso 3 va **antes** de los demás a propósito: al revés quedaría un alias reservado en una
mesa que nadie va a usar, y ese nombre no se podría volver a dar de alta hasta que venciera.
Una mesa sin sesión no llega ni a leer la cuenta.

#### Si ya tiene platos, se reserva el texto de la cuenta

Antes de reservar se mira la cuenta de la mesa (la misma fuente que
`GET /mesas/:id/cuenta`) buscando por **clave**. Si esa persona ya aparece ahí **con platos**
(`items_pedidos > 0`), se reserva **el texto con el que aparece en la cuenta**, no el que
escribió el mesero, y es ese el que viaja en el aviso y el que devuelve el **201**:

```http
POST /api/mesas/5/comensales
{ "alias": "abuela" }
```

```json
{ "id_mesa": 5, "alias": "Abuela" }
```

**Por qué.** Si «Abuela» ya tiene platos, su reserva vence (24 h) y el mesero la registra de
nuevo escribiendo «abuela», la reserva nueva quedaría como «abuela» mientras sus platos
viejos siguen como «Abuela»: la cuenta agrupa por **texto exacto** y se partiría otra vez en
dos filas. Reservando el texto de la cuenta, los platos nuevos caen en la fila que ya existe.

- Se devuelve el texto **tal como está en la cuenta**, no su forma normalizada: es el valor
  por el que la base agrupa, y guardar otro crearía una tercera fila.
- **Si hay varios textos distintos con la misma clave** —porque se escribió de dos formas
  antes de que esto existiera— gana el que tiene **más platos**; con **empate**, el
  **primero en el orden de la cuenta**. Es determinista, que es lo que importa para que dos
  llamadas seguidas no contesten distinto.
- La fila **`General`** se ignora: no es una persona, la pone la propia función SQL para los
  ítems sin comensal.
- Un texto de la cuenta que **ya no sería un alias válido** (un dato viejo escrito a mano) se
  ignora y se usa el alias escrito.
- **Si la cuenta no se puede leer, el alta NO se bloquea**: se usa el alias escrito y queda
  un aviso en el log **sin el alias**, solo con el `id_mesa`. Lo peor que pasa es que la
  cuenta quede partida, y eso se arregla; no poder sentar a una persona, no.
- Si **nadie** con esa clave aparece en la cuenta, todo igual que antes: se reserva el alias
  escrito, ya normalizado.
- El **409 `alias_en_uso`** no cambia: si la clave ya está reservada, da igual cómo se
  escriba.

**El panel debe usar el `alias` que devuelve este 201** en los `POST /pedidos` siguientes:
puede no ser el que escribió el mesero.

```json
{ "error": "Esa mesa no tiene una sesión abierta: ábrela antes de agregar comensales", "motivo": "mesa_sin_sesion" }
{ "error": "Ese nombre ya lo usa otra persona en la mesa, elige otro", "motivo": "alias_en_uso" }
{ "error": "No se pudo agregar al comensal, intenta de nuevo en unos segundos", "motivo": "alias_no_disponible" }
```

**El 409 `alias_en_uso` trae el alias guardado** (revisión del #119), en un campo `alias`
**opcional**:

```json
{ "error": "Ese nombre ya lo usa otra persona en la mesa, elige otro", "motivo": "alias_en_uso", "alias": "Abuela" }
```

- Es el texto **tal como está guardado**, no el que se envió: con «Abuela» ya reservada, un
  `POST` con `abuela` devuelve `"alias": "Abuela"`. Sirve para que el panel ofrezca pedir
  para esa persona en vez de inventar otro nombre.
- **Puede faltar.** Si la reserva no se puede leer (Redis no responde, el valor guardado no
  tiene texto legible, o la lectura falla), el 409 sale igual que antes, **sin** `alias`. Nunca
  se convierte en 500 ni en 503 por esto: el cliente tiene que tratar `alias` como opcional.
- No se registra en el log.
- **El 409 de la sesión por QR (`POST /mesas/qr/:token/sesion`) NO lo trae**, a propósito:
  quien escanea el QR no es personal, y devolverle el texto exacto le daría el nombre de otra
  persona de la mesa para entrar como ella.

El **503 `alias_no_disponible`** es el mismo comportamiento que las sesiones de QR: sin
Redis no hay unicidad garantizada, y una mesa sin unicidad de alias permite cargarle los
platos a otra persona, así que **falla cerrada** y no se da de alta a nadie.

**El alta MARCA el alias.** El valor guardado en el hash pasa de `{ alias, en }` a
`{ alias, en, sin_celular: true }`. **El flujo de las sesiones de QR no cambia**: sigue
guardando `{ alias, en }`, sin la marca. Es lo único que permite distinguir después a una
persona que agregó el personal de una que entró con su celular, y de eso depende el 409 del
`DELETE` (ver abajo).

**La reserva dura 24 h**, no las 3 h por defecto de `reservar`. Las 3 h son la vida del JWT
del comensal: cuando su token caduca, su reserva puede caducar con él. Aquí no hay JWT que
caduque —la persona no tiene teléfono— y lo que manda es la lista
`sd:mesa:{id}:sin_celular` del socket-server, que vive 24 h igual que `pagaron`. Con 3 h el
alias se liberaría a media tarde y otro comensal podría reservar el mismo nombre mientras
la persona sigue sentada.

La vigencia vive en **una sola constante** del backend
(`VIGENCIA_SIN_CELULAR` en `src/services/alias-comensal.js`), con la nota de que **debe
coincidir** con el TTL de `sd:mesa:{ID}:sin_celular` del socket-server: son dos servicios
guardando la misma persona en dos sitios, y si se desalinean, el nombre queda bloqueado en
uno después de que el otro ya lo olvidó, o al revés.

**Latencia máxima del POST.** Este endpoint **espera** el aviso (ver abajo por qué), así que
en el peor caso tarda lo que tarden los reintentos. Con los valores reales de hoy —3
intentos, 150 ms entre ellos y `SOCKET_TIMEOUT_MS` de **1500 ms por intento**— el tope es:

```
3 x 1500 ms (intentos) + 2 x 150 ms (esperas) = 4800 ms
```

Ese tope solo se alcanza si el socket-server responde `ERROR_INTERNO` **justo antes** de
agotar el timeout, tres veces seguidas. Los casos corrientes son mucho más cortos: un
socket-server **caído** o una ruta **inexistente** responden al instante y **no se
reintentan** (un intento, milisegundos); un **timeout** tampoco se reintenta, así que son
**1500 ms** como mucho; y tres `ERROR_INTERNO` rápidos son ~300 ms de esperas más los
viajes. Subir `SOCKET_TIMEOUT_MS` sube este tope de forma proporcional.

#### DELETE /mesas/:id/comensales/:alias

El alias va en la URL (porcentaje-codificado) y se **normaliza igual** que al agregar, así
que `/comensales/abuela` quita a «Abuela».

**Comprueba, en este orden:**

1. la mesa existe → **404**
2. el alias es de un comensal **sin celular** → **409** si es de alguien que entró por QR
3. no tiene platos → **409**
4. soltar la reserva → **503** si Redis no responde

El paso 2 va **antes** del 3 y del 4 a propósito: es lo único que protege la sesión de un
comensal conectado.

- **204** sin cuerpo cuando se quita. Mesa inexistente, **404**; alias inválido, **400**.
- **409 `comensal_con_sesion`** si ese alias **no lleva la marca** `sin_celular`:

```json
{ "error": "Esa persona entró con su celular: su sesión no se puede quitar desde aquí", "motivo": "comensal_con_sesion" }
```

  Este endpoint es para las personas que agregó el personal. Soltar la reserva de alguien
  que entró por QR dejaría su nombre **libre para otro**, que heredaría sus platos en el
  desglose por comensal; y su sesión seguiría viva, porque el alias va firmado dentro de su
  JWT. Para cerrar la sesión de una mesa está `POST /mesas/:id/liberar`.

  **Compatibilidad:** una reserva hecha **antes** de este cambio no tiene la marca, así que
  se trata **como de QR** y **no se puede quitar** con este endpoint. Es deliberado: no hay
  forma de saber a posteriori de dónde salió, y equivocarse hacia «no la toques» cuesta un
  409, mientras que hacia el otro lado cuesta la sesión de un comensal. Esas reservas
  vencen solas (3 h o 24 h según cómo se crearan) y las nuevas ya llevan la marca. Lo mismo
  con un valor guardado que no se pueda leer.
- Un alias que **no está reservado** es un borrado **idempotente**: **204**. No hay nada que
  soltar y pedir dos veces que se quite a la misma persona no es un error; es también lo que
  hace §6.4 con un `quitar` de quien no está en la lista. El aviso se manda igual, por si
  allá sí quedó en la lista (el TTL de aquí y el del socket-server son dos relojes
  distintos), con el alias **normalizado de la URL**, que es el único texto que hay.
- **Cuando sí había reserva, el aviso de `quitar` viaja con el alias que ella tenía
  guardado**, no con el de la URL (ver el aviso interno, abajo): es lo que hace que el
  socket-server la quite de verdad de `sin_celular`.
- **503 `alias_no_disponible`** también si no se puede **leer** la marca: sin saber de quién
  es la reserva no se suelta nada.
- **409** si esa persona **ya tiene platos** en la cuenta de la mesa:

```json
{ "error": "Esa persona ya tiene platos en la cuenta: no se puede quitar de la mesa", "motivo": "comensal_con_platos" }
```

  Quitarla dejaría su consumo **sin dueño** en el desglose por comensal, y además el alias
  volvería a estar libre: otra persona podría reservar ese nombre y heredar sus platos.
- Se comparan los platos **por clave del alias**, no por el texto. La cuenta agrupa por
  `btrim(dp.comensal)` (función `obtener_cuenta_mesa`), que distingue mayúsculas y tildes:
  comparando el texto, quitar a «abuela» pasaría aunque hubiera platos cargados a «Abuela»,
  que es la misma persona.
- Se cuentan los **platos** (`items_pedidos > 0`), no el saldo: alguien que ya pagó lo suyo
  sigue teniendo sus platos en la cuenta. Un comensal que sale con 0 ítems (puede aparecer
  por un pago sin consumo) **sí** se puede quitar.
- **503 `alias_no_disponible`** si Redis no responde: la reserva sigue ahí, y responder 204
  sería mentir.

#### El aviso interno `POST /internal/mesa-comensal`

> **El contrato es `socket-server/EVENTS.md` §6.4, Estable desde R-19.2** (ruta implementada
> en `socket-server/src/mesa-comensal.js`). Aun así, nada de la API REST depende de que
> funcione: si el socket-server responde 404 o no hay nadie escuchando, el aviso falla y la
> respuesta HTTP del mesero sigue siendo correcta, porque la reserva del alias ya está hecha
> en el backend, que es la fuente de verdad.

Tras reservar o soltar el alias, el backend manda:

```json
{ "id_mesa": 5, "alias": "Abuela", "accion": "agregar", "eventId": "<uuid v4>" }
```

El socket-server lo suma a `sd:mesa:{id}:sin_celular` y lo incluye en `mesa:presencia`
(§6.4 y §5.2), así cuenta para «igual» y puede pagar en caja con su alias.

- **`accion`** es `"agregar"` o `"quitar"`.
- **El `alias` que viaja es SIEMPRE el texto con el que se reservó**, en las dos acciones.
  El socket-server compara `quitar` por **clave** (§6.4, R-19.2), con la misma normalización
  de [`alias-comensal.js`](../src/services/alias-comensal.js) —sin tildes, en minúsculas y
  sin espacios ni `. _ ' -`—: busca en `sin_celular` el alias guardado cuya clave coincida y
  quita **ese**. Por eso el backend puede mandar el alias tal como está guardado, sin que
  importen la capitalización, una tilde o un espacio doble.

  Al **agregar** es el alias que acaba de normalizarse y reservarse. Al **quitar** es el que
  la reserva tenía **guardado**, no el de la URL: el `DELETE` libera la reserva por
  **clave**, así que `DELETE …/comensales/abuela` sobre la reserva de «Abuela» responde 204,
  suelta la reserva y el socket-server quita a «Abuela» igual, porque la clave es la misma.
  Se manda el guardado porque es el texto real de esa persona: así el par
  `agregar`/`quitar` de una misma persona viaja con el mismo texto, y repetir un `agregar`
  es «sin cambio» en vez de un `409 ALIAS_EN_USO` por un alias distinto con la misma clave.

  La única excepción es un alias que **no está reservado** (el 204 idempotente): ahí se
  manda el **normalizado de la URL**, porque no hay otro texto de donde sacarlo.
- **`eventId` UUID v4, uno por acción.** Es lo que hace seguro reintentar: el socket-server
  deduplica por `backend:mesa-comensal:{eventId}`.

**Reintentos.** `enviar` del notificador sigue **sin reintentar** y los avisos que ya
existían no cambian de comportamiento; el reintento es una capa aparte que solo usa este
aviso:

- Se reintenta **solo** ante **500/502/503 con `codigo: "ERROR_INTERNO"`**, con el **mismo
  `eventId`**. Hasta 3 intentos, 150 ms entre ellos, y el **timeout es por intento** (el de
  `enviar`, `SOCKET_TIMEOUT_MS`, 1500 ms por defecto).
- **Nunca** ante **503 `NO_CONFIGURADO`** (al socket-server le falta `INTERNAL_API_KEY`: no
  se arregla repitiendo) ni ante un **4xx** (400 es un cuerpo mal armado, 401 una clave que
  no coincide, 409 una regla de negocio que hay que atender, no repetir).
- Tampoco ante un **TIMEOUT** o un **INALCANZABLE**: el contrato nombra solo esos tres
  status y, con la ruta aún sin implementar, lo más probable es que no haya nadie al otro
  lado; reintentar alargaría cada petición del mesero por un aviso que no va a llegar.
- **Un `agregar` viejo no se reintenta** si ya se pidió `quitar` a esa misma persona en esa
  mesa: insistir volvería a sentar a alguien que el mesero acaba de quitar. Un `quitar` sí
  se reintenta siempre, porque es el estado final.

**Orden.** Los avisos de **una misma mesa van en serie** (una cadena de promesas por
`id_mesa`), así un `quitar` nunca se adelanta al `agregar` anterior. Es por mesa y no
global: la mesa 5 no espera a la 9, y menos con reintentos de por medio. Con **una**
instancia del backend basta; con varias, cada proceso ordenaría solo sus propios avisos y
lo que impide aplicar dos veces un reintento seguiría siendo el `eventId`.

**Qué pasa si el aviso falla.** La reserva **ya está hecha** y el backend es la **fuente de
verdad**: un 404 (R-19 todavía no existe), un socket-server caído, un timeout o un
`ERROR_INTERNO` que agota los reintentos **no cambian la respuesta HTTP** —el alta sigue
siendo **201** y la baja **204**— y se registran en el log del servidor sin datos
sensibles.

**La excepción es el 409**, y es la única: este aviso **sí se espera** en el `POST`, al
contrario que el resto de los avisos de la API. Si el socket-server responde **409**
(`MESA_LIBERADA`, `ALIAS_EN_USO`, `LIMITE_COMENSALES`), el backend **suelta el alias que
acaba de reservar** —si no, quedaría una reserva sin presencia: nadie podría volver a usar
ese nombre y la persona no aparecería en la mesa— y devuelve **409** con el motivo
traducido. El `DELETE` **no** espera su aviso: no hay nada que decidir con la respuesta y el
alias ya está suelto.

Los 409 del socket-server son **guardias, no la autoridad**: el backend valida la sesión de
la mesa y reserva el alias él mismo (§6.4, "Las guardias no reemplazan al backend").

**`LIMITE_COMENSALES` (20 personas sin celular por mesa) lo impone SOLO el socket-server.**
El backend no cuenta cuántas hay: mientras **R-19 no exista**, no hay ningún límite y se
pueden dar de alta tantas como quepan en el hash de alias. Ponerlo también aquí
significaría contar los alias reservados y duplicar una regla que el contrato coloca del
otro lado, con el riesgo de que los dos números se desalineen; cuando R-19 esté, el 409
llega del socket-server y el backend suelta el alias que acababa de reservar.

#### Pedir por esa persona y verla en la cuenta

No hace falta nada nuevo: `POST /pedidos` del **mesero** o del **admin** ya acepta
`comensal` por ítem (el alias del body vale para el personal, que pide de parte de alguien;
para un comensal el alias sale **solo** del JWT, H-05). Queda en
`detalles_pedido.comensal`, que es la columna por la que
[`GET /mesas/:id/cuenta`](#mesas) agrupa el desglose por persona.

**Desde D-18b el backend canonicaliza ese alias**: si el mesero escribe «abuela» y la
persona se registró como «Abuela», se guarda «Abuela». Ver
[§`POST /pedidos` · el alias del comensal](#el-alias-del-comensal-cuando-pide-el-personal-d-18b).

> **Para el panel de «Tomar pedido»: manda el `alias` TAL COMO lo devolvió el `201`.**
> Aunque el backend ahora lo corrige, mandar el texto exacto evita el **409
> `comensal_no_registrado`** cuando la persona no está registrada, y es lo único que funciona
> igual si Redis está caído (ahí el backend se degrada y guarda lo que llegue).
>
> Vale cualquiera de las tres fuentes: el `alias` del `201` de
> `POST /mesas/:id/comensales`, el de `mesa:presencia` (campos `comensales` o
> `sin_celular`) o el `comensal` de `GET /mesas/:id/cuenta`.

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

**Cuerpo opcional** (zod `.strict()`, #174):

```json
{ "solo_si_vacia": true }
```

Es para la **renovación automática del modal del panel** (#174): el panel renueva el QR que
muestra sin tumbar la sesión de quien ya entró. Con `solo_si_vacia: true` se aplica, **antes de
pedir el token** y en la misma transacción con la mesa bloqueada, **la misma guarda de
continuidad que la rotación interna** (`/token-qr/interno`, abajo):

| Si… | Respuesta | ¿Rota? |
|---|---|---|
| la sesión actual tiene pedidos (regla de `sesion_iniciada_en`) o algún nombre reservado (por QR o sin celular) | **409** `{ "error", "motivo": "mesa_con_comensales" }` | No |
| Redis no responde (no se pueden leer las reservas) | **503** `{ "error", "motivo": "alias_no_disponible" }` | No |
| la mesa está vacía | `201` como arriba | Sí |

Sin cuerpo, con `{}` o con `solo_si_vacia: false` es el **"Nuevo QR" manual de siempre**: rota
aunque haya comensales. Un campo de más o un `solo_si_vacia` que no sea booleano es **400**
`{ "error", "motivo": "cuerpo_invalido" }`, sin tocar la mesa.

> Hoy el middleware de sesión compara el `sid` del JWT del comensal con el `token_qr`
> vigente, así que **rotar cierra las sesiones de quienes ya estaban sentados**. Si se quiere
> que conserven su sesión tras una rotación, hay que cambiar ese criterio (pendiente). La
> rotación **automática** (abajo) no tiene ese problema: no rota si alguien ya entró.

### POST /mesas/:id/token-qr/interno — interna (rotación automática del QR)

La llama **el socket-server**, no un frontend: mientras una mesa está abierta y **nadie se ha
sentado**, su QR cambia cada 3 minutos para que una foto de la tablet deje de servir (diseño en
`socket-server/docs/rotacion-qr.md`, opción A). El socket-server firma el QR nuevo y le pide al
backend que lo guarde como el vigente; solo si recibe `200` lo anuncia a la tablet con
`qr:actualizado`. El backend **no** llama a `/internal/qr-rotado`.

```http
POST /api/mesas/5/token-qr/interno
x-internal-key: <INTERNAL_API_KEY>
Content-Type: application/json

{ "token_qr": "v1.<datos>.<firma>", "token_anterior": "v1.<datos>.<firma>" }
```

- **Clave interna** (`requireInternalKey`, comparación en tiempo constante): sin ella o con una
  equivocada, **401**; sin `INTERNAL_API_KEY` configurada, 503.
- **Cuerpo** (zod `.strict()`): `token_qr` con la forma `v1.<datos>.<firma>` en base64url y
  hasta 255 caracteres (el tamaño de la columna); `token_anterior` con la misma forma o
  `null`, **obligatorio** aunque sea null; distintos entre sí. La **firma no se valida aquí**:
  es del socket-server, que tiene `QR_SECRET`. Cualquier fallo es **400**
  `{ "error", "motivo": "cuerpo_invalido" }`.

En **una transacción**, con la mesa bloqueada (`FOR UPDATE`):

| Paso | Si no se cumple |
|---|---|
| La mesa existe | **404** |
| Está `ocupada` | **409** `{ "motivo": "mesa_no_ocupada", "estado" }` |
| **Compare-and-swap**: `token_anterior` es el `token_qr` vigente | **409** `{ "motivo": "token_anterior_distinto" }`: alguien rotó a mano o liberó la mesa mientras tanto |
| **Guarda de continuidad**: la sesión de mesa no tiene comensales | **409** `{ "motivo": "mesa_con_comensales" }` |
| Se pueden leer las reservas de alias | **503** `{ "motivo": "alias_no_disponible" }` |

Si todo se cumple: guarda el token anterior en `token_qr_historico`, cambia `mesas.token_qr`,
`COMMIT` y **200** `{ "ok": true }`. Desde ese momento el QR viejo ya no abre sesión
(`POST /mesas/qr/:token/sesion` responde 401 `no_es_el_vigente`) y el nuevo sí.

**`token_anterior: null` es 409, no un comodín.** El socket-server arranca la rotación siempre
con el token que acaba de firmar en `/qr/generar`, que es el mismo que guarda el backend al abrir
o rotar a mano, así que hoy nunca manda `null`. Si algún día lo hiciera, sería un rotador que no
sabe qué QR está vigente, y pisarlo a ciegas podría deshacer una rotación manual. Con el 409 deja
de rotar esa mesa.

**La guarda de continuidad, y por qué.** El middleware de sesión compara el `sid` del JWT del
comensal con el `token_qr` vigente, así que rotar dejaría sin sesión a quien ya entró con el QR
anterior. El diseño quiere que el QR quede **fijo** en cuanto entra alguien; el socket-server lo
decide con los sockets de la sala, pero puede haber alguien que escaneó y todavía no abrió su
socket. Por eso el backend también mira, y **no rota** si la sesión de mesa ya tiene:

- **pedidos** de la sesión actual (misma regla de `sesion_iniciada_en` que la liberación
  automática), o
- **reservas de alias**: todo el que entra por QR reserva su alias, y el personal reserva el de
  quien no tiene celular. Abrir la mesa las borra, así que lo que haya es de esta sesión.

El 409 hace que el socket-server deje de rotar: el QR queda fijo hasta que la mesa se libere. Si
las reservas **no se pueden leer** (Redis no responde) se elige lo seguro, **no rotar**: el QR
anterior sigue valiendo y nadie pierde su sesión. Se responde **503** (y no 409) para que el
socket-server lo reintente en el siguiente ciclo en vez de dejar la mesa fija para siempre.

**Logs:** el id de la mesa y el motivo; **nunca** un token, porque quien lo tenga abre sesión
en esa mesa.

Cobertura: `tests/mesas-rotacion-interna.test.js` y `tests/integracion/mesas-rotacion-sql.test.js`
(contra PostgreSQL, con QR firmados por el servicio real del socket-server y una vuelta de punta a
punta con su rotador).

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
la PWA debe pedir otro nombre. **Sin campo `alias`**, a diferencia del alta del personal
(`POST /mesas/:id/comensales`): devolver el texto guardado le daría a quien escanea el nombre
exacto de otra persona de la mesa para entrar como ella.

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
| **POST** | **/pedidos/:id/items/:id_detalle/cancelar** | **comensal** | **D-13 por el comensal (J-14): quita UNA línea suya, entera, antes de que cocina empiece. No libera la mesa** |

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

**404 `Mesa no encontrada` (D-18c).** Si el pedido trae algún `comensal` y el `id_mesa` no
existe, la respuesta es **404**, como en el resto de las rutas de mesa. Antes era un **409
`comensal_no_registrado`**: la cuenta de una mesa inexistente viene vacía y el resolutor de
alias lo leía como «esa persona no está sentada», así que el mesero veía un error sobre el
**nombre del comensal** cuando lo que estaba mal era el **número de la mesa**.

La comprobación es una sola consulta (`SELECT 1 FROM mesas`, la misma que ya hacían las dos
cuentas) y corre **antes** de resolver alias: no se lee la cuenta ni Redis. Un pedido **sin
alias** no la paga: sigue fallando contra la FK de `pedidos.id_mesa` (**409**) exactamente
como antes.

#### El alias del comensal cuando pide el personal (D-18b)

La cuenta por persona agrupa por el **texto exacto** del alias (`btrim(dp.comensal)` en
`obtener_cuenta_mesa`), mientras que la **unicidad** de los alias se mide por **clave** (sin
tildes, en minúsculas, sin espacios ni `. _ ' -`). Si la abuela se registra como «Abuela» y
el mesero escribe «abuela» al tomarle el pedido, la cuenta muestra **dos filas**, el
desglose no cuadra y el cajero no sabe a quién cobrarle qué.

Así que cuando pide el **personal** (`mesero` o `admin`) y el ítem trae `comensal` (o
`apodo`), **no se guarda el texto que llegó, sino el alias CANÓNICO de esa persona en la
mesa**. Se busca por clave en dos sitios, en este orden:

1. **Las reservas de alias de la mesa** (`sd:mesa:{id}:alias`), que son la fuente de verdad
   de quién está sentado, venga de una sesión de QR o del alta del personal. Se usa el campo
   `alias` de la reserva. Da igual de qué tipo sea: aquí solo interesa **cómo se escribe**.
2. **La cuenta de la mesa**, solo si la reserva no apareció. Cubre a quien ya tiene platos
   pero cuya reserva venció (24 h para un sin celular, 3 h para una sesión de QR). Se exige
   que esa fila tenga **platos** (`items_pedidos > 0`): una que solo existe por un pago no
   dice cómo se escribe el nombre de quien está pidiendo ahora. Es la misma fuente que
   `GET /mesas/:id/cuenta`, y la búsqueda es **la misma** que usa el alta de un comensal
   (`services/alias-en-cuenta.js`): se guarda el texto tal como está en la cuenta, se ignora
   la fila `General`, y si hay varios textos con la misma clave gana el de **más platos**
   (con empate, el primero en el orden de la cuenta).

Si no aparece en ninguno de los dos, es un nombre que **nadie registró**:

```json
{
  "error": "Esa persona no está registrada en la mesa: agrégala primero (POST /api/mesas/:id/comensales) o usa el nombre con el que ya aparece en la cuenta",
  "motivo": "comensal_no_registrado",
  "alias": "Abuela"
}
```

**409 `comensal_no_registrado`**, y **el pedido NO se crea**: basta con que **uno** de los
comensales del cuerpo no esté registrado para que se rechace el pedido entero, sin abrir
siquiera la transacción.

El campo **`alias`** dice **cuál** de ellos no se pudo resolver: con un pedido de varias
personas, «esa persona no está registrada» sin decir quién obliga a adivinar. Es el texto
**normalizado** que se intentó usar, y si fallan varios se informa el **primero en el orden
de los ítems**. Solo ese: el alias lo mandó quien llama, así que la respuesta **no devuelve
ningún dato de las otras personas** de la mesa. Es deliberado: un alias escrito a mano que no corresponde a nadie
es casi siempre un error de tecleo, y guardarlo crea una persona fantasma en la cuenta que
luego hay que arreglar a mano.

**Un alias que no cumple la regla R-18** (menos de 2 caracteres, caracteres no permitidos,
clave vacía) es **400**, con el **mismo mensaje** y el mismo `campo: "comensal"` que las
demás rutas de alias, y solo si el `comensal` viene informado.

**Un ítem a nombre de «General» es 409 `comensal_no_registrado`, no 400 (D-18c).** El alta
de comensales lo rechaza como alias inválido (ver R-18 arriba), pero aquí el significado es
otro: «General» es el **cajón de los platos sin dueño**, así que no es un nombre mal escrito
sino un nombre que **no corresponde a nadie**. Era ya la respuesta antes de que la regla
existiera —no aparecía en las reservas ni como fila con platos propios— y se mantiene para
no cambiarle el error a quien ya lo maneja. El `alias` del cuerpo trae el texto normalizado.

**Lo que no cambia:**

- **Un ítem sin `comensal`** sigue cayendo en «General», como siempre. No se consulta nada.
- **El comensal con sesión de QR** no cambia: su alias sale **firmado del JWT** (H-05) y el
  del cuerpo se ignora, así que no hay nada que canonicalizar.
- `apodo` sigue valiendo como alias de compatibilidad, y se canonicaliza igual.

**Cuándo se resuelve.** **Antes** de abrir la transacción del pedido y **una vez por alias
distinto**, no una por ítem: un pedido con ocho platos de la abuela hace **una** lectura de
la reserva, y la cuenta se consulta como mucho **una vez** para todo el pedido (y solo si
alguna reserva no apareció).

**Degradación si Redis no está disponible: el pedido NO se bloquea.** No se puede afirmar
que una persona no esté registrada cuando no se puede leer el registro, y una caché caída
no puede impedir que una mesa coma. En ese caso se intenta **igual** con la cuenta (que vive
en PostgreSQL) y, si tampoco aparece, se guarda el alias **recortado y normalizado**, que es
exactamente lo que hacía el backend antes de D-18b. **Sin Redis el único 409 posible es el
de «General»** (D-18c), que no necesita consultar nada: un ítem no se guarda a nombre del
cajón de los platos sin dueño ni cuando no se puede verificar quién está sentado. Queda
un aviso en el log del servidor **sin el alias** —es un dato de quién está sentado en una
mesa, y estos logs acaban en archivos y en consolas ajenas—, solo con el `id_mesa` para
poder investigar.

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
Un pedido creado en el instante exacto de la apertura **sí** entra.

Con `sesion_iniciada_en` en `null` esta lista devuelve **todos** los pedidos: la consulta
es del backend y mantiene el criterio del script 17. Ojo, porque **la cuenta hace lo
contrario**: `obtener_cuenta_mesa` devuelve una cuenta **vacía** cuando no hay sesión
(regla H-02, script 20). Son dos respuestas distintas a propósito —ver una comanda vieja
no cobra nada; sumarla en la cuenta, sí—, pero conviene no leer una por la otra.

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

### POST /pedidos/:id/items/:id_detalle/cancelar — comensal (D-13, J-14)

El comensal quita **una línea suya** de un pedido de su mesa, mientras cocina no lo haya
empezado. Contrato aprobado por Juan (J-14).

- **Quién:** solo una **sesión de comensal** (su JWT). El personal no usa esta ruta: con un
  JWT de personal responde **403**; sin sesión, o con la sesión de un QR que ya no es el
  vigente, **401**. La mesa y el comensal salen **del JWT**, nunca del cuerpo.
- **Parámetros:** `:id` y `:id_detalle` enteros > 0 (zod `.strict()`); si no, **400**
  `{ "motivo": "parametro_invalido" }`.
- **Sin cuerpo:** nada o `{}`. Un cuerpo con cualquier campo es **400**
  `{ "motivo": "cuerpo_invalido" }`.

En **una transacción**, con el pedido y después la línea bloqueados (`FOR UPDATE`, siempre
en ese orden), y en este orden de comprobación:

| Paso | Si no se cumple |
|---|---|
| El pedido existe y `id_detalle` es una línea **de ese pedido** | **404** `{ "motivo": "no_encontrado" }` |
| El pedido es de la **mesa del JWT** (y de su visita actual), y la línea es **del comensal del JWT**, comparando por la **clave** del alias (D-18b: sin tildes, mayúsculas ni separadores; `Ána María` = `ana  maria`). Una línea sin comensal (`NULL`) no la quita ningún comensal | **403** `{ "motivo": "no_es_tuyo" }` |
| La línea no estaba ya cancelada (se mira **antes** que los otros 409) | **409** `{ "motivo": "item_ya_cancelado" }` |
| El pedido sigue en `recibido` y la línea en `pendiente` | **409** `{ "motivo": "item_en_preparacion" }` |
| Si el pedido tiene pagos `completada`, el total nuevo no queda **por debajo** de lo pagado | **409** `{ "motivo": "pago_registrado" }` |

Si pasa:

1. La línea se cancela **completa** (`estado_item = 'cancelado'`), aunque tenga
   `cantidad > 1`: no se descuenta de a una unidad.
2. Lo demás lo hace **la base**: `tr_devolver_inventario` devuelve al stock lo reservado
   (es **devolución, no merma**: la línea estaba `pendiente` y el pedido `recibido`), también
   las porciones de los ingredientes elegidos de un plato del **constructor**; y
   `tr_actualizar_total_pedido` recalcula el total sin las líneas canceladas.
3. Si el pedido se queda **sin líneas vivas**, pasa a `cancelado` por la transición válida,
   con su fila en `historial_estados` (`id_usuario` NULL, observación *"Cancelado por el
   comensal"*).
4. **No libera la mesa**, aunque no le queden pedidos abiertos: el grupo sigue sentado y
   puede volver a pedir. (La cancelación del personal sí llama a
   `liberarSiNoQuedanPedidosAbiertos`; esta no.)

Frente al **KDS**: cocina cambia el estado con un `UPDATE` del pedido, que toma el mismo
bloqueo de fila. Si cocina llega primero, esta ruta espera y responde `409
item_en_preparacion`; si llega primero el comensal, cocina espera a que la línea quede
cancelada y el stock devuelto, y después aplica su cambio.

`200`, con los ítems en la **misma forma que el seguimiento del comensal** (`GET
/pedidos/:id`, `GET /pedidos/mesa`: con `plato_nombre`, `ingredientes` y su personalización),
cada uno con su `estado_item`. `total` es un número:

```json
{
  "pedido": {
    "id_pedido": 87,
    "codigo_pedido": "PED-261111-3F9A2",
    "estado": "recibido",
    "total": 18000,
    "items": [
      { "id_detalle": 210, "id_plato": 12, "plato_nombre": "Bandeja paisa", "cantidad": 2,
        "subtotal": 36000, "comensal": "Ana", "estado_item": "cancelado", "ingredientes": [], "...": "..." },
      { "id_detalle": 211, "id_plato": 1001, "plato_nombre": "Bowl Personalizado", "cantidad": 1,
        "subtotal": 18000, "comensal": "Ana", "estado_item": "pendiente",
        "ingredientes": [{ "id_ingrediente": 3, "nombre": "Arroz", "porcion": "normal", "precio_aplicado": 0,
                           "id_paso": 101, "paso": "Elige tu Base" }], "...": "..." }
    ]
  }
}
```

**Tiempo real, después del COMMIT** (la respuesta no los espera):

1. `POST /internal/item-cancelado` con `{ id_pedido, id_mesa, codigo_pedido, id_detalle,
   id_plato, nombre, comensal, total, estado_pedido, origen, eventId }`, con los mismos
   reintentos que los demás avisos (solo 500/502/503 `ERROR_INTERNO`, mismo `eventId`).
   **Pendiente de Roberto:** la ruta aún no existe en el socket-server; mientras tanto
   responde 404, que queda en el log y no cambia la respuesta.

   `origen` dice **quién** quitó el plato: `"comensal"` (su sesión de QR; es lo que manda
   esta ruta) o `"personal"` (la cancelación del personal). Lo pidió Juan y lo aceptó
   Roberto en su #181. **Un consumidor que no lo reciba debe asumir `"comensal"`**, el
   único origen que existía antes de este campo.
2. Si el pedido quedó `cancelado`, además el `POST /internal/order-status` de siempre
   (`order:status` → `cancelado`).

> El `estado_pago` del pedido (script 22) solo lo recalcula un trigger sobre
> `transacciones`. Si quitar una línea deja el total **igual** a lo ya pagado, el pedido
> queda cubierto pero `estado_pago` sigue en `parcial` hasta el próximo movimiento de
> pago. Es de la base; queda anotado para Jarrison.

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
incluye ese `sesion_iniciada_en` para que el cliente sepa de qué visita habla.

**Sin sesión abierta, la cuenta sale VACÍA**, no completa: con `sesion_iniciada_en` en
`null` la función devuelve totales en `0.00` y `pedidos`/`comensales` vacíos (regla H-02,
`database/scripts/20_fix_h02_sesion_mesa_cuenta.sql`). Es lo contrario de lo que hacía el
script 17, donde un `null` sumaba todo el histórico y la cuenta del grupo nuevo arrastraba
lo del anterior. Así que una mesa con pedidos pero sin abrir no muestra `$0` por error:
muestra que no hay ninguna visita a la que cobrarle.

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
| **GET** | **/transacciones?desde=hoy\|AAAA-MM-DD** | **admin, cajero** | **Las transacciones completadas desde ese día hasta el final de hoy (días de Bogotá), con total y cantidad: el cierre de caja** |
| **POST** | **/transacciones/mesa** | **admin, cajero** | **Cobra un monto a la MESA y lo reparte entre sus pedidos, del más viejo al más nuevo** |

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

### GET /transacciones?desde=hoy|AAAA-MM-DD — el cierre de caja

**Roles:** `admin`, `cajero` (los mismos que registran pagos). Sin token **401**; `mesero`,
`cocina` o un comensal, **403**.

**Query**, validada con zod `.strict()`:

| Parámetro | Obligatorio | Valores |
|---|---|---|
| `desde` | Sí | `hoy`, o una fecha `AAAA-MM-DD` |

**Qué significa `desde`:** un **rango de días de Bogotá**, desde las 00:00 de ese día hasta el
**final de hoy**. No es un solo día: `desde=2026-11-08` con hoy 10 de noviembre trae el 8, el 9
y el 10. `desde=hoy` es el caso hoy..hoy (igual que `desde=<la fecha de hoy>`).

**Límites**, todos en días de **Bogotá**, no del servidor ni de UTC:

- La fecha tiene que **existir**: `2026-02-30`, `2026-13-01` o `2026-11-00` son 400. Se comprueba
  sin depender de la zona del servidor (con `Date.UTC`, mirando que año, mes y día no cambien).
- **No puede ser futura**: posterior a hoy en Bogotá → 400.
- **Como mucho 31 días contando hoy**: `desde >= hoy - 30` (`DIAS_ATRAS_MAXIMOS = 30`). Más
  antigua → 400, y el mensaje dice la fecha más antigua permitida ese día.
- A las 20:00 de Bogotá, cuando en UTC ya es el día siguiente, "hoy" sigue siendo el de Bogotá:
  la fecha de Bogotá de ese día es válida, la del día siguiente es futura, y el tope se cuenta
  desde el hoy de Bogotá.

Errores, todos **400** `{ "error": "...", "motivo": "consulta_invalida" }`:

| Caso | `error` (ejemplo) |
|---|---|
| Sin `desde` | `desde es obligatorio: "hoy" o una fecha AAAA-MM-DD` |
| Otro valor o formato (`ayer`, `10/11/2026`, `2026-1-5`, `2026-11-10T00:00`) | `desde debe ser "hoy" o una fecha AAAA-MM-DD` |
| Fecha que no existe | `La fecha 2026-02-30 no existe` |
| Futura | `desde no puede ser posterior a hoy (2026-11-10, hora de Bogotá)` |
| Más de 31 días atrás | `desde admite como mucho 30 días atrás: la fecha más antigua permitida hoy es 2026-10-11` |
| Un parámetro extra | el mensaje de zod |

**Respuesta 200:**

```json
{
  "desde": "2026-11-10",
  "hasta": "2026-11-10",
  "total": 58000,
  "cantidad": 2,
  "transacciones": [
    {
      "id_transaccion": 41, "id_pedido": 87, "codigo_pedido": "PED-261110-7K2Q9",
      "id_mesa": 5, "numero_mesa": 5, "monto": 34000, "metodo_pago": "efectivo",
      "comensal": "Ana", "fecha": "2026-11-11T01:12:40.512Z",
      "referencia_pago": null
    },
    { "id_transaccion": 40, "id_pedido": 86, "codigo_pedido": "PED-261110-3M8ZT",
      "id_mesa": 2, "numero_mesa": 2, "monto": 24000, "metodo_pago": "tarjeta_debito",
      "comensal": null, "fecha": "2026-11-10T18:03:11.004Z", "referencia_pago": null }
  ]
}
```

- `desde` y `hasta` son los días del rango, ambos **incluidos**, en `AAAA-MM-DD`: `hasta` es
  siempre hoy en Bogotá. Con `desde=hoy` coinciden. (`hasta` es nuevo; los campos que ya
  había no cambian.)
- Solo `estado_transaccion = 'completada'`: ni pendientes, ni fallidas, ni reembolsadas.
- **Más reciente primero** (`creado_en` descendente; a igual instante, id descendente).
- `monto` y `total` son **números**, no texto (los `NUMERIC` se convierten); `cantidad` es un
  entero. `total` y `cantidad` los calcula la base en la misma consulta que la lista.
- `fecha` es el instante en ISO 8601 UTC (`Z`); el cliente lo muestra en su hora local.
- `comensal` es quien pagó cuando la mesa dividió la cuenta; `null` en un cobro de la mesa
  completa.
- **`referencia_pago`** identifica el **pago** al que pertenece la fila, para agrupar. Un
  pago a la mesa se reparte entre varios pedidos y deja **una fila por pedido**; todas llevan
  el mismo `referencia_pago`. Pasa con los dos pagos de mesa: el de Wompi (la referencia de la
  pasarela) y el **cobro de mesa en caja** (`POST /transacciones/mesa`), cuyas filas salen
  todas con `referencia_pago = "caja:<id_cobro>"`, el mismo `id_cobro` que mandó la caja. Es la referencia del pago
  sin el sufijo interno de almacenamiento (`ref`, `ref#2`, `ref#3` → `ref`; solo se quita un
  `#<entero ≥ 2>` final, nunca un `#` que forme parte de la referencia original). Es `null`
  en un cobro por pedido sin referencia (`POST /transacciones`). Agrupar para la caja:

  ```js
  const pagos = new Map();
  for (const t of respuesta.transacciones) {
    // Sin referencia, cada fila es su propio cobro.
    const clave = t.referencia_pago ?? `fila-${t.id_transaccion}`;
    const p = pagos.get(clave) ?? { referencia_pago: t.referencia_pago, monto: 0, pedidos: [] };
    p.monto += t.monto;
    p.pedidos.push(t.id_pedido);
    pagos.set(clave, p);
  }
  // Un pago de Wompi de 72.000 repartido en 3 pedidos sale como UN pago de 72.000.
  ```

  Suma en pesos con cuidado de la coma flotante si se muestran muchos decimales; con montos
  en pesos enteros o con centavos no hay problema práctico, y el `total` de arriba ya viene
  de la base.
- **No expone nada más** de la transacción: `referencia_externa` en crudo (con su sufijo) no
  sale, ni ningún otro dato de la pasarela (Wompi).

**Los días son de América/Bogotá**, no del servidor ni UTC, y los calcula la base, con la misma
zona para el rango y para los límites:

```
hoy       = (now() AT TIME ZONE 'America/Bogota')::date
desde_ts  = <fecha de desde>::timestamp AT TIME ZONE 'America/Bogota'   -- 00:00 de ese día
hasta_ts  = (hoy + 1)::timestamp AT TIME ZONE 'America/Bogota'          -- 00:00 de mañana
filtro    = creado_en >= desde_ts AND creado_en < hasta_ts
```

Por eso una venta a las 20:00 de Bogotá (01:00 UTC del día siguiente) cuenta como de hoy, y una
a las 23:30 de Bogotá del día anterior a `desde` no. Que la fecha sea futura o demasiado antigua
también lo decide esa consulta, con el mismo `hoy`, así no hay dos cálculos de "hoy en Bogotá"
que puedan discrepar. Es la misma zona que usan los reportes (`ZONA` en
`reportes.service.js`); no hay zona configurable en `configuracion_restaurante`. La condición
va sobre `creado_en` sin funciones encima, así que `idx_transacciones_estado_fecha`
(`estado_transaccion, creado_en DESC, monto`) puede servir la consulta.

Cobertura: `tests/transacciones-del-dia.test.js` (roles, query, formato y existencia de la
fecha, forma, mapeo de los límites a 400) y `tests/integracion/transacciones-del-dia-sql.test.js`
contra PostgreSQL (estados, el rango desde ayer, el tope de 30/31 días, y los bordes del día de
Bogotá, incluido un reloj fijado a las 20:00 de Bogotá).

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

> El panel hoy **no pinta** `ocupacionMesas` ni `kdsAlertsCount`. De `topPlatos` pinta los
> tres primeros con `nombre`, `unidades` y `total`, y de `topIngredientes` los seis primeros
> con `nombre_ingrediente`, `nombre_plato` y `veces_solicitado`; si una lista llega vacía, la
> muestra vacía. No hay ventas por día en este contrato, así que ese panel lo dice en vez de
> dibujar barras. Los campos que no se pintan se devuelven igual, porque el contrato los pide
> y son datos legítimos del reporte.

---

## Tiempo real (socket-server)

El backend avisa al socket-server por HTTP interno, con la cabecera `x-internal-key` y un
`eventId` UUID v4 por acción (reintentar con el mismo `eventId` es seguro: él deduplica).
Contrato completo en [socket-server/EVENTS.md](../../socket-server/EVENTS.md).

| Cuándo | Aviso |
|---|---|
| Se crea un pedido | `POST /internal/order-created` con el pedido y sus ítems |
| Cambia el estado (pedidos y KDS) | `POST /internal/order-status` con `estado_anterior` |
| **Un comensal quita una línea suya** (D-13, J-14) | `POST /internal/item-cancelado` (**pendiente de Roberto**: hoy 404, solo log); si el pedido queda cancelado, además `order-status` |
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
| **POST** | **/mesas/:id/token-qr/interno** | **Rotación automática del QR de una mesa abierta y vacía (socket-server/docs/rotacion-qr.md)** |
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

- **Es la cuenta de la VISITA ACTUAL.** `obtener_cuenta_mesa` filtra por
  `creado_en >= mesas.sesion_iniciada_en`, así que los pedidos de un grupo anterior **no**
  suman en `total_centavos`. Y si la mesa no tiene sesión abierta
  (`sesion_iniciada_en IS NULL`), la cuenta sale **vacía**: totales en `0` y
  `por_comensal` en `[]` (scripts 17 y 20). Lo de que mezclaba sesiones era cierto hasta
  el script 15 y ya no lo es.

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

### POST /transacciones/mesa — cobro de mesa en caja

**Roles:** `admin`, `cajero`. Sin token **401**; `mesero`, `cocina` o un comensal, **403**.

La caja cobra **a la mesa**, no a un pedido: el monto se reparte entre los pedidos de la mesa
que tienen saldo, **del más viejo al más nuevo**, con el mismo núcleo que el pago en línea
(`POST /transacciones/internal`). Es lo que hay que usar para «cobrar lo de Ana» o «cobrar toda
la mesa»; `POST /transacciones` sigue siendo el cobro de **un pedido** concreto y no cambia.

**Cuerpo** (zod `.strict()`: un campo de más es 400):

```json
{ "id_mesa": 5, "monto": 34000, "metodo_pago": "efectivo", "comensal": "Ana",
  "id_cobro": "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f" }
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `id_mesa` | Sí | Entero > 0 |
| `monto` | Sí | Pesos, número > 0 con **como mucho 2 decimales** y que quepa en `DECIMAL(10,2)` (hasta 99.999.999,99). Se convierte a **centavos enteros** desde el texto del número, sin coma flotante (`1.15` son 115 centavos, no 114) |
| `metodo_pago` | Sí | `efectivo`, `tarjeta_debito`, `tarjeta_credito` o `transferencia`. **`online` no**: es solo de Wompi |
| `comensal` | No | Las mismas reglas que en `POST /transacciones`: texto de 1 a 40, o `null`. Es de quién se descuenta en la cuenta por persona; sin él, el cobro es «de la mesa» |
| `id_cobro` | Sí | **UUID**. Ver abajo |

**`id_cobro`: generarlo una vez y reutilizarlo en los reintentos.** La caja genera un UUID v4
(`crypto.randomUUID()`) **cuando el cajero pulsa «Cobrar»**, no en cada envío, y si la petición
falla por red o no llega la respuesta, **reintenta con el MISMO `id_cobro`**. Con el mismo
`id_cobro` el backend no cobra dos veces: responde `200 { duplicado: true }` con el saldo actual.
Un cobro nuevo (otro monto, otra persona) lleva un `id_cobro` nuevo. Por dentro se guarda como
`referencia_externa = 'caja:' + id_cobro`, así que nunca choca con una referencia de Wompi y
usa el mismo índice único (`uq_transacciones_referencia_externa`) e idempotencia que el pago en
línea, incluida la carrera de dos peticiones simultáneas: una cobra, la otra es duplicado.

**Un `id_cobro` ya usado en OTRA mesa no es un duplicado**: es **409** `id_cobro_en_uso`. El
backend mira a qué mesa pertenece la transacción que ya tiene `caja:<id_cobro>` (por su pedido):
si es la misma mesa, es el reintento de este cobro y responde `duplicado`; si es otra, contestar
`duplicado` haría creer a la caja que cobró sin haber cobrado nada, así que responde 409 y no
escribe nada. Pasa también en la carrera: dos peticiones a la vez con el mismo `id_cobro` en
mesas distintas → una cobra y la otra recibe 409, no `duplicado`. Si llega este 409, la caja
tiene que generar un `id_cobro` nuevo. (El pago en línea, `/transacciones/internal`, no cambia:
una referencia de Wompi ya registrada sigue siendo duplicado.)

**El reparto**, en una sola transacción:

- Se bloquea la mesa y después sus pedidos por `id_pedido`: el mismo orden que el cobro por
  pedido y el webhook de Wompi, así que la caja y Wompi sobre la misma mesa se serializan, sin
  interbloqueo y sin cobrar de más (el segundo ve el saldo ya reducido).
- Cada pedido recibe hasta su saldo, empezando por el más viejo; una fila de `transacciones` por
  pedido tocado.
- Un pedido que queda en cero **y ya está entregado** pasa a `pagado`, con su línea de
  `historial_estados` cuyo autor es **quien cobra** (el id del JWT) y la observación
  **`Pago en caja`**. Si todavía está en cocina, el dinero queda registrado y el pedido sigue su
  curso.
- Si con eso no queda ningún pedido abierto, la mesa se libera (estado `disponible`, QR
  invalidado) en la misma transacción.
- **La propina no entra**: este cobro solo cubre el saldo de los pedidos. Un monto mayor que el
  saldo es `409 excede`, no una propina.

**Respuestas:**

```json
201 {
  "duplicado": false,
  "saldo_restante": 0,
  "mesa_liberada": true,
  "pagados": [91, 92],
  "transacciones": [
    { "id_transaccion": 120, "id_pedido": 91, "monto": 34000, "comensal": null },
    { "id_transaccion": 121, "id_pedido": 92, "monto": 34000, "comensal": null }
  ]
}
```

- `saldo_restante` es el saldo de **la mesa** tras el cobro, en pesos (número). `pagados` son
  los `id_pedido` que pasaron a `pagado` con este cobro. `transacciones`, las filas creadas, con
  `monto` en pesos.

| Status | Cuerpo | Cuándo |
|---|---|---|
| **200** | `{ "duplicado": true, "saldo_restante": 34000 }` | Ese `id_cobro` ya se cobró **en esta mesa**: no se cobra ni se avisa otra vez |
| **409** | `{ "error": "Ese id_cobro ya se usó en otra mesa; genera uno nuevo", "motivo": "id_cobro_en_uso" }` | Ese `id_cobro` ya se usó en **otra** mesa. No se escribe nada |
| **400** | `{ "error", "motivo": "cuerpo_invalido" }` | Cuerpo inválido (tabla de arriba) |
| **404** | `{ "error": "Mesa no encontrada", "motivo": "mesa_inexistente" }` | La mesa no existe |
| **409** | `{ "error", "motivo": "sin_cuenta" }` | La mesa no tiene ningún pedido con saldo |
| **409** | `{ "error", "motivo": "excede", "saldo": 68000 }` | El monto supera el saldo de la mesa (`saldo` en pesos). No se escribe nada |
| **409** | `{ "error", "motivo": "autor_inexistente" }` | El usuario del token ya no existe ([El autor que ya no existe](#el-autor-que-ya-no-existe-409-autor_inexistente)). La transacción se deshace entera |

`POST /transacciones/internal` (Wompi) responde los mismos casos **sin** `motivo` y en
centavos; ese contrato no cambia.

**Avisos de tiempo real**, después del COMMIT y en este orden, los mismos que el cobro de caja
por pedido (`POST /transacciones`):

1. `POST /internal/payment-confirmed` → `payment:confirmed` (EVENTS.md §8.6): **uno por cobro**,
   con el monto entero, el saldo de la mesa, el `comensal`, `referencia_externa: "caja:<id_cobro>"`
   y el `id_transaccion` de la primera fila (la guardia de idempotencia del socket-server).
2. `order:status` → `pagado` por cada pedido que se liquidó.
3. `mesa:liberada` con motivo `pagada`, si la mesa quedó libre (y se olvidan sus alias).

Un `duplicado` no avisa nada. Si el socket-server no responde, el cobro ya está guardado.

Cobertura: `tests/transacciones-mesa.test.js` (roles, validación, centavos, cada respuesta,
avisos) y `tests/integracion/transacciones-mesa-sql.test.js` contra PostgreSQL (reparto entre
pedidos, pago parcial, pedido en cocina, excede, `id_cobro` repetido en serie y a la vez, caja y
Wompi a la vez, autor inexistente, historial).

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

## Inventario: insumos, movimientos y recetas (D-17 PR 2)

Lo que hay en bodega, cómo entra y sale, y cuánto consume cada plato y cada opción del
constructor. Las tablas, la función y las vistas son de `database/scripts/27_inventario.sql`
(P-19, Jarrison); este backend solo expone el CRUD y traduce sus errores.

**La base es la fuente de verdad, y aquí más que en ningún otro módulo:**

- `insumos.stock_actual` **no se edita nunca a mano**. Lo mueven la reserva de los pedidos y
  `registrar_movimiento_inventario`, y la regla del libro es
  `SUM(movimientos_inventario.cantidad) = insumos.stock_actual`. Por eso no hay ningún `PUT`
  ni `PATCH` que escriba el stock: un UPDATE directo descuadraría el libro para siempre.
- La **disponibilidad se recalcula sola**. Al cambiar el stock, al activar o desactivar un
  insumo y al tocar una receta, los triggers del script 27 recalculan
  `platos.stock_suficiente` e `ingredientes.stock_suficiente`, y lo que cambie sale por el
  canal `inventario` de PostgreSQL. El backend ya lo escucha y lo reenvía al socket-server
  (ver [Avisos de inventario en vivo](#avisos-de-inventario-en-vivo-d-17), D-17 PR 1): el
  panel y las mesas se enteran sin pedir nada.
- Lo que ve el comensal es `disponible AND stock_suficiente`: el **interruptor manual** de la
  cocina sigue siendo `disponible`, y el stock es lo calculado.

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/inventario/insumos` | **admin** | Lista de insumos; `?estado=bajo` lee `v_stock_bajo` |
| GET | `/inventario/insumos/:id` | **admin** | Un insumo |
| POST | `/inventario/insumos` | **admin** | Crea el insumo; `stock_inicial` entra como movimiento |
| PUT | `/inventario/insumos/:id` | **admin** | Nombre, unidad, mínimo y alta/baja. **No** el stock |
| POST | `/inventario/insumos/:id/movimientos` | **admin** | Entrada, ajuste o merma |
| GET | `/inventario/insumos/:id/movimientos` | **admin** | Historial del insumo, lo más nuevo primero |
| GET | `/inventario/insumos/:id/usos` | **admin** | Qué recetas usan ese insumo, y cuánto (D-17 PR 3) |
| GET | `/inventario/carta` | **admin** | Platos y opciones con su disponibilidad y si tienen receta (D-17 PR 3) |
| GET | `/platos/:id/receta` | **admin** | Receta del plato |
| PUT | `/platos/:id/receta` | **admin** | Reemplaza la receta completa |
| GET | `/ingredientes/:id/receta` | **admin** | Receta de una opción del constructor |
| PUT | `/ingredientes/:id/receta` | **admin** | Reemplaza la receta completa |

> **Todo es solo `admin`, también las lecturas.** El inventario dice cuánto cuesta y cuánto
> queda de cada cosa: es información del negocio, no de sala. El `mesero` y el `cajero` sí
> reciben en vivo el aviso `inventario:alerta` de lo que se está agotando (EVENTS.md §5.5,
> `room:admin`), que es lo que necesitan para no ofrecer lo que no hay. **Propuesta para
> G-06:** si el panel quiere además una lectura REST de `?estado=bajo` para esos dos roles, es
> un cambio de una línea en la ruta; no lo abro por mi cuenta.

### GET /inventario/insumos — admin

| Parámetro | Valores | Por omisión |
|---|---|---|
| `estado` | `todos`, `bajo` | `todos` |
| `activo` | `true`, `false` (sin él, todos) | — |
| `q` | Texto **literal**, busca por nombre sin distinguir mayúsculas (ver abajo) | — |
| `limite` | 1–200 | 100 |

**`q` es texto literal, sin comodines** (aquí, en `?estado=bajo` y en `GET /inventario/carta`).
Lo que escribe el usuario no se usa como patrón: `%`, `_` y `\` se escapan y la consulta lleva
`ILIKE … ESCAPE '\'` explícito. Así `q=%` solo trae nombres que contienen un `%`, `q=_` solo
los que tienen un guion bajo, y una barra invertida se busca tal cual en vez de romper el
patrón. Antes `q=%` devolvía todo. Distingue **acentos**: `costeno` no encuentra «Queso
costeño» (es un `ILIKE`, sin `unaccent`); las mayúsculas, no.

`?estado=bajo` lee la vista **`v_stock_bajo`** (`activo AND stock_actual <= stock_minimo`), que
trae su propio `agotado`:

```json
{
  "insumos": [
    { "id_insumo": 12, "nombre": "Queso costeño", "unidad": "g", "stock_actual": 450, "stock_minimo": 500, "agotado": false },
    { "id_insumo": 3, "nombre": "Masa", "unidad": "porcion", "stock_actual": 0, "stock_minimo": 10, "agotado": true }
  ]
}
```

Sin `estado=bajo` (o con `estado=todos`) sale la tabla `insumos`, con `activo` y
`actualizado_en`, y además `bajo` y `agotado` calculados, para que el panel pinte la misma
señal en las dos vistas sin tener que comparar a mano:

```json
{
  "insumos": [
    {
      "id_insumo": 12,
      "nombre": "Queso costeño",
      "unidad": "g",
      "stock_actual": 450,
      "stock_minimo": 500,
      "activo": true,
      "bajo": true,
      "agotado": false,
      "actualizado_en": "2026-11-08T12:00:00.000Z"
    }
  ]
}
```

- **Los `NUMERIC` salen como números JSON** (`450`, `0.5`), no como texto: el backend registra
  un parser para el OID 1700 (`src/config/db.js`). Es la misma regla que ya cumplen `total` y
  `precio`.
- `estado` y `activo` con un valor que no está en la lista son **400**, no se ignoran en
  silencio: un `?estado=bajos` que devolviera todo haría creer al panel que no hay faltantes.
- Orden: por `nombre`. Con `estado=bajo`, primero lo **agotado** y luego por nombre.

### GET /inventario/insumos/:id — admin

```json
{
  "insumo": {
    "id_insumo": 12,
    "nombre": "Queso costeño",
    "unidad": "g",
    "stock_actual": 450,
    "stock_minimo": 500,
    "activo": true,
    "bajo": true,
    "agotado": false,
    "actualizado_en": "2026-11-08T12:00:00.000Z"
  }
}
```

**400** si el `:id` no es un entero positivo · **404** `Insumo no encontrado` si no existe (un
insumo **desactivado** sí se devuelve: la baja no lo esconde, solo lo saca del servicio).

### POST /inventario/insumos — admin

```json
{ "nombre": "Queso costeño", "unidad": "g", "stock_minimo": 500, "stock_inicial": 2000 }
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `nombre` | Sí | Texto 1–80 (la columna es `VARCHAR(80)`), **único** |
| `unidad` | No (por omisión `porcion`) | Uno de `porcion`, `unidad`, `g`, `ml` (CHECK de la tabla) |
| `stock_minimo` | No (por omisión `0`) | Número ≥ 0, hasta 2 decimales |
| `stock_inicial` | No | Número **> 0**, hasta 2 decimales |

**201**: el insumo creado y, si hubo `stock_inicial`, el movimiento con el que entró:

```json
{
  "insumo": { "id_insumo": 12, "nombre": "Queso costeño", "unidad": "g", "stock_actual": 2000, "stock_minimo": 500, "activo": true, "bajo": false, "agotado": false, "actualizado_en": "..." },
  "movimiento": { "id": 44, "tipo": "entrada", "cantidad": 2000, "stock_resultante": 2000, "motivo": "Stock inicial", "id_usuario": 1, "creado_en": "..." }
}
```

- **El insumo nace con `stock_actual = 0` y el stock inicial entra como un movimiento
  `entrada`**, en la **misma transacción**. Así `SUM(cantidad) = stock_actual` se cumple desde
  la primera fila: si el stock inicial se escribiera en la columna, el libro arrancaría torcido
  y ningún informe cuadraría nunca.
- Sin `stock_inicial` no hay movimiento y `movimiento` sale en `null`. Es lo normal al dar de
  alta algo que todavía no ha llegado.
- **409 `nombre_en_uso`** si ya existe un insumo con ese nombre (índice único de la tabla):

```json
{ "error": "Ya hay un insumo con ese nombre", "motivo": "nombre_en_uso" }
```

### PUT /inventario/insumos/:id — admin

Parcial: solo lo que se manda. Al menos un campo, o **400**.

```json
{ "stock_minimo": 800, "activo": false }
```

| Campo | Regla |
|---|---|
| `nombre` | Texto 1–80, único (**409 `nombre_en_uso`**) |
| `unidad` | `porcion`, `unidad`, `g`, `ml` |
| `stock_minimo` | Número ≥ 0, hasta 2 decimales |
| `activo` | Booleano estricto (`"false"` o `0` son **400**) |

**200** devuelve el insumo ya actualizado. El cuerpo es `.strict()`: una clave de más es
**400**, y eso incluye **`stock_actual`**, que se rechaza en vez de ignorarse para que nadie
crea haber corregido el stock con un PUT que no lo toca. Para eso están los movimientos.

**No existe `DELETE`. Un insumo no se borra: se desactiva** con `{"activo": false}`.

- Las recetas lo referencian con `ON DELETE RESTRICT` y los movimientos también: borrarlo
  sería borrar el libro de inventario, que es justo lo que no se puede perder.
- Desactivarlo **cuenta como "no hay"**: `fn_recalcular_*` trata un insumo inactivo igual que
  uno sin stock, así que **los platos y las opciones que lo usan pasan a no disponibles** y
  salen sus avisos por el canal. Volver a activarlo los recupera.
- `stock_minimo` **no dispara ningún aviso** al cambiarlo (el trigger solo mira `stock_actual`
  y `activo`): el panel ve la lista al abrir con `?estado=bajo`.

### POST /inventario/insumos/:id/movimientos — admin

El único camino para mover el stock.

```json
{ "tipo": "entrada", "cantidad": 2000, "motivo": "Compra del proveedor" }
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `tipo` | Sí | `entrada`, `ajuste` o `merma`. **Nada más**: `reserva` y `devolucion` los escribe la base al pedir o al cancelar, y mandarlos a mano descuadraría el libro |
| `cantidad` | Sí | `entrada` y `merma`: **> 0** (el tipo ya dice el signo). `ajuste`: cualquier número **≠ 0**, con signo. Hasta 2 decimales |
| `motivo` | No | Texto hasta 500 |

**201**:

```json
{
  "movimiento": { "id": 44, "id_insumo": 12, "tipo": "merma", "cantidad": -50, "stock_resultante": 1950, "id_detalle": null, "id_usuario": 1, "motivo": "Se cayó una bandeja", "creado_en": "..." },
  "stock_actual": 1950
}
```

- Lo hace **`registrar_movimiento_inventario`**, no un UPDATE del backend: ella bloquea el
  insumo (`FOR UPDATE`), comprueba que no quede negativo, escribe la fila y devuelve el
  movimiento. `cantidad` sale **con el signo con el que se guardó** (una merma de 50 es `-50`).
- **El autor es el del JWT.** La función lo lee de `app.id_usuario` con
  `fn_usuario_de_sesion()`, así que el backend hace
  `SELECT set_config('app.id_usuario', '<id>', true)` **en la misma transacción** (con
  `is_local`, para que no se filtre a la siguiente petición del pool). Nunca sale del cuerpo.
- `ajuste` con signo es lo que permite **corregir un conteo** en los dos sentidos
  (`-12` tras un recuento físico). Es lo que acepta la función, y por eso aquí la regla de
  "cantidad > 0" aplica a `entrada` y `merma`, no a `ajuste`.
- **400 `movimiento_invalido`** si el movimiento dejaría el stock en negativo (SQLSTATE
  **SD002**, ya traducido en el PR 1), con el stock que hay ahora:

```json
{ "error": "El movimiento dejaría \"Queso costeño\" en negativo: hay 450.00 g", "motivo": "movimiento_invalido", "stock_actual": 450 }
```

- **404** si el insumo no existe. **400** de zod si `tipo` no es uno de los tres o `cantidad`
  no cumple: se valida en el backend **antes** de llamar a la función, porque la base lo
  rechazaría con un `check_violation` (23514) que el manejador central traduce a un **422**
  opaco ("un dato está fuera del rango permitido"), y aquí sí se puede decir qué campo falla.
- Un movimiento sobre un insumo **desactivado** se acepta: hay que poder cuadrar el libro de
  algo que ya no se usa. Lo que no cambia es la disponibilidad, que sigue en "no hay".
- La base publica `stock_bajo` —y el panel recibe `inventario:alerta` en vivo— si el
  movimiento **cruza el mínimo hacia abajo** o si **deja el insumo en 0** viniendo de más de 0,
  **aunque ya estuviera bajo el mínimo** (script 28, G-06). Nunca en cada movimiento: un
  insumo que sigue bajando por debajo del mínimo sin llegar a 0 no vuelve a avisar. El detalle
  de los dos casos está en
  [Cuándo sale `stock_bajo`](#avisos-de-inventario-en-vivo-d-17). Si el movimiento deja un
  plato sin stock, llega además su `plato:disponibilidad`.

### GET /inventario/insumos/:id/movimientos — admin

El libro del insumo, **lo más reciente primero**.

| Parámetro | Valores | Por omisión |
|---|---|---|
| `limite` | 1–200 | 50 |
| `desde` | Fecha ISO 8601; solo los movimientos desde ese instante | — |

```json
{
  "movimientos": [
    { "id": 44, "tipo": "merma", "cantidad": -50, "stock_resultante": 1950, "id_detalle": null, "id_usuario": 1, "motivo": "Se cayó una bandeja", "creado_en": "2026-11-08T12:00:00.000Z" },
    { "id": 43, "tipo": "reserva", "cantidad": -2, "stock_resultante": 2000, "id_detalle": 701, "id_usuario": null, "motivo": "Pedido 87", "creado_en": "2026-11-08T11:40:00.000Z" }
  ]
}
```

- Salen **todos** los tipos, incluidos los que escribe la base al pedir (`reserva`,
  `devolucion`, `merma` con `id_detalle`): es el libro, y sin ellos no cuadraría con el stock.
- `id_detalle` dice de qué ítem de pedido salió el movimiento; `id_usuario` puede ser `null`
  (lo hizo la reserva de un comensal, o el usuario se borró después: la FK es
  `ON DELETE SET NULL`).
- No se devuelve el nombre del usuario: esta ruta no es un informe y unir con `usuarios`
  publicaría datos del personal en una lista que el panel ya sabe resolver.
- **400** si `limite` o `desde` no son válidos · **404** si el insumo no existe (para no
  confundir "sin movimientos" con "ese id no existe").

### GET /inventario/insumos/:id/usos — admin (D-17 PR 3)

**Dónde se usa ese insumo**: qué platos y qué opciones del constructor lo llevan en su receta,
y cuánto. Es la pregunta de antes de tocarlo —desactivarlo, cambiarle la unidad, cambiar su
receta—: *si lo toco, qué se cae*. Con `PUT /inventario/insumos/:id {"activo": false}` el panel
puede avisar exactamente qué platos van a quedar en "no hay".

```json
{
  "id_insumo": 12,
  "nombre": "Queso costeño",
  "platos": [
    { "id": 1004, "nombre": "Nachos Supremos", "cantidad": 30 }
  ],
  "ingredientes": [
    {
      "id": 7,
      "nombre": "Queso Extra",
      "id_plato": 1001,
      "plato": "Bowl Personalizado",
      "id_paso": 6,
      "paso": "Añade Toppings",
      "paso_orden": 3,
      "cantidad": 15
    }
  ]
}
```

- `cantidad` es lo que consume **una unidad** del plato, o **una porción normal** de la opción
  (la base multiplica esta última por `factores_porcion`: `ligera` 0.5, `normal` 1, `extra`
  1.5). Llega como **número**, no como texto.
- Las opciones traen su `plato`, su `paso` y `paso_orden`, igual que en
  [`GET /inventario/carta`](#get-inventariocarta--admin-d-17-pr-3), para que el panel las
  agrupe de la misma forma.
- Orden: los platos por **nombre**; las opciones por **plato**, **`paso_orden`** y **nombre**.
- Un insumo que **no se usa en ninguna receta** devuelve las dos listas vacías. Es lo normal
  en uno recién creado, y es la señal de que se puede desactivar sin romper nada.
- **404** `Insumo no encontrado` si el insumo no existe, y **no** dos listas vacías: "no se usa"
  y "no existe" son cosas distintas. **400** si el `:id` no es un entero positivo.
- Es de **solo lectura**: no cambia nada ni dispara ningún aviso.

### GET /inventario/carta — admin (D-17 PR 3)

La carta entera con **su disponibilidad y si tiene receta**: es lo que necesita la pestaña de
**Recetas** del panel (P-22) para listar de una sola llamada qué hay que configurar y qué está
agotado, sin pedir plato por plato.

Sale de la vista **`v_carta_disponible`** (`database/scripts/27_inventario.sql`), que es quien
decide qué es "disponible": el backend no recalcula nada. A la vista se le añaden, con un JOIN,
los datos que el panel necesita para agrupar y explicar las filas —la categoría del plato, si
es personalizable, y de qué plato y de qué paso (con su orden) es cada opción del
constructor—, que la vista no trae.

```http
GET /api/inventario/carta
Authorization: Bearer <token de admin>
```

```json
{
  "platos": [
    {
      "id": 12,
      "nombre": "Arepa de Huevo",
      "categoria": "Entradas",
      "personalizable": false,
      "disponible": true,
      "stock_suficiente": false,
      "disponible_efectivo": false,
      "motivo": "stock",
      "tiene_receta": true
    },
    {
      "id": 1001,
      "nombre": "Bowl Personalizado",
      "categoria": "Bowls",
      "personalizable": true,
      "disponible": true,
      "stock_suficiente": true,
      "disponible_efectivo": true,
      "motivo": null,
      "tiene_receta": false
    }
  ],
  "ingredientes": [
    {
      "id": 7,
      "nombre": "Panceta Crujiente",
      "id_plato": 1001,
      "plato": "Bowl Personalizado",
      "id_paso": 4,
      "paso": "Proteína",
      "paso_orden": 2,
      "disponible": false,
      "stock_suficiente": true,
      "disponible_efectivo": false,
      "motivo": "manual",
      "tiene_receta": true
    }
  ]
}
```

**Dos listas y no una**, aunque la vista las devuelva juntas con un `tipo`: un plato y una
opción no se pintan igual (la opción cuelga de un paso de su plato) y el panel las muestra en
dos tablas. Separarlas aquí le ahorra filtrar por `tipo` en el cliente, y el `tipo` deja de
hacer falta en cada fila.

| Campo | Qué es |
|---|---|
| `id` | `id_plato` o `id_ingrediente`, según la lista |
| `nombre` | El del plato o de la opción |
| `categoria` | Solo en `platos`: el nombre de su categoría (`null` si no tiene) |
| `personalizable` | Solo en `platos`: si se arma por pasos en el constructor |
| `id_plato`, `plato` | Solo en `ingredientes`: a qué plato pertenece la opción |
| `id_paso`, `paso` | Solo en `ingredientes`: de qué paso del constructor es, con su nombre |
| `paso_orden` | Solo en `ingredientes`: el **orden de ese paso dentro de su plato** (`pasos_constructor.orden`) |
| `disponible` | El **interruptor manual** de la cocina |
| `stock_suficiente` | Lo que **calcula la base** a partir del stock de la receta |
| `disponible_efectivo` | `disponible AND stock_suficiente`: lo que ve el comensal |
| `motivo` | `null` si está disponible · `"manual"` si lo apagó la cocina · `"stock"` si no alcanza el inventario. El manual **gana**: un plato apagado a mano y además sin stock dice `"manual"` |
| `tiene_receta` | Si tiene receta en insumos. En `false` **no controla inventario**: se puede pedir siempre |

**`personalizable` explica un `tiene_receta: false` que NO es un olvido.** Un Bowl, un Wrap o
una Arepa Rellena **consumen por sus opciones**, cada una con su propia receta, así que el
plato no tiene receta propia y está bien así. Sin ese campo, el panel los pintaría en la lista
de "falta configurar" junto a los que de verdad están sin receta.

**`paso_orden` hace falta porque el nombre del paso se repite entre platos** ("Elige tu Salsa"
está en varios): con solo `paso` no se pueden ordenar los pasos como los ve el comensal, ni
distinguir dos pasos homónimos de platos distintos.

- Los `id` y `paso_orden` llegan como **números JSON**, no como texto.
- **Orden fijo, y es parte del contrato**: los platos por **categoría** y luego **nombre**; las
  opciones por **plato**, luego **`paso_orden`** y luego **nombre**. Es el orden en que el panel
  las pinta, así que no tiene que reordenar nada. Un plato sin categoría va primero.
- Salen **todos** los platos y todas las opciones, también los agotados y los apagados a mano:
  es una pantalla de administración, no el menú del comensal (ese es `GET /menu`, que solo
  muestra lo disponible).

**Filtros opcionales** (`.strict()`: un parámetro que no esté aquí es **400**):

| Parámetro | Valores | Qué hace |
|---|---|---|
| `tipo` | `plato`, `ingrediente` | Devuelve solo esa lista; la otra viaja **vacía**, no se omite |
| `sin_receta` | `true`, `false` | Con `true`, solo lo que **no tiene receta**: es la lista de "falta configurar" de la pestaña |
| `q` | Texto, hasta 80 | Busca por **nombre** como texto **literal** (sin comodines: `%`, `_` y `\` se escapan, con `ESCAPE '\'`), sin distinguir mayúsculas pero sí acentos. Va parametrizado, nunca pegado al SQL |

```http
GET /api/inventario/carta?sin_receta=true&tipo=plato
GET /api/inventario/carta?q=arepa
```

- `sin_receta=true` filtra **solo por `tiene_receta = false`**, sin mirar `personalizable`: un
  Bowl personalizable sin receta propia **sí sale** en esa lista, y es el panel el que decide
  cómo mostrarlo con el campo `personalizable`. El filtro no esconde nada por su cuenta.
- Un valor fuera de la lista es **400** y no se ignora: un `?tipo=platos` que devolviera todo
  haría creer al panel que no hay nada pendiente de configurar.
- `q` filtra por el nombre del plato o de la opción, no por el del plato padre: buscar "bowl"
  no trae todas sus opciones.
- Con `tipo=ingrediente`, la respuesta sigue trayendo `"platos": []`, para que el cliente no
  tenga que comprobar si la clave existe.

**Qué cambia la disponibilidad.** Nada de esta ruta: es de solo lectura. La cambian un
movimiento de inventario, activar o desactivar un insumo, editar una receta
(`PUT /platos/:id/receta`) o el interruptor manual (`PATCH /platos/:id/disponible`). La base
recalcula y publica el aviso por el canal `inventario`, y el panel lo recibe en vivo como
`plato:disponibilidad` o `ingrediente:disponibilidad` (ver
[Avisos de inventario en vivo](#avisos-de-inventario-en-vivo-d-17)): esta llamada es para
**cargar la pantalla**, no para refrescarla en bucle.

### GET /platos/:id/receta y GET /ingredientes/:id/receta — admin

Lo que consume **una unidad** del plato, o **una porción normal** de la opción.

```json
{
  "id_plato": 12,
  "receta": [
    { "id_insumo": 3, "nombre": "Masa", "unidad": "porcion", "cantidad": 1, "stock_actual": 40, "activo": true },
    { "id_insumo": 12, "nombre": "Queso costeño", "unidad": "g", "cantidad": 30, "stock_actual": 450, "activo": true }
  ]
}
```

En `/ingredientes/:id/receta` la clave es `id_ingrediente` y el resto es igual. Una receta
vacía es `{"receta": []}` y significa que **ese plato u opción no controla inventario**: se
puede pedir siempre (`tiene_receta` en `v_carta_disponible` sale en `false`).

**400** si el `:id` no es un entero positivo · **404** si el plato o la opción no existen.

### PUT /platos/:id/receta y PUT /ingredientes/:id/receta — admin

**Reemplaza la receta completa**, en una transacción:

```json
{ "insumos": [{ "id_insumo": 3, "cantidad": 1 }, { "id_insumo": 12, "cantidad": 30 }] }
```

| Campo | Regla |
|---|---|
| `insumos` | Arreglo de 0 a 50 entradas. **Sin `id_insumo` repetidos** (sería ambiguo: la tabla tiene PK `(id_plato, id_insumo)`) |
| `id_insumo` | Entero positivo |
| `cantidad` | Número **> 0**, hasta 2 decimales (el CHECK de la tabla exige `> 0`) |

**200** devuelve la receta ya guardada, en el mismo formato que el `GET`.

- **Es un reemplazo, no un parche**: se borra la receta anterior y se insertan las entradas
  nuevas, todo en la misma transacción. Un `PUT` con `{"insumos": []}` **deja el plato sin
  receta** y por tanto sin control de inventario; es la forma de quitarla.
- Para la opción del constructor, `cantidad` es la de la **porción normal**. La base la
  multiplica por `factores_porcion` (`ligera` 0.5, `normal` 1, `extra` 1.5).
- **La disponibilidad cambia al guardar.** Los triggers `tr_receta_plato` y
  `tr_receta_ingrediente` recalculan el plato o la opción con la receta nueva, así que un plato
  puede quedar **no disponible en el mismo PUT** si algún insumo de la receta no alcanza para
  una unidad. Sale su aviso por el canal y el panel y las mesas lo ven al instante.
- **409 `insumo_inexistente`** si alguna entrada apunta a un `id_insumo` que no existe (la FK
  de la receta):

```json
{ "error": "Alguno de los insumos de la receta no existe", "motivo": "insumo_inexistente" }
```

- **400 `insumo_repetido`** si el mismo `id_insumo` aparece dos veces, con el id que choca:

```json
{ "error": "El insumo 3 está repetido en la receta", "motivo": "insumo_repetido" }
```

- **404** si el plato o la opción no existen. Un insumo **desactivado** sí se puede poner en
  una receta (se está preparando el cambio), pero deja el plato en "no hay" hasta que vuelva.

### Lo que este PR NO hace

- **No toca `stock_actual` directamente** por ninguna ruta, ni ofrece un `DELETE` de insumos.
- **No da de baja recetas por plato borrado**: eso ya lo hace la base con
  `ON DELETE CASCADE` sobre `platos` e `ingredientes`.
- **No expone `movimientos_inventario` completo** (sin filtrar por insumo) ni informes de
  consumo: son de reportes y van con su propia agregación en SQL.

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

### Inventario: SD001 y SD002 (P-19 · los traduce D-17)

Dos SQLSTATE propios del inventario (`database/scripts/27_inventario.sql`). Los dos traen en
el **DETAIL** un JSON (en `pg`: `err.detail`) que el backend parsea. La traducción vive en
`src/middleware/inventario-errores.js` y la aplica el **manejador central**, así que vale para
cualquier ruta que acabe tocando el inventario.

| SQLSTATE | Cuándo | Status | Cuerpo |
|---|---|---|---|
| **SD001** "sin stock" | Al pedir: la reserva no alcanza para el pedido completo | **409** | `{ "error": "...", "motivo": "sin_stock", "faltantes": [{ "tipo", "id", "nombre" }] }` |
| **SD002** "stock negativo" | `registrar_movimiento_inventario` (merma o ajuste) dejaría el stock bajo 0 | **400** | `{ "error": "...", "motivo": "movimiento_invalido", "stock_actual": 450 }` |
| `El ingrediente "X" está agotado` (**P0001**) | Interruptor manual de una opción, anterior a P-19 | **409** | `{ "error": "...", "motivo": "ingrediente_agotado" }` |

> La convención de errores de esta API es **`{ error, motivo }`** (decisión de Jarrison).
> `motivo` es el código estable que el cliente compara; `error` es el texto para leer. **No se
> usa `codigo`**: la versión anterior de este documento prometía un `codigo: "SIN_STOCK"` que
> el backend nunca envía.

**SD001**: `DETAIL = {"faltantes":[{ "tipo", "id", "nombre", "id_insumo", "insumo", "necesita", "hay" }]}`.

```json
{
  "error": "Sin stock suficiente para el pedido 87",
  "motivo": "sin_stock",
  "faltantes": [
    { "tipo": "plato", "id": 12, "nombre": "Arepa de Huevo" },
    { "tipo": "ingrediente", "id": 7, "nombre": "Panceta Crujiente" }
  ]
}
```

- `tipo` es `"plato"` o `"ingrediente"`, e `id`/`nombre` dicen **qué quitar del carrito**.
- **Al cliente solo van `tipo`, `id` y `nombre`, y sin repetir**: el pedido lo puede hacer un
  comensal anónimo desde su teléfono y las cantidades de bodega no son asunto suyo.
  `id_insumo`, `insumo`, `necesita` y `hay` quedan **solo en el log del servidor**, que es
  donde hacen falta para reponer.
- Se **deduplica por `tipo` + `id`**: la base arma los faltantes por INSUMO, así que un plato
  al que le faltan tres insumos sale tres veces en el DETAIL y al cliente se le diría tres
  veces que quite el mismo plato. Un plato y una opción con el mismo `id` **no** se pisan.
- Los faltantes del constructor pueden traer `id_insumo`, `insumo`, `necesita` y `hay` en
  `null` cuando lo que falta son las **opciones de un paso obligatorio**; siguen siendo
  faltantes válidos y salen igual.
- Si el DETAIL **no se puede parsear**, la respuesta sigue siendo **409 `sin_stock`** con
  `faltantes: []`. Un detalle ilegible no convierte en 500 un error que el cliente sabe
  atender; `nombre` va en `null` si la base no lo manda.
- **Puede llegar en el `COMMIT`**, no en el `INSERT`: la reserva es un trigger **diferido**
  (`tr_reservar_inventario`) que corre al confirmar, para ver el pedido entero con sus
  ingredientes. El `try/catch` de `crearConDetalles` **envuelve también el `COMMIT`**, y el
  `ROLLBACK` del catch está protegido para que no tape el SD001 (tras un COMMIT fallido la
  transacción ya está deshecha y ese ROLLBACK solo avisa "no hay transacción en curso").
  Si el plato ya **figuraba** sin stock, llega antes, en el `INSERT` del detalle, con el mismo
  formato y la misma respuesta. Ojo con el reparto: el trigger del `INSERT` mira la **bandera**
  `platos.stock_suficiente`, que la base calcula para **una unidad**, así que pedir 5 de un
  plato que alcanza para 1 **pasa el INSERT** y falla en el `COMMIT`. Para el cliente es el
  mismo 409; para quien depure, el camino normal del "no alcanza por la cantidad" es el COMMIT.
- Se revierte el **pedido entero**: no queda ningún detalle ni ninguna reserva, y no se avisa
  al socket-server de un pedido que no existe.
- Reintentar no sirve; el cliente quita lo agotado y reenvía.

**SD002**: `DETAIL = {"id_insumo", "insumo", "stock_actual", "cantidad"}` (`cantidad` con
signo: lo que se intentó mover). El `MESSAGE` ya está en lenguaje para el usuario y se usa tal
cual: `El movimiento dejaría "Queso" en negativo: hay 450.00 g`. `stock_actual` sale del
DETAIL; si no se puede leer, el campo **no se inventa** y el mensaje ya lleva el dato.

**`ingrediente_agotado`** se reconoce con una expresión **estricta** (anclada y solo con
P0001) porque `fn_tr_validar_detalle_ingrediente` lanza otros cinco P0001 ("no pertenece al
plato", "no es personalizable", "el pedido ya está en estado X"…): un `includes` los marcaría
todos como agotados y el cliente actuaría sobre el ingrediente cuando el problema es otro.
Esos otros P0001 siguen saliendo como el **409 de siempre, sin `motivo`**.

**`OVERRIDE_ADMIN` no salta el stock.** El bypass de `notas_especiales` que acepta
`fn_tr_validar_disponibilidad_plato` solo vale para el **interruptor manual** de la cocina
(`platos.disponible`). El stock se comprueba después y en la reserva, así que un pedido con
`OVERRIDE_ADMIN` puede dar **SD001 igualmente**, y lo normal es que lo dé en el **COMMIT**.
No hay forma de comandar por encima del inventario: el libro de `movimientos_inventario` no
cuadraría.

**Un deadlock al crear el pedido (40P01) es 503 `reintentar`.** La reserva bloquea los insumos
del pedido en orden de `id_insumo` justo para no cruzarse con otra transacción, pero un 40P01
sigue siendo posible. `POST /api/pedidos` **no acepta ninguna clave de idempotencia**, así que
el backend **no reintenta por su cuenta**: repetir la petición podría dejar la comanda
duplicada. Se responde `{ "error": "intenta de nuevo", "motivo": "reintentar" }` y lo reenvía
el cliente. En el resto de las rutas, un 40P01 sigue siendo el **409** genérico de concurrencia
del manejador central.

### Avisos de inventario en vivo (D-17)

`27_inventario.sql` publica en el canal `inventario` de PostgreSQL (`pg_notify`), y **solo si
la transacción se confirma**:

```json
{"tipo":"disponibilidad","entidad":"plato","id":12,"disponible":false,"motivo":"stock"}
{"tipo":"stock_bajo","id_insumo":12,"nombre":"Queso costeño","unidad":"g","stock_actual":450,"stock_minimo":500}
```

El backend los escucha en `src/services/inventario-avisos.js` y los reenvía al socket-server:

| Aviso | Ruta interna | Notas |
|---|---|---|
| `disponibilidad` de un plato | `POST /internal/plato-disponibilidad` | lo que viaja es el **efectivo** (`disponible AND stock_suficiente`) |
| `disponibilidad` de una opción | `POST /internal/ingrediente-disponibilidad` | igual |
| `stock_bajo` | `POST /internal/inventario-alerta` | contrato de EVENTS.md §5.5 (Estable, R-20.2) |

- **Conexión dedicada, no una del pool.** `LISTEN` vive en la conexión: una del pool se
  devuelve en cuanto acaba la consulta y la siguiente petición la usaría —con su `LISTEN`
  puesto— para otra cosa, o `idleTimeoutMillis` la cerraría y el canal quedaría muerto sin que
  nadie se enterara. Esa conexión tampoco lleva `statement_timeout`: el recálculo del arranque
  recorre toda la carta.
- **Con `eventId` y reintentos.** Estos avisos van **siempre** con reintento
  (`enviarConReintento`: 3 intentos, 150 ms, solo ante `500/502/503 ERROR_INTERNO`), porque
  nadie está esperando la respuesta y el aviso no se guarda en ningún sitio: si se pierde, la
  carta queda desfasada en las mesas hasta el próximo movimiento. Las rutas del personal
  (`PATCH /platos/:id/disponible`) siguen con un solo intento, como antes.
- **Los números tienen que ser números.** Los del `pg_notify` ya son números JSON, pero los
  `NUMERIC` de una **consulta** con `pg` llegan como texto (`'450.00'`), y el socket-server
  responde `400 PAYLOAD_INVALIDO` a un `stock_actual` de texto. Se convierten antes de
  reenviarlos.
- `agotado` y `emitidoEn` **no se mandan**: los pone el socket-server al emitir.
- Un payload **ilegible o incompleto se ignora** y se registra: el canal lo llena la base, así
  que un aviso raro es un script más nuevo o un cambio de contrato, nunca algo que deba cortar
  el oyente.

**Al arrancar el backend** (el caso "estaba caído cuando cambió el stock"), en este orden:

1. `LISTEN inventario` **primero**, para no perder nada desde ese momento. Si se recalculara
   antes, los avisos de ese propio recálculo se emitirían con el canal todavía sin escuchar.
2. `SELECT fn_recalcular_toda_la_carta()`. Corrige cualquier `stock_suficiente` desfasado y lo
   que cambie sale por `pg_notify` como siempre; devuelve **solo cuántos** cambiaron.
3. Los avisos emitidos mientras el backend no estaba **se perdieron**, y el recálculo no los
   repite (si el estado ya era correcto, no hay cambio que notificar). Así que se lee
   `v_carta_disponible` (`tipo`, `id`, `disponible_efectivo`, `motivo`) y se **emite la
   disponibilidad de cada plato y de cada opción**. Las apps además recargan el menú al
   reconectar.

Si el socket-server no responde, la emisión de la carta se **abandona tras 5 fallos seguidos**:
los demás van a fallar igual y serían minutos de timeouts y decenas de líneas idénticas en el
log. **Si se cae la conexión del canal**, se reconecta con espera creciente (1 s, 2 s, 4 s…
hasta 30 s), se vuelve a hacer `LISTEN` y se repiten los pasos 2 y 3. El apagado ordenado
cierra esa conexión y **cancela la reconexión pendiente** antes de cerrar el pool.

**Nada de esto puede tumbar el backend ni una petición**: el tiempo real es un extra. El
backend arranca y sirve igual sin Redis, sin socket-server y con el canal cerrado.

**`stock_minimo` no dispara ningún aviso al cambiarlo.** El trigger `tr_insumo_recalcular` solo
mira `stock_actual` y `activo`, así que subir el mínimo de un insumo que ya está por debajo
**no** avisa: el panel ve esa lista al abrir, con
[`GET /inventario/insumos?estado=bajo`](#get-inventarioinsumos--admin), que lee esa misma
vista. `inventario:alerta` es solo para los avisos en vivo, y el propio contrato de Roberto
dice que no se guardan.

**Cuándo sale `stock_bajo` (script 28, G-06).** La base avisa en dos casos, con el **mismo**
payload, y nunca en cada movimiento:

1. el insumo **cruza su mínimo hacia abajo** (estaba sobre el mínimo, o inactivo, y queda en o
   bajo él), o
2. el insumo **llega a 0** desde más de 0, **aunque ya estuviera bajo el mínimo**. Es lo que
   pide EVENTS.md §5.5 ("o llega a 0"); hasta el script 27 este caso no avisaba.

Un mismo cambio de stock avisa una sola vez aunque cumpla los dos (p. ej. mínimo 0 y llega a
0). Un pedido que en la **misma transacción** cruza el mínimo y luego llega a 0 (dos detalles
del mismo insumo) deja **dos** avisos, uno con el stock que quedó bajo y otro con `0`: el
socket-server marca el segundo con `agotado: true`. Lo prueba
`database/tests/test_g06_aviso_agotado.sh`.

### El autor que ya no existe: 409 `autor_inexistente`

Varias escrituras del panel anotan **quién** las hizo, y ese id sale del JWT. Si el usuario se
borró mientras su sesión seguía viva, la escritura choca contra la clave ajena de `usuarios` y
PostgreSQL devuelve **23503**. Antes salía como el 409 genérico de clave ajena —"La operación
choca con otro registro relacionado", sin `motivo`—, que no dice que el problema sea la propia
sesión. Ahora:

```json
{ "error": "Tu usuario ya no existe; vuelve a iniciar sesión", "motivo": "autor_inexistente" }
```

**Status 409.** El cliente no puede arreglarlo reintentando ni corrigiendo el cuerpo: lo que
toca es volver a entrar. El mensaje no nombra tablas ni constraints, porque a quien está en el
panel no le sirve saber qué fila chocó.

Dónde puede salir, y qué clave ajena lo provoca (los nombres están comprobados contra la base,
y **no** siguen todos el mismo patrón: el de `movimientos_inventario` lo generó PostgreSQL):

| Ruta | Qué lo escribe | Clave ajena |
|---|---|---|
| `PUT /platos/:id` (cuando cambia el precio) | `tr_historial_precio_plato` → `historial_precios.id_usuario` | `fk_historial_precios_usuario` |
| `PUT /ingredientes/:id` (cuando cambia `precio_extra`) | `tr_historial_precio_ingrediente` → la misma tabla | `fk_historial_precios_usuario` |
| `PUT /configuracion` | `tr_configuracion_actualizada` → `configuracion_restaurante.actualizado_por` | `fk_configuracion_actualizado_por` |
| `POST /inventario/insumos/:id/movimientos` y `POST /inventario/insumos` con `stock_inicial` | `registrar_movimiento_inventario` → `movimientos_inventario.id_usuario` | `movimientos_inventario_id_usuario_fkey` |
| `POST /pedidos` | el INSERT de `historial_estados` que deja el pedido en `recibido` | `fk_historial_usuario` |
| `PATCH /pedidos/:id/estado` y `PATCH /kds/comandas/:id/estado` | la línea de `historial_estados` de cada cambio de estado (el KDS pasa por el mismo servicio) | `fk_historial_usuario` |
| `POST /transacciones`, cuando el cobro liquida un pedido ya entregado | la línea de `historial_estados` del paso a `pagado` | `fk_historial_usuario` |
| `POST /transacciones/mesa`, cuando el reparto liquida algún pedido entregado | la línea de `historial_estados` del paso a `pagado` (`Pago en caja`, con el id de quien cobra) | `fk_historial_usuario` |

- **La transacción se deshace entera**: el precio no cambia, la configuración se queda como
  estaba, el stock no se mueve (el libro de inventario sigue cuadrando) y del pedido no queda
  nada: ni la fila de `pedidos`, ni sus detalles, ni el descuento de insumos.
- Se mira el **nombre del constraint**, no solo el SQLSTATE: un 23503 de otra cosa —una
  categoría que no existe, un insumo que no existe— significa algo distinto y conserva su
  propio motivo. La cuenta vive en un solo sitio,
  [`src/services/autor-inexistente.js`](../src/services/autor-inexistente.js), para que ningún
  camino pueda discrepar de otro.
- `id_usuario` **en `null` es válido** y no da este error: así quedan los movimientos que
  genera un pedido de un comensal, que no tiene usuario.
- **`POST /platos` no entra en la lista**, aunque comparta sección con el `PUT`:
  `tr_historial_precio_plato` es `AFTER UPDATE OF precio`, así que **crear** un plato nunca
  escribe en `historial_precios` y no hay autor que validar. Comprobado contra PostgreSQL: un
  `POST /platos` —y un `INSERT` a pelo con `app.id_usuario` apuntando a un usuario que no
  existe— pasan sin error. El `tr_auditar_platos` del INSERT sí corre, pero
  `auditoria_cambios.usuario_id` no recibe el id del JWT.

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

## API v1 · Clientes (D-19)

> **Contrato. Implementación después de la P-23.** Nada de esta sección existe todavía en
> el código: es el acuerdo para que la app móvil (Juan) y la base (Jarrison) puedan
> avanzar en paralelo. **Todo va bajo `/api/v1`, nada en `/api`.**

### El prefijo `/api/v1` (ya montado, D-19 parte A)

La API completa responde también en `/api/v1/...` con el **mismo router**
(`src/routes/montaje.js`): mismas rutas, auth, roles, CORS, 404 y errores. `/api` sigue igual
y es compatible hacia atrás (PWA, panel y KDS no cambian). Los **límites de peticiones son
compartidos**: `/api/x` y `/api/v1/x` gastan el mismo cupo (el global cuenta por IP; los de
login y QR son la misma instancia en los dos prefijos). **Fuera de v1** queda el canal
interno servidor-a-servidor (`.../internal`, `.../interno`): lo llama el socket-server con URL
fija y `x-internal-key`; en `/api/v1` responde 404. Las rutas de clientes de abajo nacen
**solo** en `/api/v1`.

### Sesión del cliente: JWT corto + refresh token

| | Valor |
|---|---|
| JWT (`token`) | `rol: "cliente"`, `sub: id_cliente`. Vida corta: **15 min** (`JWT_CLIENTE_EXPIRES_IN`, configurable). **Mismo algoritmo y secreto** que hoy: HS256 (`ALGORITMO_JWT`) con `JWT_SECRET`. |
| `refresh_token` | **Opaco y aleatorio** (32 bytes, `crypto.randomBytes`, en base64url). En la base se guarda **solo su hash SHA-256**, nunca el valor. Vida **30 días** (`REFRESH_CLIENTE_DIAS`, configurable). Pertenece a una **familia** (la de su primer login) para detectar reuso. |
| `expira_en` | Cuándo vence el `token`, en ISO 8601 UTC. |

- **Separación de roles:** un JWT de cliente **no entra** a rutas de staff ni de comensal
  (`requireRole` no tiene `cliente` en ninguna de ellas → 403), y un JWT de staff o de
  comensal **no entra** a las de cliente (403).
- **Contraseñas:** el **mismo algoritmo y costo** que el login del personal: **bcrypt con
  costo 10** (`COSTO_BCRYPT` en `auth.controller.js`), y las mismas reglas de clave nueva
  (`utils/clave-bcrypt.js`): **mínimo 8 caracteres** y **máximo 72 bytes** en UTF-8 (bcrypt
  ignora en silencio lo que pasa de 72 bytes; una tilde ocupa 2 y un emoji 4).
- **Límites de peticiones propios** (además del global): registro, login y refresh, cada
  uno con su contador por IP (el login, por IP **y** correo, como el del personal).

### Autenticación

| Método y ruta | Cuerpo | Éxito | Errores |
|---|---|---|---|
| `POST /api/v1/auth/clientes/registro` | `{ nombre, correo, password, telefono? }` | **201** `{ cliente, token, refresh_token, expira_en }` | **409** `correo_registrado` · **400** `nombre_invalido`, `correo_invalido`, `clave_corta`, `clave_larga`, `telefono_invalido`, `cuerpo_invalido` · 429 |
| `POST /api/v1/auth/clientes/login` | `{ correo, password }` | **200** `{ cliente, token, refresh_token, expira_en }` | **401** `credenciales_invalidas` · 400 `cuerpo_invalido` · 429 |
| `POST /api/v1/auth/clientes/refresh` | `{ refresh_token }` | **200** `{ token, refresh_token, expira_en }` | **401** `refresh_invalido` (no existe o venció) · **401** `sesion_revocada` (reuso) · 429 |
| `POST /api/v1/auth/clientes/logout` | `{ refresh_token }` + `Authorization: Bearer <token>` | **204** | 401 sin JWT de cliente |

- **Login sin enumeración:** el **mismo 401 y el mismo mensaje** si el correo no existe o si
  la clave falla, y el **mismo tiempo de respuesta**: con un correo que no existe se compara
  contra un hash ficticio del mismo costo (como `HASH_FICTICIO` en el login del personal).
- **Rotación del refresh:** cada uso emite un `refresh_token` **nuevo** (misma familia) e
  invalida el anterior (`reemplazado_por`). Si llega uno **ya rotado** (reuso: alguien copió
  un token viejo), se **revoca toda la familia** y se responde **401** `sesion_revocada`; el
  cliente vuelve a iniciar sesión.
- **Logout:** revoca **ese** refresh token (no la familia entera ni otras sesiones del
  cliente). El JWT sigue valiendo hasta su vencimiento corto (15 min).
- `cliente` es `{ id_cliente, nombre, correo, telefono }`, nunca el hash.

### Perfil

| Método y ruta | Auth | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /api/v1/clientes/yo` | cliente | — | **200** `{ cliente }` |
| `PATCH /api/v1/clientes/yo` | cliente | `{ nombre?, telefono? }` (zod `.strict()`, al menos uno) | **200** `{ cliente }` · 400 `cuerpo_invalido` |

El cliente sale del JWT (`sub`); no hay `:id` en la ruta.

### Direcciones

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `GET /api/v1/clientes/yo/direcciones` | cliente | **200** `{ direcciones }` (la principal primero) |
| `POST /api/v1/clientes/yo/direcciones` | cliente | **201** `{ direccion }` |
| `PATCH /api/v1/clientes/yo/direcciones/:id` | cliente | **200** `{ direccion }` |
| `DELETE /api/v1/clientes/yo/direcciones/:id` | cliente | **204** |

- Campos: `direccion` (obligatorio), `barrio` (obligatorio), `referencia?`, `lat?`, `lng?`
  (los dos o ninguno; rango válido), `principal` (booleano).
- **Una sola principal por cliente**: marcar una como `principal: true` desmarca la anterior
  en la misma transacción. La primera dirección de un cliente nace principal.
- **404** si `:id` no existe **o no es del cliente** (no se distingue, para no revelar
  direcciones ajenas). 400 `cuerpo_invalido` con zod `.strict()`.

### Zonas de entrega

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `GET /api/v1/zonas` | **pública** | **200** `{ zonas: [{ id_zona, nombre, barrios, costo_envio, tiempo_estimado_min }] }`, **solo las activas** |
| `GET /api/v1/zonas/cotizar?id_direccion=N` | cliente | **200** `{ zona: { id_zona, nombre, tiempo_estimado_min }, costo_envio }` · **422** `fuera_de_cobertura` · 404 si la dirección no es del cliente |

`costo_envio` es un número JSON en pesos, como el resto de montos del panel; `barrios` es una
lista de textos.

### Diferencias con `app-movil/src/services/authService.js`

Lo que Juan debe ajustar en la app para usar este contrato (el archivo hoy solo define los
contratos esperados y no llama a nada):

| Hoy en la app | En el contrato |
|---|---|
| `POST /api/auth/clientes/registro`, `/login`, `/refresh`, `/logout` | Prefijo **`/api/v1`**: `POST /api/v1/auth/clientes/...` |
| Respuesta `{ usuario, token, refreshToken }` | `{ cliente, token, refresh_token, expira_en }` (**`usuario` → `cliente`**, **`refreshToken` → `refresh_token`**, y llega **`expira_en`**) |
| `refrescarToken(refreshToken)` → `{ token, refreshToken? }` | Cuerpo `{ refresh_token }` → `{ token, refresh_token, expira_en }`: el refresh **siempre** rota, así que hay que **guardar el nuevo** cada vez (reusar el viejo revoca la sesión con 401 `sesion_revocada`) |
| `cerrarSesion(token)` | `POST /api/v1/auth/clientes/logout` con **`Authorization: Bearer <token>`** y cuerpo **`{ refresh_token }`**; responde **204** sin cuerpo |
| `registrarUsuario({ nombre, correo, password })` | Además acepta `telefono?`; la clave necesita **8 caracteres** como mínimo y **72 bytes** como máximo |
| Errores sin motivo | Leer `motivo` del cuerpo (`correo_registrado`, `credenciales_invalidas`, `sesion_revocada`, `refresh_invalido`, `fuera_de_cobertura`…) |
| Sin manejo de vencimiento | El `token` vive **15 min**: renovar con `/refresh` ante un 401 o antes de `expira_en` |

### Lo que necesita la base (P-23)

**Propuesta para Jarrison, no un script.** Las columnas de `direcciones` y `zonas` siguen los
campos de este contrato (los del plan 5.5: `direccion`, `barrio`, `referencia`, `lat`, `lng`,
`principal`; y `id_zona`, `nombre`, `barrios`, `costo_envio`, `tiempo_estimado_min`). El plan
v1.1 no está en el repositorio, así que las de `clientes` se derivan del contrato y hay que
cuadrarlas con la sección 5.5. La tabla de **refresh tokens es nueva**: la P-23 no la tiene.

```sql
-- clientes
id_cliente      SERIAL PRIMARY KEY
nombre          VARCHAR(80)  NOT NULL
correo          VARCHAR(254) NOT NULL          -- UNIQUE sobre lower(correo)
telefono        VARCHAR(20)  NULL
password_hash   VARCHAR(60)  NOT NULL          -- bcrypt costo 10 ($2b$10$...)
activo          BOOLEAN      NOT NULL DEFAULT TRUE
creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
-- índice: UNIQUE (lower(correo))

-- direcciones_cliente
id_direccion    SERIAL PRIMARY KEY
id_cliente      INTEGER NOT NULL REFERENCES clientes(id_cliente) ON DELETE CASCADE
direccion       VARCHAR(200) NOT NULL
barrio          VARCHAR(80)  NOT NULL
referencia      VARCHAR(200) NULL
lat             NUMERIC(9,6) NULL              -- CHECK entre -90 y 90; lat y lng los dos o ninguno
lng             NUMERIC(9,6) NULL              -- CHECK entre -180 y 180
principal       BOOLEAN NOT NULL DEFAULT FALSE
creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
-- índices: (id_cliente); UNIQUE (id_cliente) WHERE principal  -> una sola principal

-- zonas_entrega
id_zona              SERIAL PRIMARY KEY
nombre               VARCHAR(80) NOT NULL UNIQUE
barrios              TEXT[] NOT NULL DEFAULT '{}'
costo_envio          NUMERIC(10,2) NOT NULL CHECK (costo_envio >= 0)
tiempo_estimado_min  INTEGER NOT NULL CHECK (tiempo_estimado_min > 0)
activa               BOOLEAN NOT NULL DEFAULT TRUE
-- índice: (activa); GIN (barrios) para cotizar por barrio

-- refresh_tokens_cliente  (NUEVA: la P-23 no la tiene)
id               BIGSERIAL PRIMARY KEY
id_cliente       INTEGER NOT NULL REFERENCES clientes(id_cliente) ON DELETE CASCADE
hash             CHAR(64) NOT NULL UNIQUE      -- SHA-256 en hex del refresh token; nunca el valor
familia          UUID NOT NULL                 -- la del primer login; se hereda al rotar
creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
expira_en        TIMESTAMPTZ NOT NULL
revocado_en      TIMESTAMPTZ NULL              -- logout, rotación o reuso de la familia
reemplazado_por  BIGINT NULL REFERENCES refresh_tokens_cliente(id)
-- índices: UNIQUE (hash); (familia); (id_cliente); (expira_en) para la limpieza de vencidos
```

Cómo se usa la tabla de refresh tokens: buscar por `hash` (el UNIQUE es el índice de la
búsqueda); al rotar, en una transacción, marcar el viejo con `revocado_en` y
`reemplazado_por` e insertar el nuevo con la misma `familia`; si llega uno con `revocado_en`
o `reemplazado_por` ya puestos, `UPDATE ... SET revocado_en = now() WHERE familia = $1::uuid
AND revocado_en IS NULL` y 401 `sesion_revocada`.

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
- ~~**`obtener_cuenta_mesa` mezcla sesiones de la misma mesa.**~~ **RESUELTO** por
  `mesas.sesion_iniciada_en` (script 17) y la regla H-02 (script 20): la cuenta filtra por
  `creado_en >= sesion_iniciada_en` y, sin sesión abierta, sale vacía en vez de arrastrar
  el histórico. El backend fija el timestamp al pasar la mesa a `ocupada`; ver
  *GET /mesas/:id/cuenta*.
- **`registrarPago` marca el pedido `pagado` con cualquier cobro `completada`, aunque
  sea parcial.** El trigger solo rechaza el exceso, no el pago de menos, así que abonar
  $1 de una cuenta de $56.000 la deja como cobrada y libera la mesa. `POST
  /transacciones/internal` no tiene ese problema (compara contra el saldo), pero
  `POST /transacciones` sí.
