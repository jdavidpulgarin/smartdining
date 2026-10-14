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
    <div className="sd-page-wrapper">
      {/* Franja Roja con Selector de Rango e Imprimir */}
      <div className="sd-red-band">
        <div className="sd-red-band-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={15} style={{ color: 'var(--sd-white)', marginRight: 4 }} />
            <button
              type="button"
              className={`sd-band-pill ${timeRange === 'hoy' ? 'active' : ''}`}
              onClick={() => handleSelectRange('hoy')}
            >
              <span>HOY</span>
            </button>
            <button
              type="button"
              className={`sd-band-pill ${timeRange === 'semana' ? 'active' : ''}`}
              onClick={() => handleSelectRange('semana')}
              aria-label="Esta Semana"
            >
              <span>ESTA SEMANA</span>
            </button>
            <button
              type="button"
              className={`sd-band-pill ${timeRange === 'mes' ? 'active' : ''}`}
              onClick={() => handleSelectRange('mes')}
            >
              <span>ESTE MES</span>
            </button>
          </div>

          <button
            type="button"
            className="sd-band-pill"
            onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Printer size={15} />
            <span>IMPRIMIR INFORME</span>
          </button>
        </div>
      </div>

      <div className="sd-page-container">
        {/* Header Editorial */}
        <div className="sd-page-header" style={{ padding: '0 0 24px 0' }}>
          <h1 className="sd-page-title">
            ASÍ VA<br />LA SEMANA
          </h1>
          <p className="sd-page-subtitle">
            Métricas & Business Intelligence del salón y la cocina
          </p>
        </div>

        {/* Banner de Fallback cuando D-07 no está en backend */}
        {contractPending && (
          <div
            role="status"
            className="sd-card"
            style={{
              padding: '14px 18px',
              borderLeft: '4px solid var(--sd-gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={18} style={{ color: 'var(--sd-gold)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--sd-text)' }}>
                <strong style={{ color: 'var(--sd-gold)' }}>Modo simulación analítica:</strong> Visualizando métricas estructuradas según las vistas SQL de <code>24_vistas_reportes.sql</code>. Esperando despliegue de la ruta <code>GET /api/reportes</code> (D-07 en Backend).
              </span>
            </div>
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setShowContractDetails((prev) => !prev)}
            >
              <FileCode size={14} />
              <span>{showContractDetails ? 'Ocultar Contrato' : 'Ver Contrato D-07'}</span>
            </button>
          </div>
        )}

        {/* Detalle del Contrato REST si se expande */}
        {showContractDetails && (
          <div className="sd-card" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ maxWidth: 720 }}>
              <h4 style={{ fontSize: 16, marginBottom: 8, color: 'var(--sd-white)', fontFamily: 'var(--sd-font-heading)' }}>
                Contrato REST esperado para Daniel (D-07):
              </h4>
              <div
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--sd-border)',
                  borderRadius: 6,
                  padding: 14,
                  fontSize: 13,
                  fontFamily: 'monospace',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div><strong>Método:</strong> GET</div>
                <div><strong>Path:</strong> /api/reportes?rango={timeRange}</div>
                <div><strong>Rol:</strong> admin</div>
                <div><strong>Vistas SQL disponibles:</strong> v_ventas_diarias, v_ingredientes_top, v_platos_top, v_tiempos_kds</div>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="sd-card" style={{ padding: 48, textAlign: 'center' }}>
            <RefreshCw size={40} className="spin" style={{ margin: '0 auto 16px', color: 'var(--sd-white)' }} />
            <h3 className="sd-card-title">Cargando métricas de reporte...</h3>
            <p style={{ color: 'var(--sd-text-muted)' }}>Consultando analíticas desde el servidor.</p>
          </div>
        ) : !currentData ? (
          <div className="sd-card" style={{ padding: 40, textAlign: 'center' }}>
            <FileCode size={48} style={{ margin: '0 auto 16px', color: 'var(--sd-text-muted)' }} />
            <h3 className="sd-card-title">No se pudieron cargar los datos de reporte</h3>
            <p style={{ color: 'var(--sd-text-muted)' }}>
              Intenta recargar o verificar la conexión con el servidor.
            </p>
          </div>
        ) : (
          <>
            {/* 4 Indicadores Principales: Ventas en tarjeta ROJA, las demás oscuras, 46px */}
            <div
              className="sd-reportes-kpis-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 16,
                marginBottom: 24,
              }}
            >
              {/* Tarjeta Roja: Ventas */}
              <div
                className="sd-card"
                style={{
                  backgroundColor: 'var(--sd-red)',
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: 22,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>
                    VENTAS TOTALES
                  </span>
                  <DollarSign size={20} style={{ color: '#fff' }} />
                </div>
                <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 46, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                  {currentData.totalVentas}
                </strong>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ArrowUpRight size={14} /> +12.4% vs periodo previo
                </span>
              </div>

              {/* Pedidos Atendidos */}
              <div className="sd-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12, padding: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 14, fontWeight: 800, color: 'var(--sd-text-muted)', letterSpacing: '0.04em' }}>
                    PEDIDOS ATENDIDOS
                  </span>
                  <Utensils size={18} style={{ color: 'var(--sd-text-muted)' }} />
                </div>
                <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 46, fontWeight: 800, color: 'var(--sd-text)', lineHeight: 1 }}>
                  {currentData.totalPedidos}
                </strong>
                <span style={{ fontSize: 13, color: 'var(--sd-text-muted)' }}>
                  Ticket prom: {currentData.ticketPromedio}
                </span>
              </div>

              {/* Tiempo KDS */}
              <div className="sd-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12, padding: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 14, fontWeight: 800, color: 'var(--sd-text-muted)', letterSpacing: '0.04em' }}>
                    TIEMPO MEDIO COCINA
                  </span>
                  <Clock size={18} style={{ color: 'var(--sd-text-muted)' }} />
                </div>
                <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 46, fontWeight: 800, color: 'var(--sd-text)', lineHeight: 1 }}>
                  {currentData.tiempoCocinaPromedio}
                </strong>
                <span style={{ fontSize: 13, color: 'var(--sd-text-muted)' }}>
                  Meta: &lt; 15 min por comanda
                </span>
              </div>

              {/* Ocupación */}
              <div className="sd-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12, padding: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 14, fontWeight: 800, color: 'var(--sd-text-muted)', letterSpacing: '0.04em' }}>
                    OCUPACIÓN DE SALA
                  </span>
                  <Users size={18} style={{ color: 'var(--sd-text-muted)' }} />
                </div>
                <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 46, fontWeight: 800, color: 'var(--sd-text)', lineHeight: 1 }}>
                  {currentData.ocupacionMesas}
                </strong>
                <span style={{ fontSize: 13, color: 'var(--sd-text-muted)' }}>
                  Rotación: 2.8 veces por mesa
                </span>
              </div>
            </div>

            {/* Grid Analítico: Platos más vendidos y Métricas de Sala */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, marginBottom: 24 }}>
              {/* Platos Más Vendidos */}
              <div className="sd-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--sd-border)', paddingBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Award size={20} style={{ color: 'var(--sd-gold)' }} />
                    <h3 className="sd-card-title" style={{ margin: 0, fontSize: 20 }}>
                      Platos Más Vendidos (Top Ventas)
                    </h3>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)' }}>
                    TOP 5
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(currentData.topPlatos || []).map((plato, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 12,
                        borderRadius: 6,
                        background: 'rgba(0,0,0,0.25)',
                        border: '1px solid var(--sd-border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: idx === 0 ? 'var(--sd-red)' : idx === 1 ? 'var(--sd-white)' : 'var(--sd-gold)',
                            color: idx === 1 ? '#000' : '#fff',
                            fontWeight: 800,
                            fontFamily: 'var(--sd-font-heading)',
                            fontSize: 13,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          #{idx + 1}
                        </span>
                        <div>
                          <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 16, color: 'var(--sd-text)', display: 'block' }}>
                            {plato.name}
                          </strong>
                          <span style={{ fontSize: 12, color: 'var(--sd-text-muted)' }}>
                            {plato.category} · {plato.qty} unidades vendidas
                          </span>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 16, color: 'var(--sd-white)', display: 'block' }}>
                          {plato.total}
                        </strong>
                        <div style={{ width: 80, height: 6, background: 'rgba(0,0,0,0.4)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                          <div
                            style={{
                              width: `${plato.percentage}%`,
                              height: '100%',
                              background: idx === 0 ? 'var(--sd-red)' : idx === 1 ? 'var(--sd-white)' : 'var(--sd-gold)',
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Métodos de Pago y Horas Pico */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Métodos de Pago */}
                <div className="sd-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--sd-border)', paddingBottom: 12, marginBottom: 16 }}>
                    <CreditCard size={18} style={{ color: 'var(--sd-white)' }} />
                    <h3 className="sd-card-title" style={{ margin: 0, fontSize: 18 }}>
                      Distribución por Método de Pago
                    </h3>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.4)' }}>
                      {(currentData.metodosPago || []).map((mp, i) => (
                        <div
                          key={i}
                          style={{
                            width: `${mp.porcentaje}%`,
                            backgroundColor: i === 0 ? 'var(--sd-white)' : i === 1 ? 'var(--sd-gold)' : 'var(--sd-border-strong)',
                          }}
                          title={`${mp.metodo}: ${mp.porcentaje}%`}
                        />
                      ))}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      {(currentData.metodosPago || []).map((mp, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                backgroundColor: i === 0 ? 'var(--sd-white)' : i === 1 ? 'var(--sd-gold)' : 'var(--sd-border-strong)',
                              }}
                            />
                            <span>{mp.metodo}</span>
                          </div>
                          <div>
                            <strong style={{ marginRight: 8 }}>{mp.monto}</strong>
                            <span style={{ color: 'var(--sd-text-muted)' }}>({mp.porcentaje}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Horas Pico */}
                <div className="sd-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--sd-border)', paddingBottom: 12, marginBottom: 16 }}>
                    <TrendingUp size={18} style={{ color: 'var(--sd-white)' }} />
                    <h3 className="sd-card-title" style={{ margin: 0, fontSize: 18 }}>
                      Afluencia por Horario (Horas Pico)
                    </h3>
                  </div>

                  <div
                    role="img"
                    aria-label="Gráfica de horas pico"
                    style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 110, gap: 10, paddingTop: 10 }}
                  >
                    {(currentData.horasPico || []).map((hp, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                        <div
                          style={{
                            width: '100%',
                            height: `${hp.volumen}%`,
                            background: hp.volumen > 80 ? 'var(--sd-red)' : 'var(--sd-white)',
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.3s ease',
                          }}
                          title={`${hp.hora}: ${hp.volumen}%`}
                        />
                        <span style={{ fontSize: 11, color: 'var(--sd-text-muted)', marginTop: 6, whiteSpace: 'nowrap' }}>
                          {hp.hora.split(' - ')[0]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Sección de Ingredientes Top del Constructor (v_ingredientes_top) */}
            <div className="sd-card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--sd-border)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Layers size={18} style={{ color: 'var(--sd-gold)' }} />
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 20 }}>
                    Ingredientes Top en Constructor de Platos (Personalización)
                  </h3>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-gold)' }}>
                  VISTA SQL: v_ingredientes_top
                </span>
              </div>

              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--sd-border)', color: 'var(--sd-text-muted)', fontFamily: 'var(--sd-font-heading)', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '10px 14px' }}>INGREDIENTE</th>
                      <th style={{ padding: '10px 14px' }}>PASO / PLATO</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>VECES SOLICITADO</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>PORCIONES EXTRA</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>PORCIONES NORMAL</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>INGRESOS EXTRAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currentData.topIngredientes || []).map((ing, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--sd-text)', fontFamily: 'var(--sd-font-heading)', fontSize: 15 }}>
                          {ing.nombre_ingrediente}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--sd-text-muted)' }}>
                          {ing.nombre_paso} · {ing.nombre_plato}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span style={{ background: 'var(--sd-surface)', border: '1px solid var(--sd-border)', padding: '2px 8px', borderRadius: 4, fontWeight: 700, color: 'var(--sd-white)' }}>
                            {ing.veces_solicitado}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--sd-gold)', fontWeight: 700 }}>
                          {ing.porciones_extra}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--sd-text-muted)' }}>
                          {ing.porciones_normal}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--sd-white)', fontFamily: 'var(--sd-font-heading)', fontSize: 15 }}>
                          {ing.ingresos_extras_recaudados}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sección de Eficiencia Operativa KDS (v_tiempos_kds) */}
            <div className="sd-card" style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--sd-border)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={18} style={{ color: 'var(--sd-white)' }} />
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 20 }}>
                    Métricas de Eficiencia Cocina KDS
                  </h3>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)' }}>
                  VISTA SQL: v_tiempos_kds
                </span>
              </div>

              <div style={{ overflowX: 'auto', marginTop: 14 }}>
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
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--sd-white)', fontWeight: 700 }}>
                          {t.tiempo_real_promedio_min} min
                        </td>
                        <td
                          style={{
                            padding: '12px 14px',
                            textAlign: 'right',
                            fontWeight: 800,
                            fontFamily: 'var(--sd-font-heading)',
                            fontSize: 15,
                            color: t.variacion_promedio_porcentaje <= 0 ? 'var(--sd-white)' : 'var(--sd-red-text)',
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
