import { useState } from 'react'
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
} from 'lucide-react'

export function Reportes() {
  const [timeRange, setTimeRange] = useState('hoy') // 'hoy' | 'semana' | 'mes'

  // Datos analíticos simulados (alineados con v_pedidos_con_pagos y kds_metricas)
  const reportData = {
    hoy: {
      totalVentas: '$2,480.00',
      totalPedidos: 48,
      tiempoCocinaPromedio: '13.8 min',
      ocupacionMesas: '78%',
      ticketPromedio: '$51.66',
      kdsAlertsCount: 3,
      topPlatos: [
        { name: 'Hamburguesa Smart Angus', category: 'Fuertes', qty: 22, total: '$748.00', percentage: 85 },
        { name: 'Alitas BBQ x8', category: 'Entradas', qty: 18, total: '$504.00', percentage: 70 },
        { name: 'Limonada de Coco', category: 'Bebidas', qty: 26, total: '$312.00', percentage: 95 },
        { name: 'Nachos Supremos', category: 'Entradas', qty: 14, total: '$336.00', percentage: 55 },
        { name: 'Costillas BBQ St. Louis', category: 'Fuertes', qty: 8, total: '$336.00', percentage: 40 },
      ],
      metodosPago: [
        { metodo: 'Tarjeta (Débito/Crédito)', porcentaje: 48, monto: '$1,190.40', color: '#0f766e' },
        { metodo: 'Efectivo', porcentaje: 32, monto: '$793.60', color: '#14b8a6' },
        { metodo: 'Transferencia (Nequi/Daviplata)', porcentaje: 20, monto: '$496.00', color: '#f59e0b' },
      ],
      horasPico: [
        { hora: '12:00 - 13:00', volumen: 65 },
        { hora: '13:00 - 14:00', volumen: 95 },
        { hora: '14:00 - 15:00', volumen: 40 },
        { hora: '19:00 - 20:00', volumen: 70 },
        { hora: '20:00 - 21:00', volumen: 85 },
        { hora: '21:00 - 22:00', volumen: 50 },
      ],
    },
    semana: {
      totalVentas: '$14,620.00',
      totalPedidos: 284,
      tiempoCocinaPromedio: '14.5 min',
      ocupacionMesas: '72%',
      ticketPromedio: '$51.47',
      kdsAlertsCount: 16,
      topPlatos: [
        { name: 'Hamburguesa Smart Angus', category: 'Fuertes', qty: 124, total: '$4,216.00', percentage: 90 },
        { name: 'Limonada de Coco', category: 'Bebidas', qty: 140, total: '$1,680.00', percentage: 98 },
        { name: 'Alitas BBQ x8', category: 'Entradas', qty: 96, total: '$2,688.00', percentage: 75 },
        { name: 'Costillas BBQ St. Louis', category: 'Fuertes', qty: 62, total: '$2,604.00', percentage: 60 },
        { name: 'Nachos Supremos', category: 'Entradas', qty: 74, total: '$1,776.00', percentage: 58 },
      ],
      metodosPago: [
        { metodo: 'Tarjeta (Débito/Crédito)', porcentaje: 52, monto: '$7,602.40', color: '#0f766e' },
        { metodo: 'Efectivo', porcentaje: 28, monto: '$4,093.60', color: '#14b8a6' },
        { metodo: 'Transferencia (Nequi/Daviplata)', porcentaje: 20, monto: '$2,924.00', color: '#f59e0b' },
      ],
      horasPico: [
        { hora: '12:00 - 13:00', volumen: 70 },
        { hora: '13:00 - 14:00', volumen: 90 },
        { hora: '14:00 - 15:00', volumen: 45 },
        { hora: '19:00 - 20:00', volumen: 75 },
        { hora: '20:00 - 21:00', volumen: 88 },
        { hora: '21:00 - 22:00', volumen: 60 },
      ],
    },
    mes: {
      totalVentas: '$58,940.00',
      totalPedidos: 1140,
      tiempoCocinaPromedio: '14.1 min',
      ocupacionMesas: '75%',
      ticketPromedio: '$51.70',
      kdsAlertsCount: 48,
      topPlatos: [
        { name: 'Hamburguesa Smart Angus', category: 'Fuertes', qty: 480, total: '$16,320.00', percentage: 95 },
        { name: 'Limonada de Coco', category: 'Bebidas', qty: 560, total: '$6,720.00', percentage: 100 },
        { name: 'Alitas BBQ x8', category: 'Entradas', qty: 390, total: '$10,920.00', percentage: 80 },
        { name: 'Costillas BBQ St. Louis', category: 'Fuertes', qty: 250, total: '$10,500.00', percentage: 65 },
        { name: 'Tiramisú Artesanal', category: 'Postres', qty: 290, total: '$4,060.00', percentage: 55 },
      ],
      metodosPago: [
        { metodo: 'Tarjeta (Débito/Crédito)', porcentaje: 54, monto: '$31,827.60', color: '#0f766e' },
        { metodo: 'Efectivo', porcentaje: 26, monto: '$15,324.40', color: '#14b8a6' },
        { metodo: 'Transferencia (Nequi/Daviplata)', porcentaje: 20, monto: '$11,788.00', color: '#f59e0b' },
      ],
      horasPico: [
        { hora: '12:00 - 13:00', volumen: 75 },
        { hora: '13:00 - 14:00', volumen: 92 },
        { hora: '14:00 - 15:00', volumen: 48 },
        { hora: '19:00 - 20:00', volumen: 80 },
        { hora: '20:00 - 21:00', volumen: 90 },
        { hora: '21:00 - 22:00', volumen: 65 },
      ],
    },
  }

  const currentData = reportData[timeRange]

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
                onClick={() => setTimeRange('hoy')}
              >
                Hoy
              </button>
              <button
                type="button"
                className={`range-pill ${timeRange === 'semana' ? 'active' : ''}`}
                onClick={() => setTimeRange('semana')}
              >
                Esta Semana
              </button>
              <button
                type="button"
                className={`range-pill ${timeRange === 'mes' ? 'active' : ''}`}
                onClick={() => setTimeRange('mes')}
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
            {currentData.topPlatos.map((plato, idx) => (
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
                {currentData.metodosPago.map((mp, i) => (
                  <div
                    key={i}
                    className="bar-segment"
                    style={{ width: `${mp.porcentaje}%`, backgroundColor: mp.color }}
                    title={`${mp.metodo}: ${mp.porcentaje}%`}
                  ></div>
                ))}
              </div>

              <div className="payment-legends-list">
                {currentData.metodosPago.map((mp, i) => (
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
              {currentData.horasPico.map((hp, i) => (
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
                <p>94% de comandas despachadas en tiempo verde (&lt; 15 min)</p>
              </div>
            </div>
            <span className="kds-badge-clean">
              {currentData.kdsAlertsCount} demoras registradas
            </span>
          </div>
        </div>
      </section>
    </main>
  )
}
