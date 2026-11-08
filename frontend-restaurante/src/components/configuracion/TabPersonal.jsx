import { useState, useEffect, useCallback } from 'react'
import { UserPlus, KeyRound, RefreshCw } from 'lucide-react'
import { usuariosApi, mensajeNoGuardado } from '../../services/api'
import { useAuth } from '../../hooks'
import { ROLES, etiquetaDeRol, errorDeClave, validarNuevoUsuario, mensajeDeCarga } from '../../utils/configuracion'

/**
 * Pestaña Personal de Configuración (P-21), contra D-16 parte A:
 * - Lista: GET /api/usuarios. Alta: POST /api/auth/register.
 * - Cambiar rol y activar/desactivar: PATCH /api/usuarios/:id (solo el campo
 *   que cambia; el cuerpo es .strict()).
 * - Restablecer clave: POST /api/usuarios/:id/clave.
 *
 * Sobre uno mismo: el backend responde 409 si un admin se desactiva o se cambia
 * el rol. Aquí esos controles ni se ofrecen en la fila propia, para que nadie
 * se encuentre el error; el 409 queda como respaldo. Cambiarse la clave sí.
 */

const FORM_VACIO = { nombre: '', email: '', password: '', rol: 'mesero' }

export function TabPersonal() {
  const { user } = useAuth()
  const miId = Number(user?.id_usuario)

  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [nuevo, setNuevo] = useState(FORM_VACIO)
  const [claveDe, setClaveDe] = useState(null) // { id, valor }
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const data = await usuariosApi.listar()
      setUsuarios(data?.usuarios || [])
      setErrorCarga(null)
    } catch (err) {
      setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar el personal'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Primera carga, con la misma guarda que Menú para no escribir estado si la
  // pestaña ya se cerró.
  useEffect(() => {
    let vivo = true
    usuariosApi
      .listar()
      .then((data) => {
        if (vivo) setUsuarios(data?.usuarios || [])
      })
      .catch((err) => {
        if (vivo) setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar el personal'))
      })
      .finally(() => {
        if (vivo) setLoading(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  const ejecutar = async (accion, textoOk, { recargar = true } = {}) => {
    setOcupado(true)
    setAviso(null)
    try {
      await accion()
      setAviso({ tipo: 'ok', texto: textoOk })
      if (recargar) await cargar()
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
    const { datos, error } = validarNuevoUsuario(nuevo)
    if (error) return setAviso({ tipo: 'error', texto: error })
    const ok = await ejecutar(() => usuariosApi.crear(datos), `${datos.nombre} ya puede entrar al panel.`)
    if (ok) setNuevo(FORM_VACIO)
  }

  const cambiarRol = (u, rol) => {
    if (rol === u.rol) return
    ejecutar(() => usuariosApi.actualizar(u.id_usuario, { rol }), `${u.nombre} ahora es ${etiquetaDeRol(rol)}.`)
  }

  const alternarActivo = (u) => {
    if (u.activo && !window.confirm(`¿Desactivar a ${u.nombre}? No podrá volver a entrar hasta que lo actives.`)) return
    ejecutar(
      () => usuariosApi.actualizar(u.id_usuario, { activo: !u.activo }),
      u.activo ? `${u.nombre} quedó desactivado.` : `${u.nombre} quedó activo.`
    )
  }

  const guardarClave = async (u) => {
    const errClave = errorDeClave(claveDe.valor)
    if (errClave) return setAviso({ tipo: 'error', texto: errClave })
    // La clave no se vuelve a pintar en ningún lado: se limpia el campo siempre.
    const ok = await ejecutar(() => usuariosApi.cambiarClave(u.id_usuario, claveDe.valor), `Clave de ${u.nombre} restablecida.`, { recargar: false })
    if (ok) setClaveDe(null)
  }

  if (loading) {
    return <p style={{ color: 'var(--sd-text-muted)' }}>Cargando personal…</p>
  }

  if (errorCarga) {
    return (
      <div className="sd-card" style={{ textAlign: 'center', padding: 32 }}>
        <p role="alert" style={{ color: 'var(--sd-text)' }}>No se pudo cargar el personal: {errorCarga}.</p>
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

      <form className="sd-card" onSubmit={crear} aria-label="Nuevo usuario" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
        <label className="sd-input-label" style={{ flex: '1 1 160px' }}>
          NOMBRE
          <input className="sd-input" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </label>
        <label className="sd-input-label" style={{ flex: '1 1 200px' }}>
          EMAIL
          <input className="sd-input" type="email" autoComplete="off" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
        </label>
        <label className="sd-input-label" style={{ flex: '1 1 160px' }}>
          CLAVE INICIAL
          <input className="sd-input" type="password" autoComplete="new-password" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} />
        </label>
        <label className="sd-input-label">
          ROL
          <select className="sd-input" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="sd-btn sd-btn-primary" disabled={ocupado}>
          <UserPlus size={14} /> <span>CREAR USUARIO</span>
        </button>
      </form>

      {usuarios.length === 0 ? (
        <p style={{ color: 'var(--sd-text-muted)' }}>No hay personal registrado.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>NOMBRE</th>
                <th>EMAIL</th>
                <th>ROL</th>
                <th>ESTADO</th>
                <th style={{ textAlign: 'right' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const soyYo = Number(u.id_usuario) === miId
                return (
                  <tr key={u.id_usuario} data-testid={`usuario-${u.id_usuario}`}>
                    <td>
                      {u.nombre}
                      {soyYo && <span style={{ color: 'var(--sd-text-muted)' }}> (tú)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {soyYo ? (
                        etiquetaDeRol(u.rol)
                      ) : (
                        <select className="sd-input" aria-label={`Rol de ${u.nombre}`} value={u.rol} disabled={ocupado} onChange={(e) => cambiarRol(u, e.target.value)}>
                          {ROLES.map((r) => (
                            <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {claveDe?.id === u.id_usuario ? (
                        <>
                          <input
                            className="sd-input"
                            type="password"
                            autoComplete="new-password"
                            aria-label={`Clave nueva de ${u.nombre}`}
                            value={claveDe.valor}
                            onChange={(e) => setClaveDe({ ...claveDe, valor: e.target.value })}
                            style={{ width: 160, display: 'inline-block' }}
                          />{' '}
                          <button type="button" className="sd-btn sd-btn-primary" disabled={ocupado} onClick={() => guardarClave(u)}>GUARDAR</button>{' '}
                          <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setClaveDe(null)}>CANCELAR</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setClaveDe({ id: u.id_usuario, valor: '' })}>
                            <KeyRound size={14} /> <span>RESTABLECER CLAVE</span>
                          </button>{' '}
                          {!soyYo && (
                            <button type="button" className="sd-btn sd-btn-secondary" disabled={ocupado} onClick={() => alternarActivo(u)}>
                              {u.activo ? 'DESACTIVAR' : 'ACTIVAR'}
                            </button>
                          )}
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
