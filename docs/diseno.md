# Diseño del frontend cliente (J-01)

- **Prototipo navegable:** https://www.figma.com/proto/g20sFyIB3ZRFXu5DUZQDXo/SmartDining-%E2%80%93-Cliente?page-id=8%3A370
- **Archivo de diseño (componentes y estilos):** https://www.figma.com/design/g20sFyIB3ZRFXu5DUZQDXo/SmartDining-%E2%80%93-Cliente?node-id=8-370
- **Archivo:** "SmartDining – Cliente", marco de celular 390 x 844.
- El prototipo se navega haciendo clic en los botones de cada pantalla.

## Paleta

| Nombre | Uso | Color |
| --- | --- | --- |
| `primary` | Acciones principales y llamados a la acción | `#8B1E1E` |
| `primary-hover` | Estado activo/hover del botón primario | `#6E1717` |
| `cafe` | Texto principal, encabezados y bordes secundarios | `#3B2414` |
| `crema` | Fondo cálido de las pantallas | `#F7F1E8` |
| `verde` | Confirmaciones, estados listos y selección de ingredientes | `#2F6B3A` |

## Tipografía

- **Títulos:** `Oswald` (pesos Bold `700` y SemiBold `600`).
- **Cuerpo:** `Inter` (pesos SemiBold `600`, Medium `500` y Regular `400`).

## Pantallas

1. **Unión (alias):** Ingreso a la sesión de la mesa tras escanear el código QR introduciendo el nombre o alias del comensal.
2. **Bienvenida:** Vista de la sesión activa con los integrantes conectados a la mesa y acceso directo al menú o al carrito grupal.
3. **Menú:** Catálogo del restaurante con buscador, categorías, platos normales y acceso destacado al constructor de platos por pasos.
4. **Constructor (un paso):** Selección paso a paso de ingredientes con barra de progreso, tarjetas seleccionables y barra inferior fija con subtotal.
5. **Carrito de la mesa:** Resumen colaborativo de los pedidos agrupados por comensal con totales individuales, total general y envío a cocina.
6. **Seguimiento:** Estado del pedido en tiempo real mediante línea de tiempo (*Recibido*, *En preparación*, *Listo para servir* y *Entregado*).
7. **Cuenta y pago:** Selección de modalidad de pago (*Todo junto*, *En partes iguales* o *Solo lo mío*), desglose con propina y confirmación.
8. **Despedida:** Confirmación de pago exitoso con resumen final de la transacción y opción para descargar el comprobante.

## Recorrido del prototipo

Unión → Bienvenida → Menú → Constructor → Carrito → Seguimiento → Cuenta y pago → Despedida.

## Componentes

- **Button** (primario y secundario, altura mínima de `48 px`)
- **Badge**
- **Card**
- **IngredientCard**
- **ProgressBar**
- **BottomBar**
- **Header**

Implementados en `frontend-cliente/src/components/ui/` y visibles en `/dev/ui` (solo en desarrollo).
