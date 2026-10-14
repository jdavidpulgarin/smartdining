# 📖 SmartDining — Manual Operativo del Personal

**Proyecto:** SmartDining - Sistema Integral de Digitalización de Salón, Cocina y Facturación  
**Autor:** Jarrinson Pulgarin (Líder de Base de Datos y Frontend Restaurante)  
**Versión:** 1.0  
**Audiencia:** Administradores, Meseros, Cajeros y Personal de Cocina  

---

## 🎯 1. Introducción y Arquitectura Operativa

SmartDining es una solución web de alta disponibilidad diseñada para optimizar los flujos de atención gastronómica en tiempo real. Conecta la experiencia del comensal desde su teléfono móvil (vía código QR dinámico), el panel de control del salón (`frontend-restaurante`), las pantallas táctiles de la cocina (`frontend-kds`) y la pasarela de cobros en caja.

### Roles de Usuario y Control de Acceso (RBAC)

| Rol | Pantallas Autorizadas | Responsabilidad Principal |
|---|---|---|
| **Mesero** | `/mesas`, `/pedidos` | Gestión de sala, apertura/rotación de QR y atención de comandas. |
| **Cajero** | `/caja`, `/pedidos` | Cobro de cuentas, pagos mixtos/parciales, emisión de recibos y cierre de mesas. |
| **Cocina** | Pantalla KDS (`frontend-kds`), `/pedidos` | Preparación en tiempo real, control de tiempos y despacho de platillos. |
| **Administrador** | `/`, `/mesas`, `/pedidos`, `/caja`, `/menu`, `/reportes` | Control total del sistema, configuración de catálogo, constructor de platos y auditoría financiera. |

---

## 🍽️ 2. Guía Operativa: Mesero (Gestión de Sala y Mesas)

### 2.1 Vista General de Sala (`/mesas`)
1. Inicie sesión con sus credenciales institucionales de rol `mesero`.
2. Acceda a la pestaña **Mesas** en la barra lateral.
3. El plano de sala muestra cada mesa identificada con su número, capacidad, ubicación y color de estado operativo:
   - 🟢 **Disponible:** Mesa lista para recibir nuevos comensales.
   - 🔵 **Ocupada:** Mesa con comensales activos y orden en proceso.
   - 🟡 **Reservada:** Mesa apartada previamente.
   - 🔴 **Mantenimiento / Bloqueada:** Mesa fuera de servicio.

### 2.2 Rotación y Entrega del Código QR a Comensales
1. Al sentarse nuevos clientes en la mesa, seleccione la tarjeta de la mesa.
2. Haga clic en el botón **"Generar / Rotar QR"**.
3. El sistema generará criptográficamente un nuevo token con versión incremental (`version_qr`), invalidando cualquier código QR anterior para prevenir accesos no autorizados fuera del restaurante.
4. Muestre el código QR al cliente o imprímalo para que los comensales accedan al menú digital desde su navegador móvil.

### 2.3 Monitoreo de Comandas en Salón (`/pedidos`)
1. Ingrese a la vista de **Pedidos** para visualizar el estado de cada comanda:
   - `recibido` &rarr; La orden fue emitida por los comensales o el mesero.
   - `en_preparacion` &rarr; La cocina ha tomado la orden en la pantalla KDS.
   - `listo` &rarr; El platillo está preparado en barra de despacho (se recibe alerta sonora o visual).
   - `entregado` &rarr; El mesero ha llevado los platillos a la mesa física.
2. Si un cliente solicita apoyo para ordenar directamente, el mesero puede crear o modificar la comanda seleccionando la mesa y agregando los ítems correspondientes.

---

## 💳 3. Guía Operativa: Cajero (Facturación y Liquidación)

### 3.1 Consulta de Cuentas por Cobrar (`/caja`)
1. Ingrese con credenciales de `cajero` o `admin`.
2. En el panel **Caja**, la columna izquierda lista todas las mesas con cuentas abiertas y saldo pendiente.
3. Al hacer clic sobre una mesa, el panel central desglosa la comanda consolidada:
   - Ítems solicitados con cantidad y precio congelado.
   - Recargos por ingredientes extra o personalizaciones de constructor.
   - Historial de pagos parciales ya abonados por la mesa.
   - **Total a pagar** y **Saldo restante**.

