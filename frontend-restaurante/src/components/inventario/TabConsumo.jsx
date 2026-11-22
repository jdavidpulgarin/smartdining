import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { inventarioApi, reportesApi } from '../../services/api'
import { formatoCantidad, ordenarInsumos } from '../../utils/inventario'
import {
  RANGOS_RAPIDOS,
  rangoRapido,
  hoyBogota,
  validarRango,
  consultaDeConsumo,
  mensajeErrorConsumo,
  filtrarConsumo,
  fechaCorta,
  conSigno,
  MAX_DIAS,
} from '../../utils/consumo'

const COLUMNAS = [
  { id: 'consumo', etiqueta: 'CONSUMO' },
  { id: 'merma', etiqueta: 'MERMA' },
  { id: 'entradas', etiqueta: 'ENTRADAS' },
  { id: 'ajustes', etiqueta: 'AJUSTES' },
]

const celda = { padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }

/**
 * Pestaña Consumo de Inventario (P-22, paso 5), contra GET /api/reportes/consumo.
 *
 * - Rango de días de Bogotá (31 como máximo, sin días futuros), con atajos.
 *   Opcional: un solo insumo (id_insumo).
 * - Por insumo: consumo (lo vendido), merma (manual + lo cancelado en cocina),
 *   entradas y ajustes con su signo, en la unidad del insumo. Los totales y los
 *   días vienen de la base; aquí no se suma nada.
 * - "Ver días" despliega el detalle diario de ese insumo.
 */
