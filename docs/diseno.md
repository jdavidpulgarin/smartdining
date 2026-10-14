# Diseño del frontend cliente (J-01)

- **Figma (diseño y prototipo navegable):** https://www.figma.com/design/g20sFyIB3ZRFXu5DUZQDXo/SmartDining-%E2%80%93-Cliente?node-id=8-370
- **Cómo ver el prototipo:** abrir el enlace, ir a la página "Pantallas" y presionar ▶ (Presentar), arriba a la derecha. Se navega haciendo clic en los botones de cada pantalla.
- **Archivo:** "SmartDining – Cliente", marco de celular 390 x 844.

## Paleta

| Nombre | Uso | Color |
| --- | --- | --- |
| `primary` | Acciones principales y llamados a la acción | `#8B1E1E` |
| `primary-hover` | Estado activo/hover del botón primario | `#6E1717` |
| `cafe` | Texto principal, encabezados y bordes secundarios | `#3B2414` |
| `crema` | Fondo cálido de las pantallas | `#F7F1E8` |
| `verde` | Confirmaciones y estados completados | `#2F6B3A` |

## Tipografía

- **Títulos:** `Oswald` (pesos Bold `700` y SemiBold `600`).
- **Cuerpo:** `Inter` (pesos SemiBold `600`, Medium `500` y Regular `400`).

## Pantallas

1. **Unión (alias):** Ingreso a la sesión de la mesa tras escanear el código QR introduciendo el nombre o alias del comensal.
2. **Bienvenida:** Vista de la sesión activa con los integrantes conectados a la mesa y acceso directo al menú o al carrito grupal.
3. **Menú:** Catálogo con filtros por categoría y tarjetas de platos con foto, etiquetas y precio; al tocar un plato se abre el constructor.
4. **Constructor (un paso):** Selección paso a paso de ingredientes con barra de progreso, tarjetas seleccionables y barra inferior fija con subtotal.
5. **Carrito de la mesa:** Resumen colaborativo de los pedidos agrupados por comensal con totales individuales, total general y envío a cocina.
6. **Seguimiento:** Estado del pedido en tiempo real mediante línea de tiempo (*Recibido*, *En preparación*, *Listo* y *Entregado*).
7. **Cuenta y pago:** Detalle por comensal y modalidad de pago (Pagar todo, Partes iguales o Solo lo mío) con los datos de la tarjeta.
8. **Despedida:** Confirmación de pago con mensaje de agradecimiento y botón para calificar la experiencia.

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

