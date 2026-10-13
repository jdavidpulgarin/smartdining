# 🗄️ SmartDining — Módulo de Base de Datos Relacional (PostgreSQL)

**Líder de Base de Datos:** Jarrinson Pulgarin  
**Motor:** PostgreSQL 15+ / 16  
**Estrategia Técnica:** SQL Nativo + PL/pgSQL modular en scripts numerados (sin ORM / no Prisma)  
**Normalización:** Tercera Forma Normal (3FN) con diseño analítico optimizado  

---

## 📋 1. Descripción General del Módulo

El módulo de base de datos de **SmartDining** constituye el núcleo de persistencia, integridad y lógica transaccional de la plataforma. Ha sido diseñado específicamente para soportar alta concurrencia en salas gastronómicas, sincronización en tiempo real vía WebSockets, trazabilidad de cocina en pantallas KDS y un módulo avanzado de platos armables ("Constructor").

### Principios Arquitectónicos
1. **Lógica de Negocio en la Base de Datos:** Los cálculos críticos (totales de pedidos, recargos por porciones extra, variaciones de tiempo de preparación, validación de sesiones QR) se ejecutan mediante funciones PL/pgSQL y triggers, asegurando consistencia independientemente de los clientes conectados.
2. **Inmutabilidad Financiera:** Los precios unitarios de los platos e ingredientes solicitados se congelan al momento de emitir la orden (`precio_unitario` y `precio_aplicado`), garantizando auditoría histórica intacta frente a variaciones comerciales del menú.
3. **Seguridad y Trazabilidad:** Historial cronológico de cambios de estado, auditoría de modificaciones en datos sensibles y registro de intentos de pago fallidos (mitigación H-08).

---

## 🗂️ 2. Catálogo de Tablas del Sistema (17 Tablas)

El modelo de datos cuenta con **17 tablas relacionales**, descritas a continuación:

| # | Tabla | Propósito Principal | Llaves Foráneas Relevantes |
|---|---|---|---|
| 1 | `usuarios` | Cuentas del personal administrativo y operativo (admin, mesero, cajero, cocina) con hash bcrypt y control de estado activo. | - |
| 2 | `mesas` | Mesas físicas del restaurante, capacidad, ubicación, estado operativo y token QR rotativo (`token_qr`, `version_qr`, `expira_qr`). | - |
| 3 | `categorias` | Clasificación de productos del menú (Hamburguesas, Pizzas, Bebidas, Arma tu plato). | - |
| 4 | `platos` | Catálogo de platos con precio base, tiempo estimado de cocina, disponibilidad e indicador de personalización (`personalizable`). | `id_categoria` &rarr; `categorias` |
| 5 | `pasos_constructor` | Pasos secuenciales para configurar platos armables (ej. Base, Proteína, Salsas, Toppings) con reglas de selección mínima y máxima. | `id_plato` &rarr; `platos` |
| 6 | `ingredientes` | Opciones seleccionables dentro de cada paso del constructor con precio extra por porción, calorías y alérgenos. | `id_paso` &rarr; `pasos_constructor` |
| 7 | `pedidos` | Cabecera de comanda por mesa con código de seguimiento, sesión de comensal, estado operativo (`recibido` ... `pagado`) y `estado_pago`. | `id_mesa` &rarr; `mesas` |
| 8 | `detalles_pedido` | Ítems solicitados dentro de cada comanda con cantidad, subtotal congelado, notas especiales e identificador de línea KDS (`id_linea`). | `id_pedido` &rarr; `pedidos`, `id_plato` &rarr; `platos` |
| 9 | `detalles_ingredientes` | Desglose de ingredientes personalizados por cada plato armado, indicando porción (`normal`, `extra`, `ligera`) y recargo aplicado. | `id_detalle` &rarr; `detalles_pedido`, `id_ingrediente` &rarr; `ingredientes` |
| 10 | `transacciones` | Registro de pagos parciales o totales vinculados a pedidos, método (efectivo, tarjeta, transferencia), estado y referencia externa. | `id_pedido` &rarr; `pedidos` |
| 11 | `historial_estados` | Registro inmutable de transiciones de estado de comandas con marca temporal y usuario responsable para métricas y auditoría. | `id_pedido` &rarr; `pedidos`, `id_usuario` &rarr; `usuarios` |
| 12 | `suscripciones_push` | Endpoints y credenciales Web Push (W3C Push API) para alertar al celular del cliente o personal en tiempo real. | `id_pedido` &rarr; `pedidos`, `id_mesa` &rarr; `mesas` |
| 13 | `kds_metricas` | Auditoría de eficiencia operativa en cocina: compara el tiempo estimado contractual vs. el tiempo real de despacho por ítem. | `id_pedido` &rarr; `pedidos`, `id_detalle` &rarr; `detalles_pedido` |
| 14 | `intentos_pago_fallidos`| Registro de seguridad para detección de anomalías y prevención de ataques de fuerza bruta en pasarelas de pago (H-08). | `id_pedido` &rarr; `pedidos` |
| 15 | `token_qr_historico` | Registro histórico de hashes de tokens QR expirados o revocados por rotación periódica. | `id_mesa` &rarr; `mesas` |
| 16 | `kds_alertas` | Registro de retrasos detectados automáticamente en cocina cuando la preparación excede el tiempo estimado. | `id_pedido` &rarr; `pedidos` |
| 17 | `auditoria_cambios` | Bitácora de auditoría general (operación INSERT/UPDATE/DELETE, valores previos y nuevos en formato JSONB). | - |

