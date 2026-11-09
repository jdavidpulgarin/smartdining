import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { inventarioApi, mensajeNoGuardado } from '../../services/api'
import { mensajeDeCarga } from '../../utils/configuracion'
import { UNIDADES, MAX_INSUMOS_RECETA, filasDeReceta, validarReceta, formatoCantidad } from '../../utils/inventario'
import { Ventana } from './Ventana'

const unidadCorta = (unidad) => UNIDADES.find((u) => u.valor === unidad)?.corta || unidad || ''

/**
 * Editor de la receta de un plato o de una opción del constructor
 * (GET / PUT /api/platos/:id/receta y /api/ingredientes/:id/receta, D-17 PR 2).
 *
 * El PUT REEMPLAZA la receta completa: lo que está en pantalla es lo que queda.
 * Dejarla vacía la quita (el plato deja de controlar inventario), así que eso
 * pide confirmación. En una opción, la cantidad es la de la porción NORMAL; la
 * base la multiplica por la porción que pida el comensal.
 */
export function EditorReceta({ tipo, item, insumos, onGuardado, onClose }) {
  const [filas, setFilas] = useState(null)
  const [original, setOriginal] = useState(0)
  const [errorCarga, setErrorCarga] = useState(null)
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    inventarioApi
      .receta(tipo, item.id)
      .then((data) => {
        if (!vivo) return
        setFilas(filasDeReceta(data?.receta))
        setOriginal((data?.receta || []).length)
      })
      .catch((err) => {
        if (vivo) setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar la receta'))
      })
    return () => {
      vivo = false
    }
  }, [tipo, item.id])

  const ordenados = [...(insumos || [])].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
  const insumoDe = (id) => ordenados.find((s) => String(s.id_insumo) === String(id))
  const cambiarFila = (i, cambios) => setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...cambios } : f)))

  const guardar = async (e) => {
    e.preventDefault()
    setError(null)
    const { datos, error: errorForm } = validarReceta(filas, ordenados)
    if (errorForm) return setError(errorForm)
    if (datos.insumos.length === 0 && original > 0 && !window.confirm(
      `¿Quitar la receta de "${item.nombre}"? Dejará de controlar inventario: se podrá pedir aunque no haya insumos.`
    )) return

    setGuardando(true)
    try {
      const guardada = await inventarioApi.guardarReceta(tipo, item.id, datos.insumos)
      const receta = guardada?.receta || []
      // Con la receta nueva, ¿alcanza el stock para una unidad? Si no, la base lo
      // deja sin stock en este mismo PUT: mejor decirlo que dejarlo descubrir.
      const noAlcanza = receta.filter((r) => r.activo === false || Number(r.stock_actual) < Number(r.cantidad))
      let texto = receta.length === 0
        ? `${item.nombre} quedó sin receta: ya no controla inventario.`
        : `Receta de ${item.nombre} guardada (${receta.length} insumo${receta.length === 1 ? '' : 's'}).`
      if (noAlcanza.length > 0) texto += ` Ojo: con el stock actual queda SIN STOCK por ${noAlcanza.map((r) => r.nombre).join(', ')}.`
      onGuardado(texto)
    } catch (err) {
      setError(mensajeNoGuardado(err))
    } finally {
      setGuardando(false)
    }
  }

  const titulo = tipo === 'plato' ? `Receta · ${item.nombre}` : `Receta · ${item.plato} · ${item.paso} · ${item.nombre}`

  return (
    <Ventana titulo={titulo} onClose={onClose} ancho={720}>
      {errorCarga && <p role="alert">No se pudo cargar la receta: {errorCarga}.</p>}
      {!errorCarga && filas === null && <p style={{ color: 'var(--sd-text-muted)' }}>Cargando receta…</p>}
      {filas && (
        <form onSubmit={guardar} aria-label="Editar receta" noValidate style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, color: 'var(--sd-text-muted)' }}>
            {tipo === 'plato'
              ? item.personalizable
                ? 'Este plato consume por sus opciones: cada opción tiene su receta. Aquí solo va lo que lleva siempre (si lleva algo).'
                : 'Lo que consume UNA unidad del plato.'
              : 'Lo que consume una porción NORMAL de esta opción (la ligera usa la mitad y la extra una vez y media).'}
          </p>
          {error && (
            <div className="table-toast-banner error" role="alert"><span>{error}</span></div>
          )}

          {filas.length === 0 ? (
            <p style={{ margin: 0 }}>Sin receta: no controla inventario.</p>
          ) : (
            <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>INSUMO</th>
                  <th>CANTIDAD</th>
                  <th style={{ textAlign: 'right' }}>HAY</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, i) => {
                  const elegido = insumoDe(fila.id_insumo)
                  return (
                    <tr key={i} data-testid={`fila-receta-${i}`}>
                      <td>
                        <select className="sd-input" aria-label={`Insumo de la fila ${i + 1}`} value={fila.id_insumo} onChange={(e) => cambiarFila(i, { id_insumo: e.target.value })}>
                          <option value="">Elige un insumo…</option>
                          {ordenados.map((s) => (
                            <option key={s.id_insumo} value={String(s.id_insumo)}>
                              {s.nombre} ({unidadCorta(s.unidad)}){s.activo === false ? ' · inactivo' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input className="sd-input" inputMode="decimal" aria-label={`Cantidad de la fila ${i + 1}`} value={fila.cantidad} onChange={(e) => cambiarFila(i, { cantidad: e.target.value })} style={{ width: 110, display: 'inline-block' }} />
                        {elegido ? ` ${unidadCorta(elegido.unidad)}` : ''}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--sd-text-muted)' }}>
                        {elegido ? formatoCantidad(elegido.stock_actual, elegido.unidad) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="sd-topbar-icon-btn" aria-label={`Quitar la fila ${i + 1}`} onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <div>
            <button type="button" className="sd-btn sd-btn-secondary" disabled={filas.length >= MAX_INSUMOS_RECETA} onClick={() => setFilas((prev) => [...prev, { id_insumo: '', cantidad: '' }])}>
              <Plus size={14} /> <span>AGREGAR INSUMO</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="sd-btn sd-btn-secondary" onClick={onClose}>CANCELAR</button>
            <button type="submit" className="sd-btn sd-btn-primary" disabled={guardando}>{guardando ? 'GUARDANDO…' : 'GUARDAR RECETA'}</button>
          </div>
        </form>
      )}
    </Ventana>
  )
}
