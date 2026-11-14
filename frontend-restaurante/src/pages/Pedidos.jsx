import { useState, useEffect, useCallback } from 'react'
import {
  Flame,
  BellRing,
  CheckCircle2,
  Search,
  X,
  ChefHat,
  Timer,
  FileText,
  User,
  AlertCircle,
  RefreshCw,
  Ban,
} from 'lucide-react'
import { StatusBadge } from '../components/ui/Badge'
import { pedidosApi } from '../services/api'
import { useSocketListener, useSocketEmit, useAuth } from '../hooks'
import { crearVentanaEventos } from '../utils/dedupeEventos'
import {
  puedeCancelarPlato,
  lineaCancelable,
  validarMotivo,
  mensajeErrorCancelarPlato,
  MOTIVO_MAX,
} from '../utils/cancelarPlato'

function backendEstadoAUI(estado) {
  switch (estado) {
    case 'recibido':
      return 'Pendiente'
    case 'en_preparacion':
      return 'En cocina'
    case 'listo':
      return 'Por servir'
    case 'entregado':
    case 'pagado':
      return 'Entregado'
    default:
      return 'Pendiente'
  }
}

function uiEstadoABackend(estadoUi) {
  switch (estadoUi) {
    case 'Pendiente':
      return 'en_preparacion'
    case 'En cocina':
      return 'listo'
    case 'Por servir':
      return 'entregado'
    default:
      return 'entregado'
  }
}

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`

/** Una línea del pedido (GET /pedidos/activos, order:created o la respuesta de D-13). */
function normalizarLinea(d) {
  return {
    idDetalle: d.id_detalle ?? null,
    estado: d.estado_item || 'pendiente',
    name: d.nombre || d.plato_nombre || 'Plato',
    qty: d.cantidad || 1,
    notes: d.notas_especiales || d.notas || null,
    subtotal: d.subtotal ? pesos(d.subtotal) : '',
    comensal: d.comensal || 'General',
  }
}

/** Una línea cancelada (D-13 o el comensal, #180): tachada y con el total nuevo. */
function marcarLineaCancelada(ord, idDetalle, total) {
  return {
    ...ord,
    total: total !== undefined && total !== null ? pesos(total) : ord.total,
    items: ord.items.map((it) => (it.idDetalle === idDetalle ? { ...it, estado: 'cancelado' } : it)),
  }
}

function normalizarPedido(p) {
  const minElapsed = p.creado_en
    ? Math.max(0, Math.floor((Date.now() - new Date(p.creado_en).getTime()) / 60000))
    : 0

  // GET /pedidos/activos trae las líneas en `detalles`; el evento order:created
  // (EVENTS.md §5) las trae en `pedido.items`. Mismos campos en los dos.
  const lineas = p.detalles || p.items || []

  return {
    id: p.codigo_pedido || `#${p.id_pedido}`,
    rawId: p.id_pedido,
    table: p.mesa_numero ? `Mesa ${p.mesa_numero}` : p.id_mesa ? `Mesa ${p.id_mesa}` : 'Barra',
    numeroMesa: p.mesa_numero || p.id_mesa || '?',
    client: lineas.find((d) => d.comensal)?.comensal || 'Comensal General',
    waiter: p.mesero || 'Mesero Asignado',
    state: backendEstadoAUI(p.estado),
    rawEstado: p.estado,
    time: p.creado_en
      ? new Date(p.creado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'En vivo',
    elapsedMin: minElapsed,
    total: pesos(p.total),
    items: lineas.map(normalizarLinea),
  }
}

