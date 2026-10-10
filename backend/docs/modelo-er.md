# Modelo de datos — SmartDining

Transcripción de `database/schema.sql` (diseño de Jarrison Pulgarin, dueño de la base de
datos). **Usar estos nombres exactos de tablas y columnas en todas las queries del
backend.** Si el schema cambia, este documento se actualiza detrás, no al revés.

El schema unificado crea **15 tablas**: las 9 del dominio original más 6 complementarias de
auditoría, métricas y seguridad. Extensiones: `uuid-ossp` y `pgcrypto`.

| # | Tabla | Para qué |
|---|---|---|
| 1 | [usuarios](#1-usuarios) | Personal del restaurante (RBAC) |
| 2 | [mesas](#2-mesas) | Mesas de sala, su estado y su token QR |
| 3 | [transiciones_validas](#3-transiciones_validas) | Máquina de estados del pedido |
| 4 | [categorias](#4-categorias) | Secciones de la carta |
| 5 | [platos](#5-platos) | Catálogo con precios y tiempos |
| 6 | [pedidos](#6-pedidos) | Cabecera de comanda por mesa |
| 7 | [detalles_pedido](#7-detalles_pedido) | Ítems del pedido, con precio histórico |
| 8 | [transacciones](#8-transacciones) | Cobros y métodos de pago |
| 9 | [historial_estados](#9-historial_estados) | Trazabilidad de estados |
| 10 | [suscripciones_push](#10-suscripciones_push) | Credenciales Web Push |
| 11 | [auditoria_cambios](#11-auditoria_cambios) | Bitácora DML de tablas críticas |
| 12 | [kds_metricas](#12-kds_metricas) | Tiempos reales vs. estimados en cocina |
| 13 | [intentos_pago_fallidos](#13-intentos_pago_fallidos) | Pagos rechazados y anomalías |
| 14 | [token_qr_historico](#14-token_qr_historico) | Tokens QR invalidados |
| 15 | [kds_alertas](#15-kds_alertas) | Alertas de demora en cocina |

---

## 1. usuarios

Solo personal: `admin`, `mesero`, `cajero`, `cocina`. El rol `comensal` **no** vive aquí
(existe solo dentro del JWT de sesión de mesa).

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_usuario | SERIAL | |
| | nombre | VARCHAR(100) | NOT NULL |
| UK | email | VARCHAR(120) | NOT NULL |
| | password_hash | VARCHAR(255) | NOT NULL (bcrypt) |
| | rol | VARCHAR(20) | NOT NULL · CHECK: `admin`, `mesero`, `cajero`, `cocina` |
| | activo | BOOLEAN | NOT NULL DEFAULT TRUE · el login rechaza `false` |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |

## 2. mesas

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_mesa | SERIAL | |
| UK | numero | INTEGER | NOT NULL · CHECK > 0 |
| | capacidad | INTEGER | NOT NULL DEFAULT 4 · CHECK > 0 |
| | ubicacion | VARCHAR(50) | NOT NULL DEFAULT `'Principal'` |
| | estado | VARCHAR(20) | NOT NULL DEFAULT `'disponible'` · CHECK: `disponible`, `ocupada`, `reservada`, `mantenimiento` |
| UK | token_qr | VARCHAR(255) | **NULLABLE** · NULL = mesa sin sesión abierta |
| | version_control | INTEGER | NOT NULL DEFAULT 1 · concurrencia optimista |
| | actualizado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |

> `token_qr` guarda el token firmado que emite el socket-server (formato
> `v1.<datos>.<firma>`, ~143 caracteres, de ahí el VARCHAR(255)). Es una **credencial**: no
> sale en ninguna respuesta de la API salvo `POST /mesas/:id/abrir`.
>
> `version_control` lo incrementa el trigger `tr_control_concurrencia_mesa` en **cualquier**
> UPDATE de la tabla, así que **no sirve** para identificar una sesión de mesa; para eso se
> usa el `sid` que va dentro del token.

## 3. transiciones_validas

Máquina de estados que aplica el trigger `tr_validar_transicion_estado`.

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_transicion | SERIAL | |
| | estado_desde | VARCHAR(20) | NOT NULL |
| | estado_hacia | VARCHAR(20) | NOT NULL |
| | descripcion | VARCHAR(255) | NOT NULL |
| | requiere_usuario | BOOLEAN | NOT NULL DEFAULT FALSE · **declarado pero no aplicado por ningún trigger** |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |
| UK | (estado_desde, estado_hacia) | | `uq_transicion_estados` |

Contenido sembrado:

```
recibido       -> en_preparacion | cancelado
en_preparacion -> listo | cancelado
listo          -> entregado
entregado      -> pagado
```

## 4. categorias

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_categoria | SERIAL | |
| UK | nombre | VARCHAR(60) | NOT NULL |
| | descripcion | TEXT | |
| | orden_visualizacion | INTEGER | NOT NULL DEFAULT 0 |
| | activo | BOOLEAN | NOT NULL DEFAULT TRUE |

## 5. platos

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_plato | SERIAL | |
| FK | id_categoria | INTEGER | NOT NULL → `categorias` · ON DELETE RESTRICT |
| | nombre | VARCHAR(120) | NOT NULL |
| | descripcion | TEXT | |
| | precio | DECIMAL(10,2) | NOT NULL · CHECK >= 0 |
| | url_imagen | VARCHAR(255) | |
| | disponible | BOOLEAN | NOT NULL DEFAULT TRUE |
| | tiempo_preparacion_estimado | INTEGER | NOT NULL DEFAULT 15 · CHECK > 0 · minutos |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |

> No existen `personalizaciones` ni `alergenos`. Las preferencias del comensal van por ítem,
> en `detalles_pedido.notas_especiales`.

## 6. pedidos

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_pedido | SERIAL | |
| FK | id_mesa | INTEGER | NOT NULL → `mesas` · ON DELETE RESTRICT |
| UK | codigo_pedido | VARCHAR(16) | NOT NULL · el backend genera `PED-AAMMDD-XXXXX` (16 exactos) |
| | estado | VARCHAR(20) | NOT NULL DEFAULT `'recibido'` · CHECK: `recibido`, `en_preparacion`, `listo`, `entregado`, `pagado`, `cancelado` |
| | total | DECIMAL(10,2) | NOT NULL DEFAULT 0.00 · CHECK >= 0 · **lo calcula el trigger** |
| | notas_generales | TEXT | |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |
| | actualizado_en | TIMESTAMPTZ | NOT NULL DEFAULT now · lo pone el trigger al cambiar de estado |

> **No hay relación entre pedidos y usuarios**: el pedido pertenece a la mesa.

## 7. detalles_pedido

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_detalle | SERIAL | |
| FK | id_pedido | INTEGER | NOT NULL → `pedidos` · ON DELETE CASCADE |
| FK | id_plato | INTEGER | NOT NULL → `platos` · ON DELETE RESTRICT |
| | cantidad | INTEGER | NOT NULL · CHECK > 0 |
| | precio_unitario | DECIMAL(10,2) | NOT NULL · CHECK >= 0 · precio congelado |
| | subtotal | DECIMAL(10,2) | NOT NULL · CHECK >= 0 · **lo calcula el trigger** |
| | notas_especiales | TEXT | apodo del comensal + su nota |
| | estado_item | VARCHAR(20) | NOT NULL DEFAULT `'pendiente'` · CHECK: `pendiente`, `cocinando`, `listo`, `servido`, `cancelado` |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |

## 8. transacciones

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_transaccion | SERIAL | |
| FK | id_pedido | INTEGER | NOT NULL → `pedidos` · ON DELETE RESTRICT |
| | metodo_pago | VARCHAR(20) | NOT NULL · CHECK: `efectivo`, `tarjeta_debito`, `tarjeta_credito`, `transferencia`, `online` |
| | monto | DECIMAL(10,2) | NOT NULL · CHECK > 0 |
| | estado_transaccion | VARCHAR(20) | NOT NULL DEFAULT `'completada'` · CHECK: `pendiente`, `completada`, `fallida`, `reembolsada` |
| | referencia_externa | VARCHAR(100) | referencia de la pasarela |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |

## 9. historial_estados

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_historial | SERIAL | |
| FK | id_pedido | INTEGER | NOT NULL → `pedidos` · ON DELETE CASCADE |
| FK | id_usuario | INTEGER | **NULLABLE** → `usuarios` · ON DELETE SET NULL · **null si el cambio lo hizo un comensal** |
| | estado_anterior | VARCHAR(20) | null en el primer registro |
| | estado_nuevo | VARCHAR(20) | NOT NULL |
| | observaciones | TEXT | |
| | fecha_cambio | TIMESTAMPTZ | NOT NULL DEFAULT now |

## 10. suscripciones_push

Módulo de Roberto. Ningún endpoint del backend la consume todavía.

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_suscripcion | SERIAL | |
| FK | id_pedido | INTEGER | NULLABLE → `pedidos` · ON DELETE CASCADE |
| FK | id_mesa | INTEGER | NULLABLE → `mesas` · ON DELETE SET NULL |
| UK | endpoint | TEXT | NOT NULL · el trigger exige `https://` |
| | clave_p256dh | TEXT | NOT NULL |
| | clave_auth | TEXT | NOT NULL |
| | creado_en | TIMESTAMPTZ | NOT NULL DEFAULT now |

---

## Tablas complementarias

Las mantiene la base por sus propios triggers y funciones; el backend **no escribe** en
ninguna de ellas.

## 11. auditoria_cambios

Bitácora DML de `usuarios`, `platos` y `transacciones` (trigger `tr_auditar_cambios`).

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_auditoria | BIGSERIAL | |
| | tabla_afectada | VARCHAR(60) | NOT NULL |
| | operacion | VARCHAR(10) | NOT NULL · CHECK: `INSERT`, `UPDATE`, `DELETE` |
| | registro_id | INTEGER | **ojo:** en `transacciones` guarda el `id_pedido`, no el `id_transaccion` (bug conocido en `fn_tr_auditar_cambios`) |
| | datos_anteriores | JSONB | |
| | datos_nuevos | JSONB | |
| FK | usuario_id | INTEGER | NULLABLE → `usuarios` · ON DELETE SET NULL |
| | ip_origen | VARCHAR(45) | DEFAULT `'127.0.0.1'` |
| | fecha_cambio | TIMESTAMPTZ | NOT NULL DEFAULT now |
| | hash_verificacion | VARCHAR(64) | NOT NULL |

## 12. kds_metricas

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_metrica | SERIAL | |
| FK | id_pedido | INTEGER | NOT NULL → `pedidos` · ON DELETE CASCADE |
| FK | id_plato | INTEGER | NULLABLE → `platos` · ON DELETE SET NULL |
| | tiempo_preparacion_real | NUMERIC(8,2) | NOT NULL · CHECK >= 0 · minutos |
| | tiempo_preparacion_estimado | INTEGER | NOT NULL · CHECK > 0 |
| | variacion_porcentaje | NUMERIC(6,2) | NOT NULL |
| | fecha_metrica | TIMESTAMPTZ | NOT NULL DEFAULT now |

## 13. intentos_pago_fallidos

La llena el trigger `tr_validar_transaccion_financiera` cuando un pago excede el saldo.

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_intento | SERIAL | |
| FK | id_pedido | INTEGER | NOT NULL → `pedidos` · ON DELETE CASCADE |
| FK | id_usuario | INTEGER | NULLABLE → `usuarios` · ON DELETE SET NULL |
| | metodo_pago | VARCHAR(20) | |
| | monto | DECIMAL(10,2) | CHECK > 0 |
| | razon_rechazo | TEXT | NOT NULL |
| | ip_origen | VARCHAR(45) | DEFAULT `'127.0.0.1'` |
| | fecha_intento | TIMESTAMPTZ | NOT NULL DEFAULT now |

## 14. token_qr_historico

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_historico_token | SERIAL | |
| FK | id_mesa | INTEGER | NOT NULL → `mesas` · ON DELETE CASCADE |
| | token_antiguo | VARCHAR(255) | NOT NULL |
| | fecha_invalidacion | TIMESTAMPTZ | NOT NULL DEFAULT now |

> Se llenaba desde `tr_regenerar_token_qr`, que **se retiró** para que el ciclo de vida de
> `token_qr` fuera del backend. Hoy queda sin escritor: si se quiere conservar el histórico,
> hay que decidir quién lo escribe.

## 15. kds_alertas

| Clave | Columna | Tipo | Notas |
|---|---|---|---|
| PK | id_alerta | SERIAL | |
| FK | id_pedido | INTEGER | NOT NULL → `pedidos` · ON DELETE CASCADE |
| | mensaje | TEXT | NOT NULL |
| | variacion_porcentaje | NUMERIC(6,2) | |
| | fecha_alerta | TIMESTAMPTZ | NOT NULL DEFAULT now |

---

## Relaciones

```
categorias 1 ─── N platos
platos     1 ─── N detalles_pedido
mesas      1 ─── N pedidos                 (el pedido es de la MESA, no de un usuario)
pedidos    1 ─── N detalles_pedido
pedidos    1 ─── N historial_estados        (auditoría)
usuarios 0..1 ── N historial_estados        (null si el cambio lo hizo un comensal)
pedidos    1 ─── N transacciones
pedidos  0..1 ── N suscripciones_push
mesas    0..1 ── N suscripciones_push
usuarios 0..1 ── N auditoria_cambios
pedidos    1 ─── N kds_metricas  ·  platos 0..1 ── N kds_metricas
pedidos    1 ─── N intentos_pago_fallidos  ·  usuarios 0..1 ── N intentos_pago_fallidos
mesas      1 ─── N token_qr_historico
pedidos    1 ─── N kds_alertas
```

## Lo que calcula la base y el backend no debe replicar

| Regla | Dónde vive |
|---|---|
| `detalles_pedido.subtotal` | Trigger `tr_validar_detalle_pedido` |
| `pedidos.total` | Trigger `tr_actualizar_total_pedido` |
| Transiciones de estado del pedido | Trigger `tr_validar_transicion_estado` + `transiciones_validas` |
| Disponibilidad del plato al comandar | Trigger `tr_validar_disponibilidad_plato` |
| Monto del pago vs. total del pedido | Trigger `tr_validar_transaccion_financiera` |
| `mesas.version_control` y `actualizado_en` | Trigger `tr_control_concurrencia_mesa` |
| Métricas y alertas del KDS | Trigger `tr_calcular_tiempo_preparacion` |

El detalle del reparto de responsabilidades está en [api-spec.md](./api-spec.md).
