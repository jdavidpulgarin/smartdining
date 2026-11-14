import { useState, useEffect, useMemo } from 'react'
import {
  Printer,
  AlertTriangle,
  RefreshCw,
  FileCode,
} from 'lucide-react'
import { reportesApi, transaccionesApi } from '../services/api'
import { resumirMetodos, cuadreConCaja, barrasVentasPorDia } from '../utils/reportes'

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

function formatoCOP(n) {
  if (n === null || n === undefined || n === '') return '$0'
  let num = n
  if (typeof n === 'string') {
    const cleaned = n.replace(/[^0-9.-]/g, '')
    num = parseFloat(cleaned) || 0
  }
  return copFormatter.format(num || 0).replace(/\u00A0/g, '').trim()
}

function calcularTicketComensal(data) {
  if (!data) return 0
  const valor = Number(data.ticketPromedio)
  return Number.isFinite(valor) ? valor : 0
}

const obtenerRangoFechasTexto = (rango) => {
  const hoy = new Date()
  const opciones = { day: 'numeric', month: 'long' }
  const hoyStr = hoy.toLocaleDateString('es-CO', opciones)

  if (rango === 'hoy') {
    return hoyStr
  }
  if (rango === 'semana') {
    const hace7 = new Date()
    hace7.setDate(hoy.getDate() - 6)
    const hace7Str = hace7.toLocaleDateString('es-CO', { day: 'numeric' })
    return `${hace7Str} al ${hoyStr}`
  }
  if (rango === 'mes') {
    // GET /reportes?rango=mes cubre los 30 últimos días (hoy incluido), no el mes calendario.
    const hace30 = new Date()
    hace30.setDate(hoy.getDate() - 29)
    return `${hace30.toLocaleDateString('es-CO', opciones)} al ${hoyStr}`
  }
  return hoyStr
}

/** Cuántos elementos pinta cada lista del panel (el backend manda hasta 5 platos y 6 ingredientes). */
const TOPE_PLATOS_PANEL = 3
const TOPE_INGREDIENTES_PANEL = 6

/** Mensaje de lista vacía: sin datos se dice, no se rellena. */
function SinDatos({ children }) {
  return (
    <p className="sd-reportes-vacio" style={{ color: 'var(--sd-text-muted)', margin: '8px 0' }}>
      {children}
    </p>
  )
}

