# Eventos Socket.io en Frontend Restaurante

Documentación de los eventos que el frontend puede **escuchar** y **emitir** desde `socket-server` (puerto 4001).

## 📨 Escuchar Eventos (useSocketListener)

### `order:status`
Se emite cuando cambia el estado de un pedido.

```javascript
import { useSocketListener } from '../hooks'

useSocketListener('order:status', (data) => {
  console.log('Pedido actualizado:', data)
  // data = { id_pedido, estado, timestamp, ... }
})
```

**Estados válidos:** `en_preparacion`, `listo`, `entregado`, `cancelado`

---

### `cart:update`
Se emite cuando el carrito de la mesa se actualiza.

```javascript
useSocketListener('cart:update', (data) => {
  // data = { action: 'set'|'remove'|'clear', items: [...] }
})
```

---

### `payment:confirmed`
Se emite cuando se confirma un pago.

```javascript
useSocketListener('payment:confirmed', (data) => {
  // data = { id_pedido, monto, metodo_pago }
})
```

---

## 📤 Emitir Eventos (useSocketEmit)

### `cart:update`
Actualizar el carrito de la mesa actual.

```javascript
import { useSocketEmit } from '../hooks'

const emit = useSocketEmit()

emit('cart:update', {
  action: 'set',
  items: [
    { id_plato: 1, qty: 2 },
    { id_plato: 3, qty: 1 }
  ]
}, (ack) => {
  console.log('Carrito actualizado:', ack)
})
```

---

### `order:create`
Crear un nuevo pedido (desde mesero/admin).

```javascript
emit('order:create', {
  id_mesa: 2,
  items: [...]
})
```

---

## 🔗 Referencia Completa

Ver `socket-server/EVENTS.md` para la especificación completa de payloads, errores y códigos.

---

## 📝 Ejemplo de Integración

```javascript
import { useState, useCallback } from 'react'
import { useSocketListener, useSocketEmit } from '../hooks'

export function MiComponente() {
  const [pedido, setPedido] = useState(null)
  const emit = useSocketEmit()

  // Escuchar cambios
  useSocketListener('order:status', (data) => {
    setPedido(data)
  })

  // Emitir acción
  const handleConfirm = useCallback(() => {
    emit('order:confirm', { id_pedido: pedido.id })
  }, [pedido, emit])

  return (...)
}
```