### 3.2 Registro de Pagos
El sistema admite tres métodos de pago certificados:

#### A. Pago en Efectivo
1. Seleccione la pestaña **Efectivo**.
2. Ingrese el monto entregado por el cliente en el campo **"Monto Recibido"**.
3. El sistema calculará automáticamente el **Cambio / Vuelto** a entregar al cliente.
4. Presione **"Confirmar Pago en Efectivo"**.

#### B. Pago con Tarjeta (Datáfono)
1. Seleccione la pestaña **Tarjeta**.
2. Procese la transacción en el datáfono físico del restaurante.
3. Ingrese en el campo **"Referencia de Transacción"** los últimos 4 dígitos o el número de aprobación del voucher.
4. Presione **"Registrar Cobro con Tarjeta"**.

#### C. Transferencia Bancaria
1. Seleccione **Transferencia**.
2. Verifique en la app bancaria del restaurante la acreditación del dinero.
3. Ingrese el número de comprobante o referencia digital.
4. Presione **"Registrar Transferencia"**.

### 3.3 Pagos Divididos / Parciales
Si los comensales solicitan pagar por separado:
1. Active la opción **"Pago Parcial"**.
2. Ingrese el monto específico que abonará el comensal actual.
3. Confirme el pago; el estado de pago del pedido cambiará a `parcial`.
4. El saldo restante quedará pendiente hasta que se cubra el 100% de la comanda.
5. Una vez liquidado el saldo total a $0.00, el sistema transiciona a `pagado` y habilita la liberación inmediata de la mesa física.

### 3.4 Emisión de Comprobantes
- Al confirmarse cada pago, se genera automáticamente el ticket digital de recibo.
- Presione **"Imprimir Recibo"** para enviar la orden a la impresora térmica de comandas.

---

## 🍳 4. Guía Operativa: Cocina / Operador de Pantalla KDS

### 4.1 Recepción de Comandas
1. La pantalla táctil KDS en cocina recibe las comandas en tiempo real vía WebSockets tan pronto son confirmadas por el cliente o mesero.
2. Cada tarjeta de comanda muestra:
   - Número de mesa y código de pedido (ej. `#ORD-0042`).
   - Minutos transcurridos desde la orden.
   - Ítems a preparar con cantidad y notas especiales (ej. *"sin cebolla"*, *"alérgico al maní"*).
   - Desglose de platos armables ("Constructor"): base, proteínas elegidas, salsas y especificación de porciones (`extra`, `ligera`, `normal`).

### 4.2 Flujo de Preparación
1. Al iniciar la cocción de un ítem o comanda, toque el botón **"En Preparación"**.
2. Al culminar el emplatado, presione **"Marcar como Listo"**.
3. El sistema:
   - Notifica instantáneamente a los meseros en salón para el retiro del plato.
   - Registra en la base de datos (`kds_metricas`) el tiempo real de preparación comparándolo con el tiempo objetivo de la carta.
   - Calcula la variación porcentual de eficiencia.

### 4.3 Alertas de Demora y Semaforización
- **Verde:** Tiempo transcurrido dentro del rango contractual (&le; 15 min).
- **Amarillo:** Preparación próxima al límite estimado.
- **Rojo:** Comanda demorada por encima del umbral. Se emite una alerta en el panel de supervisión (`kds_alertas`).

---

## ⚙️ 5. Guía Operativa: Administrador (Catálogo, Constructor y BI)

### 5.1 Administración del Catálogo de Menú (`/menu`)
1. **Creación de Platos:**  
   Acceda a `/menu`, presione **"Nuevo Plato"**, defina nombre, categoría, precio base, tiempo estimado de cocina y descripción.
