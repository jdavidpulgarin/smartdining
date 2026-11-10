import { useEffect, useState } from 'react'
import { platosApi, usuariosApi } from '../../services/api'
import { mensajeDeCarga } from '../../utils/configuracion'
import { fechaLegible } from '../../utils/configuracionRestaurante'
import { Ventana } from '../inventario/Ventana'

export const LIMITE_HISTORIAL = 50

const pesos = (valor) => `$${Number(valor).toLocaleString('es-CO')}`

/**
 * Quién cambió el precio de un plato y cuándo (P-21, P2), contra
 * GET /api/platos/:id/historial-precios. Lo más reciente primero.
 *
 * El contrato solo trae `id_usuario`: el nombre se resuelve con GET /usuarios
 * (las dos rutas son de admin). Si esa lista falla, el historial se muestra
 * igual con "Usuario N". Un `id_usuario` null es un cambio sin autor
 * registrado: anterior a D-16 B, hecho a mano en la base o de un usuario borrado.
 */
export function HistorialPrecios({ plato, onClose }) {
  const [historial, setHistorial] = useState(null)
  const [nombres, setNombres] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    platosApi
      .historialPrecios(plato.id, { limite: LIMITE_HISTORIAL })
      .then((data) => {
        if (vivo) setHistorial(data?.historial || [])
      })
      .catch((err) => {
        if (vivo) setError(mensajeDeCarga(err, 'No se pudo cargar el historial'))
      })
    usuariosApi
      .listar()
      .then((data) => {
        if (vivo) setNombres(Object.fromEntries((data?.usuarios || []).map((u) => [u.id_usuario, u.nombre])))
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [plato.id])

  const autor = (fila) => {
    if (fila.id_usuario === null || fila.id_usuario === undefined) return 'Sin registro'
    return nombres[fila.id_usuario] || `Usuario ${fila.id_usuario}`
  }

  return (
    <Ventana titulo={`Historial de precios · ${plato.name}`} onClose={onClose} ancho={760}>
      <p style={{ color: 'var(--sd-text-muted)', marginTop: 0 }}>
        Precio actual: <strong style={{ color: 'var(--sd-text)' }}>{pesos(plato.price)}</strong>. Los pedidos ya
        hechos conservan el precio que tenían.
      </p>
      {error && <p role="alert">No se pudo cargar el historial: {error}.</p>}
      {!error && historial === null && <p style={{ color: 'var(--sd-text-muted)' }}>Cargando historial…</p>}
      {historial && historial.length === 0 && (
        <p style={{ color: 'var(--sd-text-muted)' }}>Este plato no ha cambiado de precio.</p>
      )}
      {historial && historial.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>FECHA</th>
                  <th style={{ textAlign: 'right' }}>ANTES</th>
                  <th style={{ textAlign: 'right' }}>DESPUÉS</th>
                  <th style={{ textAlign: 'right' }}>CAMBIO</th>
                  <th>QUIÉN</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((fila) => {
                  const diferencia = Number(fila.precio_nuevo) - Number(fila.precio_anterior)
                  return (
                    <tr key={fila.id} data-testid={`cambio-precio-${fila.id}`}>
                      <td>{fechaLegible(fila.cambiado_en) || '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pesos(fila.precio_anterior)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{pesos(fila.precio_nuevo)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {diferencia > 0 ? '+' : diferencia < 0 ? '−' : ''}
                        {pesos(Math.abs(diferencia))}
                      </td>
                      <td>{autor(fila)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {historial.length === LIMITE_HISTORIAL && (
            <p style={{ color: 'var(--sd-text-muted)', marginBottom: 0 }}>
              Se muestran los últimos {LIMITE_HISTORIAL} cambios.
            </p>
          )}
        </>
      )}
    </Ventana>
  )
}