export function Pedidos() {
  const [ordersList, setOrdersList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedStatus, setSelectedStatus] = useState('Todos')
  const [searchQuery, setSearchQuery] = useState('')
  // El detalle abierto se guarda por id y se lee de la lista: así ve en vivo
  // los cambios (una línea cancelada, otro estado) y se cierra solo si el
  // pedido sale de la lista.
  const [selectedId, setSelectedId] = useState(null)
  const selectedOrder = ordersList.find((o) => o.rawId === selectedId) || null
  // «Cancelar plato» en curso: { idDetalle, motivo, error, enviando }.
  const [cancelando, setCancelando] = useState(null)
  const setSelectedOrder = (ord) => {
    setSelectedId(ord ? ord.rawId : null)
    setCancelando(null)
  }
  const [toastMsg, setToastMsg] = useState(null)
  const emit = useSocketEmit()
  const { user } = useAuth()
  const puedeCancelar = puedeCancelarPlato(user?.rol)

  const showToast = (msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3500)
  }

  const recargarPedidos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await pedidosApi.listarActivos({ timeout: 10000 })
      const raw = data?.pedidos || []
      setOrdersList(raw.map(normalizarPedido))
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los pedidos activos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    pedidosApi
      .listarActivos({ timeout: 10000 })
      .then((data) => {
        if (!isMounted) return
        const raw = data?.pedidos || []
        setOrdersList(raw.map(normalizarPedido))
      })
      .catch((err) => {
        if (!isMounted) return
        setError(err.message || 'No se pudieron cargar los pedidos activos')
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Duplicados, como pide EVENTS.md ("deduplica por eventId"): un evento con
  // un eventId ya visto se ignora entero, sin repetir el aviso. Una ventana de
  // los últimos 200 por tipo de evento.
  const [createdVisto] = useState(() => crearVentanaEventos())
  const [statusVisto] = useState(() => crearVentanaEventos())

  // Escuchar eventos en vivo desde el socket-server / backend
  useSocketListener('order:status', (data) => {
    if (statusVisto(data?.eventId)) return
    // Un pedido cancelado ya no es una comanda activa: sale de la lista (y del
    // detalle, si estaba abierto), igual que en TablesContext. Antes se quedaba
    // con backendEstadoAUI('cancelado'), que cae en 'Pendiente', hasta recargar.
    if (data?.id_pedido && data.estado === 'cancelado') {
      setOrdersList((prev) => prev.filter((ord) => ord.rawId !== data.id_pedido))
      showToast(`Pedido ${data.codigo_pedido || data.id_pedido} cancelado`)
      return
    }
    if (data?.id_pedido) {
      setOrdersList((prev) =>
        prev.map((ord) =>
          ord.rawId === data.id_pedido
            ? { ...ord, state: backendEstadoAUI(data.estado), rawEstado: data.estado }
            : ord
        )
      )
      showToast(`Pedido ${data.id_pedido} cambió a: ${data.estado}`)
    }
  })

  // Comanda nueva: { eventId, pedido, emitidoEn } (EVENTS.md §5). Antes se
  // escuchaba 'order:new', que nadie emite, y la lista no se enteraba de nada.
  //
  // Duplicados por eventId: ver createdVisto arriba. Y si el mismo pedido llega
  // con otro eventId, su tarjeta se reemplaza en vez de duplicarse.
  useSocketListener('order:created', (data) => {
    const pedido = data?.pedido
    if (!pedido?.id_pedido) return
    if (createdVisto(data.eventId)) return
    const normalizado = normalizarPedido(pedido)
    setOrdersList((prev) =>
      prev.some((o) => o.rawId === normalizado.rawId)
        ? prev.map((o) => (o.rawId === normalizado.rawId ? normalizado : o))
        : [normalizado, ...prev]
    )
    showToast(`¡Nuevo pedido comensal en ${normalizado.table}!`)
  })

  // Una línea cancelada (EVENTS.md §5.6): por el comensal (#180) o por el
  // personal (D-13), desde este panel o desde otro. Se tacha y se pone el total
  // nuevo. Si era la última, el pedido sale (también llega order:status).
  const [canceladoVisto] = useState(() => crearVentanaEventos())
  useSocketListener('item:cancelado', (data) => {
    if (!data?.id_pedido || !data.id_detalle) return
    if (canceladoVisto(data.eventId)) return
    if (data.estado_pedido === 'cancelado') {
      setOrdersList((prev) => prev.filter((ord) => ord.rawId !== data.id_pedido))
    } else {
      setOrdersList((prev) =>
        prev.map((ord) => (ord.rawId === data.id_pedido ? marcarLineaCancelada(ord, data.id_detalle, data.total) : ord))
      )
    }
    const quien = data.origen === 'personal' ? 'el personal' : data.comensal || 'el comensal'
    showToast(`${data.nombre || 'Un plato'} cancelado por ${quien} (${data.codigo_pedido || data.id_pedido})`)
  })

  // D-13: el personal cancela UNA línea, con motivo obligatorio.
  const confirmarCancelarPlato = async () => {
    if (!selectedOrder || !cancelando || cancelando.enviando) return
    const v = validarMotivo(cancelando.motivo)
    if (v.error) {
      setCancelando((c) => ({ ...c, error: v.error }))
      return
    }
    const { idDetalle } = cancelando
    const idPedido = selectedOrder.rawId
    setCancelando((c) => ({ ...c, error: null, enviando: true }))
    try {
      const res = await pedidosApi.cancelarItem(idPedido, idDetalle, v.motivo)
      const pedido = res?.pedido
      if (pedido?.estado === 'cancelado') {
        setOrdersList((prev) => prev.filter((ord) => ord.rawId !== idPedido))
        showToast(`Pedido ${pedido.codigo_pedido || idPedido} cancelado: era su último plato`)
      } else {
        setOrdersList((prev) =>
          prev.map((ord) => {
            if (ord.rawId !== idPedido) return ord
            if (!Array.isArray(pedido?.items)) return marcarLineaCancelada(ord, idDetalle, pedido?.total)
            return {
              ...ord,
              total: pesos(pedido.total),
              state: backendEstadoAUI(pedido.estado),
              rawEstado: pedido.estado,
              items: pedido.items.map(normalizarLinea),
            }
          })
        )
        showToast('Plato cancelado')
      }
      setCancelando(null)
    } catch (err) {
      setCancelando((c) => (c ? { ...c, enviando: false, error: mensajeErrorCancelarPlato(err) } : c))
    }
  }

  // Avanzar estado de comanda contra la API real
  const handleAdvanceStatus = async (orderId, currentState) => {
    const nextBackendState = uiEstadoABackend(currentState)
    const targetOrder = ordersList.find((ord) => ord.id === orderId)
    if (!targetOrder) return

    try {
      await pedidosApi.actualizarEstado(targetOrder.rawId, nextBackendState)

      const nextUiState = backendEstadoAUI(nextBackendState)
      setOrdersList((prev) =>
        prev.map((ord) =>
          ord.id === orderId ? { ...ord, state: nextUiState, rawEstado: nextBackendState } : ord
        )
      )

      emit('order:status_update', {
        id_pedido: targetOrder.rawId,
        estado: nextBackendState,
        timestamp: new Date().toISOString(),
      })

      showToast(`Comanda ${orderId} actualizada a "${nextUiState}"`)
    } catch (err) {
      showToast(`Error al actualizar comanda: ${err.message}`)
    }
  }

  // Filtrado
  const filteredOrders = ordersList.filter((ord) => {
    const matchesStatus =
      selectedStatus === 'Todos' ||
      ord.state.toLowerCase() === selectedStatus.toLowerCase()

    const matchesSearch =
      ord.table.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.id.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesStatus && matchesSearch
  })

  // Conteo de métricas
  const totalActivas = ordersList.filter((o) => o.state !== 'Entregado').length
  const pendientesCount = ordersList.filter((o) => o.state === 'Pendiente').length
  const enCocinaCount = ordersList.filter((o) => o.state === 'En cocina').length
  const porServirCount = ordersList.filter((o) => o.state === 'Por servir').length

  const getUrgencyClass = (min) => {
    if (!min) return 'urgency-low'
    if (min > 15) return 'urgency-high'
    if (min > 10) return 'urgency-mid'
    return 'urgency-low'
  }

  return (
    <div className="sd-pedidos-page-wrap">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="table-toast-banner info" style={{ position: 'fixed', top: 90, right: 24, zIndex: 100 }}>
          <BellRing size={16} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Franja roja con filtros */}
      <div className="sd-red-band">
        <div className="sd-red-band-content">
          <div className="sd-red-band-filters">
            <button
              type="button"
              className={`sd-red-band-btn ${selectedStatus === 'Todos' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Todos')}
            >
              TODAS <span>{ordersList.length}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${selectedStatus === 'Pendiente' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Pendiente')}
            >
              PENDIENTES <span>{pendientesCount}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${selectedStatus === 'En cocina' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('En cocina')}
            >
              EN COCINA <span>{enCocinaCount}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${selectedStatus === 'Por servir' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Por servir')}
            >
              POR SERVIR <span>{porServirCount}</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${selectedStatus === 'Entregado' ? 'active' : ''}`}
              onClick={() => setSelectedStatus('Entregado')}
            >
              ENTREGADAS
            </button>
          </div>

          <div className="sd-band-search-box">
            <Search size={14} aria-hidden="true" />
            <input
              type="text"
              placeholder="Buscar comanda por mesa, cliente o ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sd-band-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--sd-white)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sd-page-container sd-pedidos-container">
        {/* Encabezado con título editorial y contadores */}
        <header className="sd-pedidos-header" style={{ marginBottom: 28 }}>
          <h1 className="sd-page-title">
            PEDIDOS<br />
            EN VIVO
          </h1>
          <div className="sd-tables-counters">
            <span>{totalActivas} ACTIVAS</span>
            <span className="sd-counter-sep">·</span>
            <span>{pendientesCount} PENDIENTES</span>
            <span className="sd-counter-sep">·</span>
            <span>{enCocinaCount} EN COCINA</span>
            <span className="sd-counter-sep">·</span>
            <span className="sd-counter-alert">{porServirCount} POR SERVIR</span>
          </div>
        </header>

        {/* Grid de Comandas KDS */}
        <section className="pedidos-grid-layout">
          {loading ? (
            <div className="sd-card sd-empty-box">
              <RefreshCw size={40} className="spin" style={{ color: 'var(--sd-red)' }} />
              <p>CARGANDO COMANDAS EN VIVO...</p>
              <small>Sincronizando pedidos activos desde el backend.</small>
            </div>
          ) : error ? (
            <div className="sd-card sd-empty-box">
              <AlertCircle size={40} style={{ color: 'var(--sd-gold)' }} />
              <p>ERROR AL CONECTAR CON COMANDAS</p>
              <small>{error}</small>
              <button
                type="button"
                className="sd-btn sd-btn-primary"
                onClick={recargarPedidos}
                style={{ marginTop: '1rem', minHeight: 38, fontSize: 14 }}
              >
                <RefreshCw size={14} />
                <span>REINTENTAR</span>
              </button>
            </div>
          ) : ordersList.length === 0 ? (
            <div className="sd-card sd-empty-box">
              <ChefHat size={46} style={{ color: 'var(--sd-text-muted)', opacity: 0.7 }} />
              <p>NO HAY PEDIDOS ACTIVOS</p>
              <small>No hay pedidos activos en este momento.</small>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="sd-card sd-empty-box">
              <ChefHat size={46} style={{ color: 'var(--sd-text-muted)', opacity: 0.7 }} />
              <p>NO HAY COMANDAS QUE COINCIDAN</p>
              <small>No se encontraron comandas con el filtro "{selectedStatus}".</small>
            </div>
          ) : (
            <div className="sd-pedidos-cards-grid">
              {filteredOrders.map((order) => {
                const urgency = getUrgencyClass(order.elapsedMin)
                const isDelivered = order.state.toLowerCase() === 'entregado'

                return (
                  <div
                    key={order.id}
                    className="sd-card sd-pedidos-kds-card"
                    onClick={() => setSelectedOrder(order)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Header de la Tarjeta */}
                    <div className="sd-pedidos-card-top">
                      <div>
                        <strong className="sd-pedidos-mesa-title">{order.table}</strong>
                        <span className="sd-pedidos-code-time">
                          {order.id} · {order.time}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className={`elapsed-timer-chip ${urgency}`} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Timer size={13} />
                          <span>{order.elapsedMin ? `${order.elapsedMin}m` : 'Nuevo'}</span>
                        </div>
                        <StatusBadge status={order.state} />
                      </div>
                    </div>

                    {/* Comensal & Mesero */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: 'var(--sd-text-muted)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <User size={12} /> {order.client}
                      </span>
                      {order.waiter && (
                        <span>Atiende: {order.waiter}</span>
                      )}
                    </div>

                    {/* Lista de Ítems */}
                    <div className="sd-pedidos-items-list">
                      {order.items.map((item, idx) => (
                        <div key={item.idDetalle ?? idx} className="sd-pedidos-item-row">
                          <div className="sd-pedidos-item-meta">
                            <span
                              className="sd-pedidos-item-name"
                              style={item.estado === 'cancelado' ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}
                            >
                              x{item.qty} {item.name}
                              {item.estado === 'cancelado' && <small style={{ marginLeft: 6 }}>(cancelado)</small>}
                            </span>
                            {item.notes && (
                              <small style={{ color: 'var(--sd-gold)', display: 'block', fontSize: 12 }}>
                                Nota: {item.notes}
                              </small>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Footer & Acciones KDS */}
                    <div className="sd-pedidos-card-footer">
                      <strong className="sd-pedidos-total">{order.total}</strong>

                      <div className="kds-action-btn-wrap">
                        {!isDelivered ? (
                          <button
                            type="button"
                            className="sd-btn sd-btn-primary"
                            style={{ minHeight: 36, fontSize: 13, padding: '4px 14px' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAdvanceStatus(order.id, order.state)
                            }}
                          >
                            {order.state === 'Pendiente' && (
                              <>
                                <Flame size={14} />
                                <span>A Cocina</span>
                              </>
                            )}
                            {order.state === 'En cocina' && (
                              <>
                                <BellRing size={14} />
                                <span>Marcar Listo</span>
                              </>
                            )}
                            {order.state === 'Por servir' && (
                              <>
                                <CheckCircle2 size={14} />
                                <span>Entregar</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sd-white)', fontSize: 13, fontWeight: 700 }}>
                            <CheckCircle2 size={14} /> Servido
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Modal de Detalle de Comanda */}
      {selectedOrder && (
        <div className="sd-modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="sd-card sd-table-detail-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="sd-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <FileText size={24} style={{ color: 'var(--sd-red)' }} />
                <div>
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 24 }}>
                    Comanda {selectedOrder.id}
                  </h3>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--sd-text-muted)' }}>
                    {selectedOrder.table} · {selectedOrder.client} · {selectedOrder.time}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="sd-topbar-icon-btn"
                onClick={() => setSelectedOrder(null)}
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h4 style={{ fontFamily: 'var(--sd-font-heading)', margin: 0, fontSize: 18, color: 'var(--sd-text)' }}>
                ÍTEMS SOLICITADOS:
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                {selectedOrder.items.map((it, i) => {
                  const cancelada = it.estado === 'cancelado'
                  const mostrarBoton = puedeCancelar && it.idDetalle
                    && lineaCancelable(selectedOrder.rawEstado, it.estado)
                  const abierto = cancelando && cancelando.idDetalle === it.idDetalle
                  return (
                    <div key={it.idDetalle ?? i} style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={cancelada ? { textDecoration: 'line-through', opacity: 0.55 } : undefined}>
                          <strong style={{ color: 'var(--sd-text)' }}>{it.qty}x {it.name}</strong>
                          <div style={{ fontSize: 12, color: 'var(--sd-text-muted)' }}>{it.comensal}{cancelada ? ' · CANCELADO' : ''}</div>
                          {it.notes && (
                            <div style={{ fontSize: 12, color: 'var(--sd-gold)' }}>Nota: {it.notes}</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {it.subtotal && <span style={{ color: 'var(--sd-text-muted)' }}>{it.subtotal}</span>}
                          {mostrarBoton && !abierto && (
                            <button
                              type="button"
                              className="sd-btn sd-btn-secondary"
                              style={{ minHeight: 32, fontSize: 12, padding: '2px 10px' }}
                              onClick={() => setCancelando({ idDetalle: it.idDetalle, motivo: '', error: null, enviando: false })}
                              aria-label={`Cancelar plato ${it.name}`}
                            >
                              <Ban size={13} />
                              <span>Cancelar plato</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {abierto && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <label htmlFor={`motivo-${it.idDetalle}`} className="sd-input-label">
                            MOTIVO (OBLIGATORIO, QUEDA EN EL HISTORIAL):
                          </label>
                          <textarea
                            id={`motivo-${it.idDetalle}`}
                            className="sd-input"
                            rows={2}
                            maxLength={MOTIVO_MAX}
                            placeholder="Ej. El cliente ya no lo quiere"
                            value={cancelando.motivo}
                            onChange={(e) => {
                              const motivo = e.target.value
                              setCancelando((c) => ({ ...c, motivo, error: null }))
                            }}
                            disabled={cancelando.enviando}
                          />
                          <small style={{ color: 'var(--sd-text-muted)' }}>
                            {it.estado === 'pendiente' && selectedOrder.rawEstado === 'recibido'
                              ? 'Cocina no lo ha empezado: lo reservado vuelve al inventario.'
                              : 'Cocina ya lo empezó: queda como merma.'}
                          </small>
                          {cancelando.error && (
                            <div className="table-toast-banner error" role="alert">
                              <span>{cancelando.error}</span>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="sd-btn sd-btn-secondary"
                              style={{ minHeight: 34, fontSize: 13 }}
                              onClick={() => setCancelando(null)}
                              disabled={cancelando.enviando}
                            >
                              Volver
                            </button>
                            <button
                              type="button"
                              className="sd-btn sd-btn-primary"
                              style={{ minHeight: 34, fontSize: 13 }}
                              onClick={confirmarCancelarPlato}
                              disabled={cancelando.enviando}
                            >
                              {cancelando.enviando ? 'Cancelando…' : 'Confirmar cancelación'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--sd-border)' }}>
                <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 18, color: 'var(--sd-text-muted)' }}>IMPORTE COMANDA:</span>
                <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 24, color: 'var(--sd-text)' }}>{selectedOrder.total}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 12, borderTop: '1px solid var(--sd-border)' }}>
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                style={{ minHeight: 40, fontSize: 14 }}
                onClick={() => window.print()}
              >
                Imprimir Comanda
              </button>
              {selectedOrder.state !== 'Entregado' && (
                <button
                  type="button"
                  className="sd-btn sd-btn-primary"
                  style={{ minHeight: 40, fontSize: 14 }}
                  onClick={() => {
                    handleAdvanceStatus(selectedOrder.id, selectedOrder.state)
                    setSelectedOrder(null)
                  }}
                >
                  Avanzar Estado ({selectedOrder.state})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