2. **Disponibilidad Inmediata (RF-11):**  
   Si se agota un insumo o plato en cocina, active o desactive el selector **"Disponible"** en la tarjeta del plato. Esto actualizará inmediatamente la visibilidad en los menús QR de los clientes.
3. **Platos Personalizables ("Arma tu plato"):**  
   Al crear o editar un plato, marque la casilla **"Plato Personalizable (Constructor)"**.

### 5.2 Configuración del Constructor con el Editor de Pasos (RF-20)
1. En la lista de platos, ubique aquellos marcados con la insignia verde **"Arma tu plato"**.
2. Haga clic en el botón de configuración **"Configurar Pasos"**.
3. Se abrirá el modal interactivo **Editor de Pasos (`EditorPasos.jsx`)**:
   - **Paso 1 (ej. "Elige tu Base"):** Configure selección mínima (1), máxima (1), marque como *Obligatorio*. Agregue opciones: Arroz integral ($0), Quinoa ($1.50), Lechugas mixtas ($0).
   - **Paso 2 (ej. "Elige tu Proteína"):** Selección mínima (1), máxima (2). Agregue: Pollo grillé ($0), Salmón sellado (+$3.00), Tofu marinado ($0).
   - **Paso 3 (ej. "Toppings y Salsas"):** Opciones con recargos por porción extra.
4. Presione **"Guardar Configuración de Pasos"** para sincronizar las reglas de validación en base de datos.

### 5.3 Módulo de Métricas y Business Intelligence (`/reportes` / RF-21)
1. Acceda a la vista **Reportes** en la barra de navegación lateral.
2. Seleccione el rango de análisis deseado:
   - **Hoy:** Control de turno y servicio diario en tiempo real.
   - **Esta Semana:** Tendencia semanal acumulada.
   - **Este Mes:** Cierre contable y rendimiento del período.
3. **Indicadores Principales (KPIs):**
   - **Ingresos Totales:** Facturación bruta recaudada en salón.
   - **Comandas Atendidas:** Volumen de órdenes procesadas y liquidadas.
   - **Tiempo Medio Cocina (KDS):** Promedio de despacho por cocina contra la meta objetivo.
   - **Ocupación de Sala:** Porcentaje de uso de mesas y tasa de rotación.
4. **Métricas Especializadas de Base de Datos:**
   - **Platos Más Vendidos (`v_platos_top`):** Ranking Top 5 de demanda y recaudación por línea de producto.
   - **Distribución de Métodos de Pago:** Desglose porcentual y montos recaudados entre Tarjeta, Efectivo y Transferencia.
   - **Horas Pico de Afluencia:** Distribución de volumen de pedidos por franja horaria para planificar turnos del personal.
   - **Ingredientes Más Populares del Constructor (`v_ingredientes_top`):** Frecuencia de selección de ingredientes, demanda de porciones extra e ingresos adicionales recaudados por recargos.
   - **Eficiencia y Métricas KDS (`v_tiempos_kds`):** Comparativa de tiempos estimados vs. reales y desviación porcentual.
5. **Impresión de Informes:**  
   Presione **"Imprimir Informe"** para generar la versión impresa de balance para gerencia y auditoría contable.

---

## 🔒 6. Protocolos de Seguridad y Contingencia

1. **Protección contra Fuerza Bruta (H-04 / H-27):**  
   Si se ingresan 5 contraseñas erróneas en un minuto, el sistema bloqueará temporalmente los intentos devolviendo un estado HTTP 429 con contador de espera (*Retry-After*).
2. **Sesión Activa de Personal (H-09):**  
   Si un usuario es desactivado administrativamente, sus credenciales quedarán revocadas en un plazo máximo de 60 segundos por sincronización de caché.
3. **Mitigación de Pagos Fraudulentos (H-08):**  
   Cualquier anomalía o transacción sospechosa repetitiva es auditada en `intentos_pago_fallidos` registrando la dirección IP y la sesión de origen.
4. **Modo Contingencia en Reportes:**  
   Si el servidor de analíticas experimenta tareas de mantenimiento, el panel de reportes activa un banner discreto de simulación sin bloquear las operaciones de sala ni de caja.
