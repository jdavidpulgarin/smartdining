import { useCallback, useEffect, useState } from 'react'
import { Bike, MapPin, Phone, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { domiciliosApi } from '../services/api'
import {
  accionesRepartidor,
  etiquetaEntrega,
  etiquetaCocina,
  mensajeErrorDomicilio,
  validarMotivoFallo,
  MAX_MOTIVO_FALLO,
  ESTADOS_TERMINADOS,
} from '../utils/domicilios'

/** Cada cuánto se relee la lista (los avisos en vivo de domicilios llegan con la R-23). */
export const SEGUNDOS_RELECTURA = 15

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`

/**
 * P-24 · Pantalla del repartidor: SOLO sus entregas (GET /domicilios/mios).
 * Salir (con el pedido listo en cocina), entregado o no se pudo entregar (con
 * motivo). Es lo único que ve este rol en el panel.
 */
export function Entregas() {
  const [entregas, setEntregas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const [fallando, setFallando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState(null)

  const leer = useCallback(() => {
    return domiciliosApi
      .mios()
      .then((r) => {
        setEntregas(r?.domicilios || [])
        setError(null)
      })
      .catch((err) => setError(mensajeErrorDomicilio(err)))
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    leer()
    const t = setInterval(() => {
      if (!document.hidden) leer()
    }, SEGUNDOS_RELECTURA * 1000)
    return () => clearInterval(t)
  }, [leer])

  const hacer = async (entrega, accion, texto) => {
    const id = entrega.pedido.id_pedido
    setOcupado(id)
    setAviso(null)
    try {
      if (accion === 'fallar') await domiciliosApi.fallar(id, motivo)
      else await domiciliosApi[accion](id)
      setAviso({ ok: true, texto })
      setFallando(null)
      setMotivo('')
    } catch (err) {
      setAviso({ ok: false, texto: mensajeErrorDomicilio(err) })
    } finally {
      setOcupado(null)
      leer()
    }
  }

  const confirmarFallo = (entrega) => {
    const m = validarMotivoFallo(motivo)
    setErrorMotivo(m)
    if (!m) hacer(entrega, 'fallar', `Pedido ${entrega.pedido.codigo_pedido}: marcado como no entregado.`)
  }

  const pendientes = entregas.filter((e) => !ESTADOS_TERMINADOS.includes(e.estado_entrega))
  const terminadas = entregas.filter((e) => ESTADOS_TERMINADOS.includes(e.estado_entrega))

  return (
    <div className="sd-page-container" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="sd-page-title" style={{ margin: 0 }}>MIS ENTREGAS</h1>
        <button type="button" className="sd-btn sd-btn-secondary" onClick={() => leer()} disabled={cargando}>
          <RefreshCw size={16} /> <span>ACTUALIZAR</span>
        </button>
      </div>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} style={{ color: aviso.ok ? 'var(--sd-green, #4caf50)' : 'var(--sd-red)', fontWeight: 600 }}>
          {aviso.texto}
        </p>
      )}
      {error && <p role="alert" style={{ color: 'var(--sd-red)' }}>{error}</p>}
      {cargando && <p>Cargando tus entregas…</p>}
      {!cargando && !error && pendientes.length === 0 && (
        <div className="sd-card sd-empty-box" style={{ marginTop: 16 }}>
          <Bike size={40} />
          <p style={{ margin: 0 }}>No tienes entregas pendientes. Te aparecen aquí cuando caja te asigne una.</p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
        {pendientes.map((e) => {
          const a = accionesRepartidor(e)
          const id = e.pedido.id_pedido
          const telefono = e.direccion?.telefono_contacto || e.cliente?.telefono
          return (
            <article key={id} className="sd-card" data-testid={`entrega-${id}`} style={{ padding: 16, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 18 }}>Pedido {e.pedido.codigo_pedido}</strong>
                <span className="sd-badge">{etiquetaEntrega(e.estado_entrega)}</span>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <span><MapPin size={14} /> {e.direccion?.direccion} — <strong>{e.direccion?.barrio}</strong></span>
                {e.direccion?.referencia && <small style={{ color: 'var(--sd-text-muted)' }}>{e.direccion.referencia}</small>}
                <span>{e.cliente?.nombre || 'Cliente'}{telefono && <> · <a href={`tel:${telefono}`}><Phone size={14} /> {telefono}</a></>}</span>
                <small style={{ color: 'var(--sd-text-muted)' }}>
                  Zona {e.zona?.nombre} · Total {pesos(e.pedido.total)} (ya pagado) · Cocina: {etiquetaCocina(e.pedido.estado)}
                </small>
              </div>

              {a.esperandoCocina && <p style={{ margin: 0, color: 'var(--sd-gold, #e0a526)' }}>Espera a que cocina lo tenga listo para salir.</p>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(a.salir || a.esperandoCocina) && (
                  <button type="button" className="sd-btn sd-btn-primary" style={{ minHeight: 48, flex: 1 }} disabled={!a.salir || ocupado === id}
                    onClick={() => hacer(e, 'salir', `Pedido ${e.pedido.codigo_pedido}: saliste a entregarlo.`)}>
                    <Bike size={18} /> <span>SALIR A ENTREGAR</span>
                  </button>
                )}
                {a.entregar && (
                  <button type="button" className="sd-btn sd-btn-primary" style={{ minHeight: 48, flex: 1 }} disabled={ocupado === id}
                    onClick={() => hacer(e, 'entregar', `Pedido ${e.pedido.codigo_pedido}: entregado.`)}>
                    <CheckCircle2 size={18} /> <span>ENTREGADO</span>
                  </button>
                )}
                {a.fallar && fallando !== id && (
                  <button type="button" className="sd-btn sd-btn-secondary" style={{ minHeight: 48, flex: 1 }} disabled={ocupado === id}
                    onClick={() => { setFallando(id); setMotivo(''); setErrorMotivo(null) }}>
                    <XCircle size={18} /> <span>NO SE PUDO ENTREGAR</span>
                  </button>
                )}
              </div>
              {fallando === id && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label className="sd-input-label" htmlFor={`motivo-${id}`}>¿POR QUÉ NO SE PUDO ENTREGAR?</label>
                  <textarea id={`motivo-${id}`} className="sd-input" rows={2} maxLength={MAX_MOTIVO_FALLO} value={motivo}
                    onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ej: nadie abrió en la portería" />
                  {errorMotivo && <span role="alert" style={{ color: 'var(--sd-red)', fontSize: 13 }}>{errorMotivo}</span>}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setFallando(null)}>VOLVER</button>
                    <button type="button" className="sd-btn sd-btn-primary" disabled={ocupado === id} onClick={() => confirmarFallo(e)}>CONFIRMAR</button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {terminadas.length > 0 && (
        <>
          <h2 className="sd-card-title" style={{ marginTop: 28 }}>TERMINADAS HOY</h2>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
            {terminadas.map((e) => (
              <li key={e.pedido.id_pedido} className="sd-card" style={{ padding: '10px 14px' }}>
                Pedido {e.pedido.codigo_pedido} · {e.direccion?.barrio} · <strong>{etiquetaEntrega(e.estado_entrega)}</strong>
                {e.motivo_fallo && <small style={{ display: 'block', color: 'var(--sd-text-muted)' }}>{e.motivo_fallo}</small>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
