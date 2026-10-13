import { useState, useEffect } from 'react'
import {
  TrendingUp,
  DollarSign,
  Clock,
  Printer,
  Calendar,
  Award,
  Users,
  Utensils,
  CreditCard,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  FileCode,
  Layers,
} from 'lucide-react'
import { reportesApi } from '../services/api'

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

  return (
    <main className="main-panel reportes-page">
      {/* Header del Panel */}
      <section className="panel reportes-header-panel">
        <div className="reportes-title-row">
          <div>
            <h2>Métricas & Business Intelligence</h2>
            <span className="panel-subtitle">
              Rendimiento financiero de sala, tiempos KDS de cocina y hábitos de consumo
            </span>
          </div>

          <div className="reportes-actions">
            {/* Selector de Rango */}
            <div className="range-selector">
              <Calendar size={15} />
              <button
                type="button"
                className={`range-pill ${timeRange === 'hoy' ? 'active' : ''}`}
                onClick={() => handleSelectRange('hoy')}
              >
                Hoy
              </button>
              <button
                type="button"
                className={`range-pill ${timeRange === 'semana' ? 'active' : ''}`}
                onClick={() => handleSelectRange('semana')}
              >
                Esta Semana
              </button>
              <button
                type="button"
                className={`range-pill ${timeRange === 'mes' ? 'active' : ''}`}
                onClick={() => handleSelectRange('mes')}
              >
                Este Mes
              </button>
            </div>

            <button
              type="button"
              className="ghost-button small"
              onClick={() => window.print()}
            >
              <Printer size={15} />
              <span>Imprimir Informe</span>
            </button>
          </div>
        </div>
      </section>

      {/* Banner de Fallback cuando D-07 no está en backend */}
      {contractPending && (
        <div
          role="status"
          style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '12px',
            padding: '0.85rem 1.25rem',
            margin: '1rem 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            color: '#f8fafc',
            fontSize: '0.875rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <AlertTriangle size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />
            <span>
              <strong style={{ color: '#fbbf24' }}>Modo simulación analítica:</strong> Visualizando métricas estructuradas según las vistas SQL de <code>24_vistas_reportes.sql</code>. Esperando despliegue de la ruta <code>GET /api/reportes</code> (D-07 en Backend).
            </span>
          </div>
          <button
            type="button"
            className="ghost-button small"
            style={{ whiteSpace: 'nowrap', borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24' }}
            onClick={() => setShowContractDetails((prev) => !prev)}
          >
            <FileCode size={14} />
            <span>{showContractDetails ? 'Ocultar Contrato' : 'Ver Contrato D-07'}</span>
          </button>
        </div>
      )}

      {/* Detalle del Contrato REST si se expande */}
      {showContractDetails && (
        <section className="panel" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ maxWidth: '720px' }}>
            <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#10b981' }}>
              Contrato REST esperado para Daniel (D-07):
            </h4>
            <div
              style={{
                background: 'rgba(15, 118, 110, 0.08)',
                border: '1px solid rgba(15, 118, 110, 0.25)',
                borderRadius: '8px',
                padding: '1rem',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
              }}
            >
              <div><strong>Método:</strong> GET</div>
              <div><strong>Path:</strong> /api/reportes?rango={timeRange}</div>
              <div><strong>Rol:</strong> admin</div>
              <div><strong>Vistas SQL disponibles:</strong> v_ventas_diarias, v_ingredientes_top, v_platos_top, v_tiempos_kds</div>
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <section className="panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <RefreshCw size={40} className="spin text-emerald" style={{ margin: '0 auto 1rem' }} />
          <h3>Cargando métricas de reporte...</h3>
          <p>Consultando analíticas desde el servidor.</p>
        </section>
      ) : !currentData ? (
        <section className="panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <FileCode size={48} className="text-emerald" style={{ margin: '0 auto 1rem', display: 'block' }} />
          <h3>No se pudieron cargar los datos de reporte</h3>
          <p style={{ color: 'var(--text-secondary, #6b7280)' }}>
            Intenta recargar o verificar la conexión con el servidor.
          </p>
        </section>
      ) : (
        <>
          {/* KPI Cards */}
          <section className="reportes-kpi-grid">
            <div className="stat-card">
              <div className="kpi-icon-row">
                <span className="stat-label">Ingresos Totales</span>
                <div className="kpi-badge-icon teal"><DollarSign size={18} /></div>
              </div>
              <div className="stat-value">{currentData.totalVentas}</div>
              <div className="stat-detail positive">
                <ArrowUpRight size={14} /> +12.4% vs periodo previo
              </div>
            </div>

            <div className="stat-card">
              <div className="kpi-icon-row">
                <span className="stat-label">Comandas Atendidas</span>
                <div className="kpi-badge-icon blue"><Utensils size={18} /></div>
              </div>
              <div className="stat-value">{currentData.totalPedidos}</div>
              <div className="stat-detail">Ticket prom: {currentData.ticketPromedio}</div>
            </div>

            <div className="stat-card">
              <div className="kpi-icon-row">
                <span className="stat-label">Tiempo Medio Cocina (KDS)</span>
                <div className="kpi-badge-icon amber"><Clock size={18} /></div>
              </div>
              <div className="stat-value">{currentData.tiempoCocinaPromedio}</div>
              <div className="stat-detail positive">Meta: &lt; 15 min por comanda</div>
            </div>

            <div className="stat-card">
              <div className="kpi-icon-row">
                <span className="stat-label">Ocupación de Sala</span>
                <div className="kpi-badge-icon purple"><Users size={18} /></div>
              </div>
              <div className="stat-value">{currentData.ocupacionMesas}</div>
              <div className="stat-detail">Rotación: 2.8 veces por mesa</div>
            </div>
          </section>

          {/* Grid de Reportes Detallados */}
          <section className="reportes-grid" style={{ marginTop: '1.5rem' }}>
            {/* Top Platos Más Vendidos */}
            <div className="panel ranking-panel">
              <div className="panel-header">
                <div className="panel-title-with-icon">
                  <Award size={18} className="text-teal" />
                  <h3>Platos Más Vendidos (Top Ventas)</h3>
                </div>
                <span className="badge-count">Top 5</span>
              </div>

              <div className="ranking-list">
                {(currentData.topPlatos || []).map((plato, idx) => (
                  <div key={idx} className="ranking-item">
                    <div className="ranking-left">
                      <span className={`ranking-pos pos-${idx + 1}`}>#{idx + 1}</span>
                      <div className="ranking-info">
                        <strong>{plato.name}</strong>
                        <span>{plato.category} · {plato.qty} unidades vendidas</span>
                      </div>
                    </div>

                    <div className="ranking-right">
                      <strong className="ranking-total">{plato.total}</strong>
                      <div className="ranking-bar-track">
                        <div
                          className="ranking-bar-fill"
                          style={{ width: `${plato.percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Métodos de Pago & Horas Pico */}
            <div className="reportes-right-col" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Métodos de Pago */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title-with-icon">
                    <CreditCard size={18} className="text-teal" />
                    <h3>Distribución por Método de Pago</h3>
                  </div>
                </div>

                <div className="payment-distribution-bars">
                  <div className="multi-bar">
                    {(currentData.metodosPago || []).map((mp, i) => (
                      <div
                        key={i}
                        className="bar-segment"
                        style={{ width: `${mp.porcentaje}%`, backgroundColor: mp.color }}
                        title={`${mp.metodo}: ${mp.porcentaje}%`}
                      ></div>
                    ))}
                  </div>

                  <div className="payment-legends-list">
                    {(currentData.metodosPago || []).map((mp, i) => (
                      <div key={i} className="payment-legend-row">
                        <div className="legend-label">
                          <span
                            className="legend-dot"
                            style={{ backgroundColor: mp.color }}
                          ></span>
                          <span>{mp.metodo}</span>
                        </div>
                        <div className="legend-values">
                          <strong>{mp.monto}</strong>
                          <span className="percentage-pill">{mp.porcentaje}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Horas Pico */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title-with-icon">
                    <TrendingUp size={18} className="text-teal" />
                    <h3>Afluencia por Horario (Horas Pico)</h3>
                  </div>
                </div>

                <div className="peak-hours-chart">
                  {(currentData.horasPico || []).map((hp, i) => (
                    <div key={i} className="peak-hour-column">
                      <div className="bar-wrapper">
                        <div
                          className="peak-bar-fill"
                          style={{ height: `${hp.volumen}%` }}
                        >
                          <span className="bar-tooltip">{hp.volumen}%</span>
                        </div>
                      </div>
                      <span className="hour-label">{hp.hora.split(' - ')[0]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Semaforización KDS */}
              <div className="panel kds-alert-summary">
                <div className="kds-alert-header">
                  <AlertTriangle size={18} className="text-amber" />
                  <div>
                    <strong>Auditoría KDS: Eficiencia de Tiempos</strong>
                    <p>Comandas monitoreadas en tiempo real</p>
                  </div>
                </div>
                <span className="kds-badge-clean">
                  {currentData.kdsAlertsCount || 0} demoras registradas
                </span>
              </div>
            </div>
          </section>

          {/* Sección de Ingredientes Top del Constructor (v_ingredientes_top) */}
          <section className="panel" style={{ marginTop: '1.5rem' }}>
            <div className="panel-header">
              <div className="panel-title-with-icon">
                <Layers size={18} className="text-teal" />
                <h3>Ingredientes Top en Constructor de Platos (Personalización)</h3>
              </div>
              <span className="badge-count">Vista SQL: v_ingredientes_top</span>
            </div>

            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Ingrediente</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Paso / Plato</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Veces Solicitado</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Porciones Extra</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Porciones Normal</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Ingresos Extras</th>
                  </tr>
                </thead>
                <tbody>
                  {(currentData.topIngredientes || []).map((ing, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#ffffff' }}>{ing.nombre_ingrediente}</td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)' }}>{ing.nombre_paso} · {ing.nombre_plato}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span className="badge-count" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
                          {ing.veces_solicitado}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: '#fbbf24' }}>{ing.porciones_extra}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>{ing.porciones_normal}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#34d399' }}>
                        {ing.ingresos_extras_recaudados}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Sección de Eficiencia Operativa KDS (v_tiempos_kds) */}
          <section className="panel" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
            <div className="panel-header">
              <div className="panel-title-with-icon">
                <Clock size={18} className="text-teal" />
                <h3>Métricas de Eficiencia Cocina KDS</h3>
              </div>
              <span className="badge-count">Vista SQL: v_tiempos_kds</span>
            </div>

            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Periodo / Fecha</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Platos Preparados</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Tiempo Estimado Promedio</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Tiempo Real Promedio</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Variación vs Estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {(currentData.tiemposKds || []).map((t, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#ffffff' }}>{t.fecha}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>{t.platos_preparados} comandas</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>{t.tiempo_estimado_promedio_min} min</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: '#60a5fa', fontWeight: 600 }}>{t.tiempo_real_promedio_min} min</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: t.variacion_promedio_porcentaje <= 0 ? '#34d399' : '#fbbf24' }}>
                        {t.variacion_promedio_porcentaje > 0 ? `+${t.variacion_promedio_porcentaje}%` : `${t.variacion_promedio_porcentaje}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
