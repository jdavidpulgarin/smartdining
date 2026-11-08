# Reporte de Pruebas Reales: Base de Datos y Panel Restaurante (SmartDining)

**Responsable:** Jarrinson Pulgarín (Base de datos + Frontend Restaurante)  
**Fecha:** 2026-10-14  
**Rama:** `test/pruebas-reales-jarrinson`  
**Base de datos de prueba:** `smartdining_test` (PostgreSQL 16 en puerto 5433)  
**Servicios reales levantados:** Backend (puerto 4000), Socket-Server (puerto 4001), Frontend Restaurante (puerto 5173), Frontend Cliente (puerto 5174).  
**Regla de pruebas:** **Cero dobles, cero mocks, `VITE_USE_MOCKS=false`**.

---

## 1. Resumen Ejecutivo de Ejecución

Todas las suites se ejecutaron dos veces consecutivas desde cero para certificar estabilidad, idempotencia y ausencia de pruebas parpadeantes (*flaky tests*).

| Suite | Archivo / Componente | Pruebas | Pasan | Fallan | Omitidas | Duración (Corrida 1) | Duración (Corrida 2) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Paso 1: BD (SQL Real)** | `database/tests/db.test.js` | 14 | 14 | 0 | 0 | 352 ms | 437 ms |
| **Paso 2: Integración API + BD** | `database/tests/integracion/api.test.js` | 9 | 9 | 0 | 0 | 1.09 s | 1.11 s |
| **Paso 3: Tiempo Real (Socket.io)** | `database/tests/tiempo-real/socket.test.js` | 7 | 7 | 0 | 0 | 2.16 s | 2.17 s |
| **Paso 4: E2E Panel (Playwright / Chromium)** | `frontend-restaurante/e2e/panel.spec.js` | 10 | 10 | 0 | 0 | 36.8 s | 37.1 s |
| **TOTAL** | **Todas las Suites Reales** | **40** | **40** | **0** | **0** | **~40.4 s** | **~40.8 s** |

*Resultado global: **40/40 pruebas aprobadas (100% verde) en ambas corridas**.*  
*Validación de Frontend:* `npm run lint` aprobó con **0 errores y 0 warnings**. `npm run build` compiló en producción limpiamente en **2.11 s**.

---

## 2. Detalle de Pruebas Ejecutadas

### Paso 1: Pruebas de Base de Datos (`database/tests/db.test.js`)
- **1.1 Esquema e Integridad:** Verificación de las 18 tablas (15 base + 3 de constructor: `pasos_constructor`, `ingredientes`, `detalles_ingredientes`). Verificación de `token_qr` en tabla `mesas` como `nullable` y con índice `UNIQUE`.
- **1.2 Restricciones:** CHECK `min_sel <= max_sel` rechaza violaciones; porciones de ingredientes restringidas estrictamente a `ligera|normal|extra`; eliminación en cascada (`ON DELETE CASCADE`) al borrar un detalle limpia sus ingredientes hijos.
- **1.3 Máquina de Estados:** Transiciones legales (`recibido -> en_preparacion -> listo -> entregado -> pagado`) autorizadas; transiciones ilegales (ej. `entregado -> recibido` o `entregado -> cancelado`) rechazadas inmediatamente por el trigger `tr_validar_transicion_estado`.
- **1.4 Cálculo de Totales:** Adición de porción `extra` suma `precio_extra` al subtotal; porciones `ligera` y `normal` mantienen el costo base del plato ($0 costo extra); cancelación de pedido excluye automáticamente su importe del saldo consolidado de la mesa.
- **1.5 Función `obtener_menu_completo()`:** Retorna la estructura JSON jerárquica con pasos ordenados cronológicamente (`pc.orden ASC`), ingredientes disponibles y exclusión de ítems no disponibles (`disponible = false`).
- **1.6 Cuenta por Comensal (`obtener_cuenta_mesa`):** Cálculos aritméticos exactos por comensal tras pagos parciales; pago con `comensal = NULL` cubre la cuenta general de la mesa.
- **1.7 Concurrencia Real:** Dos transacciones concurrentes compitiendo con `SELECT ... FOR UPDATE` sobre la misma mesa; la segunda conexión se bloquea de manera determinista hasta que la primera finaliza (`COMMIT`/`ROLLBACK`).
- **1.8 Seed Completo:** Presencia verificada de platos armables (Bowl, Wrap, Arepa) con sus 4 pasos obligatorios y $\ge 5$ ingredientes configurados por paso.

