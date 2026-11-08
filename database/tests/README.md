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
| E2E del panel (Playwright) | `frontend-restaurante/e2e/panel.spec.js` | Todo lo anterior y el cliente (`:5174`) |

### Paso a paso

```bash
# 1. Base de pruebas smartdining_test.
#    Con Docker: PostgreSQL 16 en el puerto 5433, cargado por docker-init.sh.
#    Sin Docker: usa el PostgreSQL local (5432) y la carga si no existe.
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
