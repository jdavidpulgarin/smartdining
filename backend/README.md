# SmartDining — Backend + KDS

Responsable: Carlos Ospino (Desarrollador 2 / Integrante 3).

El trabajo va sobre **`develop`**, con una rama por tarea (`feature/…`, `fix/…`, `docs/…`)
que se fusiona por PR. Las ramas `feature/backend` y `feature/frontend-kds` del arranque del
proyecto ya no existen. El frontend del KDS está en **[`/frontend-kds`](../frontend-kds)** y
funciona.

Para levantar el resto de los servicios (Redis, socket-server y los tres frontends) y ver
sus puertos, el **[README.md de la raíz](../README.md)**.

## Modelo de datos

La fuente única de verdad es **[docs/modelo-er.md](docs/modelo-er.md)**, el modelo
entidad-relación definido por Jarrison (dueño de la base de datos). Todas las queries
usan esos nombres: `id_<tabla>` para las PK, `url_imagen`, `token_qr`,
`orden_visualizacion`, `subtotal`, `estado_item`, `estado_anterior`/`estado_nuevo`,
`fecha_cambio`, `metodo_pago`, `estado_transaccion`, `referencia_externa`.

## Reparto de responsabilidades con la base de datos

Acordado con el equipo: **la base es la fuente de verdad** y el backend no replica su
lógica. Ver el detalle en [docs/api-spec.md](docs/api-spec.md).

| La base (triggers de Jarrison) | El backend |
|---|---|
| Totales y subtotales | Autenticación y roles (RBAC) |
| Transiciones de estado (`transiciones_validas`) | Que el body venga bien formado (zod) |
| Disponibilidad del plato | Congelar el precio leyendo `platos.precio` en el INSERT |
| Monto del pago vs. total del pedido | Traducir los errores de la base a HTTP |
| Liberar la mesa y rotar su `token_qr` | Escribir `historial_estados` |

**Traducir los errores de PostgreSQL se decide en un único lugar**,
`src/middleware/errores.middleware.js` (más `inventario-errores.js` para los dos SQLSTATE
del inventario, que el CRUD de insumos reutiliza). Lo que sale hoy:

| SQLSTATE | Qué es | Respuesta |
|---|---|---|
| `P0001` | `RAISE EXCEPTION` de un trigger | **409** con el mensaje del trigger, que está escrito para leerse |
| `23505` unique_violation | Ya existe una fila con esos datos | **409** genérico |
| `23503` foreign_key_violation | Choca con otra fila relacionada | **409** genérico (algunas rutas lo afinan: `categoria_inexistente`, `insumo_inexistente`) |
| `23514` check_violation | El valor no cumple una regla de la columna | **422** con mensaje fijo y opaco |
| Clase `22` (22003, 22001, 22P02…) | Dato fuera de rango o mal formado | **422**, el mismo mensaje |
| `40P01` / `40001` | Deadlock o fallo de serialización | **409** "vuelve a intentarlo". Al **crear un pedido** sale **503 `reintentar`**, porque no hay clave de idempotencia y repetirlo lo duplicaría |
| `57014` query_canceled | Venció `statement_timeout` | **503** |
| `SD001` | Sin stock para el pedido (inventario) | **409** `sin_stock` con los `faltantes` |
| `SD002` | El movimiento dejaría el stock negativo | **400** `movimiento_invalido` con `stock_actual` |
| Cualquier otro | — | **500** genérico, sin exponer el detalle (va al log) |

La tabla completa, con los cuerpos de respuesta y el porqué de cada status, está en
[docs/api-spec.md](docs/api-spec.md).

## Recrear la base de datos local

**Lo carga todo `database/migrar.sh`**, que vive en este repositorio: no hay que traer
`database/` de ninguna otra rama. El script aplica, en orden, los scripts de
`database/scripts/` que la base todavía no tenga registrados en `schema_migraciones`, y
cada uno corre en **una transacción junto con su registro**: o queda aplicado y
registrado, o no queda nada.

Sabe arreglárselas con tres situaciones:

