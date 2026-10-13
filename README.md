# 🍽️ SmartDining

> Plataforma web para digitalizar la experiencia en sala de restaurantes: pedidos colaborativos en tiempo real mediante QR, panel administrativo para sala y sistema Kitchen Display System (KDS) para cocina.

---

## 📌 Descripción del Proyecto

**SmartDining** es una solución integral que elimina fricciones en el servicio presencial de restaurantes:
- **Clientes:** Escanean un código QR dinámico en su mesa, exploran el menú digital interactivo y realizan pedidos grupales/colaborativos en tiempo real desde el navegador móvil (PWA) sin instalar aplicaciones.
- **Cocina (KDS):** Visualización en tiempo real de comandas clasificadas por estado y tiempos de preparación.
- **Administración & Sala:** Control del estado de mesas, gestión del catálogo de platos, reportes y supervisión de pedidos.
- **Infraestructura en tiempo real:** Comunicación bidireccional mediante WebSockets y pagos integrados.

---

## 👥 Equipo de Desarrollo y Roles

| Integrante | Rol | Responsabilidades Principales |
| :--- | :--- | :--- |
| **Jarrison Pulgarin** *(Líder)* | **Frontend Restaurante + Base de Datos** | Modelado e implementación en PostgreSQL (9 tablas), panel administrativo web del restaurante. |
| **Juan Buelvas** | **Frontend Cliente (PWA)** | Experiencia del comensal móvil, carrito colaborativo, escaneo y consumo de menú. |
| **Carlos Ospino** | **Backend + API REST + KDS** | Arquitectura del API REST (Node/Express), lógica de negocio, contratos de endpoints y pantalla KDS para cocina. |
| **Roberto Buelvas** | **WebSockets + QR + Pagos + Notificaciones** | Servidor Socket.io en tiempo real, emisión/sincronización de eventos de mesa, generación de tokens QR, notificaciones push y pasarela de pago. |

---

## 📂 Estructura del Repositorio

El proyecto utiliza un esquema monorepo organizado por módulos:

```plaintext
restaurante-app/
├── database/               # Scripts SQL, migraciones y diccionario de datos (PostgreSQL)
├── backend/                # API REST principal (Node.js + Express)
├── socket-server/          # Servidor de WebSockets (Socket.io) para sincronización en vivo
├── frontend-cliente/       # Aplicación web móvil PWA para comensales (React + Vite)
├── frontend-restaurante/   # Panel de control administrativo y gestión de sala (React + Vite)
└── frontend-kds/           # Sistema de pantalla de cocina para visualización de comandas
```

---

## 🌿 Flujo de ramas (develop)

| Rama | Para qué | Quién escribe |
| :--- | :--- | :--- |
| `main` | Versión estable. Solo se actualiza **al cierre de cada sprint** con un PR `develop → main`. | Nadie directo: solo el PR de cierre |
| `develop` | Integración del sprint. Todas las ramas de trabajo salen de aquí y vuelven aquí. | Nadie directo: solo PRs |
| `tipo/descripcion` | Una rama por actividad: `feature/`, `fix/`, `chore/`, `docs/`, `test/`, `ci/`. | Su autor |

1. Actualiza develop y crea tu rama desde ahí:
   ```bash
   git checkout develop && git pull
   git checkout -b feature/mi-actividad
   ```
2. Commits pequeños con el formato `tipo(scope): descripcion` (minúsculas, infinitivo, sin
   tildes ni ñ, sin punto final, máximo 72 caracteres). Agrega archivos por nombre
   (`git add ruta/archivo`), nunca `git add .`.
3. Antes de abrir el PR: `npm test` en verde (sin fallidas ni canceladas) en cada carpeta
   que tocaste, y `git pull origin develop` para resolver conflictos en tu rama.
4. Abre el PR **contra `develop`** con la plantilla (`.github/pull_request_template.md`).
   GitHub pide revisión al dueño de cada carpeta (`.github/CODEOWNERS`) y el CI debe pasar.
5. Si tu cambio necesita tocar una carpeta ajena, hazlo en una rama aparte, mínima, y pide
   revisión a su dueño. No se refactoriza código ajeno.
6. Al cierre del sprint, el líder abre `develop → main`, se revisa y se fusiona.

### Protección de ramas (paso manual del dueño del repo)

En GitHub → *Settings* → *Branches* → *Add branch ruleset*, una regla para `main` y otra
para `develop`:

1. *Require a pull request before merging* → 1 aprobación como mínimo.
2. *Require review from Code Owners* (cuando CODEOWNERS tenga los usuarios reales).
3. *Dismiss stale pull request approvals when new commits are pushed*.
4. *Require status checks to pass* → marcar los jobs del workflow **CI**
   (`.github/workflows/ci.yml`) y *Require branches to be up to date before merging*.
   GitHub solo ofrece un check en el buscador después de que haya corrido al menos una vez
   (abre un PR primero). Los nombres exactos son:
   - `backend · pruebas`
   - `socket-server · pruebas (con Redis)`
   - `frontend-cliente · lint y build`
   - `frontend-restaurante · lint y build`
   - `infra · scripts de despliegue`
5. *Require conversation resolution before merging*.
6. *Block force pushes* y *Restrict deletions*.
7. En `main`, además: restringir quién puede hacer push (solo el líder).

---

## 🔔 Notificaciones push en iPhone

