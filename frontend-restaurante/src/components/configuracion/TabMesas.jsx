import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Power, RefreshCw } from 'lucide-react'
import { mesasApi, mensajeNoGuardado } from '../../services/api'
import { mensajeDeCarga } from './personal'

/** GET /mesas → lista ordenada por número. */
function ordenar(data) {
  const lista = Array.isArray(data) ? data : data?.mesas || []
  return [...lista].sort((a, b) => Number(a.numero) - Number(b.numero))
}

/**
 * Pestaña Mesas de Configuración (P-21): el mobiliario, no la operación del
 * salón (abrir, liberar y QR siguen en /mesas).
 *
 * - Crear: POST /api/mesas. Editar: PATCH /api/mesas/:id, solo con lo que
 *   cambió. Borrar: DELETE /api/mesas/:id.
 * - Los 409 del backend (número repetido, mesa ocupada, mesa con pedidos) se
 *   muestran con su texto, que ya dice qué pasa y qué hacer.
 * - Activar/Desactivar llega con D-16 parte B (`activa`). El botón solo aparece
 *   si GET /mesas trae ese campo: así no hay un botón que siempre falla mientras
 *   ese PR no esté en develop.
 */

const FORM_VACIO = { numero: '', capacidad: '4', ubicacion: '' }

