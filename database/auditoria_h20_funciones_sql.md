# Auditoría y Clasificación de Funciones SQL Sin Uso (H-20)

**Responsable:** Jarrinson Pulgarin (Líder Técnico, Base de Datos)  
**Alcance:** Scripts `02_funciones_pagos.sql` a `07_funciones_notificaciones.sql`  
**Referencia Auditoría:** Hallazgo H-20 (Severidad Baja)

---

## 1. Resumen Ejecutivo
Se auditaron las 22 funciones de PostgreSQL identificadas en la auditoría como no vinculadas a triggers automáticos ni invocadas en la versión actual del backend de Express.

Siguiendo las reglas de trabajo:
- **No se modifican los scripts inmutables `00` a `17`.**
- Se preservan intactas las funciones requeridas para los nuevos endpoints asignados a Daniel (como `reembolsar_pago` para H-07, `actualizar_disponibilidad_plato` para RF-11, etc.).
- Se clasifica cada función en una de tres categorías:
  1. **Conservar para Daniel / Backend Próximo**: Lista para ser consumida por el backend en las nuevas rutas del roadmap.
  2. **Backlog / Fase v2**: Funciones de notificaciones Web Push o analítica avanzada que requieren infraestructura adicional.
  3. **Reemplazada / Deprecada por Triggers**: Funciones cuya lógica fue asumida por triggers reactivos en la base de datos.

---

## 2. Clasificación Detallada de las 22 Funciones

| # | Función | Script Origen | Decisión | Justificación & Caso de Uso |
|---|---|---|---|---|
| 1 | `reembolsar_pago(id_pago, motivo, id_usuario)` | `02_funciones_pagos.sql` | **Conservar para Daniel** | **Crítica para H-07**: Ruta administrativa de reembolsos (`POST /api/pagos/:id/reembolso`). Registra la devolución y revierte el balance. |
| 2 | `cancelar_pedido(id_pedido, motivo, id_usuario)` | `03_funciones_pedidos.sql` | **Conservar para Daniel** | Flujo de anulación de comandas por mesero/cocina (RF-08). Valida que el pedido no esté ya entregado. |
| 3 | `obtener_platos_destacados(limite)` | `05_funciones_menu.sql` | **Conservar para Daniel** | Pantalla de inicio del comensal y módulo de reportes (RF-21) para ranking de ventas. |
| 4 | `actualizar_disponibilidad_plato(id_plato, disponible, id_usuario)` | `05_funciones_menu.sql` | **Conservar para Daniel** | **Requerida para RF-11**: Módulo de agotados en tiempo real (`PATCH /api/menu/platos/:id/disponibilidad`). |
| 5 | `generar_comprobante_pago(id_transaccion)` | `02_funciones_pagos.sql` | **Conservar para Daniel** | Generación de factura electrónica y comprobante POS en PDF/impresión. |
| 6 | `obtener_detalles_plato(id_plato)` | `05_funciones_menu.sql` | **Conservar para Daniel** | Modal de detalles nutricionales, alérgenos y descripción del plato para el frontend. |
| 7 | `obtener_pedidos_mesa(id_mesa)` | `03_funciones_pedidos.sql` | **Conservar para Daniel** | Historial de comandas por mesa durante el turno de servicio. |
| 8 | `obtener_historial_pedido(id_pedido)` | `06_funciones_auditoria.sql` | **Conservar para Daniel** | Trazabilidad de estados del pedido para auditoría y pantalla KDS. |
| 9 | `obtener_auditoria_cambios(tabla, id_registro, limite)` | `06_funciones_auditoria.sql` | **Conservar para Daniel** | Panel administrativo de auditoría forense (`GET /api/admin/auditoria`). |
| 10 | `generar_reporte_auditoria(fecha_inicio, fecha_fin)` | `06_funciones_auditoria.sql` | **Conservar para Daniel** | **Requerida para RF-21**: Reportes de ventas, caja y seguridad. |
| 11 | `obtener_intentos_fraude()` | `06_funciones_auditoria.sql` | **Conservar para Daniel** | Panel de ciberseguridad para detectar anomalías en pagos o logins repetidos. |
| 12 | `bloquear_usuario_sospechoso(id_usuario, motivo)` | `06_funciones_auditoria.sql` | **Conservar para Daniel** | Bloqueo preventivo de cuentas comprometidas tras múltiples intentos fallidos (H-04). |
| 13 | `obtener_categorias_activas()` | `05_funciones_menu.sql` | **Conservar para Daniel** | Filtro simplificado de categorías para pantallas de selección rápida. |
| 14 | `obtener_platos_por_categoria(id_categoria)` | `05_funciones_menu.sql` | **Conservar para Daniel** | Navegación por pestañas de categoría en la carta digital del cliente. |
| 15 | `obtener_mesas_disponibles(capacidad_minima)` | `04_funciones_mesas.sql` | **Conservar para Daniel** | Asignación inteligente de mesas por capacidad para anfitriones/meseros. |
| 16 | `regenerar_token_qr(id_mesa)` | `04_funciones_mesas.sql` | **Conservar para Daniel** | Rotación manual o programada del código QR de la mesa (RF-02). |
| 17 | `verificar_endpoint_valido(endpoint)` | `07_funciones_notificaciones.sql` | **Backlog v2** | Validación de sintaxis de URLs push (W3C Push API). Pospuesta a fase de PWA. |
| 18 | `registrar_suscripcion_push(id_usuario, endpoint, p256dh, auth)` | `07_funciones_notificaciones.sql` | **Backlog v2** | Suscripción de navegadores a notificaciones push (RF-23). Requiere VAPID keys en backend. |
| 19 | `obtener_suscripciones_activas(id_usuario)` | `07_funciones_notificaciones.sql` | **Backlog v2** | Consulta de dispositivos activos de un usuario para envío push concurrente. |
| 20 | `enviar_notificacion_push(id_usuario, titulo, cuerpo, payload)` | `07_funciones_notificaciones.sql` | **Backlog v2** | Cola de mensajes push en BD antes de dispatching por el servicio de notificaciones. |
| 21 | `cancelar_suscripcion_push(id_suscripcion)` | `07_funciones_notificaciones.sql` | **Backlog v2** | Desregistro cuando un token push es revocado o el usuario cierra sesión. |
| 22 | `limpiar_suscripciones_expiradas()` | `07_funciones_notificaciones.sql` | **Backlog v2** | Mantenimiento periódico (cron job) para depurar suscripciones inactivas o 410 Gone. |

---

## 3. Acciones Tomadas
1. **Conservación:** Todas las 16 funciones operativas que Daniel necesita se mantienen vivas en PostgreSQL para evitar reimplementación o duplicación de código en Node.js.
2. **Backlog Documentado:** Las 6 funciones de notificaciones push (`07_funciones_notificaciones.sql`) quedan clasificadas para la fase de Progressive Web App (PWA) y Push Server.
3. **No regresión:** La base de datos mantiene integridad total, compatibilidad con scripts históricos y cero errores en la ejecución de `00_ejecutar_todo.sql`.