### Paso 2: Integración API + BD (`database/tests/integracion/api.test.js`)
- **2.1 Autenticación y RBAC:** Login real con credenciales del seed para roles `admin`, `mesero` y `cajero`; respuesta 401 ante contraseñas inválidas; respuesta 403 Forbidden cuando un mesero intenta invocar el endpoint financiero `POST /api/transacciones`.
- **2.2 Ciclo de Mesa con QR y Sesión:** `POST /api/mesas/:id/abrir` genera URL con `?token=`; comensal obtiene JWT con `POST /api/mesas/qr/:token/sesion`; tras liberar la mesa, el token previo queda revocado (401).
- **2.3 Pedido con Plato Armado y Pagos:** Creación de pedido con plato compuesto; validación de que el total calculado en PostgreSQL coincide al centavo con el cálculo analítico; avance de estados vía API (`PATCH /api/pedidos/:id/estado`); pago en efectivo en caja salda la deuda y libera la mesa a estado `disponible`.

### Paso 3: Pruebas de Tiempo Real (`database/tests/tiempo-real/socket.test.js`)
- **3.1 - 3.2 Autenticación Socket:** Conexión con JWT de staff une al socket a `room:admin`; intento de conexión sin JWT o con token corrupto es rechazado con `AUTH_REQUERIDA` / `TOKEN_INVALIDO`.
- **3.3 Latencia `order:created`:** Emisión y recepción de evento de nuevo pedido en el panel en **177 ms - 218 ms** (ampliamente inferior al límite de 1000 ms).
- **3.4 Aislamiento de Salas:** Eventos `order:status` y `payment:confirmed` se entregan únicamente a la mesa destinataria (`room:mesa-X`), sin contaminación ni fugas hacia mesas adyacentes (`room:mesa-Y`).
- **3.5 Cierre de Sesión:** Al liberar la mesa, el evento `mesa:liberada` se propaga a los comensales y el socket-server corta la conexión de la sala.
- **3.6 Rotación de QR:** Rotación de token emite `qr:actualizado` hacia la sala de la mesa en < 80 ms.
- **3.7 Persistencia en Memoria del Carrito:** Comprobación de que el socket-server mantiene el estado del carrito en memoria del proceso (hallazgo esperado documentado abajo).

### Paso 4: E2E en Navegador Real con Playwright (`frontend-restaurante/e2e/panel.spec.js`)
- **4.1 Login Real:** Mesero autenticado visualiza el panel; credenciales falsas muestran alerta visual de error; token manipulado redirige a login.
- **4.2 Mesas en Panel vs. BD:** Las tarjetas renderizadas en el panel (`.table-card`) coinciden en cantidad, numeración y estado con `SELECT * FROM mesas`.
- **4.3 Flujo Multidispositivo (2 celulares):** Mesero abre mesa 3 en panel → abre modal QR → dos navegadores móviles reales (iPhone 13 y Pixel 5) ingresan con la URL del QR → comensal Ana crea comanda en vivo → el panel de restaurante ve aparecer el pedido con el nombre de Ana **en tiempo real sin recargar la página**.
- **4.4 Máquina de Estados en Panel:** Transición interactiva mediante botones de acción (`A Cocina` $\rightarrow$ `Marcar Listo` $\rightarrow$ `Entregar`) reflejada simultáneamente en la interfaz y en PostgreSQL (`pedidos.estado = 'entregado'`).
- **4.5 Alertas de Mesa:** Campana interactiva `.alertas-trigger-btn` y bandeja en topbar para meseros.
- **4.6 Rotación de QR en Panel:** Rotación de QR en vivo invalida el token previo y autentica exitosamente el nuevo.
- **4.7 Caja y Cierre:** Cobro de cuenta en efectivo por cajero salda el importe exacto en la vista `/caja` y libera la mesa en PostgreSQL (`mesas.estado = 'disponible'`).
- **4.8 Catálogo de Menú y Constructor:** Visualización de los platos armables (Bowl, Wrap, Arepa) con su estructura de pasos e ingredientes.
- **4.9 Reportes de Gestión:** Métricas financieras del dashboard `/reportes` coinciden con sumatorias SQL directas.
- **4.10 Diseño Responsivo:** Panel probado en tablet (viewport 1024×768) sin scroll horizontal ni desbordamiento de componentes.

---

## 3. Defectos Identificados, Soluciones y Hallazgos Externos

### A. Corregidos en mi alcance (`frontend-restaurante` y `database/tests`)
1. **Falta de escucha de `order:created` en `Pedidos.jsx`:**
   - *Causa:* El componente escuchaba `order:new` en vez de `order:created` (evento oficial del socket-server según `EVENTS.md`), y asumía que el payload era plano en lugar de `{ eventId, pedido }`.
   - *Solución:* Se agregó el listener `useSocketListener('order:created', ...)` extrayendo `data?.pedido`, permitiendo que el panel reciba y muestre las comandas entrantes en vivo sin recargar la página.