function enteroPositivo(valor) {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Valida el formulario y devuelve { datos } o { error }. */
function leerFormulario(form) {
  const numero = enteroPositivo(form.numero)
  if (!numero) return { error: 'El número de mesa debe ser un entero mayor que 0.' }
  const capacidad = enteroPositivo(form.capacidad)
  if (!capacidad) return { error: 'La capacidad debe ser un entero mayor que 0.' }
  const ubicacion = form.ubicacion.trim()
  if (!ubicacion) return { error: 'Escribe la ubicación (por ejemplo, Terraza).' }
  if (ubicacion.length > 50) return { error: 'La ubicación admite hasta 50 caracteres.' }
  return { datos: { numero, capacidad, ubicacion } }
}

export function TabMesas() {
  const [mesas, setMesas] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [aviso, setAviso] = useState(null) // { tipo: 'ok' | 'error', texto }
  const [nueva, setNueva] = useState(FORM_VACIO)
  const [editando, setEditando] = useState(null) // { id, form }
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setMesas(ordenar(await mesasApi.listar()))
      setErrorCarga(null)
    } catch (err) {
      setErrorCarga(mensajeDeCarga(err, 'No se pudieron cargar las mesas'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Primera carga, con la misma guarda que Menú para no escribir estado si la
  // pestaña ya se cerró.
  useEffect(() => {
    let vivo = true
    mesasApi
      .listar()
      .then((data) => {
        if (vivo) setMesas(ordenar(data))
      })
      .catch((err) => {
        if (vivo) setErrorCarga(mensajeDeCarga(err, 'No se pudieron cargar las mesas'))
      })
      .finally(() => {
        if (vivo) setLoading(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  const ejecutar = async (accion, textoOk) => {
    setOcupado(true)
    setAviso(null)
    try {
      await accion()
      setAviso({ tipo: 'ok', texto: textoOk })
      await cargar()
      return true
    } catch (err) {
      setAviso({ tipo: 'error', texto: mensajeNoGuardado(err) })
      return false
    } finally {
      setOcupado(false)
    }
  }

  const crear = async (e) => {
    e.preventDefault()
    const { datos, error } = leerFormulario(nueva)
    if (error) return setAviso({ tipo: 'error', texto: error })
    const ok = await ejecutar(() => mesasApi.crear(datos), `Mesa ${datos.numero} creada.`)
    if (ok) setNueva(FORM_VACIO)
  }

  const guardarEdicion = async (mesa) => {
    const { datos, error } = leerFormulario(editando.form)
    if (error) return setAviso({ tipo: 'error', texto: error })
    // Solo lo que cambió: lo que no viene no se toca (COALESCE en el backend).
    const cambios = {}
    if (datos.numero !== Number(mesa.numero)) cambios.numero = datos.numero
    if (datos.capacidad !== Number(mesa.capacidad)) cambios.capacidad = datos.capacidad
    if (datos.ubicacion !== (mesa.ubicacion || '')) cambios.ubicacion = datos.ubicacion
    if (Object.keys(cambios).length === 0) {
      setEditando(null)
      return
    }
    const ok = await ejecutar(() => mesasApi.actualizarDatos(mesa.id_mesa, cambios), `Mesa ${datos.numero} actualizada.`)
    if (ok) setEditando(null)
  }

  const alternarActiva = (mesa) =>
    ejecutar(
      () => mesasApi.actualizarDatos(mesa.id_mesa, { activa: !mesa.activa }),
      mesa.activa ? `Mesa ${mesa.numero} desactivada.` : `Mesa ${mesa.numero} activada.`
    )

  const eliminar = (mesa) => {
    if (!window.confirm(`¿Borrar la mesa ${mesa.numero}? Esta acción no se puede deshacer.`)) return
    ejecutar(() => mesasApi.eliminar(mesa.id_mesa), `Mesa ${mesa.numero} borrada.`)
  }

  const conActiva = mesas.some((m) => typeof m.activa === 'boolean')

  if (loading) {
    return <p style={{ color: 'var(--sd-text-muted)' }}>Cargando mesas…</p>
  }

  if (errorCarga) {
    return (
      <div className="sd-card" style={{ textAlign: 'center', padding: 32 }}>
        <p role="alert" style={{ color: 'var(--sd-text)' }}>No se pudieron cargar las mesas: {errorCarga}.</p>
        <button type="button" className="sd-btn sd-btn-primary" onClick={() => { setLoading(true); cargar() }} style={{ margin: '12px auto 0' }}>
          <RefreshCw size={14} /> <span>REINTENTAR</span>
        </button>
      </div>
    )
  }

  return (
    <div className="sd-config-tab">
      {aviso && (
        <div className={`table-toast-banner ${aviso.tipo === 'error' ? 'error' : 'success'}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ marginBottom: 16 }}>
          <span>{aviso.texto}</span>
        </div>
      )}

      <form className="sd-card" onSubmit={crear} aria-label="Nueva mesa" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
        <label className="sd-input-label">
          NÚMERO
          <input className="sd-input" type="number" min="1" value={nueva.numero} onChange={(e) => setNueva({ ...nueva, numero: e.target.value })} />
        </label>
        <label className="sd-input-label">
          CAPACIDAD
          <input className="sd-input" type="number" min="1" value={nueva.capacidad} onChange={(e) => setNueva({ ...nueva, capacidad: e.target.value })} />
        </label>
        <label className="sd-input-label" style={{ flex: '1 1 180px' }}>
          UBICACIÓN
          <input className="sd-input" maxLength={50} value={nueva.ubicacion} onChange={(e) => setNueva({ ...nueva, ubicacion: e.target.value })} />
        </label>
        <button type="submit" className="sd-btn sd-btn-primary" disabled={ocupado}>
          <Plus size={14} /> <span>CREAR MESA</span>
        </button>
      </form>

      {mesas.length === 0 ? (
        <p style={{ color: 'var(--sd-text-muted)' }}>Todavía no hay mesas registradas.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>NÚMERO</th>
                <th>CAPACIDAD</th>
                <th>UBICACIÓN</th>
                <th>ESTADO</th>
                {conActiva && <th>ACTIVA</th>}
                <th style={{ textAlign: 'right' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {mesas.map((mesa) => {
                const enEdicion = editando?.id === mesa.id_mesa
                const f = editando?.form
                return (
                  <tr key={mesa.id_mesa} data-testid={`mesa-${mesa.numero}`}>
                    <td>
                      {enEdicion ? (
                        <input className="sd-input" type="number" min="1" aria-label="Número" value={f.numero} onChange={(e) => setEditando({ ...editando, form: { ...f, numero: e.target.value } })} />
                      ) : (
                        mesa.numero
                      )}
                    </td>
                    <td>
                      {enEdicion ? (
                        <input className="sd-input" type="number" min="1" aria-label="Capacidad" value={f.capacidad} onChange={(e) => setEditando({ ...editando, form: { ...f, capacidad: e.target.value } })} />
                      ) : (
                        mesa.capacidad
                      )}
                    </td>
                    <td>
                      {enEdicion ? (
                        <input className="sd-input" maxLength={50} aria-label="Ubicación" value={f.ubicacion} onChange={(e) => setEditando({ ...editando, form: { ...f, ubicacion: e.target.value } })} />
                      ) : (
                        mesa.ubicacion || '—'
                      )}
                    </td>
                    <td>{mesa.estado}</td>
                    {conActiva && <td>{mesa.activa === false ? 'No' : 'Sí'}</td>}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {enEdicion ? (
                        <>
                          <button type="button" className="sd-btn sd-btn-primary" disabled={ocupado} onClick={() => guardarEdicion(mesa)}>GUARDAR</button>{' '}
                          <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setEditando(null)}>CANCELAR</button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="sd-topbar-icon-btn"
                            title={`Editar mesa ${mesa.numero}`}
                            onClick={() =>
                              setEditando({
                                id: mesa.id_mesa,
                                form: { numero: String(mesa.numero), capacidad: String(mesa.capacidad ?? ''), ubicacion: mesa.ubicacion || '' },
                              })
                            }
                          >
                            <Pencil size={16} />
                          </button>
                          {typeof mesa.activa === 'boolean' && (
                            <button
                              type="button"
                              className="sd-topbar-icon-btn"
                              title={mesa.activa ? `Desactivar mesa ${mesa.numero}` : `Activar mesa ${mesa.numero}`}
                              disabled={ocupado}
                              onClick={() => alternarActiva(mesa)}
                            >
                              <Power size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="sd-topbar-icon-btn"
                            title={`Borrar mesa ${mesa.numero}`}
                            disabled={ocupado}
                            onClick={() => eliminar(mesa)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