---

## 📊 3. Vistas Analíticas y de Operación

PostgreSQL expone vistas optimizadas para alimentar los dashboards administrativos y la sincronización de sala:

1. **`v_ventas_diarias` (`24_vistas_reportes.sql`):**  
   Consolida por fecha el volumen de pedidos totales, pedidos completamente liquidados, ingresos totales recaudados, ticket promedio e ítems vendidos. Excluye pedidos cancelados.
2. **`v_ingredientes_top` (`24_vistas_reportes.sql`):**  
   Ranking de popularidad de ingredientes del constructor de platos. Mide solicitudes totales, porciones estándar vs. extras e ingresos recaudados por recargos adicionales.
3. **`v_platos_top` (`24_vistas_reportes.sql`):**  
   Ranking de demanda de platos por categoría, cantidad total de unidades despachadas e ingresos generados.
4. **`v_tiempos_kds` (`24_vistas_reportes.sql`):**  
   Consolida métricas de eficiencia en cocina: tiempo estimado promedio vs. tiempo real promedio y porcentaje de variación.
5. **`v_pedidos_activos` (`10_vistas.sql`):**  
   Listado de comandas activas en salón con resumen de platos y minutos transcurridos desde su creación.
6. **`v_mesas_ocupacion` (`10_vistas.sql`):**  
   Monitoreo en tiempo real del estado de cada mesa, pedidos asociados y tiempo de ocupación acumulado.

---

## 🚀 4. Guía de Ejecución y Despliegue de Scripts

Los scripts SQL están versionados secuencialmente en `database/scripts/`:

```
database/scripts/
├── 00_ejecutar_todo.sql                # Orquestador maestro (ejecuta del 01 al 24 en orden)
├── 01_tablas_complementarias.sql       # Tablas de soporte, kds y auditoria
├── 02_funciones_pagos.sql              # Logica transaccional de cobros y validaciones
├── 03_funciones_pedidos.sql            # Creacion y actualizacion de pedidos
├── 04_funciones_mesas.sql              # Rotacion de QR y apertura de mesas
├── 05_funciones_menu.sql               # Gestion de catalogo y disponibilidad
├── 06_funciones_auditoria.sql          # Triggers de bitacora
├── 07_funciones_notificaciones.sql     # Logica Web Push
├── 08_triggers.sql                     # Triggers automaticos de recalculo
├── 09_indices.sql                      # Indices B-tree y optimizaciones
├── 10_vistas.sql                       # Vistas operativas de sala
├── 11_seed_data.sql                    # Datos semilla iniciales
├── 12_documentacion.sql                # Metadatos y comentarios embebidos
├── 13_constructor.sql                  # Modulo de constructor de platos
├── 14_seed_constructor.sql             # Semilla de prueba para platos armables
├── 15_pagos_comensal.sql               # Pagos parciales por comensal
├── 16_pagos_integracion.sql            # Conciliacion y pasarelas externas
├── 17_sesion_mesa_cuenta.sql           # Sesion de mesa y cuenta abierta
├── 18_kds_variacion_tiempo.sql         # Metricas de desviacion en cocina
├── 19_fix_h01_bloqueo_pedidos.sql      # Concurrencia optimista en comandas
├── 20_fix_h02_sesion_mesa_cuenta.sql   # Consistencia de sesion en cuenta compartida
├── 21_fix_h06_limites_pedido.sql       # Limites cuantitativos de pedidos
├── 22_fix_h03_estado_pago.sql          # Consistencia de estado_pago
├── 23_fix_h08_intentos_pago_fallidos.sql # Registro y deteccion de fuerza bruta
└── 24_vistas_reportes.sql              # Vistas analiticas para modulo de BI
```

### Ejecución en PostgreSQL Local / Docker
Para crear la base de datos completa y ejecutar todas las migraciones:

```bash
# 1. Crear base de datos
psql -U postgres -c "CREATE DATABASE smartdining;"

# 2. Ejecutar esquema base
psql -U postgres -d smartdining -f database/schema.sql

# 3. Ejecutar scripts modulares en secuencia
cd database/scripts
psql -U postgres -d smartdining -f 00_ejecutar_todo.sql

# 4. (Opcional) Cargar datos de prueba completos
psql -U postgres -d smartdining -f ../seed.sql
```

### Ejecución con Docker Compose
```bash
docker compose up -d postgres
# La inicialización automática corre via database/docker-init.sh montado en /docker-entrypoint-initdb.d
```
