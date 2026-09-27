# Modelo ER — SmartDining (diseño de Jarrison Pulgarin)

Transcripción del diagrama ER compartido por Jarrison. Usar estos nombres exactos
de tablas y columnas en todas las queries del backend.

## categorias
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_categoria |
| UK | varchar | nombre |
| | text | descripcion |
| | int | orden_visualizacion |
| | boolean | activo |

## platos
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_plato |
| FK | int | id_categoria |
| | varchar | nombre |
| | text | descripcion |
| | decimal | precio |
| | varchar | url_imagen |
| | boolean | disponible |
| | int | tiempo_preparacion_estimado |
| | timestamptz | creado_en |

## usuarios (solo personal: admin, mesero, cajero, cocina)
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_usuario |
| | varchar | nombre |
| UK | varchar | email |
| | varchar | password_hash |
| | varchar | rol |
| | boolean | activo |
| | timestamptz | creado_en |

## mesas
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_mesa |
| UK | int | numero |
| | int | capacidad |
| | varchar | ubicacion |
| | varchar | estado |
| UK | varchar | token_qr |
| | timestamptz | actualizado_en |

## pedidos
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_pedido |
| FK | int | id_mesa |
| UK | varchar | codigo_pedido |
| | varchar | estado |
| | decimal | total |
| | text | notas_generales |
| | timestamptz | creado_en |
| | timestamptz | actualizado_en |

## detalles_pedido
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_detalle |
| FK | int | id_pedido |
| FK | int | id_plato |
| | int | cantidad |
| | decimal | precio_unitario |
| | decimal | subtotal |
| | text | notas_especiales |
| | varchar | estado_item |
| | timestamptz | creado_en |

## historial_estados
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_historial |
| FK | int | id_pedido |
| FK | int | id_usuario |
| | varchar | estado_anterior |
| | varchar | estado_nuevo |
| | text | observaciones |
| | timestamptz | fecha_cambio |

## transacciones
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_transaccion |
| FK | int | id_pedido |
| | varchar | metodo_pago |
| | decimal | monto |
| | varchar | estado_transaccion |
| | varchar | referencia_externa |
| | timestamptz | creado_en |

## suscripciones_push
| Clave | Tipo | Columna |
|---|---|---|
| PK | int | id_suscripcion |
| FK | int | id_pedido |
| FK | int | id_mesa |
| UK | text | endpoint |
| | text | clave_p256dh |
| | text | clave_auth |
| | timestamptz | creado_en |

## Relaciones
- categorias 1 — N platos
- platos 1 — N detalles_pedido
- pedidos 1 — N detalles_pedido
- mesas 1 — N pedidos
- pedidos 1 — N historial_estados (auditoría)
- usuarios 0..1 — N historial_estados (nullable: cambios hechos por un comensal no tienen usuario)
- pedidos 1 — N transacciones
- pedidos 0..1 — N suscripciones_push
- mesas 0..1 — N suscripciones_push

## Diferencias con lo que el backend asumía antes
- platos usa `url_imagen` (no `imagen_url`) y NO tiene `personalizaciones` ni `alergenos`.
- usuarios NO tiene `telefono`.
- mesas usa `token_qr` (no `qr_token`) y agrega `capacidad` y `ubicacion`.
- categorias usa `orden_visualizacion` (no `orden`) y agrega `activo`.
- No existe relación entre pedidos y usuarios: el pedido pertenece a la mesa.
