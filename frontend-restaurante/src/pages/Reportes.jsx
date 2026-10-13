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
} from 'lucide-react'
import { reportesApi } from '../services/api'

export function Reportes() {
  const [timeRange, setTimeRange] = useState('hoy') // 'hoy' | 'semana' | 'mes'
  const [loading, setLoading] = useState(true)
  const [reportData, setReportData] = useState(null)
  const [contractPending, setContractPending] = useState(true)

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
        setContractPending(false)
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
      </section>      {loading ? (
        <section className="panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <RefreshCw size={40} className="spin text-emerald" style={{ margin: '0 auto 1rem' }} />
          <h3>Cargando métricas de reporte...</h3>
          <p>Consultando analíticas desde el servidor.</p>
        </section>
      ) : contractPending || !currentData ? (
        <section className="panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <FileCode size={48} className="text-emerald" style={{ margin: '0 auto 1rem', display: 'block' }} />
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              Módulo de Reportes & BI (RF-21) — Pendiente en Backend
            </h3>
            <p style={{ color: 'var(--text-secondary, #6b7280)', marginBottom: '1.5rem', lineHeight: '1.6' }}>
              La ruta <code>GET /api/reportes?rango={timeRange}</code> no existe actualmente en el backend.
              El contrato REST requerido para Daniel ha sido especificado para su implementación:
            </p>

            <div
              style={{
                background: 'rgba(15, 118, 110, 0.08)',
                border: '1px solid rgba(15, 118, 110, 0.25)',
                borderRadius: '8px',
                padding: '1.25rem',
                textAlign: 'left',
                fontSize: '0.875rem',
                fontFamily: 'monospace',
              }}
            >
              <div><strong>Método:</strong> GET</div>
              <div><strong>Path:</strong> /api/reportes?rango={timeRange}</div>
              <div><strong>Rol:</strong> admin</div>
              <div style={{ marginTop: '0.5rem' }}><strong>Respuesta JSON esperada:</strong></div>
              <pre style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-primary, #111827)' }}>
{`{
  "totalVentas": "$2,480.00",
  "totalPedidos": 48,
  "tiempoCocinaPromedio": "13.8 min",
  "ocupacionMesas": "78%",
  "ticketPromedio": "$51.66",
  "kdsAlertsCount": 3,
  "topPlatos": [
    { "name": "Hamburguesa Smart Angus", "category": "Fuertes", "qty": 22, "total": "$748.00", "percentage": 85 }
  ],
  "metodosPago": [
    { "metodo": "Tarjeta", "porcentaje": 48, "monto": "$1,190.40", "color": "#0f766e" }
  ],
  "horasPico": [
    { "hora": "12:00 - 13:00", "volumen": 65 }
  ]
}`}
              </pre>
            </div>
          </div>
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
          <section className="reportes-grid">
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
            <div className="reportes-right-col">
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
        </>
      )}
    </main>
  )
}
