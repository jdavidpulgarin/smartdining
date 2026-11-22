import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X,
  CheckCircle2,
  Receipt,
  Utensils,
  QrCode,
  LogOut,
  ArrowRight,
  UserCheck,
  AlertTriangle,
} from 'lucide-react'

import { StateBadge, StatusBadge } from './ui/Badge'
import { decodificarTokenQr } from '../services/qrService'
import { useNavigate } from 'react-router-dom'
import { useAuth, useSocket } from '../hooks'
import { mesasApi } from '../services/api'
import { puedeUsarCaja, mesaConSesionActiva, EVENTOS_QUE_CAMBIAN_LA_CUENTA } from '../utils/caja'
import { crearUltimaPeticion } from '../utils/ultimaPeticion'
import {
  resumenDetalleMesa,
  avisoDeEstaMesa,
  AVISO_PAGADA_SIN_ENTREGAR,
} from '../utils/detalleMesa'

export function TableDetailModal({
  table,
  pedidos = [],
  onClose,
  onOpenQR,
  onFreeTable,
  onDeliverOrder,
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const userRole = (user?.rol || user?.role || '').toLowerCase()
  const canTakeOrder = userRole === 'mesero' || userRole === 'admin'

  const idMesa = Number(table?.id_mesa ?? table?.id)
  const tableName = table?.name || `Mesa ${idMesa}`
  const tableStatus = (table?.status || table?.estado || 'Disponible').toLowerCase()
  const isOcupada = tableStatus === 'ocupada'

  // Decodificar token de sesión para extraer sid
  const sesionInfo = table?.token_qr ? decodificarTokenQr(table.token_qr) : null
  const sid = sesionInfo?.sid && sesionInfo.sid !== 'N/A' ? sesionInfo.sid.slice(0, 8) : null

  // Consumo, pagado, saldo, reparto y comandas: GET /mesas/:id/cuenta, como la
  // Caja (utils/detalleMesa.js). Solo se pide con una visita en curso: para una
  // mesa libre la cuenta sería la del grupo anterior.
  const conSesion = mesaConSesionActiva(table)
  const [cuenta, setCuenta] = useState(null)
  const [errorCuenta, setErrorCuenta] = useState(null)
  const [ultimaCarga] = useState(() => crearUltimaPeticion())

  const cargarCuenta = useCallback(async () => {
    const peticion = ultimaCarga.nueva()
    if (!conSesion || !Number.isInteger(idMesa) || idMesa <= 0) {
      setCuenta(null)
      setErrorCuenta(null)
      return
    }
    try {
      const datos = await mesasApi.obtenerCuenta(idMesa)
      if (!peticion.vigente()) return
      setCuenta(datos || null)
      setErrorCuenta(null)
    } catch {
      if (!peticion.vigente()) return
      setErrorCuenta('No se pudo cargar la cuenta de la mesa.')
    }
  }, [conSesion, idMesa, ultimaCarga])

  // Al abrir (en la microtarea siguiente, como la Caja) y al cambiar de mesa o
  // de estado. Al cerrar, lo que esté en vuelo se descarta.
  useEffect(() => {
    let montado = true
    Promise.resolve().then(() => {
      if (montado) cargarCuenta()
    })
    return () => {
      montado = false
      ultimaCarga.invalidar()
    }
  }, [cargarCuenta, ultimaCarga])

  // En vivo: los mismos eventos con los que la Caja recarga sus cuentas.
  const socket = useSocket()
  useEffect(() => {
    if (!socket) return undefined
    const alAviso = (data) => {
      if (avisoDeEstaMesa(data, idMesa)) cargarCuenta()
    }
    EVENTOS_QUE_CAMBIAN_LA_CUENTA.forEach((ev) => socket.on(ev, alAviso))
    return () => {
      EVENTOS_QUE_CAMBIAN_LA_CUENTA.forEach((ev) => socket.off(ev, alAviso))
    }
  }, [socket, idMesa, cargarCuenta])

  const resumen = useMemo(
    () => resumenDetalleMesa({ mesa: table, cuenta, pedidosPanel: pedidos }),
    [table, cuenta, pedidos]
  )
  const pedidosMesa = resumen.comandas
  // Con visita en curso pero sin cuenta todavía (cargando o error): sin cifras.
  const sinCifras = resumen.conSesion && !cuenta

  const formatearDinero = (monto) => {
    return `$${Number(monto || 0).toLocaleString('es-CO')}`
  }
  const cifra = (monto) => (sinCifras ? '—' : formatearDinero(monto))

  return (
    <div className="tema-comanda dm-fondo" onClick={onClose}>
      <div
        className="dm-tarjeta"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-franja" aria-hidden="true" />
        {/* Encabezado */}
        <div className="dm-cabecera">
          <div className="dm-cabecera-izq">
            <span aria-hidden="true" className="dm-rotulo">Detalle de mesa</span>
            <div className="dm-titulo-fila">
              <div className="dm-numero">#{table?.numero ?? table?.number ?? idMesa}</div>
              <h2 className="dm-titulo">{tableName}</h2>
            </div>
            <div className="dm-subtitulo">
              <StatusBadge status={table?.status || table?.estado || 'Disponible'} />
              <span className="dm-meta">
                Zona {table?.location || table?.ubicacion || 'Principal'} · Capacidad {table?.seats || table?.capacidad || 4}
              </span>
              {sid && (
                <span className="dm-sid">
                  · sid: {sid}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="dm-cerrar"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tarjetas de Métricas de Mesa */}
        <div className="dm-metricas">
          <div className="dm-metrica">
            <span className="dm-metrica-rotulo">Consumo Mesa</span>
            <strong className="dm-metrica-valor">
              {cifra(resumen.total)}
            </strong>
            <span className="dm-metrica-sub">
              {resumen.total > 0 ? `${resumen.items} ítems ordenados` : 'Sin consumo'}
            </span>
          </div>

          <div className="dm-metrica">
            <span className="dm-metrica-rotulo">Comensales</span>
            <strong className="dm-metrica-valor">
              {resumen.comensales.length > 0 ? resumen.comensales.length : (resumen.conSesion ? '1+' : '0')}
            </strong>
            <span className="dm-metrica-sub">
              {resumen.conSesion ? 'Grupo activo' : 'Mesa libre'}
            </span>
          </div>

          <div className="dm-metrica dm-metrica-saldo">
            <span className="dm-metrica-rotulo">Saldo Pendiente</span>
            <strong className="dm-metrica-valor">
              {cifra(resumen.saldo)}
            </strong>
            <span className="dm-metrica-sub">
              {resumen.pagado > 0 ? `Pagado ${formatearDinero(resumen.pagado)}` : 'Por liquidar en caja'}
            </span>
          </div>
        </div>

        {errorCuenta && (
          <div role="alert" className="dm-aviso dm-aviso-error">
            {errorCuenta}
          </div>
        )}

        {resumen.pagadaSinEntregar && (
          <div
            role="status"
            className="dm-aviso dm-aviso-pagada"
          >
            <AlertTriangle size={16} className="dm-aviso-icono" />
            <span>{AVISO_PAGADA_SIN_ENTREGAR}</span>
          </div>
        )}

        {/* Desglose de Comensales (si hay consumos) */}
        {resumen.comensales.length > 0 && (
          <div className="dm-seccion">
            <div className="dm-seccion-cabeza">
              <UserCheck size={16} className="dm-seccion-icono" />
              <h3 className="dm-seccion-titulo">
                Cuenta Dividida por Comensal
              </h3>
            </div>
            <div className="dm-lista dm-lista-comensales">
              {resumen.comensales.map((c) => (
                <div
                  key={c.nombre}
                  className="dm-tiquete dm-comensal"
                >
                  <div>
                    <strong className="dm-comensal-nombre">{c.nombre}</strong>
                    <span className="dm-comensal-items">
                      ({c.items} {c.items === 1 ? 'ítem' : 'ítems'})
                    </span>
                  </div>
                  <span className="dm-comensal-cifras">
                    <strong className="dm-comensal-subtotal">
                      {formatearDinero(c.subtotal)}
                    </strong>
                    <span className="dm-comensal-saldo">
                      {c.saldo > 0 ? `Saldo ${formatearDinero(c.saldo)}` : 'Pagado'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pedidos Activos de la Mesa */}
        <div className="dm-seccion dm-seccion-comandas">
          <div className="dm-seccion-cabeza">
            <div className="dm-seccion-cabeza-izq">
              <Utensils size={16} className="dm-seccion-icono" />
              <h3 className="dm-seccion-titulo">
                Comandas en Curso ({pedidosMesa.length})
              </h3>
            </div>
          </div>

          {pedidosMesa.length > 0 ? (
            <div className="dm-lista dm-lista-comandas">
              {pedidosMesa.map((ped) => {
                const isListo = ped.estado?.toLowerCase() === 'listo'
                return (
                  <div
                    key={ped.id_pedido || ped.codigo_pedido}
                    className={isListo ? 'dm-tiquete dm-comanda dm-comanda-lista' : 'dm-tiquete dm-comanda'}
                  >
                    <div className="dm-comanda-fila">
                      <div className="dm-comanda-id">
                        <strong className="dm-comanda-codigo">
                          {ped.codigo_pedido || `#${ped.id_pedido}`}
                        </strong>
                        <StateBadge state={ped.estado} />
                      </div>
                      <strong className="dm-comanda-total">
                        {formatearDinero(ped.total)}
                      </strong>
                    </div>

                    {/* Platos del pedido */}
                    <div className="dm-comanda-platos">
                      {(ped.detalles || ped.items || []).map((it, idx) => (
                        <div key={idx} className="dm-plato">
                          <span>
                            {it.cantidad}x {it.plato_nombre || it.nombre || 'Plato'}{' '}
                            {it.comensal ? `(${it.comensal})` : ''}
                          </span>
                          <span>{formatearDinero(it.subtotal || it.precio_unitario * it.cantidad)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Botón Marcar Entregado si está listo */}
                    {isListo && onDeliverOrder && (
                      <div className="dm-comanda-acciones">
                        <button
                          type="button"
                          className="primary-button small dm-entregar"
                          onClick={() => onDeliverOrder(ped.id_pedido)}
                        >
                          <CheckCircle2 size={13} />
                          <span>Marcar Entregado</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="dm-vacio">
              {resumen.conSesion && sinCifras
                ? (errorCuenta ? 'Sin datos de la cuenta.' : 'Cargando cuenta…')
                : resumen.conSesion
                ? 'Sin consumo. Sesión abierta esperando comandas de los comensales.'
                : 'Sin consumo. Mesa libre.'}
            </div>
          )}
        </div>

        {/* Barra de Acciones de Mesa */}
        <div className="dm-acciones">
          {onOpenQR && (
            <button
              type="button"
              className="dm-btn dm-btn-qr"
              onClick={() => {
                onClose()
                onOpenQR(table)
              }}
            >
              <QrCode size={18} />
              <span>{isOcupada ? 'Ver / Rotar QR' : 'Abrir Mesa'}</span>
            </button>
          )}

          {isOcupada && canTakeOrder && (
            <button
              type="button"
              className="dm-btn dm-btn-tomar"
              onClick={() => {
                onClose()
                navigate(`/mesas/${idMesa}/tomar-pedido`)
              }}
            >
              <Utensils size={18} />
              <span>Tomar Pedido</span>
              <ArrowRight size={16} />
            </button>
          )}

          {isOcupada && puedeUsarCaja(userRole) && (
            <button
              type="button"
              className="dm-btn dm-btn-caja"
              onClick={() => {
                onClose()
                navigate(`/caja?mesa=${idMesa}`)
              }}
            >
              <Receipt size={18} />
              <span>Cobrar en Caja</span>
              <ArrowRight size={16} />
            </button>
          )}

          {isOcupada && onFreeTable && (
            <button
              type="button"
              className="dm-btn dm-btn-liberar"
              onClick={() => {
                if (window.confirm(`¿Liberar ${tableName}? Se revocará el QR de la sesión.`)) {
                  onFreeTable(idMesa)
                  onClose()
                }
              }}
            >
              <LogOut size={16} />
              <span>Liberar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
