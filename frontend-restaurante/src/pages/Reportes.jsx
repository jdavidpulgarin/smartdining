import { useState, useEffect, useMemo, useContext } from 'react'
import { Navigate } from 'react-router-dom'
import { AuthContext } from '../context/authContextDef'
import {
  Printer,
  AlertTriangle,
  RefreshCw,
  FileCode,
} from 'lucide-react'
import { reportesApi, transaccionesApi } from '../services/api'
import { resumirMetodos, cuadreConCaja, barrasVentasPorDia } from '../utils/reportes'
import '../styles/reportes.css'

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
    <p className="rep-vacio">
      {children}
    </p>
  )
}

/**
 * Reportes es solo de admin: GET /api/reportes da 403 a los demás roles. Al
 * mesero y al cajero no se les muestra el enlace y, si llegan por la URL,
 * vuelven al inicio (como la Caja).
 */
export function Reportes() {
  const rol = useContext(AuthContext)?.user?.rol
  if (rol && rol !== 'admin') return <Navigate to="/" replace />
  return <ReportesAdmin />
}

function ReportesAdmin() {
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
    <div className="reportes-pagina tema-comanda">
      <div className="rep-cont">
        {/* Encabezado: título del periodo, rango de fechas y acciones */}
        <header className="rep-cab">
          <div className="rep-cab-izq">
            <h1 className="rep-titulo">
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
            <span className="rep-rango">
              {obtenerRangoFechasTexto(timeRange)}
              {contractPending && ' · datos de demostración'}
            </span>

            {contractPending && (
              <div className="rep-demo">
                <AlertTriangle size={14} />
                <span>
                  Datos de demostración: <code>VITE_USE_MOCKS</code> activo en desarrollo. No son ventas reales.
                </span>
              </div>
            )}
          </div>

          <div className="rep-acciones">
            <div className="rep-periodo" role="group" aria-label="Periodo">
              <span className="rep-periodo-lbl">PERIODO</span>
              <button
                type="button"
                className={`rep-chip ${timeRange === 'hoy' ? 'activa' : ''}`}
                onClick={() => handleSelectRange('hoy')}
              >
                <span>HOY</span>
              </button>
              <button
                type="button"
                className={`rep-chip ${timeRange === 'semana' ? 'activa' : ''}`}
                onClick={() => handleSelectRange('semana')}
                aria-label="Últimos 7 días"
              >
                <span>ÚLTIMOS 7 DÍAS</span>
              </button>
              <button
                type="button"
                className={`rep-chip ${timeRange === 'mes' ? 'activa' : ''}`}
                onClick={() => handleSelectRange('mes')}
                aria-label="Últimos 30 días"
              >
                <span>ÚLTIMOS 30 DÍAS</span>
              </button>
            </div>

            <button
              type="button"
              className="rep-btn"
              onClick={() => window.print()}
            >
              <Printer size={16} />
              <span>IMPRIMIR INFORME</span>
            </button>
          </div>
        </header>

        {loading ? (
          <div className="rep-ticket rep-estado">
            <RefreshCw size={36} className="spin" />
            <h3>
              Cargando métricas de reporte...
            </h3>
            <p>Consultando analíticas desde el servidor.</p>
          </div>
        ) : !currentData ? (
          <div className="rep-ticket rep-estado">
            <FileCode size={40} />
            <h3>
              No se pudieron cargar los datos de reporte
            </h3>
            <p role="alert">
              {errorCarga ? `${errorCarga}. ` : ''}Intenta recargar o verificar la conexión con el servidor.
            </p>
          </div>
        ) : (
          <>
            {/* Cuatro indicadores */}
            <div className="rep-kpis">
              <article className="rep-ticket rep-kpi rep-kpi-ventas">
                <span className="rep-banda">VENTAS</span>
                <div className="rep-kpi-cuerpo">
                  <strong className="rep-kpi-valor">
                    {formatoCOP(currentData.totalVentas)}
                  </strong>
                  <span className="rep-kpi-sub">
                    Pagos completados en el periodo
                  </span>
                </div>
              </article>

              <article className="rep-ticket rep-kpi">
                <span className="rep-banda">PEDIDOS</span>
                <div className="rep-kpi-cuerpo">
                  <strong className="rep-kpi-valor">
                    {currentData.totalPedidos}
                  </strong>
                  <span className="rep-kpi-sub">
                    {currentData.pedidosLiquidados ?? 0} liquidados
                  </span>
                </div>
              </article>

              {/* ticketPromedio = ventas / pedidos liquidados */}
              <article className="rep-ticket rep-kpi">
                <span className="rep-banda">TICKET PROMEDIO</span>
                <div className="rep-kpi-cuerpo">
                  <strong className="rep-kpi-valor">
                    {formatoCOP(calcularTicketComensal(currentData))}
                  </strong>
                  <span className="rep-kpi-sub">
                    Por pedido liquidado
                  </span>
                </div>
              </article>

              <article className="rep-ticket rep-kpi">
                <span className="rep-banda">TIEMPO DE PREPARACIÓN</span>
                <div className="rep-kpi-cuerpo">
                  <strong className="rep-kpi-valor">
                    {currentData?.tiempoCocinaPromedio != null
                      ? `${Number(currentData.tiempoCocinaPromedio).toFixed(1)} min`
                      : '—'}
                  </strong>
                  <span className="rep-kpi-sub">
                    Meta: &lt; 15 min por comanda
                  </span>
                </div>
              </article>
            </div>

            <div className="rep-grid">
              {/* Ventas por día */}
              <section className="rep-ticket">
                <h3 className="rep-banda">VENTAS POR DÍA</h3>
                <div className="rep-cuerpo">
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
                      className="rep-barras"
                    >
                      {ventasDia.map((d) => (
                        <div
                          key={d.fecha}
                          data-testid={`dia-${d.fecha}`}
                          title={`${d.titulo}: ${formatoCOP(d.total)} · ${d.pedidos} pedidos`}
                          className="rep-barra"
                        >
                          <span className="rep-barra-valor">
                            {d.total > 0 ? formatoCOP(d.total) : ''}
                          </span>
                          <div className="rep-barra-fill" style={{ height: `${d.altura}%` }} />
                          <span className="rep-barra-eje">{d.etiqueta}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Afluencia por horario */}
              <section className="rep-ticket">
                <h3 className="rep-banda">AFLUENCIA POR HORARIO (HORAS PICO)</h3>
                <div className="rep-cuerpo">
                  {(currentData.horasPico || []).length === 0 && (
                    <SinDatos>Sin pedidos en este periodo.</SinDatos>
                  )}
                  <div
                    role="img"
                    aria-label="Gráfica de afluencia por horario"
                    className="rep-horas"
                  >
                    {(currentData.horasPico || []).map((hp, i) => (
                      <div key={i} className="rep-hora">
                        <div
                          className={`rep-hora-fill${hp.volumen > 80 ? ' pico' : hp.volumen > 60 ? ' alta' : ''}`}
                          style={{ height: `${hp.volumen}%` }}
                          title={`${hp.hora}: ${hp.volumen}%`}
                        />
                        <span className="rep-hora-eje">
                          {hp.hora.split(' - ')[0]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Métodos de pago (T6): montos por método, cada uno con su color, el
                  total y, en «hoy», si cuadra con «Recaudado hoy» de la Caja. */}
              <section className="rep-ticket" data-testid="panel-metodos">
                <h3 className="rep-banda">DISTRIBUCIÓN POR MÉTODO DE PAGO</h3>
                <div className="rep-cuerpo">
                  {metodos.filas.length === 0 && (
                    <SinDatos>Sin pagos completados en este periodo.</SinDatos>
                  )}
                  <div className="rep-reparto" role="img" aria-label="Montos cobrados por método de pago">
                    {metodos.filas.map((mp) => (
                      <div
                        key={mp.metodo}
                        style={{ width: `${mp.porcentaje}%`, backgroundColor: mp.color }}
                        title={`${mp.metodo}: ${formatoCOP(mp.monto)} (${mp.porcentaje}%)`}
                      />
                    ))}
                  </div>

                  <div className="rep-ley">
                    {metodos.filas.map((mp) => (
                      <div key={mp.metodo} className="rep-ley-fila" data-testid={`metodo-${mp.metodo}`}>
                        <span className="sd-payment-dot rep-ley-punto" style={{ backgroundColor: mp.color }} />
                        <span className="rep-ley-nombre">{mp.metodo}</span>
                        <strong className="rep-ley-monto">
                          {formatoCOP(mp.monto)}
                        </strong>
                        <span className="rep-ley-pct">({mp.porcentaje}%)</span>
                      </div>
                    ))}
                    {metodos.filas.length > 0 && (
                      <div className="rep-ley-fila rep-ley-total" data-testid="metodos-total">
                        <span className="rep-ley-nombre">TOTAL COBRADO</span>
                        <strong className="rep-ley-monto">{formatoCOP(metodos.total)}</strong>
                      </div>
                    )}
                  </div>
                  {timeRange === 'hoy' && cuadre.estado !== 'sin_dato' && (
                    <p
                      data-testid="cuadre-caja"
                      role={cuadre.estado === 'cuadra' ? 'status' : 'alert'}
                      className={`rep-cuadre${cuadre.estado === 'cuadra' ? '' : ' no-cuadra'}`}
                    >
                      {cuadre.estado === 'cuadra'
                        ? `Cuadra con «Recaudado hoy» de la Caja (${formatoCOP(recaudadoHoy)}).`
                        : `No cuadra con «Recaudado hoy» de la Caja (${formatoCOP(recaudadoHoy)}): diferencia de ${formatoCOP(Math.abs(cuadre.diferencia))}. Puede ser un cobro de hace menos de un minuto (el reporte se guarda 60 s).`}
                    </p>
                  )}
                </div>
              </section>

              {/* Platos más pedidos */}
              <section className="rep-ticket">
                <h3 className="rep-banda">PLATOS MÁS PEDIDOS</h3>
                <div className="rep-cuerpo">
                  {topPlatos.length === 0 ? (
                    <SinDatos>Sin platos vendidos en este periodo.</SinDatos>
                  ) : (
                    <ol className="rep-rank">
                      {topPlatos.map((plato, idx) => (
                        <li key={plato.id} className={idx === 0 ? 'primero' : ''}>
                          <h4 className="rep-rank-nombre">
                            {idx + 1}. {String(plato.nombre || '').toUpperCase()}
                          </h4>
                          <span className="rep-rank-meta">
                            {plato.unidades} vendidos · {formatoCOP(plato.total)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>

              {/* Ingredientes más pedidos */}
              <section className="rep-ticket">
                <h3 className="rep-banda">INGREDIENTES MÁS PEDIDOS</h3>
                <div className="rep-cuerpo">
                  {topIngredientes.length === 0 && (
                    <SinDatos>Sin ingredientes pedidos en este periodo.</SinDatos>
                  )}
                  <div className="rep-ing">
                    {topIngredientes.map((ing) => {
                      const percent = Math.round((ing.veces / maxIngVeces) * 100)
                      return (
                        <div key={ing.id} className="rep-ing-fila">
                          <div className="rep-ing-meta">
                            <span className="rep-ing-nombre">
                              {ing.nombre}
                              {ing.plato && (
                                <span className="rep-ing-plato"> · {ing.plato}</span>
                              )}
                            </span>
                            <span className="rep-ing-veces">{ing.veces} veces</span>
                          </div>
                          <div className="rep-ing-riel">
                            <div
                              className="rep-ing-barra"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              {/* Tiempos de cocina (KDS) */}
              <section className="rep-ticket rep-ancho">
                <div className="rep-banda">
                  <h3 className="rep-banda-h">MÉTRICAS DE EFICIENCIA COCINA KDS</h3>
                  <small>VISTA SQL: v_tiempos_kds</small>
                </div>

                <div className="rep-tabla">
                  <table>
                    <thead>
                      <tr>
                        <th>PERIODO / FECHA</th>
                        <th className="centro">PLATOS PREPARADOS</th>
                        <th className="centro">TIEMPO ESTIMADO</th>
                        <th className="centro">TIEMPO REAL</th>
                        <th className="der">VARIACIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(currentData.tiemposKds || []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="rep-tabla-vacia">
                            Sin comandas registradas por el KDS en este periodo.
                          </td>
                        </tr>
                      )}
                      {(currentData.tiemposKds || []).map((t, idx) => (
                        <tr key={idx}>
                          <td className="rep-tabla-fecha">
                            {t.fecha}
                          </td>
                          <td className="centro">
                            {t.platos_preparados} comandas
                          </td>
                          <td className="centro rep-tabla-suave">
                            {t.tiempo_estimado_promedio_min} min
                          </td>
                          <td className="centro rep-tabla-real">
                            {t.tiempo_real_promedio_min} min
                          </td>
                          <td className={`der rep-tabla-var${t.variacion_promedio_porcentaje <= 0 ? ' menos' : ' mas'}`}>
                            {t.variacion_promedio_porcentaje > 0 ? `+${t.variacion_promedio_porcentaje}%` : `${t.variacion_promedio_porcentaje}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
