# Pruebas de la base de datos

Hay dos tipos de pruebas en esta carpeta.

## 1. Pruebas SQL (`test_*.sql`)

Cada archivo es un bloque `DO` que lanza una excepción si algo falla y limpia lo que
crea. Se corren sobre una base ya cargada:

```bash
cd database/tests
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_h01_concurrencia_pagos.sql
```

## 2. Pruebas reales con el sistema levantado (se corren a mano)

Usan PostgreSQL, el backend y el socket-server **de verdad**, sin dobles. **No están en
el CI**: necesitan todos los servicios corriendo. El resultado de la última corrida
completa está en [`REPORTE-PRUEBAS.md`](REPORTE-PRUEBAS.md).

| Suite | Archivo | Necesita |
|---|---|---|
| Base de datos | `db.test.js` | PostgreSQL |
| Integración API + BD | `integracion/api.test.js` | PostgreSQL y backend (`:4000`) |
| Tiempo real | `tiempo-real/socket.test.js` | PostgreSQL, backend y socket-server (`:4001`) |
| Concurrencia por la API | `integracion/concurrencia-pedidos.js` | PostgreSQL, Redis, backend y socket-server (ver §3) |
| Guion E2E de la demo (G-08) | `frontend-restaurante/e2e/demo.spec.js` | Todo lo anterior, el panel, el cliente y el KDS (ver §4) |
| E2E del panel (Playwright) | `frontend-restaurante/e2e/panel.spec.js` | Todo lo anterior y el cliente (`:5174`) |

### Paso a paso

```bash
# 1. Base de pruebas smartdining_test.
#    Con Docker: PostgreSQL 16 en el puerto 5433; docker-init.sh -> migrar.sh la carga.
#    Sin Docker: usa el PostgreSQL local (5432), la crea si no existe y corre migrar.sh.
bash database/tests/levantar-entorno.sh

# 2. Backend y socket-server apuntando a esa base (cada uno en su terminal), con
#    PGPORT=5433 y PGDATABASE=smartdining_test en sus .env, y la MISMA
#    INTERNAL_API_KEY en los dos.
cd backend && npm run dev
cd socket-server && npm run dev

# 3. Suites de base de datos, integración y tiempo real
cd database && npm install
INTERNAL_API_KEY=<la del socket-server de pruebas> npm run test:real
#   o por partes: npm run test:db | test:integracion | test:tiempo-real

# 4. E2E del panel (levanta solo el panel en :5173; el cliente debe estar en :5174)
cd frontend-cliente && npm run dev
cd frontend-restaurante
npx playwright install chromium     # la primera vez
npm run test:e2e

# 5. Apagar y limpiar la base de pruebas
bash database/tests/levantar-entorno.sh down
```

Variables de conexión: `PGHOST`, `PGPORT` (por defecto `5433`), `PGUSER`, `PGPASSWORD` y
`PGDATABASE` (por defecto `smartdining_test`). Las credenciales `postgres`/`postgres` por
defecto son **solo** de la base de pruebas local que crea `docker-compose.test.yml`.
`INTERNAL_API_KEY` no tiene valor por defecto: sin ella, la suite de tiempo real no arranca.

Para usar un Chrome ya instalado en lugar del Chromium de Playwright:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="<ruta a chrome>" npm run test:e2e`.

## 3. Concurrencia de `POST /api/pedidos` (50 pedidos por las últimas 10 porciones)

Es el caso B de `test_p19_concurrencia.sh`, pero **por la API**: 50 `POST /api/pedidos` a la
vez contra un plato al que le quedan 10 porciones. Debe salir:

```
OK    preparado por la API: plato …, insumo … con 10 porciones, mesa 901 abierta y "Ana Prueba" en Redis
OK    50 POST /api/pedidos simultáneos (… ms): 10 creados (201), 40 con 409 sin_stock, 0 otros
OK    cada 409 trae faltantes = [el plato], solo con tipo, id y nombre (sin cantidades de bodega)
OK    los pedidos creados tienen código único, estado recibido y total 9000
OK    GET /inventario/insumos/:id → stock_actual 0 y agotado
OK    en la base: stock 0 y nunca negativo (mínimo del libro: 0)
OK    el libro cuadra: SUM(movimientos) = stock_actual, con 10 reservas
OK    en la base: 10 pedidos, 10 detalles, todos a nombre de "Ana Prueba"; ningún rechazado quedó a medias
OK    GET /inventario/carta: el plato quedó agotado por stock (disponible_efectivo false, motivo "stock"; …)
OK    un pedido más con el plato agotado → 409 (sin_stock)
=== CONCURRENCIA POR LA API PASADA ===
```

Cualquier `500`, `503 reintentar` (deadlock) u otro código cuenta como falla y sale en el resumen.

**Qué usa de verdad.** Los datos se crean por la API (categoría, plato, insumo con
`stock_inicial`, receta, mesa 901): no hay `INSERT` a mano. Abrir la mesa necesita el
**socket-server** (le pide el QR), y cada pedido lleva el comensal «Ana Prueba», registrado
con `POST /mesas/:id/comensales`, que responde **503 sin Redis**: así **Redis** también entra
en cada pedido (el backend resuelve el alias ahí). Al final todo se borra (pedidos y datos por
SQL, el alias de Redis por la API). Si una corrida se corta, la siguiente limpia lo que quedó.

**Paso a paso.** Un proyecto de compose **aparte** (no toca el `pgdata` de desarrollo); el
backend y el socket-server corren en tu máquina y comparten `JWT_SECRET` e `INTERNAL_API_KEY`.

```bash
# 1. PostgreSQL 16 + Redis en un proyecto aparte (puertos 5434 y 6380)
export COMPOSE_PROJECT_NAME=sdconcurrencia POSTGRES_PORT=5434 REDIS_PORT=6380
docker compose up -d
until docker compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d smartdining; do sleep 2; done
docker compose exec -T postgres psql -q -U postgres -d smartdining < backend/scripts/fijar-password-demo.sql