2. **Normalización de comensal en comandas:**
   - *Causa:* El payload del socket trae `pedido.items[0].comensal`, mientras que `Pedidos.jsx` solo leía `p.detalles[0].comensal`.
   - *Solución:* Se amplió `normalizarPedido()` para soportar `p.items || p.detalles` y resolver el alias del comensal.
3. **Reseteo no conforme con máquina de estados en pruebas:**
   - *Causa:* En corridas consecutivas, pedidos en estado `entregado` no podían pasar a `cancelado` mediante `UPDATE pedidos SET estado = 'cancelado'`, disparando la excepción del trigger `tr_validar_transicion_estado`.
   - *Solución:* Se implementó la función helper `resetTable()` que respeta la máquina de estados: pedidos en `recibido|en_preparacion|listo` pasan a `cancelado`, y pedidos en `entregado` registran su transacción en `transacciones` pasando legalmente a `pagado`.
4. **Método HTTP para cambio de estado:**
   - *Causa:* La prueba 4.7 usaba `PUT /api/pedidos/:id/estado` cuando la ruta oficial del backend es `PATCH /api/pedidos/:id/estado`. Al no actualizarse a `entregado`, la regla de cierre del backend no liberaba la mesa al cobrar.
   - *Solución:* Corregido a `PATCH`.

### B. Hallazgos en componentes de otros integrantes (Para información del equipo)
1. **Para Daniel (Backend) — `listarActivos()` no incluye detalles ni comensales:**
   - **Archivo:** `backend/src/services/pedidos.service.js:180`
   - **Comportamiento:** `SELECT * FROM pedidos WHERE estado IN ('recibido', 'en_preparacion')` no une con `detalles_pedido`. Si el panel recarga la página por HTTP (`GET /api/pedidos/activos`), no recibe los ítems ni los alias de los comensales a menos que haga consultas individuales a `GET /api/pedidos/:id`.
   - **Recomendación:** Considerar usar `detallesDePedidos()` en `listarActivos` similar a como se hace en `obtenerConDetalles()`.
2. **Para Roberto (Socket-Server) — Persistencia de carritos en memoria del proceso:**
   - **Archivo:** `socket-server/src/carritos.js`
   - **Comportamiento:** El estado de los carritos temporales se almacena en memoria de Node.js en lugar de una base persistente o Redis. Si el proceso del socket-server se reinicia a mitad del servicio, los comensales con carritos no confirmados deben volver a armar su pedido. (Hallazgo esperado según arquitectura actual).

---

## 4. Hallazgos de Rendimiento (PostgreSQL y Socket.io)

### Tiempos de Entrega en Tiempo Real
- Latencia de evento `order:created`: **177 ms** (Corrida 2) / **218 ms** (Corrida 1). SLA de diseño: < 1000 ms.
- Latencia de evento `order:status`: **26 ms - 45 ms**.
- Latencia de evento `qr:actualizado`: **60 ms - 76 ms**.

### Análisis de Consultas Críticas (`EXPLAIN ANALYZE`)
Ninguna consulta superó los 100 ms:
1. `EXPLAIN ANALYZE SELECT * FROM obtener_menu_completo()`
   - **Planning time:** 0.196 ms
   - **Execution time:** **19.188 ms** (Excelente para serialización JSON jerárquica de 3 niveles).
2. `EXPLAIN ANALYZE SELECT * FROM obtener_cuenta_mesa_json(1)`
   - **Planning time:** 0.052 ms
   - **Execution time:** **36.841 ms** (Cálculo dinámico de subtotales por comensal y saldos en 36 ms).
3. `EXPLAIN ANALYZE SELECT dp.*, pl.nombre FROM detalles_pedido dp JOIN platos pl ON pl.id_plato = dp.id_plato`
   - **Planning time:** 0.655 ms
   - **Execution time:** **0.237 ms** (Index Scan optimizado sobre `platos_pkey`).
4. `EXPLAIN ANALYZE SELECT * FROM mesas`
   - **Execution time:** **0.025 ms**.

---

## 5. Instrucciones de Ejecución para el Equipo

Desde la raíz del monorepo con los servicios levantados:

```bash
# 1. Pruebas de base de datos SQL real, integración API y tiempo real:
cd database
npm run test:real        # Corre las 3 suites completas (30 pruebas)
npm run test:db          # Solo pruebas SQL y funciones PL/pgSQL
npm run test:integracion # Solo pruebas HTTP API contra PostgreSQL
npm run test:tiempo-real # Solo pruebas Socket.io contra socket-server

# 2. Pruebas E2E de navegador real (Chromium):
cd ../frontend-restaurante
npm run test:e2e         # Ejecuta las 10 pruebas E2E en Playwright
npm run lint             # Linter de código (oxlint)
npm run build            # Build de producción de Vite
```