| Situación | Qué hace |
|---|---|
| Base **vacía** | Carga la línea base con `00_ejecutar_todo.sql` —el `schema.sql` como paso `[0/26]`, los scripts 01 a 25 y el `seed.sql` como `[26/26]`— y después los scripts nuevos, del 26 en adelante (hoy son **tres**: `26_configuracion.sql`, `27_inventario.sql` y `28_aviso_insumo_agotado.sql`) |
| Base cargada **antes de P-17** (sin `schema_migraciones`) | Corre solo el 25, que registra 00 a 25 como aplicados, y después los nuevos |
| Base **al día** | Aplica solo lo que falte; si no falta nada, no cambia nada |

> **`00_ejecutar_todo.sql` por sí solo NO alcanza.** Está congelado en la línea base (00 a
> 25) y **no incluye los scripts 26 en adelante** —la configuración del restaurante, el
> inventario y el aviso de agotado—, así que una base cargada solo con el runner deja
> cinco rutas del backend respondiendo 500. Para eso está `migrar.sh`, que corre el runner
> y luego los scripts nuevos.

```bash
# El nombre de la base va en una variable: cambialo y todo el bloque apunta ahi.
export PGDATABASE=smartdining
export PGUSER=postgres
export PGPASSWORD=...            # el de backend/.env

# 1. Recrear la base vacia (si solo quieres aplicar lo que falte, salta al paso 2)
psql -h localhost -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $PGDATABASE;"
psql -h localhost -U "$PGUSER" -d postgres -c "CREATE DATABASE $PGDATABASE ENCODING 'UTF8';"

# 2. Cargar todo: linea base + scripts nuevos. Desde la RAIZ del repositorio.
sh database/migrar.sh

# 3. Solo si el hash del seed no corresponde a la clave demo (el seed ya la trae):
#    desde backend/
psql -h localhost -U "$PGUSER" -d "$PGDATABASE" -f scripts/fijar-password-demo.sql
```

> **Para probar sin tocar tu base, usa otro nombre.** El paso 1 hace `DROP DATABASE`: con
> `export PGDATABASE=smartdining_pruebas` el bloque entero —borrado, creación y
> `migrar.sh`— trabaja sobre esa y tu base de desarrollo no se entera. **Nunca corras
> `migrar.sh` sin tener `PGDATABASE` puesta a lo que quieres**, porque su valor por
> omisión es `smartdining`.

**En Windows**, `migrar.sh` es POSIX `sh` (la imagen `postgres:16-alpine` no trae bash), así
que va con **Git Bash** o equivalente, y conviene indicarle dónde está `psql`:

```bash
PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe" PGUSER=postgres \
  PGDATABASE=smartdining sh database/migrar.sh
```

Con Docker, que es como corre en producción:

```bash
docker compose exec -T postgres sh /smartdining-db/migrar.sh
```

La conexión sale de las variables estándar de PostgreSQL (`PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD`, `PGDATABASE`); dentro del contenedor caen en `POSTGRES_USER` y `POSTGRES_DB`
por el socket local, sin contraseña. Dos variables opcionales: **`PSQL`** (ruta de `psql`,
por omisión el del `PATH`) y **`MIGRAR_SCRIPTS_DIR`** (carpeta de scripts, por omisión
`database/scripts`).

Dos cosas que el script vigila y conviene saber: **un script ya aplicado no se edita nunca**
—si cambia su checksum, `migrar.sh` se detiene con error y el cambio tiene que ir en un
script nuevo— y **no se corren dos migraciones a la vez** sobre la misma base.

**El `seed.sql` no se ejecuta aparte**: la línea base ya lo incluye como su último paso.

Usuarios demo (todos con `Admin123!`): `admin@smartdining.com`,
`cocina@smartdining.com`, `mesero@smartdining.com`, `caja@smartdining.com`.
Token QR de la mesa 1 recién sembrada: `qr-token-mesa-01-a1b2c3d4`.

## Requisitos previos

- **Node.js 22+**. Es la versión del CI (`.github/workflows/ci.yml`) y la que hace falta de
  verdad: `npm test` y `npm run test:cobertura` usan banderas del runner de pruebas que no
  existen en 18 (`--test-coverage-exclude`, el resumen `# cancelled` que vigila el script
  del CI).
