import { useState, useEffect, useCallback } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { configuracionApi, usuariosApi, mensajeNoGuardado } from '../../services/api'
import { mensajeDeCarga } from '../../utils/configuracion'
import {
  DIAS,
  LIMITES,
  formDesdeConfig,
  validarConfig,
  cambiosDeConfig,
  cruzaMedianoche,
  fechaLegible,
} from '../../utils/configuracionRestaurante'

/**
 * Pestaña Restaurante de Configuración (P-21, P2), contra D-16 parte B:
 * - Carga: GET /api/configuracion/completa (admin).
 * - Guardar: PUT /api/configuracion con SOLO lo que cambió (parcial, .strict()).
 *
 * La respuesta del PUT es la fila completa ya guardada: pasa a ser el nuevo
 * "original", así el siguiente guardado compara contra lo que de verdad quedó.
 * Quién guardó por última vez sale de `actualizado_por` (lo pone el trigger a
 * partir del JWT); el nombre se busca en la lista del personal y, si esa
 * lista no carga, simplemente no se muestra.
 */
export function TabRestaurante() {
  const [original, setOriginal] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [nombres, setNombres] = useState({})

  const aplicar = (config) => {
    setOriginal(config)
    setForm(formDesdeConfig(config))
  }

  const cargar = useCallback(async () => {
    try {
      const config = await configuracionApi.obtenerCompleta()
      setOriginal(config)
      setForm(formDesdeConfig(config))
      setErrorCarga(null)
    } catch (err) {
      setErrorCarga(mensajeDeCarga(err, 'No se pudieron cargar los datos del restaurante'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Primera carga, con la misma guarda que las otras pestañas.
  useEffect(() => {
    let vivo = true
    configuracionApi
      .obtenerCompleta()
      .then((config) => {
        if (!vivo) return
        setOriginal(config)
        setForm(formDesdeConfig(config))
      })
      .catch((err) => {
        if (vivo) setErrorCarga(mensajeDeCarga(err, 'No se pudieron cargar los datos del restaurante'))
      })
      .finally(() => {
        if (vivo) setLoading(false)
      })
    // Solo para mostrar el nombre de quien guardó; si falla, no pasa nada.
    usuariosApi
      .listar()
      .then((data) => {
        if (vivo) setNombres(Object.fromEntries((data?.usuarios || []).map((u) => [u.id_usuario, u.nombre])))
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }))
  const cambiarDia = (clave, cambios) =>
    setForm((f) => ({ ...f, horario: { ...f.horario, [clave]: { ...f.horario[clave], ...cambios } } }))

  const guardar = async (e) => {
    e.preventDefault()
    setAviso(null)
    const { datos, error } = validarConfig(form)
    if (error) return setAviso({ tipo: 'error', texto: error })
    const cambios = cambiosDeConfig(original, datos)
    if (Object.keys(cambios).length === 0) return setAviso({ tipo: 'ok', texto: 'No hay cambios que guardar.' })

    setGuardando(true)
    try {
      const guardada = await configuracionApi.actualizar(cambios)
      aplicar(guardada)
      setAviso({ tipo: 'ok', texto: 'Datos del restaurante guardados.' })
    } catch (err) {
      setAviso({ tipo: 'error', texto: mensajeNoGuardado(err) })
    } finally {
      setGuardando(false)
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--sd-text-muted)' }}>Cargando datos del restaurante…</p>
  }

  if (errorCarga) {
    return (
      <div className="sd-card" style={{ textAlign: 'center', padding: 32 }}>
        <p role="alert" style={{ color: 'var(--sd-text)' }}>No se pudieron cargar los datos del restaurante: {errorCarga}.</p>
        <button type="button" className="sd-btn sd-btn-primary" onClick={() => { setLoading(true); cargar() }} style={{ margin: '12px auto 0' }}>
          <RefreshCw size={14} /> <span>REINTENTAR</span>
        </button>
      </div>
    )
  }

  const ultima = fechaLegible(original?.actualizado_en)
  const autor = original?.actualizado_por ? nombres[original.actualizado_por] : null

  return (
    <form className="sd-config-tab" onSubmit={guardar} aria-label="Datos del restaurante" noValidate>
      {aviso && (
        <div className={`table-toast-banner ${aviso.tipo === 'error' ? 'error' : 'success'}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ marginBottom: 16 }}>
          <span>{aviso.texto}</span>
        </div>
      )}

      <div className="sd-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <label className="sd-input-label" style={{ flex: '1 1 240px' }}>
          NOMBRE
          <input className="sd-input" maxLength={LIMITES.nombre} value={form.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />
        </label>
        <label className="sd-input-label" style={{ flex: '1 1 160px' }}>
          TELÉFONO
          <input className="sd-input" type="tel" maxLength={LIMITES.telefono} value={form.telefono} onChange={(e) => cambiar('telefono', e.target.value)} />
        </label>
        <label className="sd-input-label" style={{ flex: '1 1 320px' }}>
          DIRECCIÓN
          <input className="sd-input" maxLength={LIMITES.direccion} value={form.direccion} onChange={(e) => cambiar('direccion', e.target.value)} />
        </label>
        <label className="sd-input-label" style={{ flex: '1 1 320px' }}>
          URL DEL LOGO
          <input className="sd-input" type="url" maxLength={LIMITES.url_logo} placeholder="https://…" value={form.url_logo} onChange={(e) => cambiar('url_logo', e.target.value)} />
        </label>
        <label className="sd-input-label" style={{ flex: '0 1 140px' }}>
          PROPINA SUGERIDA (%)
          <input className="sd-input" inputMode="decimal" value={form.propina_sugerida_pct} onChange={(e) => cambiar('propina_sugerida_pct', e.target.value)} />
        </label>
        <label className="sd-input-label" style={{ flex: '0 1 110px' }}>
          MONEDA
          <input className="sd-input" maxLength={3} value={form.moneda} onChange={(e) => cambiar('moneda', e.target.value.toUpperCase())} />
        </label>
      </div>

      <fieldset className="sd-card" style={{ marginBottom: 20, border: '1px solid var(--sd-border)' }}>
        <legend className="sd-input-label" style={{ padding: '0 6px' }}>HORARIO</legend>
        <p style={{ color: 'var(--sd-text-muted)', margin: '0 0 12px' }}>Un día sin marcar sale como cerrado.</p>
        <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <tbody>
            {DIAS.map(({ clave, etiqueta }) => {
              const dia = form.horario[clave]
              return (
                <tr key={clave}>
                  <td>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={dia.abierto} onChange={(e) => cambiarDia(clave, { abierto: e.target.checked })} />
                      {etiqueta}
                    </label>
                  </td>
                  <td>
                    {dia.abierto ? (
                      <>
                        <input className="sd-input" type="time" aria-label={`Abre el ${etiqueta}`} value={dia.abre} onChange={(e) => cambiarDia(clave, { abre: e.target.value })} style={{ width: 130, display: 'inline-block' }} />
                        {' a '}
                        <input className="sd-input" type="time" aria-label={`Cierra el ${etiqueta}`} value={dia.cierra} onChange={(e) => cambiarDia(clave, { cierra: e.target.value })} style={{ width: 130, display: 'inline-block' }} />
                        {cruzaMedianoche(dia) && <span style={{ color: 'var(--sd-text-muted)', marginLeft: 8 }}>cierra al día siguiente</span>}
                      </>
                    ) : (
                      <span style={{ color: 'var(--sd-text-muted)' }}>Cerrado</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </fieldset>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button type="submit" className="sd-btn sd-btn-primary" disabled={guardando}>
          <Save size={14} /> <span>{guardando ? 'GUARDANDO…' : 'GUARDAR CAMBIOS'}</span>
        </button>
        {ultima && (
          <span style={{ color: 'var(--sd-text-muted)' }}>
            Última actualización: {ultima}
            {autor ? ` · por ${autor}` : ''}
          </span>
        )}
      </div>
    </form>
  )
}