En iPhone el Web Push solo funciona con iOS 16.4 o posterior **y** la PWA instalada en la
pantalla de inicio. Por eso el aviso principal ("¡Tu plato está listo!") es el evento en vivo
por socket dentro de la página; el push es un extra. Detalles en
[socket-server/README.md](socket-server/README.md#notificaciones-push-y-iphone).

---

## 🚀 Levantar SmartDining en 5 minutos

Requisitos: **Node 22** y **Docker Desktop** (o Docker Engine con el plugin `compose`).

| Servicio | Puerto | Cómo se levanta |
| :--- | :--- | :--- |
| PostgreSQL 16 | 5432 | `docker compose up -d` (carga `database/scripts` la primera vez) |
| Redis 7 | 6379 | `docker compose up -d` |
| backend | 4000 | `npm run dev` en `backend/` |
| socket-server | 4001 | `npm run dev` en `socket-server/` |
| frontend-cliente | 5173 | `npm run dev` en `frontend-cliente/` |
| frontend-restaurante | 5174 | `npm run dev` en `frontend-restaurante/` (Vite toma el siguiente libre) |

### 1. Base de datos y Redis

**bash (Linux, macOS, Git Bash):**

```bash
cp .env.example .env            # opcional: solo si quieres cambiar puertos o la clave de Postgres
docker compose up -d
docker compose ps               # espera a que ambos digan (healthy)
```

**PowerShell (Windows):**

```powershell
Copy-Item .env.example .env     # opcional
docker compose up -d
docker compose ps
```

La primera vez, Postgres ejecuta `database/scripts/00_ejecutar_todo.sql` (esquema, funciones,
triggers y datos de ejemplo). Para empezar de cero: `docker compose down -v` y otra vez `up -d`.

### 2. Secretos (una sola vez)

Genera **tres** valores distintos y guárdalos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # INTERNAL_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # QR_SECRET
```

`JWT_SECRET` e `INTERNAL_API_KEY` deben ser **idénticos** en `backend/.env` y
`socket-server/.env`; `QR_SECRET` va solo en `socket-server/.env`. El socket-server no arranca
con secretos cortos, repetidos o de ejemplo. Nunca pongas un secreto en un frontend ni con
prefijo `VITE_`.

### 3. Backend y socket-server

**bash:**

```bash
cd backend && cp .env.example .env && npm install && cd ..
cd socket-server && cp .env.example .env && npm install && cd ..
# edita backend/.env y socket-server/.env con los secretos del paso 2
(cd backend && npm run dev) &
(cd socket-server && npm run dev) &
```

**PowerShell** (una terminal por servicio):

```powershell
cd backend; Copy-Item .env.example .env; npm install; npm run dev
```

```powershell
cd socket-server; Copy-Item .env.example .env; npm install; npm run dev
```

Usuarios de demo con contraseña `Admin123!` (opcional):

```bash
docker compose exec -T postgres psql -U postgres -d smartdining < backend/scripts/fijar-password-demo.sql
```

```powershell
Get-Content backend/scripts/fijar-password-demo.sql | docker compose exec -T postgres psql -U postgres -d smartdining
```

### 4. Frontends

```bash
cd frontend-cliente && npm install && npm run dev
cd frontend-restaurante && npm install && npm run dev
```

### 5. Comprobar

```bash
curl http://localhost:4000/api/health    # {"status":"ok"}
curl http://localhost:4001/health        # {"estado":"ok"}
```

```powershell
Invoke-RestMethod http://localhost:4000/api/health
Invoke-RestMethod http://localhost:4001/health
```

---

## ⚙️ Variables de entorno (Seguridad y Producción)

A raíz de la Fase 2 de la auditoría de seguridad (H-04, H-09, H-10, H-27), el backend y socket-server requieren las siguientes variables para operar con lista blanca de CORS y conteo correcto de límites de intentos (rate limit):

| Variable | Descripción y Formato | Valor en Desarrollo | Valor en Producción (VPS) |
| :--- | :--- | :--- | :--- |
| `CORS_ORIGINS` | Lista de orígenes permitidos separados por comas, con protocolo (`http://` o `https://`) y **sin** barra final. **Obligatoria en producción** (si falta, el backend bloquea todas las peticiones cruzadas). | `http://localhost:5173,http://localhost:5174,http://localhost:5175` | `https://app.${DOMINIO},https://staff.${DOMINIO},https://cocina.${DOMINIO}` |
| `TRUST_PROXY` | Configuración de proxy de confianza para Express. Permite leer la IP real del cliente desde `X-Forwarded-For` para el rate limit (login y QR). Acepta `true`, número de saltos (`1`), o IP fija del proxy. | Vacío (apagado, para evitar falsificación de IP) | `172.31.250.10` (IP fija de Nginx en `docker-compose.prod.yml`) o `1` |

> **Nota:** En producción con Docker Compose (`docker-compose.prod.yml`), estas variables ya se propagan automáticamente al backend y socket-server basándose en la variable `DOMINIO` y la IP fija de Nginx (`172.31.250.10`).

---

## 🌐 Producción

Un VPS con Docker Compose, HTTPS de Let's Encrypt y despliegue automático al fusionar en
`main`. Guía completa: [`docs/despliegue.md`](docs/despliegue.md).

---

## 📋 Hoja de Ruta Inicial

- [x] **Paso 1:** Creación del repositorio y estructura base de carpetas.
- [ ] **Paso 2:** Creación y subida del script SQL de PostgreSQL con las 9 tablas en `/database`.
- [ ] **Paso 3:** Definición del contrato de API REST (endpoints y esquemas JSON) en `/backend`.
- [ ] **Paso 4:** Definición de eventos WebSocket y formato de token QR en `/socket-server`.
- [ ] **Paso 5:** Inicialización de proyectos base ("Hello World") en cada módulo.
- [ ] **Paso 6:** Integración con datos simulados (mocks) en frontend.
- [ ] **Paso 7:** Conexión completa Frontend ↔ Backend ↔ Base de Datos.
- [ ] **Paso 8:** Pruebas integrales y puesta a punto para Exposoftware.