export function TabConsumo() {
  const hoy = hoyBogota()
  const [rango, setRango] = useState(() => rangoRapido('7', hoy))
  const [idInsumo, setIdInsumo] = useState('')
  const [insumos, setInsumos] = useState([])
  const [reporte, setReporte] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [abiertos, setAbiertos] = useState(() => new Set())

  const consultar = useCallback(async (r, id) => {
    const problema = validarRango(r, hoyBogota())
    if (problema) {
      setError(problema)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const data = await reportesApi.consumo(consultaDeConsumo({ desde: r.desde, hasta: r.hasta, idInsumo: id || null }))
      setReporte(data)
      setAbiertos(new Set())
    } catch (err) {
      setError(mensajeErrorConsumo(err))
    } finally {
      setCargando(false)
    }
  }, [])

  // Primera consulta (últimos 7 días) y la lista de insumos para el filtro, solo
  // al montar; después consulta el admin con el botón. El estado se pone en los
  // .then, no de forma síncrona dentro del efecto.
  useEffect(() => {
    let vivo = true
    reportesApi
      .consumo(consultaDeConsumo(rangoRapido('7', hoyBogota())))
      .then((data) => {
        if (vivo) setReporte(data)
      })
      .catch((err) => {
        if (vivo) setError(mensajeErrorConsumo(err))
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    inventarioApi
      .listar()
      .then((data) => {
        if (vivo) setInsumos(ordenarInsumos(data?.insumos || []))
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  const elegirRapido = (id) => {
    const r = rangoRapido(id, hoyBogota())
    setRango(r)
    consultar(r, idInsumo)
  }

  const alternar = (id) => {
    setAbiertos((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const visibles = filtrarConsumo(reporte?.insumos || [], busqueda)

  return (
    <div>
      {/* noValidate: el aviso lo da validarRango (la regla completa del contrato,
          en español). `max` queda solo para el calendario. */}
      <form
        noValidate
        aria-label="Rango del reporte de consumo"
        onSubmit={(e) => {
          e.preventDefault()
          consultar(rango, idInsumo)
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="sd-input-label">DESDE</span>
          {/* El valor se lee ANTES del updater: dentro, React ya repuso el anterior. */}
          <input className="sd-input" type="date" value={rango.desde} max={hoy} onChange={(e) => { const desde = e.target.value; setRango((r) => ({ ...r, desde })) }} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="sd-input-label">HASTA</span>
          <input className="sd-input" type="date" value={rango.hasta} max={hoy} onChange={(e) => { const hasta = e.target.value; setRango((r) => ({ ...r, hasta })) }} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="sd-input-label">INSUMO</span>
          <select className="sd-input" value={idInsumo} onChange={(e) => setIdInsumo(e.target.value)}>
            <option value="">Todos los insumos</option>
            {insumos.map((i) => (
              <option key={i.id_insumo} value={i.id_insumo}>{i.nombre}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="sd-btn sd-btn-primary" disabled={cargando}>
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> <span>CONSULTAR</span>
        </button>
      </form>

      <div role="group" aria-label="Rangos rápidos" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {RANGOS_RAPIDOS.map((r) => (
          <button key={r.id} type="button" className="sd-btn sd-btn-secondary" onClick={() => elegirRapido(r.id)} disabled={cargando}>
            {r.etiqueta}
          </button>
        ))}
      </div>

      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--sd-text-muted)' }}>
        Días de Bogotá, {MAX_DIAS} como máximo. <strong>Consumo</strong>: lo usado en platos vendidos. <strong>Merma</strong>: las mermas manuales y lo de los
        platos cancelados cuando ya se cocinaban. <strong>Ajustes</strong> llevan su signo.
      </p>

      {error && (
        <div className="table-toast-banner error" role="alert" style={{ marginBottom: 16 }}>
          <span>{error}</span>
        </div>
      )}

      {cargando && !reporte && <p style={{ color: 'var(--sd-text-muted)' }}>Cargando reporte…</p>}

      {reporte && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p data-testid="rango-consumo" style={{ margin: 0 }}>
              Del <strong>{fechaCorta(reporte.desde)}</strong> al <strong>{fechaCorta(reporte.hasta)}</strong> · {reporte.insumos.length} insumo
              {reporte.insumos.length === 1 ? '' : 's'} con movimientos
            </p>
            <input className="sd-input" type="search" aria-label="Buscar insumo en el reporte" placeholder="Buscar insumo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260 }} />
          </div>

          {reporte.insumos.length === 0 ? (
            <p style={{ color: 'var(--sd-text-muted)' }}>No hubo movimientos de inventario en ese rango.</p>
          ) : visibles.length === 0 ? (
            <p style={{ color: 'var(--sd-text-muted)' }}>Ningún insumo del reporte coincide con la búsqueda.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sd-border)', fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>INSUMO</th>
                    {COLUMNAS.map((c) => (
                      <th key={c.id} style={celda}>{c.etiqueta}</th>
                    ))}
                    <th style={celda} aria-label="Detalle por día" />
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((i) => {
                    const abierto = abiertos.has(i.id_insumo)
                    const f = (v) => formatoCantidad(v, i.unidad)
                    return (
                      <Fragment key={i.id_insumo}>
                        <tr data-testid={`consumo-${i.id_insumo}`} style={{ borderBottom: '1px solid var(--sd-border)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 700 }}>{i.nombre}</td>
                          <td style={celda}>{f(i.total.consumo)}</td>
                          <td style={celda}>{f(i.total.merma)}</td>
                          <td style={celda}>{f(i.total.entradas)}</td>
                          <td style={celda}>{conSigno(i.total.ajustes, f)}</td>
                          <td style={celda}>
                            {i.dias.length > 0 && (
                              <button type="button" className="sd-btn sd-btn-secondary" style={{ minHeight: 30, fontSize: 12 }} aria-expanded={abierto} onClick={() => alternar(i.id_insumo)}>
                                {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                <span>{abierto ? 'Ocultar días' : `Ver días (${i.dias.length})`}</span>
                              </button>
                            )}
                          </td>
                        </tr>
                        {abierto &&
                          i.dias.map((d) => (
                            <tr key={`${i.id_insumo}-${d.fecha}`} data-testid={`consumo-${i.id_insumo}-${d.fecha}`} style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--sd-text-muted)' }}>
                              <td style={{ padding: '6px 12px 6px 28px' }}>{fechaCorta(d.fecha)}</td>
                              <td style={celda}>{f(d.consumo)}</td>
                              <td style={celda}>{f(d.merma)}</td>
                              <td style={celda}>{f(d.entradas)}</td>
                              <td style={celda}>{conSigno(d.ajustes, f)}</td>
                              <td />
                            </tr>
                          ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
