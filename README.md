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
5. *Require conversation resolution before merging*.
6. *Block force pushes* y *Restrict deletions*.
7. En `main`, además: restringir quién puede hacer push (solo el líder).

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
