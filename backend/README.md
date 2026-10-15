# SmartDining — Backend + KDS

Responsable: Carlos Ospino (Desarrollador 2 / Integrante 3).
Ramas: `feature/backend` y `feature/frontend-kds` (el frontend del KDS se arma después, en `/frontend-kds`).

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

Los `RAISE EXCEPTION` de los triggers (SQLSTATE `P0001`) salen como **409** con el
mensaje del trigger; cualquier otro error de PostgreSQL sale como **500** genérico sin
exponer el detalle. Todo eso se decide en un único lugar:
`src/middleware/errores.middleware.js`.

## Recrear la base de datos local

El `database/README.md` de Jarrison no documenta el orden de ejecución. Desde el commit
`7556518` el bootstrap es **el runner y después el seed**: `00_ejecutar_todo.sql` ejecuta
`../schema.sql` él mismo como paso `[0/13]`, y ese schema arranca con `DROP TABLE` de las
15 tablas — por eso el seed va al final, o se borraría. Además el seed ahora inserta
`transiciones_validas`, que existe recién después del paso 0.

> Antes del `7556518` el orden era el inverso (`schema.sql` → `seed.sql` → runner).
> Conviene volver a mirar el runner cada vez que Jarrison actualice la rama.

```bash
# 1. Traer la version mas reciente de la rama de Jarrison, sin mezclarla:
#    (se extrae a una carpeta aparte; no se commitea en feature/backend)
git fetch origin
git archive origin/feature/base-datos database/ | tar -x -C /ruta/temporal

export PGPASSWORD=...            # el de backend/.env

# 2. Recrear la base vacia
psql -h localhost -U postgres -d postgres -c "DROP DATABASE IF EXISTS smartdining;"
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE smartdining ENCODING 'UTF8';"

# 3. El runner (incluye schema.sql). OJO: usa "\i" con rutas relativas,
#    hay que ejecutarlo con el cwd en scripts/
cd /ruta/temporal/database/scripts
psql -h localhost -U postgres -d smartdining -v ON_ERROR_STOP=1 -f 00_ejecutar_todo.sql

# 4. El seed, DESPUES del runner
psql -h localhost -U postgres -d smartdining -v ON_ERROR_STOP=1 -f ../seed.sql

# 5. Solo si el hash del seed no corresponde a Admin123! (el seed nuevo ya lo trae):
#    desde backend/
psql -h localhost -U postgres -d smartdining -f scripts/fijar-password-demo.sql
```

Usuarios demo (todos con `Admin123!`): `admin@smartdining.com`,
`cocina@smartdining.com`, `mesero@smartdining.com`, `caja@smartdining.com`.
Token QR de la mesa 1 recién sembrada: `qr-token-mesa-01-a1b2c3d4`.

## Requisitos previos

- Node.js 18+
- PostgreSQL corriendo localmente, con `database/schema.sql` y `database/seed.sql` de Jarrison ya ejecutados
- Redis (o Memurai en Windows) corriendo localmente

## Instalación

```bash
cd backend
npm install
cp .env.example .env
# Edita .env con tus credenciales locales de PostgreSQL/Redis y un JWT_SECRET propio
```

## Ejecución

```bash
npm run dev     # con nodemon, recarga automática
npm start       # modo normal
```

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
| `APAGADO_TIMEOUT_MS` | `10000` | Margen para el cierre ordenado antes de forzar la salida |

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

```bash
curl http://localhost:4000/api/health
# { "status": "ok" }
```

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
- En el carrito colaborativo, a cada comensal lo identifica su **apodo**, que se guarda
  por ítem en `detalles_pedido.notas_especiales`.

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
         → POST /api/pedidos                id_mesa del token; apodo por ítem
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

## Tiempo real

El backend avisa al socket-server de Roberto por HTTP interno
(`/internal/order-created`, `/internal/order-status`, `/internal/qr-rotado`,
`/internal/mesa-liberada`) desde
`src/services/socket.notifier.js`, con `x-internal-key` y un `eventId` por acción.

Ese cliente **nunca lanza**: con timeout corto, registra el fallo y sigue, así que un
socket-server caído no rompe un pedido ni un cobro. La excepción son `/qr/generar` y
`/qr/validar`: ahí sin respuesta no se puede abrir la mesa ni la sesión, y se responde 503.

## Pruebas

```bash
npm test
```

119 pruebas con `node --test` + `supertest`. No hacen falta PostgreSQL ni Redis:
`tests/helpers/fake-db.js` reemplaza `pool.query`/`pool.connect` por dobles en memoria
y registra las queries ejecutadas, así que las pruebas también verifican con qué
valores llega cada `INSERT`.

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
- [x] Pedidos: crear (comensal/mesero/admin, transaccional, precio congelado, `codigo_pedido` único, apodo en `notas_especiales`), activos, pedidos de la mesa, cambiar estado, cancelar
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
- [ ] Cache de sesiones con Redis (conexión lista, falta integrarla en el middleware de auth)
- [ ] Validar el TTL del token QR contra Redis, o confirmar que Roberto ya lo validó
- [ ] Disparar los eventos de WebSocket hacia socket-server en los puntos ya marcados con `NOTA` en el código (coordinar con Roberto)
- [ ] Endpoints de `suscripciones_push` (la tabla está en el modelo, el módulo es de Roberto)
- [ ] Frontend del KDS (`/frontend-kds`)
