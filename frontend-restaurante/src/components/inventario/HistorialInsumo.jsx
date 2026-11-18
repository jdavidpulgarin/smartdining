import { useEffect, useState } from 'react'
import { inventarioApi } from '../../services/api'
import { mensajeDeCarga } from '../../utils/configuracion'
import { ETIQUETA_MOVIMIENTO, formatoCantidad, notaDeMovimiento } from '../../utils/inventario'
import { fechaLegible } from '../../utils/configuracionRestaurante'
import { Ventana } from './Ventana'

const LIMITE = 50

/**
 * El libro del insumo (GET /api/inventario/insumos/:id/movimientos), lo más
 * reciente primero. Salen todos los tipos, también los que escribe la base al
 * pedir y al cancelar: sin ellos no cuadraría con el stock.
 *
 * El contrato no trae el nombre del usuario (solo `id_usuario`): se resuelve con
 * la lista del personal que ya cargó la pantalla. Un `id_usuario` null es una
 * reserva hecha por un comensal desde su teléfono.
 */
export function HistorialInsumo({ insumo, nombres = {}, onClose }) {
  const [movimientos, setMovimientos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    inventarioApi
      .movimientos(insumo.id_insumo, { limite: LIMITE })
      .then((data) => {
        if (vivo) setMovimientos(data?.movimientos || [])
      })
      .catch((err) => {
        if (vivo) setError(mensajeDeCarga(err, 'No se pudo cargar el historial'))
      })
    return () => {
      vivo = false
    }
  }, [insumo.id_insumo])

  const autor = (mov) => {
    if (mov.id_usuario === null || mov.id_usuario === undefined) return mov.id_detalle ? 'Pedido' : '—'
    return nombres[mov.id_usuario] || `Usuario ${mov.id_usuario}`
  }

  return (
    <Ventana titulo={`Historial · ${insumo.nombre}`} onClose={onClose} ancho={900}>
      {error && <p role="alert">No se pudo cargar el historial: {error}.</p>}
      {!error && movimientos === null && <p style={{ color: 'var(--sd-text-muted)' }}>Cargando historial…</p>}
      {movimientos && movimientos.length === 0 && <p style={{ color: 'var(--sd-text-muted)' }}>Este insumo todavía no tiene movimientos.</p>}
      {movimientos && movimientos.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>FECHA</th>
                  <th>TIPO</th>
                  <th style={{ textAlign: 'right' }}>CANTIDAD</th>
                  <th style={{ textAlign: 'right' }}>QUEDÓ EN</th>
                  <th>QUIÉN</th>
                  <th>MOTIVO</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((mov) => {
                  const cantidad = Number(mov.cantidad)
                  return (
                    <tr key={mov.id} data-testid={`movimiento-${mov.id}`}>
                      <td>{fechaLegible(mov.creado_en) || '—'}</td>
                      <td>
                        {ETIQUETA_MOVIMIENTO[mov.tipo] || mov.tipo}
                        {mov.id_detalle ? <span style={{ color: 'var(--sd-text-muted)' }}> · ítem #{mov.id_detalle}</span> : null}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cantidad > 0 ? '+' : ''}{formatoCantidad(cantidad, insumo.unidad)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoCantidad(mov.stock_resultante, insumo.unidad)}</td>
                      <td>{autor(mov)}</td>
                      <td>{notaDeMovimiento(mov)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {movimientos.length === LIMITE && (
            <p style={{ color: 'var(--sd-text-muted)', marginBottom: 0 }}>Se muestran los últimos {LIMITE} movimientos.</p>
          )}
        </>
      )}
    </Ventana>
  )
}
