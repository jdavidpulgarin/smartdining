import { useState, useEffect, useMemo } from 'react'
import {
  Printer,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  FileCode,
} from 'lucide-react'
import { reportesApi } from '../services/api'

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
    const mesNombre = hoy.toLocaleDateString('es-CO', { month: 'long' })
    const anio = hoy.getFullYear()
    return `1 al ${hoy.getDate()} de ${mesNombre} de ${anio}`
  }
  return hoyStr
}

const defaultTopPlatos = [
  { nombreCorto: 'BOWL', name: 'Bowl Personalizado', qty: 212, percentage: 43 },
  { nombreCorto: 'AREPA RELLENA', name: 'Arepa Rellena', qty: 164, percentage: 32 },
  { nombreCorto: 'WRAP', name: 'Wrap Personalizado', qty: 98, percentage: 19 },
]

const defaultTopIngredientes = [
  { nombre: 'Arroz Integral', veces: 142 },
  { nombre: 'Pollo a la Plancha', veces: 118 },
  { nombre: 'Carne Desmechada', veces: 89 },
  { nombre: 'Aguacate', veces: 84 },
  { nombre: 'Maíz Tierno', veces: 76 },
  { nombre: 'Salsa de Ajo', veces: 65 },
]

export function Reportes() {
  const [timeRange, setTimeRange] = useState('hoy') // 'hoy' | 'semana' | 'mes'
  const [loading, setLoading] = useState(true)
  const [reportData, setReportData] = useState(null)
  const [contractPending, setContractPending] = useState(false)
  const [showContractDetails, setShowContractDetails] = useState(false)

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
      })
      .catch(() => {
        if (!isMounted) return
        setReportData(null)
        setContractPending(true)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [timeRange])

  const currentData = reportData

  // Ventas por día (últimos 7 días)
  const diasVentas = useMemo(() => {
    return [
      { dia: 'MIÉ', monto: 1120000, label: '$1,12 M' },
      { dia: 'JUE', monto: 1240000, label: '$1,24 M' },
      { dia: 'VIE', monto: 1480000, label: '$1,48 M' },
      { dia: 'SÁB', monto: 1620000, label: '$1,62 M' },
      { dia: 'DOM', monto: 1350000, label: '$1,35 M' },
      { dia: 'LUN', monto: 950000, label: '$0,95 M' },
      { dia: 'HOY', monto: 1280000, label: '$1,28 M', esHoy: true },
    ]
  }, [])

  const diaMax = useMemo(() => {
    return diasVentas.reduce((prev, curr) => (curr.monto > prev.monto ? curr : prev), diasVentas[0])
  }, [diasVentas])

  const diaMin = useMemo(() => {
    return diasVentas.reduce((prev, curr) => (curr.monto < prev.monto ? curr : prev), diasVentas[0])
  }, [diasVentas])

  const maxVentaDia = diaMax.monto

  // Top 3 platos del menú seed
  const top3Platos = useMemo(() => {
    if (!currentData?.topPlatos || currentData.topPlatos.length === 0) {
      return defaultTopPlatos
    }
    const seedDishes = [
      { nombreCorto: 'BOWL', name: 'Bowl Personalizado' },
      { nombreCorto: 'AREPA RELLENA', name: 'Arepa Rellena' },
      { nombreCorto: 'WRAP', name: 'Wrap Personalizado' },
    ]
    return seedDishes.map((seed, idx) => {
      const platoData = currentData.topPlatos[idx] || {}
      return {
        nombreCorto: seed.nombreCorto,
        name: seed.name,
        qty: platoData.qty || defaultTopPlatos[idx].qty,
        percentage: platoData.percentage || defaultTopPlatos[idx].percentage,
      }
    })
  }, [currentData])

  // Top 6 ingredientes del menú seed
  const top6Ingredientes = useMemo(() => {
    const seedNames = [
      'Arroz Integral',
      'Pollo a la Plancha',
      'Carne Desmechada',
      'Aguacate',
      'Maíz Tierno',
      'Salsa de Ajo',
    ]
    if (!currentData?.topIngredientes || currentData.topIngredientes.length === 0) {
      return defaultTopIngredientes
    }
    return seedNames.map((nombre, idx) => {
      const item = currentData.topIngredientes[idx]
      return {
        nombre,
        veces: item?.veces_solicitado || defaultTopIngredientes[idx].veces,
      }
    })
  }, [currentData])

  const maxIngVeces = useMemo(() => {
    return Math.max(...top6Ingredientes.map((i) => i.veces), 1)
  }, [top6Ingredientes])

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
            >
              <span>ESTE MES</span>
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
                  ASÍ VA<br />EL MES
                </>
              )}
            </h1>

            {contractPending && (
              <div className="sd-reportes-sim-notice">
                <AlertTriangle size={14} style={{ color: 'var(--sd-gold)', flexShrink: 0 }} />
                <span>
                  Modo simulación analítica: esperando despliegue de <code>GET /api/reportes</code> (D-07 en backend).
                </span>
                <button
                  type="button"
                  className="sd-reportes-contract-toggle"
                  onClick={() => setShowContractDetails((prev) => !prev)}
                >
                  {showContractDetails ? '(ocultar contrato)' : '(ver contrato D-07)'}
                </button>
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

        {/* Detalle técnico del contrato REST si se expande */}
        {showContractDetails && (
          <div className="sd-reportes-panel" style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 16, marginBottom: 8, color: '#fff', fontFamily: 'var(--sd-font-heading)' }}>
              Contrato REST esperado para Daniel (D-07):
            </h4>
            <div style={{ background: 'var(--sd-bg)', border: '1px solid var(--sd-border)', borderRadius: 8, padding: 14, fontSize: 13, fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div><strong>Método:</strong> GET</div>
              <div><strong>Path:</strong> /api/reportes?rango={timeRange}</div>
              <div><strong>Rol:</strong> admin</div>
              <div><strong>Vistas SQL disponibles:</strong> v_ventas_diarias, v_ingredientes_top, v_platos_top, v_tiempos_kds</div>
            </div>
          </div>
        )}

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
            <p style={{ color: 'var(--sd-text-muted)', margin: 0 }}>
              Intenta recargar o verificar la conexión con el servidor.
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
                  <ArrowUpRight size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                  +12.4% vs periodo previo
                </span>
              </div>

              {/* Tarjeta: PEDIDOS */}
              <div className="sd-indicator-card">
                <span className="sd-indicator-label">PEDIDOS</span>
                <strong className="sd-indicator-value">
                  {currentData.totalPedidos}
                </strong>
                <span className="sd-indicator-sub">
                  {currentData.pedidosLiquidados || currentData.totalPedidos} liquidados en sala
                </span>
              </div>

              {/* Tarjeta: TICKET POR COMENSAL */}
              <div className="sd-indicator-card">
                <span className="sd-indicator-label">TICKET POR COMENSAL</span>
                <strong className="sd-indicator-value">
                  {formatoCOP(calcularTicketComensal(currentData))}
                </strong>
                <span className="sd-indicator-sub">
                  Promedio estimado por comensal
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
                <div
                  role="img"
                  aria-label={`Ventas por día: día más alto ${diaMax.dia} con ${diaMax.label}, día más bajo ${diaMin.dia} con ${diaMin.label}`}
                  className="sd-daily-sales-chart"
                >
                  <div className="sd-daily-bars-container">
                    {diasVentas.map((d, idx) => {
                      const barHeight = Math.max(12, Math.round((d.monto / maxVentaDia) * 100))
                      return (
                        <div key={idx} className="sd-daily-bar-col">
                          <span className={`sd-daily-bar-val ${d.esHoy ? 'is-today' : ''}`}>
                            {d.label}
                          </span>
                          <div className="sd-daily-bar-track">
                            <div
                              className={`sd-daily-bar-fill ${d.esHoy ? 'is-today' : ''}`}
                              style={{ height: `${barHeight}%` }}
                            />
                          </div>
                          <div className="sd-daily-bar-baseline" />
                          <span className={`sd-daily-bar-day ${d.esHoy ? 'is-today' : ''}`}>
                            {d.dia}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Panel 2: INGREDIENTES MÁS PEDIDOS (Top 6) */}
              <div className="sd-reportes-panel">
                <h3 className="sd-reportes-panel-title">INGREDIENTES MÁS PEDIDOS</h3>
                <div className="sd-ingredients-list">
                  {top6Ingredientes.map((ing, idx) => {
                    const percent = Math.round((ing.veces / maxIngVeces) * 100)
                    return (
                      <div key={idx} className="sd-ingredient-row">
                        <div className="sd-ingredient-meta">
                          <span className="sd-ingredient-name">{ing.nombre}</span>
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

            {/* 5. PLATOS MÁS PEDIDOS (Top 3) */}
            <div className="sd-reportes-panel" style={{ marginBottom: 24 }}>
              <h3 className="sd-reportes-panel-title">PLATOS MÁS PEDIDOS</h3>
              <div className="sd-top3-dishes-grid">
                {top3Platos.map((plato, idx) => {
                  const borderClass = idx === 0 ? 'border-red' : idx === 1 ? 'border-white' : 'border-gold'
                  return (
                    <div key={idx} className={`sd-top3-card ${borderClass}`}>
                      <h4 className="sd-top3-dish-name">
                        {idx + 1}. {plato.nombreCorto || plato.name.toUpperCase()}
                      </h4>
                      <span className="sd-top3-dish-meta">
                        {plato.qty} vendidos · {plato.percentage} %
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 6. Debajo (Secundario): Métodos de Pago y Horas Pico */}
            <div className="sd-reportes-secondary-grid">
              {/* Métodos de Pago */}
              <div className="sd-reportes-panel">
                <h3 className="sd-reportes-panel-title">DISTRIBUCIÓN POR MÉTODO DE PAGO</h3>
                <div className="sd-payment-methods-block">
                  <div className="sd-payment-bar-track">
                    {(currentData.metodosPago || []).map((mp, i) => (
                      <div
                        key={i}
                        style={{
                          width: `${mp.porcentaje}%`,
                          backgroundColor: i === 0 ? '#FFFFFF' : i === 1 ? 'var(--sd-gold)' : '#4A413D',
                        }}
                        title={`${mp.metodo}: ${mp.porcentaje}%`}
                      />
                    ))}
                  </div>

                  <div className="sd-payment-legend-list">
                    {(currentData.metodosPago || []).map((mp, i) => (
                      <div key={i} className="sd-payment-legend-item">
                        <div className="sd-payment-legend-left">
                          <span
                            className="sd-payment-dot"
                            style={{
                              backgroundColor: i === 0 ? '#FFFFFF' : i === 1 ? 'var(--sd-gold)' : '#4A413D',
                            }}
                          />
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
                  </div>
                </div>
              </div>

              {/* Horas Pico */}
              <div className="sd-reportes-panel">
                <h3 className="sd-reportes-panel-title">AFLUENCIA POR HORARIO (HORAS PICO)</h3>
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