- PostgreSQL corriendo localmente, con `database/schema.sql` y `database/seed.sql` de Jarrison ya ejecutados
- Redis **opcional en desarrollo**: sin él todo funciona, solo sin caché (ver [Redis en desarrollo](#redis-en-desarrollo-es-opcional))

## Instalación

```bash
cd backend
npm install
cp .env.example .env
# Edita .env con tus credenciales locales de PostgreSQL/Redis y un JWT_SECRET propio
```

**El `JWT_SECRET` no es opcional: sin uno válido el backend no arranca.** Al iniciar,
`exigirEntornoValido()` corta con código 1 y explica el problema si falta, está vacío, trae
alguno de los valores de ejemplo del `.env.example` (quien haya visto el repositorio podría
firmar tokens válidos) o tiene **menos de 16 caracteres**. Ese mismo valor tiene que estar
también en `socket-server/.env`, o los dos servicios no se reconocerán los tokens.

## Ejecución

```bash
npm run dev     # con nodemon, recarga automática
npm start       # modo normal
```

**Para desarrollar, `npm run dev`, no `node server.js`.** Ejecutar
`node server.js` (o `npm start`, que es lo mismo) **NO activa el modo red local**: ese modo
se enciende solo con `NODE_ENV=development`, y es `npm run dev` quien la fija —la pone
`nodemon.json`, no el código—. Arrancado a mano, el enlace del QR sale con `localhost` y
desde un celular no abre nada (ver [Modo red local](#modo-red-local-probar-el-cliente-desde-un-celular-desarrollo)).

### Redis en desarrollo (es opcional)

**Con Redis apagado el backend funciona igual, sin caché.** No hay que levantarlo para
trabajar: las rutas responden consultando PostgreSQL y en el log queda un aviso corto.

Redis aquí es solo caché —la comprobación de cuenta activa (H-09) y el menú— y **nunca
puede tumbar una petición**. Quien decide es PostgreSQL: si la base falla, el error sube
(falla cerrada). La única pieza que cambia de comportamiento sin Redis es la reserva de
alias del comensal, que fuera de producción usa un respaldo en memoria.

Si Redis no responde, `connectRedis()` **rechaza rápido** (no se queda esperando) y entra
en un **enfriamiento**: durante unos segundos ni se intenta, para que cada petición no
pague el intento otra vez. Cuando Redis vuelve, la caché se reactiva sola en la siguiente
petición, **sin reiniciar el backend**.

Dos variables **opcionales** (si faltan o traen algo que no es un entero positivo, se usa
el valor por defecto):

| Variable | Defecto | Para qué |
|---|---|---|
| `REDIS_CONNECT_TIMEOUT_MS` | `1500` | espera máxima al conectar, para que un Redis que no contesta no retenga la petición |
| `REDIS_ENFRIAMIENTO_MS` | `15000` | cuánto se deja de intentar tras un fallo |

#### Levantarlo, si quieres caché

1. **Docker** (lo que usa `docker-compose.yml`):

   ```bash
   docker compose up -d redis     # desde la raíz del repo
   ```

2. **Windows sin Docker ni WSL**: el Redis portable de
   [tporadowski](https://github.com/tporadowski/redis/releases) —
   `Redis-x64-5.0.14.1.zip`—: descomprimir y ejecutar `redis-server.exe`, que queda
   escuchando en el `6379`. Es la alternativa que usa el equipo en Windows; su versión 5
   es antigua y **no se ha comprobado** contra ella la caché del backend.
3. **Un servicio nativo equivalente**, como Memurai, también en el `6379`.

El backend solo usa `GET`, `SET` con `EX`, `DEL`, `HSETNX` y `EXPIRE`, y se ha
comprobado contra el Redis **7.4.9** de desarrollo. Con cualquiera de las tres opciones,
`REDIS_URL=redis://localhost:6379` en el `.env` y listo.

### Límites del pool y cierre ordenado (H-25)

Cinco variables **opcionales**, todas en milisegundos salvo `PG_POOL_MAX`. Si falta, está
vacía o trae algo que no es un entero positivo, se usa el valor por defecto y queda un
aviso en el log: **una errata en el `.env` no impide arrancar**.

| Variable | Defecto | Para qué |
|---|---|---|
| `PG_POOL_MAX` | `10` | Conexiones simultáneas máximas del pool |
| `PG_IDLE_TIMEOUT_MS` | `10000` | Cuánto vive una conexión inactiva antes de devolverse |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | Cuánto se espera una conexión libre antes de fallar |
| `PG_STATEMENT_TIMEOUT_MS` | `10000` | Cuánto puede tardar una consulta antes de que PostgreSQL la aborte |
| `APAGADO_TIMEOUT_MS` | `10000` | Margen para el cierre ordenado antes de forzar la salida. En producción debe ser menor que `stop_grace_period` (ver abajo) |

Por qué importan las dos del medio:

- **`PG_CONNECTION_TIMEOUT_MS`** tapa el default de `pg`, que es `0`: esperar *para
  siempre*. Con PostgreSQL caído la petición se cuelga y el cliente con ella, porque
  Express no tiene timeout propio.
- **`PG_STATEMENT_TIMEOUT_MS`** pone `statement_timeout` (no `query_timeout`, que corta
  solo del lado del cliente y deja la consulta corriendo en el servidor). Sin él, una
  query trabada retiene su conexión indefinidamente: con `max: 10`, diez de esas dejan el
  backend muerto sin un solo error. Al vencer, PostgreSQL devuelve `57014` y la API
  responde **503** (ver [`docs/api-spec.md`](docs/api-spec.md)).

**Cierre ordenado.** Ante `SIGTERM` (lo que manda `docker stop`) o `SIGINT` (Ctrl+C), el
backend cierra en este orden: servidor HTTP → Redis → pool de PostgreSQL. El HTTP primero
para no cerrarle la base a una petición en vuelo, y el pool de último porque es el que
puede tener transacciones a medias. Si algo no cierra en `APAGADO_TIMEOUT_MS`, se fuerza la
salida: un apagado colgado es peor que uno brusco. `SIGUSR2` **no** se intercepta, porque
es con la que nodemon reinicia en `npm run dev`.

En producción, `docker-compose.prod.yml` le da al backend `stop_grace_period: 15s`: es lo que
Docker espera tras el `SIGTERM` antes de mandar `SIGKILL`. Ese margen debe ser **mayor** que
`APAGADO_TIMEOUT_MS`; si subes la variable, sube también `stop_grace_period`, porque si no
Docker corta el cierre antes de que termine y el pool puede quedar sin cerrar.

```bash
curl http://localhost:4000/api/health
# { "status": "ok" }
```

## Límite de peticiones (H-04, H-27 y D-21)

Tres límites, todos por IP y todos con respuesta **429**, cabecera `Retry-After` y el
cuerpo `{ "error": … }` de siempre. Los dos de ruta son la defensa de verdad; el global
(D-21) es un techo de respaldo para que ninguna IP pueda inundar el resto de la API.

| Qué limita | Defecto | Variables |
|---|---|---|
| `POST /api/auth/login` (solo los fallos, por IP + email) | **5 / minuto** | `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_VENTANA_MS` |
| `POST /api/mesas/qr/:token/sesion` | **20 / minuto** | `RATE_LIMIT_QR_MAX`, `RATE_LIMIT_QR_VENTANA_MS` |
| **Todo lo demás** (global, D-21) | **2000 / minuto** | `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_GLOBAL_VENTANA_MS` |

Las seis variables son **opcionales**: si falta, está vacía o no trae un entero positivo,
se usa el valor por defecto. Los tres límites **se desactivan solos dentro de las
pruebas**, o cualquier suite que haga unas cuantas llamadas empezaría a chocar con el techo
según creciera.

**El global no cuenta** `GET /api/health` —es la sonda de Docker: si contara, un límite
agotado haría que el contenedor se declarara enfermo y se reiniciara solo— ni el canal
interno con el socket-server (`POST /api/transacciones/internal`,
`GET /api/mesas/:id/cuenta/interno`), que va por `x-internal-key`, sale todo con **una**
IP y ya tiene su propia autenticación.

**Por qué 2000 por minuto, que parece muchísimo.** Los comensales de un local comparten
**una sola IP pública**, la del wifi: el cupo no es de una persona, es del restaurante
entero. Con 20 mesas de 4 son 80 teléfonos y, en el pico, cada uno hace del orden de 15 a
20 peticiones en ese minuto (80 × 20 = 1600), más las tablets del personal. 2000 deja pasar
ese pico y aun así corta a una sola máquina que intente raspar la API: 33 por segundo
sostenidos no los hace ningún comensal. Si el local es más grande, o si varios locales
salen por la misma IP, sube `RATE_LIMIT_GLOBAL_MAX`.

**Detrás de un proxy hace falta `TRUST_PROXY`.** Sin ella, `req.ip` es la IP de nginx y el
límite global se convierte en un único cupo compartido por todo el mundo. Está apagada por
defecto porque creerse `X-Forwarded-For` sin un proxy delante permite falsificar la IP; en
`docker-compose.prod.yml` vale `172.31.250.10`, la IP fija de nginx, y de ningún otro
contenedor se acepta la cabecera.

**Limitación conocida:** el contador vive en memoria del proceso. Con N instancias del
backend el techo real es 2000×N; para que fuera global de verdad haría falta un store
compartido en Redis.

## Roles y sesiones

| Rol | De dónde sale | Payload del JWT |
|---|---|---|
| `admin`, `mesero`, `cajero`, `cocina` | Tabla `usuarios`, vía `POST /api/auth/login` | `{ id_usuario, rol }` |
| `comensal` | **No existe en la tabla usuarios.** Se emite al escanear el QR, vía `POST /api/mesas/qr/:token/sesion` (3 h) | `{ id_mesa, sid, rol: "comensal" }` |

- El rol `cliente` ya no existe.
- Solo un `admin` puede registrar usuarios (`POST /api/auth/register`). El primer admin
  sale del `seed.sql` de Jarrison.
- El pedido pertenece a **la mesa**, no a un usuario: el modelo ER no relaciona
  `pedidos` con `usuarios`. Cuando un comensal crea o cambia algo, `historial_estados`
  queda con `id_usuario = null`.
- En el carrito colaborativo, a cada comensal lo identifica su **alias**, que se guarda por
  ítem en **`detalles_pedido.comensal`**, su propia columna (D-03). `notas_especiales`
  lleva **solo la nota** del ítem ("sin cebolla"): antes el alias se metía ahí y la cuenta
  por persona no podía agruparse. El alias de un comensal sale **firmado del JWT** y el del
  cuerpo se ignora; cuando pide el personal, se guarda el alias canónico de esa persona en
  la mesa (D-18b). El detalle, en [docs/api-spec.md](docs/api-spec.md).

## Flujo de una mesa, de principio a fin

```
mesero   → POST /api/mesas/:id/abrir        pide el QR al socket-server, lo guarda en
                                            mesas.token_qr y deja la mesa 'ocupada'
                                            (idempotente: llamarlo dos veces da el mismo token)
                                            si el token es nuevo, avisa a /internal/qr-rotado
                                            y la tablet de la mesa dibuja el QR
comensal → POST /api/mesas/qr/:token/sesion el token debe ser válido para el socket-server
                                            Y el vigente de la mesa -> JWT { id_mesa, sid }
         → GET  /api/categorias + GET /api/platos?id_categoria=
         → POST /api/pedidos                id_mesa del token; alias por item en
                                            detalles_pedido.comensal
         → GET  /api/pedidos/mesa
cocina   → PATCH /api/kds/comandas/:id/estado
cajero   → POST /api/transacciones          cobro 'completada'
                                            si no quedan pedidos abiertos, la mesa se
                                            libera en esa misma transacción
mesero   → POST /api/mesas/:id/liberar      solo si la mesa NO tiene pedidos abiertos
                                            (si los tiene: 409, hay que cobrarlos o
                                             cancelarlos, y ahí se libera sola)
```

Al liberarse, `token_qr` queda en NULL y las sesiones de ese grupo caen con **401
"Sesión de mesa cerrada"** en su siguiente petición: el middleware compara el `sid` del
JWT contra el del token que la mesa tiene ahora. El QR impreso es fijo mientras la sesión
dure; Jarrison retiró el trigger `tr_regenerar_token_qr`, así que ese ciclo de vida lo
maneja el backend.

## Puertos

| Pieza | Puerto | Nota |
|---|---|---|
| Panel del restaurante | **5173** | `frontend-restaurante` |
| Cliente del comensal | **5174** | `frontend-cliente`, puerto fijo (`strictPort`) |
| KDS de cocina | **5175** | `frontend-kds` |
| Backend (esta API) | **4000** | `PORT` |
| socket-server | **4001** | `SOCKET_URL` |

El enlace del QR apunta al **cliente (5174)**. Antes el valor por defecto de
`FRONTEND_CLIENTE_URL` era `http://localhost:5173`, que es el puerto del panel: el QR
llevaba al comensal a la pantalla de administración.

## Modo red local: probar el cliente desde un celular (desarrollo)

El comensal entra escaneando el QR con su teléfono, y para un teléfono `localhost` es él
mismo. Para que funcione sin configurar nada, el backend tiene un **modo red local**.

**Se activa solo con `NODE_ENV=development`**, escrito así, exacto. Es la misma regla que
el socket-server. Con `production`, `test`, vacío o ausente **no cambia nada**, ni el
enlace del QR ni el CORS.

`npm run dev` ya lo fija: `nodemon.json` pone `NODE_ENV=development` en el proceso, así
que funciona igual en Windows, macOS y Linux sin `cross-env` ni variables a mano.
`npm start` (producción) **no** lo fija.

Qué cambia estando activo:

- **Enlace del QR.** Se detecta la IPv4 privada de la LAN (`src/utils/ip-local.js`:
  descarta adaptadores virtuales —WSL, Docker, VirtualBox, VMware, Hyper-V, Tailscale,
  ZeroTier, VPN— y prefiere `192.168` sobre `10` sobre `172.16-31`) y:
  - si `FRONTEND_CLIENTE_URL` apunta a `localhost` o `127.0.0.1`, se sustituye **solo el
    host** por esa IP (protocolo, puerto y path se conservan);
  - si **no está definida**, el enlace se arma con `http://<IP>:5174`;
  - si no se detecta ninguna IP, queda como siempre.

  **Un dominio real nunca se sustituye**, ni en desarrollo. La detección se cachea 30 s,
  así que cambiar de Wi-Fi no obliga a reiniciar el backend.
- **CORS.** Además de la lista que haya —los tres `localhost` por omisión, o tu
  `CORS_ORIGINS` si la configuraste— se acepta **siempre** esta regla exacta:

  ```
  http://  +  IPv4 privada (10/8, 172.16/12, 192.168/16)  +  :5173 | :5174 | :5175
  ```

  Nada más: ni `https`, ni otros puertos, ni dominios, ni rutas, ni octetos con ceros a
  la izquierda o mayores que 255. Es la misma regla que `socket-server/src/origenes.js`.

**En desarrollo ya no hace falta definir `FRONTEND_CLIENTE_URL`.** En producción sí, con
el dominio real.

`HOST_LAN_IP` (opcional, solo desarrollo) fuerza la IP del enlace cuando la máquina tiene
varias tarjetas y la heurística elige la que no es. Si no es una IPv4 válida se ignora con
un aviso en el log.

Lo que **no** cambia: la firma del token QR, su vigencia y lo que valida el socket-server
en `/qr/validar`. El token no lleva dentro el host del enlace, así que cambiar el host no
afecta a ninguna validación.

## Tiempo real

El backend avisa al socket-server de Roberto por HTTP interno desde
`src/services/socket.notifier.js`, con `x-internal-key` y un `eventId` por acción. Son
**nueve** rutas:

| Ruta interna | Cuándo se manda |
|---|---|
| `POST /internal/order-created` | Pedido creado |
| `POST /internal/order-status` | Cambio de estado de un pedido (KDS) |
| `POST /internal/qr-rotado` | La mesa tiene un `token_qr` nuevo |
| `POST /internal/mesa-liberada` | La mesa quedó libre (cobrada o liberada a mano) |
| `POST /internal/payment-confirmed` | Cobro de caja confirmado |
| `POST /internal/plato-disponibilidad` | Un plato se agotó o volvió |
| `POST /internal/ingrediente-disponibilidad` | Una opción del constructor se agotó o volvió |
| `POST /internal/mesa-comensal` | Alta o baja de un comensal sin celular (D-18) |
| `POST /internal/inventario-alerta` | Un insumo cruzó su stock mínimo o se agotó (D-17) |

Las dos de disponibilidad llevan el valor **efectivo** (`disponible AND stock_suficiente`),
no el interruptor manual, y las disparan tanto el `PATCH` de la cocina como el oyente del
canal `inventario`. Los contratos y los eventos que emite el socket-server están en
[`socket-server/EVENTS.md`](../socket-server/EVENTS.md).

Ese cliente **nunca lanza**: con timeout corto, registra el fallo y sigue, así que un
socket-server caído no rompe un pedido ni un cobro. La excepción son `/qr/generar` y
`/qr/validar`: ahí sin respuesta no se puede abrir la mesa ni la sesión, y se responde 503.

## Agotados: agotar o reponer en vivo (D-05)

Dos rutas gemelas, las únicas escrituras del catálogo que no son **solo de admin**:
también las puede llamar `cocina`, porque agotar algo no es editar la carta, es reportar
lo que pasa en la cocina. Es lo que usa el panel de agotados.

| Ruta | Roles | Cuerpo | Respuesta |
|---|---|---|---|
| `PATCH /api/platos/:id/disponible` | `admin`, `cocina` | `{ "disponible": false }` | 200, la fila del plato |
| `PATCH /api/ingredientes/:id/disponible` | `admin`, `cocina` | `{ "disponible": false }` | 200, la fila del ingrediente |

- `disponible` es **booleano estricto** y el cuerpo es `.strict()`: `"false"`, `0`, `null`
  o una clave de más responden **400**. Un `:id` que no es entero positivo, **400**; algo
  que no existe, **404**.
- **Idempotentes**: ponerlo al valor que ya tenía responde **200**, no 409.
- El orden es parte del contrato: **COMMIT → invalidar `cache:menu` → avisar al
  socket-server**. Al revés, un cliente que reaccione al evento pidiendo `GET /menu`
  recibiría la copia vieja de la caché y seguiría mostrando el plato como disponible.
- El aviso (`/internal/plato-disponibilidad`, `/internal/ingrediente-disponibilidad`) es
  un **extra**: si el socket-server está caído la respuesta sigue siendo 200, porque el
  cambio ya está guardado. Tampoco se espera para responder.
- La bitácora del cambio la escribe la base (trigger `tr_auditar_cambios` sobre `platos`),
  no el backend.

El detalle completo está en `docs/api-spec.md`; los eventos que emite el socket-server,
en `socket-server/EVENTS.md` §5.3 y §5.4.

## Pruebas

```bash
npm test
```

Más de **1.700** pruebas con `node --test` + `supertest`. **La cifra exacta no se fija
aquí a propósito**: cada PR suma pruebas y un número escrito en el README queda obsoleto a
la semana siguiente (este decía "119" cuando ya iban más de mil, y "1.200" cuando ya iban
1.737). El número real lo dice el resumen de `npm test`, que en noviembre de 2026 daba:

```
ℹ tests 1737
ℹ pass 1737
ℹ fail 0
ℹ cancelled 0
```

No hacen falta PostgreSQL ni Redis: `tests/helpers/fake-db.js` reemplaza
`pool.query`/`pool.connect` por dobles en memoria y registra las queries ejecutadas, así
que las pruebas también verifican con qué valores llega cada `INSERT`.

**`cancelled` tiene que ser 0, no solo `fail`.** Una prueba cancelada **no se ejecutó**:
`node --test` cancela las que siguen en un archivo que deja el event loop colgado, y el
proceso puede terminar con código 0 sin haber probado nada. En el CI eso lo vigila
[`.github/scripts/npm-test-sin-canceladas.sh`](../.github/scripts/npm-test-sin-canceladas.sh),
que corre `npm test` y falla si el resumen trae canceladas. Para reproducir el conteo
oficial, lo mismo que hace el CI:

```bash
cd backend && bash ../.github/scripts/npm-test-sin-canceladas.sh
```

`npm test` solo corre `tests/*.test.js`. Las de `tests/integracion/` **no** entran en ese
glob porque necesitan PostgreSQL de verdad; van aparte:

```bash
npm run test:integracion
```

### Cobertura

```bash
npm run test:cobertura
```

Es `npm test` con `--experimental-test-coverage` y **el mismo glob**
(`tests/*.test.js`, sin `tests/integracion/`) y el mismo `--require` del entorno de
pruebas, para que la cobertura sea la de la batería que de verdad corre en el CI. Los
propios archivos de prueba se excluyen del informe (`--test-coverage-exclude`): lo que
interesa es cuánto de `src/` se ejercita, y contar las pruebas a sí mismas infla el
porcentaje sin decir nada.

Medido en noviembre de 2026, con `develop` en `67b1f1f` y 1.737 pruebas:

| | Líneas | Ramas | Funciones |
|---|---|---|---|
| Todo el backend | **98,90 %** | 93,61 % | 96,97 % |

Es la línea `all files` del informe. No se repite aquí un número por carpeta porque
`node --test --experimental-test-coverage` **no imprime el total de un directorio**: la
fila `services` sale vacía y cada archivo trae el suyo. Para mirar un área concreta, el
informe completo está en la salida del comando.

Lo que queda sin cubrir son sobre todo ramas de Redis caído y de errores de red del aviso al
socket-server: `socket.notifier.js` es el más bajo en ramas (**84,50 %**). `server.js` baja
a **83,33 %** porque el bloque de `require.main` —`listen` y los manejadores de señal— no se
ejecuta cuando las pruebas importan la app con supertest, que es justamente lo que se quiere.

## Estructura

```
/backend
  server.js                    → punto de entrada
  /src
    /config                    → conexión a PostgreSQL y Redis
    /middleware                → JWT y control de roles (RBAC)
    /controllers               → lógica HTTP de cada endpoint
    /services                  → consultas SQL y lógica de negocio
    /routes                    → definición de endpoints
    /utils                     → IP de la LAN y enlace del QR (modo red local)
  /docs
    modelo-er.md               → modelo ER oficial de Jarrison (fuente de verdad)
    api-spec.md                → contrato formal de la API (compartir con Juan y Jarrison)
  /tests                       → pruebas con supertest y doble de base de datos
```

## Estado actual

- [x] Esqueleto en capas (routes → controllers → services) según el plan de trabajo
- [x] Roles alineados con el modelo ER: `admin`, `mesero`, `cajero`, `cocina` en la tabla, `comensal` solo en el JWT
- [x] Registro de usuarios restringido a `admin`, sin `telefono`
- [x] Sesión de comensal por QR: `POST /api/mesas/qr/:token/sesion` (JWT de mesa, 3 h)
- [x] CRUD de categorías, platos y mesas
- [x] Pedidos: crear (comensal/mesero/admin, transaccional, precio congelado, `codigo_pedido` único, alias en `detalles_pedido.comensal`), activos, pedidos de la mesa, cambiar estado, cancelar
- [x] KDS: comandas activas clasificadas por categoría, restringido a rol `cocina` (o `admin`)
- [x] Transacciones: registrar pago con liberación atómica de la mesa
- [x] Todas las queries alineadas con `docs/modelo-er.md`
- [x] Probado contra el `schema.sql` real de Jarrison: login, catálogo, sesión de comensal, pedido, ciclo completo de estados y cobro
- [x] Totales, subtotales, transiciones y disponibilidad delegados a los triggers
- [x] Errores de la base traducidos en un solo lugar (409 para `P0001`, 500 genérico para el resto)
- [x] `OVERRIDE_ADMIN` rechazado en apodos y notas (era un bypass del control de disponibilidad)
- [x] Solo un cobro `completada` liquida el pedido
- [x] Ciclo de vida de la sesión de mesa: abrir/liberar, QR fijo por sesión y cierre por `sid`
- [x] Integración con el socket-server: `order:created`, `order:status` y `mesa-liberada`
- [x] Caché de la cuenta activa en el middleware de auth (H-09): `services/usuario-activo.js`,
      consultado desde `auth.middleware.js`; con Redis caído se consulta PostgreSQL
- [x] Vigencia del token QR validada contra el socket-server (`validarTokenQr`): si no
      responde, la sesión no se abre y sale 503
- [x] Avisos al socket-server en los nueve puntos (ver [Tiempo real](#tiempo-real)); ya no
      queda ningún `NOTA` pendiente en `src/`
- [x] Frontend del KDS (`/frontend-kds`): tablero, panel de agotados y sus pruebas
- [x] Inventario (D-17): insumos, movimientos, recetas, carta y avisos por el canal
      `inventario`
- [x] Configuración del restaurante e historial de precios (D-16 B)
- [x] Comensales sin celular y alias canónico del pedido (D-18)
- [ ] Endpoints de `suscripciones_push` (la tabla está en el modelo, el módulo es de Roberto)