export function Reportes() {
  const [timeRange, setTimeRange] = useState('hoy') // 'hoy' | 'semana' | 'mes'
  const [loading, setLoading] = useState(true)
  const [reportData, setReportData] = useState(null)
  // true solo con datos de demostración (VITE_USE_MOCKS en desarrollo, P-13)
  const [contractPending, setContractPending] = useState(false)
  const [errorCarga, setErrorCarga] = useState(null)
  // T6: «Recaudado hoy» de la Caja (GET /transacciones?desde=hoy), para
  // mostrar si la suma por métodos cuadra. null = no se sabe.
  const [recaudadoHoy, setRecaudadoHoy] = useState(null)

  const handleSelectRange = (range) => {
    if (range === timeRange) return
    setTimeRange(range)
    setLoading(true)
  }

  useEffect(() => {
    let isMounted = true

    reportesApi
      .obtenerReporte(timeRange)
      .then((data) => {
        if (!isMounted) return
        setReportData(data)
        setContractPending(Boolean(data?.isFallback))
        setErrorCarga(null)
      })
      .catch((err) => {
        if (!isMounted) return
        // Sin cifras inventadas: se muestra el error real (P-13).
        setReportData(null)
        setContractPending(false)
        setErrorCarga(err?.sinConexion ? 'Sin conexión con el servidor' : err?.message || null)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    // Solo en «hoy»: «Recaudado hoy» es el cierre del día, no de 7 o 30 días.
    if (timeRange === 'hoy') {
      transaccionesApi
        .delDia('hoy')
        .then((d) => {
          if (isMounted) setRecaudadoHoy(Number(d?.total))
        })
        .catch(() => {
          if (isMounted) setRecaudadoHoy(null)
        })
    }

    return () => {
      isMounted = false
    }
  }, [timeRange])

  const metodos = useMemo(() => resumirMetodos(reportData?.metodosPago), [reportData])
  const ventasDia = useMemo(() => barrasVentasPorDia(reportData?.ventasPorDia), [reportData])
  const cuadre = cuadreConCaja(metodos.total, recaudadoHoy)

  const currentData = reportData

  // Platos más pedidos: tal cual los manda GET /reportes (topPlatos), sin nombres fijos.
  const topPlatos = useMemo(() => {
    return (currentData?.topPlatos || []).slice(0, TOPE_PLATOS_PANEL).map((p) => ({
      id: p.id_plato,
      nombre: p.nombre,
      unidades: Number(p.unidades) || 0,
      total: Number(p.total) || 0,
    }))
  }, [currentData])

  // Ingredientes más pedidos (topIngredientes). Puede haber nombres repetidos en
  // platos distintos, así que se muestra también el plato.
  const topIngredientes = useMemo(() => {
    return (currentData?.topIngredientes || []).slice(0, TOPE_INGREDIENTES_PANEL).map((i) => ({
      id: i.id_ingrediente,
      nombre: i.nombre_ingrediente,
      plato: i.nombre_plato,
      veces: Number(i.veces_solicitado) || 0,
    }))
  }, [currentData])

  const maxIngVeces = useMemo(() => {
    return Math.max(...topIngredientes.map((i) => i.veces), 1)
  }, [topIngredientes])

  return (
    <div className="sd-page-wrapper sd-reportes-page">
      {/* 1. Franja Roja (#C8102E) bajo el menú */}
      <div className="sd-red-band">
        <div className="sd-red-band-content">
          <div className="sd-red-band-filters">
            <span style={{ fontFamily: 'var(--sd-font-heading)', fontWeight: 800, fontSize: 16, letterSpacing: '0.06em', color: '#FFFFFF', marginRight: 8 }}>
              PERIODO
            </span>
            <button
              type="button"
              className={`sd-red-band-btn ${timeRange === 'hoy' ? 'active' : ''}`}
              onClick={() => handleSelectRange('hoy')}
            >
              <span>HOY</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${timeRange === 'semana' ? 'active' : ''}`}
              onClick={() => handleSelectRange('semana')}
              aria-label="Últimos 7 días"
            >
              <span>ÚLTIMOS 7 DÍAS</span>
            </button>
            <button
              type="button"
              className={`sd-red-band-btn ${timeRange === 'mes' ? 'active' : ''}`}
              onClick={() => handleSelectRange('mes')}
              aria-label="Últimos 30 días"
            >
              <span>ÚLTIMOS 30 DÍAS</span>
            </button>
          </div>

          <button
            type="button"
            className="sd-red-band-btn"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            <span>IMPRIMIR INFORME</span>
          </button>
        </div>
      </div>

      <div className="sd-reportes-container">
        {/* 2. Encabezado Editorial */}
        <div className="sd-reportes-header-editorial">
          <div className="sd-reportes-header-left">
            <h1 className="sd-reportes-title-hero">
              {timeRange === 'hoy' && (
                <>
                  ASÍ VA<br />EL DÍA
                </>
              )}
              {timeRange === 'semana' && (
                <>
                  ASÍ VA<br />LA SEMANA
                </>
              )}
              {timeRange === 'mes' && (
                <>
                  ASÍ VAN<br />LOS 30 DÍAS
                </>
              )}
            </h1>

            {contractPending && (
              <div className="sd-reportes-sim-notice">
                <AlertTriangle size={14} style={{ color: 'var(--sd-gold)', flexShrink: 0 }} />
                <span>
                  Datos de demostración: <code>VITE_USE_MOCKS</code> activo en desarrollo. No son ventas reales.
                </span>
              </div>
            )}
          </div>

          <div className="sd-reportes-header-right">
            <span className="sd-reportes-date-range">
              {obtenerRangoFechasTexto(timeRange)}
              {contractPending && ' · datos de demostración'}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="sd-reportes-panel" style={{ padding: 48, textAlign: 'center' }}>
            <RefreshCw size={40} className="spin" style={{ margin: '0 auto 16px', color: 'var(--sd-white)' }} />
            <h3 style={{ color: 'var(--sd-text)', fontFamily: 'var(--sd-font-heading)', fontSize: 22, margin: '0 0 8px 0' }}>
              Cargando métricas de reporte...
            </h3>
            <p style={{ color: 'var(--sd-text-muted)', margin: 0 }}>Consultando analíticas desde el servidor.</p>
          </div>
        ) : !currentData ? (
          <div className="sd-reportes-panel" style={{ padding: 40, textAlign: 'center' }}>
            <FileCode size={48} style={{ margin: '0 auto 16px', color: 'var(--sd-text-muted)' }} />
            <h3 style={{ color: 'var(--sd-text)', fontFamily: 'var(--sd-font-heading)', fontSize: 22, margin: '0 0 8px 0' }}>
              No se pudieron cargar los datos de reporte
            </h3>
            <p style={{ color: 'var(--sd-text-muted)', margin: 0 }} role="alert">
              {errorCarga ? `${errorCarga}. ` : ''}Intenta recargar o verificar la conexión con el servidor.
            </p>
          </div>
        ) : (
          <>
            {/* 3. 4 Indicadores en grilla */}
            <div className="sd-reportes-indicators-grid">
              {/* Tarjeta Roja: VENTAS */}
              <div className="sd-indicator-card is-sales">
                <span className="sd-indicator-label is-white">VENTAS</span>
                <strong className="sd-indicator-value is-white">
                  {formatoCOP(currentData.totalVentas)}
                </strong>
                <span className="sd-indicator-sub is-white">
                  Pagos completados en el periodo
                </span>
              </div>

              {/* Tarjeta: PEDIDOS */}
              <div className="sd-indicator-card">
                <span className="sd-indicator-label">PEDIDOS</span>
                <strong className="sd-indicator-value">
                  {currentData.totalPedidos}
                </strong>
                <span className="sd-indicator-sub">
                  {currentData.pedidosLiquidados ?? 0} liquidados
                </span>
              </div>

              {/* Tarjeta: TICKET PROMEDIO (ticketPromedio = ventas / pedidos liquidados) */}
              <div className="sd-indicator-card">
                <span className="sd-indicator-label">TICKET PROMEDIO</span>
                <strong className="sd-indicator-value">
                  {formatoCOP(calcularTicketComensal(currentData))}
                </strong>
                <span className="sd-indicator-sub">
                  Por pedido liquidado
                </span>
              </div>

              {/* Tarjeta: TIEMPO DE PREPARACIÓN */}
              <div className="sd-indicator-card">
                <span className="sd-indicator-label">TIEMPO DE PREPARACIÓN</span>
                <strong className="sd-indicator-value">
                  {currentData?.tiempoCocinaPromedio != null
                    ? `${Number(currentData.tiempoCocinaPromedio).toFixed(1)} min`
                    : '—'}
                </strong>
                <span className="sd-indicator-sub">
                  Meta: &lt; 15 min por comanda
                </span>
              </div>
            </div>

            {/* 4. Fila de Dos Paneles: Ventas por Día & Ingredientes más pedidos */}
            <div className="sd-reportes-row-panels">
              {/* Panel 1: VENTAS POR DÍA (Ancho grande) */}
              <div className="sd-reportes-panel">
                <h3 className="sd-reportes-panel-title">VENTAS POR DÍA</h3>
                {/* ventasPorDia de GET /reportes (T6): un día por cada día del rango,
                    en hora de Bogotá, con los días sin ventas en 0. Sin el campo
                    (backend viejo) no se dibujan barras inventadas. */}
                {ventasDia === null ? (
                  <SinDatos>El reporte todavía no incluye las ventas por día.</SinDatos>
                ) : ventasDia.every((d) => d.total === 0) ? (
                  <SinDatos>Sin ventas en este periodo.</SinDatos>
                ) : (
                  <div
                    role="img"
                    aria-label="Ventas por día"
                    data-testid="ventas-por-dia"
                    style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '8px 0' }}
                  >
                    {ventasDia.map((d) => (
                      <div
                        key={d.fecha}
                        data-testid={`dia-${d.fecha}`}
                        title={`${d.titulo}: ${formatoCOP(d.total)} · ${d.pedidos} pedidos`}
                        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }}
                      >
                        <span style={{ fontSize: 10, color: 'var(--sd-text-muted)', whiteSpace: 'nowrap' }}>
                          {d.total > 0 ? formatoCOP(d.total) : ''}
                        </span>
                        <div style={{ width: '100%', maxWidth: 48, height: `${d.altura}%`, background: 'var(--sd-red)', borderRadius: '4px 4px 0 0' }} />
                        <span style={{ fontSize: 11, color: 'var(--sd-text-muted)', whiteSpace: 'nowrap' }}>{d.etiqueta}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Panel 2: INGREDIENTES MÁS PEDIDOS */}
              <div className="sd-reportes-panel">
                <h3 className="sd-reportes-panel-title">INGREDIENTES MÁS PEDIDOS</h3>
                <div className="sd-ingredients-list">
                  {topIngredientes.length === 0 && (
                    <SinDatos>Sin ingredientes pedidos en este periodo.</SinDatos>
                  )}
                  {topIngredientes.map((ing) => {
                    const percent = Math.round((ing.veces / maxIngVeces) * 100)
                    return (
                      <div key={ing.id} className="sd-ingredient-row">
                        <div className="sd-ingredient-meta">
                          <span className="sd-ingredient-name">
                            {ing.nombre}
                            {ing.plato && (
                              <span style={{ color: 'var(--sd-text-muted)', fontWeight: 400 }}> · {ing.plato}</span>
                            )}
                          </span>
                          <span className="sd-ingredient-count">{ing.veces} veces</span>
                        </div>
                        <div className="sd-ingredient-rail">
                          <div
                            className="sd-ingredient-bar"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* 5. PLATOS MÁS PEDIDOS */}
            <div className="sd-reportes-panel" style={{ marginBottom: 24 }}>
              <h3 className="sd-reportes-panel-title">PLATOS MÁS PEDIDOS</h3>
              {topPlatos.length === 0 ? (
                <SinDatos>Sin platos vendidos en este periodo.</SinDatos>
              ) : (
                <div className="sd-top3-dishes-grid">
                  {topPlatos.map((plato, idx) => {
                    const borderClass = idx === 0 ? 'border-red' : idx === 1 ? 'border-white' : 'border-gold'
                    return (
                      <div key={plato.id} className={`sd-top3-card ${borderClass}`}>
                        <h4 className="sd-top3-dish-name">
                          {idx + 1}. {String(plato.nombre || '').toUpperCase()}
                        </h4>
                        <span className="sd-top3-dish-meta">
                          {plato.unidades} vendidos · {formatoCOP(plato.total)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 6. Debajo (Secundario): Métodos de Pago y Horas Pico */}
            <div className="sd-reportes-secondary-grid">
              {/* Métodos de Pago (T6): montos por método, cada uno con su color, el
                  total y, en «hoy», si cuadra con «Recaudado hoy» de la Caja. */}
              <div className="sd-reportes-panel" data-testid="panel-metodos">
                <h3 className="sd-reportes-panel-title">DISTRIBUCIÓN POR MÉTODO DE PAGO</h3>
                {metodos.filas.length === 0 && (
                  <SinDatos>Sin pagos completados en este periodo.</SinDatos>
                )}
                <div className="sd-payment-methods-block">
                  <div className="sd-payment-bar-track" role="img" aria-label="Montos cobrados por método de pago">
                    {metodos.filas.map((mp) => (
                      <div
                        key={mp.metodo}
                        style={{ width: `${mp.porcentaje}%`, backgroundColor: mp.color }}
                        title={`${mp.metodo}: ${formatoCOP(mp.monto)} (${mp.porcentaje}%)`}
                      />
                    ))}
                  </div>

                  <div className="sd-payment-legend-list">
                    {metodos.filas.map((mp) => (
                      <div key={mp.metodo} className="sd-payment-legend-item" data-testid={`metodo-${mp.metodo}`}>
                        <div className="sd-payment-legend-left">
                          <span className="sd-payment-dot" style={{ backgroundColor: mp.color }} />
                          <span className="sd-payment-method-name">{mp.metodo}</span>
                        </div>
                        <div className="sd-payment-legend-right">
                          <strong className="sd-payment-amount">
                            {formatoCOP(mp.monto)}
                          </strong>
                          <span className="sd-payment-percent">({mp.porcentaje}%)</span>
                        </div>
                      </div>
                    ))}
                    {metodos.filas.length > 0 && (
                      <div className="sd-payment-legend-item" data-testid="metodos-total" style={{ borderTop: '1px solid var(--sd-border)', paddingTop: 8 }}>
                        <div className="sd-payment-legend-left">
                          <span className="sd-payment-method-name" style={{ fontWeight: 800 }}>TOTAL COBRADO</span>
                        </div>
                        <div className="sd-payment-legend-right">
                          <strong className="sd-payment-amount">{formatoCOP(metodos.total)}</strong>
                        </div>
                      </div>
                    )}
                  </div>
                  {timeRange === 'hoy' && cuadre.estado !== 'sin_dato' && (
                    <p
                      data-testid="cuadre-caja"
                      role={cuadre.estado === 'cuadra' ? 'status' : 'alert'}
                      style={{ margin: '10px 0 0', fontSize: 13, color: cuadre.estado === 'cuadra' ? 'var(--sd-text-muted)' : 'var(--sd-red-text)' }}
                    >
                      {cuadre.estado === 'cuadra'
                        ? `Cuadra con «Recaudado hoy» de la Caja (${formatoCOP(recaudadoHoy)}).`
                        : `No cuadra con «Recaudado hoy» de la Caja (${formatoCOP(recaudadoHoy)}): diferencia de ${formatoCOP(Math.abs(cuadre.diferencia))}. Puede ser un cobro de hace menos de un minuto (el reporte se guarda 60 s).`}
                    </p>
                  )}
                </div>
              </div>

              {/* Horas Pico */}
              <div className="sd-reportes-panel">
                <h3 className="sd-reportes-panel-title">AFLUENCIA POR HORARIO (HORAS PICO)</h3>
                {(currentData.horasPico || []).length === 0 && (
                  <SinDatos>Sin pedidos en este periodo.</SinDatos>
                )}
                <div
                  role="img"
                  aria-label="Gráfica de afluencia por horario"
                  className="sd-hours-chart"
                >
                  {(currentData.horasPico || []).map((hp, i) => (
                    <div key={i} className="sd-hours-col">
                      <div
                        className="sd-hours-fill"
                        style={{
                          height: `${hp.volumen}%`,
                          backgroundColor: hp.volumen > 80 ? 'var(--sd-red)' : hp.volumen > 60 ? 'var(--sd-gold)' : '#4A413D',
                        }}
                        title={`${hp.hora}: ${hp.volumen}%`}
                      />
                      <span className="sd-hours-label">
                        {hp.hora.split(' - ')[0]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Eficiencia Cocina KDS (Secundario) */}
            <div className="sd-reportes-panel" style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--sd-border)', paddingBottom: 12, marginBottom: 14 }}>
                <h3 className="sd-reportes-panel-title" style={{ margin: 0 }}>
                  MÉTRICAS DE EFICIENCIA COCINA KDS
                </h3>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)' }}>
                  VISTA SQL: v_tiempos_kds
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--sd-border)', color: 'var(--sd-text-muted)', fontFamily: 'var(--sd-font-heading)', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '10px 14px' }}>PERIODO / FECHA</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>PLATOS PREPARADOS</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>TIEMPO ESTIMADO</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>TIEMPO REAL</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>VARIACIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currentData.tiemposKds || []).length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: '12px 14px', color: 'var(--sd-text-muted)' }}>
                          Sin comandas registradas por el KDS en este periodo.
                        </td>
                      </tr>
                    )}
                    {(currentData.tiemposKds || []).map((t, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--sd-text)', fontFamily: 'var(--sd-font-heading)', fontSize: 15 }}>
                          {t.fecha}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          {t.platos_preparados} comandas
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--sd-text-muted)' }}>
                          {t.tiempo_estimado_promedio_min} min
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: '#FFFFFF', fontWeight: 700 }}>
                          {t.tiempo_real_promedio_min} min
                        </td>
                        <td
                          style={{
                            padding: '12px 14px',
                            textAlign: 'right',
                            fontWeight: 800,
                            fontFamily: 'var(--sd-font-heading)',
                            fontSize: 15,
                            color: t.variacion_promedio_porcentaje <= 0 ? '#FFFFFF' : 'var(--sd-red-text)',
                          }}
                        >
                          {t.variacion_promedio_porcentaje > 0 ? `+${t.variacion_promedio_porcentaje}%` : `${t.variacion_promedio_porcentaje}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
