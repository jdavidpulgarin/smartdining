import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Bike } from 'lucide-react'
import { domiciliosApi, pedidosApi } from '../services/api'
import { useAuth } from '../hooks'
import {
  ESTADOS_SIN_TERMINAR,
  ESTADOS_TERMINADOS,
  etiquetaEntrega,
  etiquetaCocina,
  mensajeErrorDomicilio,
  puedeAsignar,
  puedeCancelarFallido,
} from '../utils/domicilios'

export const SEGUNDOS_RELECTURA = 15

const FILTROS = [
  { clave: 'pendientes', etiqueta: 'PENDIENTES', estados: ESTADOS_SIN_TERMINAR },
  { clave: 'por_asignar', etiqueta: 'POR ASIGNAR', estados: ['por_asignar'] },
  { clave: 'en_camino', etiqueta: 'EN CAMINO', estados: ['en_camino'] },
  { clave: 'terminados', etiqueta: 'TERMINADOS', estados: ESTADOS_TERMINADOS },
]

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : null)

/**
 * P-24 · Despacho de domicilios (admin y cajero): ver los domicilios por estado
 * de la entrega, asignar o cambiar el repartidor mientras no haya salido y, si
 * una entrega quedó fallida, que el admin cancele el pedido (es final).
 */
export function Despacho() {
  const { user } = useAuth()
  const [filtro, setFiltro] = useState(FILTROS[0])
  const [domicilios, setDomicilios] = useState([])
  const [repartidores, setRepartidores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [ocupado, setOcupado] = useState(null)

  const leer = useCallback(() => {
    return Promise.all([domiciliosApi.despacho(filtro.estados), domiciliosApi.repartidores()])
      .then(([d, r]) => {
        setDomicilios(d?.domicilios || [])
        setRepartidores(r?.repartidores || [])
        setError(null)
      })
      .catch((err) => setError(mensajeErrorDomicilio(err)))
      .finally(() => setCargando(false))
  }, [filtro])

  useEffect(() => {
    leer()
    const t = setInterval(() => {
      if (!document.hidden) leer()
    }, SEGUNDOS_RELECTURA * 1000)
    return () => clearInterval(t)
  }, [leer])

  const asignar = async (d, idRepartidor) => {
    if (!idRepartidor) return
    setOcupado(d.pedido.id_pedido)
    setAviso(null)
    try {
      await domiciliosApi.asignar(d.pedido.id_pedido, idRepartidor)
      const nombre = repartidores.find((r) => String(r.id_usuario) === String(idRepartidor))?.nombre
      setAviso({ ok: true, texto: `Pedido ${d.pedido.codigo_pedido} asignado a ${nombre || 'el repartidor'}.` })
    } catch (err) {
      setAviso({ ok: false, texto: mensajeErrorDomicilio(err) })
    } finally {
      setOcupado(null)
      leer()
    }
  }

  const cancelarFallido = async (d) => {
    setOcupado(d.pedido.id_pedido)
    setAviso(null)
    try {
      await pedidosApi.cancelar(d.pedido.id_pedido, `Entrega fallida: ${d.motivo_fallo || 'sin motivo'}`)
      setAviso({ ok: true, texto: `Pedido ${d.pedido.codigo_pedido} cancelado. El reembolso se hace aparte.` })
    } catch (err) {
      setAviso({ ok: false, texto: mensajeErrorDomicilio(err) })
    } finally {
      setOcupado(null)
      leer()
    }
  }

  return (
    <div className="sd-page-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="sd-page-title" style={{ margin: 0 }}>DESPACHO</h1>
          <p style={{ margin: 0, color: 'var(--sd-text-muted)' }}>Domicilios pagados: asigna el repartidor y sigue la entrega.</p>
        </div>
        <button type="button" className="sd-btn sd-btn-secondary" onClick={() => leer()} disabled={cargando}>
          <RefreshCw size={16} /> <span>ACTUALIZAR</span>
        </button>
      </div>

      <div role="tablist" aria-label="Estado de la entrega" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        {FILTROS.map((f) => (
          <button key={f.clave} type="button" role="tab" aria-selected={filtro.clave === f.clave}
            className={`sd-red-band-btn ${filtro.clave === f.clave ? 'active' : ''}`} onClick={() => { setCargando(true); setFiltro(f) }}>
            {f.etiqueta}
          </button>
        ))}
      </div>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} style={{ color: aviso.ok ? 'var(--sd-green, #4caf50)' : 'var(--sd-red)', fontWeight: 600 }}>{aviso.texto}</p>
      )}
      {error && <p role="alert" style={{ color: 'var(--sd-red)' }}>{error}</p>}
      {!cargando && !error && domicilios.length === 0 && (
        <div className="sd-card sd-empty-box"><Bike size={40} /><p style={{ margin: 0 }}>No hay domicilios en este estado.</p></div>
      )}
      {!cargando && repartidores.length === 0 && filtro.clave !== 'terminados' && (
        <p style={{ color: 'var(--sd-gold, #e0a526)' }}>No hay repartidores activos. Créalos en Configuración con el rol «repartidor».</p>
      )}

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {domicilios.map((d) => {
          const id = d.pedido.id_pedido
          return (
            <article key={id} className="sd-card" data-testid={`despacho-${id}`} style={{ padding: 16, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>Pedido {d.pedido.codigo_pedido}</strong>
                <span className="sd-badge">{etiquetaEntrega(d.estado_entrega)}</span>
              </div>
              <span>{d.direccion?.direccion} — <strong>{d.direccion?.barrio}</strong></span>
              <small style={{ color: 'var(--sd-text-muted)' }}>
                Zona {d.zona?.nombre} · envío {pesos(d.costo_envio)} · total {pesos(d.pedido.total)}
              </small>
              <small>{d.cliente?.nombre || 'Cliente'}{d.cliente?.telefono ? ` · ${d.cliente.telefono}` : ''}</small>
              <small>Cocina: <strong>{etiquetaCocina(d.pedido.estado)}</strong>
                {hora(d.tiempos?.en_camino_en) && ` · salió ${hora(d.tiempos.en_camino_en)}`}
                {hora(d.tiempos?.entregado_en) && ` · entregado ${hora(d.tiempos.entregado_en)}`}
              </small>

              {puedeAsignar(d) ? (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span className="sd-input-label">REPARTIDOR</span>
                  <select className="sd-input" aria-label={`Repartidor del pedido ${d.pedido.codigo_pedido}`}
                    value={d.repartidor?.id_usuario ?? ''} disabled={ocupado === id || repartidores.length === 0}
                    onChange={(ev) => asignar(d, ev.target.value)}>
                    <option value="" disabled>Elige un repartidor</option>
                    {repartidores.map((r) => <option key={r.id_usuario} value={r.id_usuario}>{r.nombre}</option>)}
                  </select>
                </label>
              ) : (
                <span>Repartidor: <strong>{d.repartidor?.nombre || '—'}</strong></span>
              )}

              {d.estado_entrega === 'fallido' && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span style={{ color: 'var(--sd-red)' }}>No se entregó: {d.motivo_fallo}</span>
                  {puedeCancelarFallido(d, user?.rol) ? (
                    <button type="button" className="sd-btn sd-btn-secondary" disabled={ocupado === id} onClick={() => cancelarFallido(d)}>
                      CANCELAR PEDIDO
                    </button>
                  ) : d.pedido.estado === 'listo' && (
                    <small style={{ color: 'var(--sd-text-muted)' }}>Solo el administrador puede cancelarlo.</small>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