# 2. Claves de prueba, las mismas para los dos servicios (no se imprimen)
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export INTERNAL_API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export QR_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export REDIS_URL=redis://localhost:6380

# 3. Cada uno en su terminal, con las variables del paso 2 (las de la línea pisan el .env)
(cd socket-server && PORT=4101 BACKEND_URL=http://localhost:4100 node server.js)
(cd backend && PORT=4100 PGPORT=5434 PGDATABASE=smartdining SOCKET_URL=http://localhost:4101 node server.js)

# 4. La prueba
cd database && npm install
API_URL=http://localhost:4100 PGPORT=5434 PGDATABASE=smartdining npm run test:concurrencia

# 5. Apagar y borrar SOLO el proyecto de prueba
docker compose down -v
unset COMPOSE_PROJECT_NAME POSTGRES_PORT REDIS_PORT JWT_SECRET INTERNAL_API_KEY QR_SECRET REDIS_URL
```

Variables: `API_URL` (sin `/api`, por defecto `http://localhost:4000`), `PG*` (la **misma** base
del backend), `ADMIN_EMAIL`/`ADMIN_PASSWORD` (por defecto el admin de demo), `PEDIDOS` (50),
`PORCIONES` (10) y `MESA_NUMERO` (901; si esa mesa existe con pedidos ajenos, la prueba no
arranca). Sale con código 0 si todo pasa.

Con `PEDIDOS=100 PORCIONES=7` también pasa (7 creados, 93 `sin_stock`).

> `POST /api/platos` sin `tiempo_preparacion_estimado` responde **500**: el esquema lo deja
> opcional y el backend inserta `NULL`, pero la columna es `NOT NULL` **sin `DEFAULT`**. El
> script lo manda explícito; el arreglo es del backend (issue #132).

## 4. Guion E2E de la demo (G-08): agotar la Hamburguesa y reponerla

`frontend-restaurante/e2e/demo.spec.js` recorre la demo en navegadores reales: el panel, el
KDS y dos "celulares" con la PWA. Sin dobles: backend, socket-server, PostgreSQL 16 y Redis
de verdad. Los 11 pasos están en la cabecera del archivo; en resumen:

1. el admin entra al panel y abre la mesa 1 desde Mesas (URL del QR tomada del modal);
2. «Ana» entra con ese QR; el KDS abre con la sesión de cocina;
3. pedidos 1.º a 3.º de la Hamburguesa por la API (con la sesión de Ana), y el **4.º desde la
   interfaz** del cliente; el panel (Pedidos) y el KDS lo ven sin recargar;
4. sin recargar, la Hamburguesa sale **agotada** en el panel (Menú), en el KDS (agotados) y en
   el celular de Ana; «Beto», que entra después, no la puede pedir (409 `sin_stock`);
5. en Inventario el admin registra una **entrada** de 10 de Carne Angus; sin recargar, la
   Hamburguesa **vuelve** en las tres pantallas y Ana la pide otra vez (201);
6. ninguna pantalla se recargó (marca en `window`), y la limpieza deja **todo como estaba**: se
   comprueba stock 4, plato disponible, mesa libre, 0 pedidos abiertos y el libro cuadrado.

**Datos:** `seed.sql` + `seed_inventario_demo.sql` (G-07: la Carne Angus con 4 porciones). Si
la carne no está en 4, la prueba la deja en 4 con un `ajuste` por la API. Los pedidos de la
prueba se **cancelan** (la base devuelve las porciones) y quedan en el historial como
cancelados, igual que en un restaurante; no se borra nada a mano.

```bash
# 1. PostgreSQL 16 + Redis aparte, con las claves de §3 pasos 1 y 2, y luego:
docker compose exec -T postgres psql -q -U postgres -d smartdining < database/seed_inventario_demo.sql

# 2. Cada uno en su terminal (además de backend y socket-server como en §3 paso 3)
(cd frontend-restaurante && VITE_API_URL=http://localhost:4100/api VITE_SOCKET_URL=http://localhost:4101 npx vite --port 5173)
(cd frontend-cliente && VITE_API_URL=http://localhost:4100/api VITE_SOCKET_URL=http://localhost:4101 VITE_MODO_SIMULADO=false npx vite --port 5174)
(cd frontend-kds && VITE_API_URL=http://localhost:4100/api VITE_SOCKET_URL=http://localhost:4101 npx vite --port 5175)

# 3. La prueba (con el Chrome del sistema, o el Chromium de `npx playwright install chromium`)
cd frontend-restaurante
API_URL=http://localhost:4100/api PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="<ruta a chrome>" \
  npx playwright test e2e/demo.spec.js
```

Variables: `API_URL`, `CLIENTE_URL` (5174), `KDS_URL` (5175), `DEMO_PASSWORD`, `MESA_DEMO` (1;
si esa mesa tiene pedidos abiertos, la prueba no arranca). Usa 3 inicios de sesión por corrida
(el límite es 5 por minuto). Tarda unos 25 s.

> **Problema conocido (backend):** `GET /menu` se guarda 60 s en Redis y **agotar o reponer
> por inventario no lo invalida**. En ese minuto, quien abre el menú ve la carta vieja: Beto ve
> la Hamburguesa agotada como disponible (si la pide, recibe 409 y la PWA se lo dice; la prueba
> lo comprueba y lo anota), y tras reponer, un menú recién abierto puede seguir ocultándola. Por
> eso la prueba espera, antes de empezar, a que `GET /menu` muestre la Hamburguesa (hasta 70 s).
