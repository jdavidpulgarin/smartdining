import { useState } from 'react'
import { inventarioApi, mensajeNoGuardado } from '../../services/api'
import { UNIDADES, NOMBRE_MAX, formDeInsumo, validarInsumo, cambiosDeInsumo, textoDeDesactivar } from '../../utils/inventario'
import { Ventana } from './Ventana'

/**
 * Alta o edición de un insumo (POST / PUT /api/inventario/insumos).
 *
 * - Alta: nombre, unidad, mínimo y stock inicial opcional (el servidor lo
 *   registra como movimiento `entrada`, así el libro cuadra desde el principio).
 * - Edición: nombre, unidad, mínimo y activo; solo viaja lo que cambió. El stock
 *   no se edita aquí: para eso están los movimientos.
 * - Desactivar pide confirmación: para la base, un insumo inactivo cuenta como
 *   "no hay", así que los platos y opciones que lo usan quedan no disponibles.
 *   La confirmación los nombra (GET /inventario/insumos/:id/usos).
 */
export function FormInsumo({ insumo = null, onGuardado, onClose }) {
  const nuevo = !insumo
  const [form, setForm] = useState(() => formDeInsumo(insumo))
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }))

  const guardar = async (e) => {
    e.preventDefault()
    setError(null)
    const { datos, error: errorForm } = validarInsumo(form, { nuevo })
    if (errorForm) return setError(errorForm)

    let llamada
    if (nuevo) {
      llamada = () => inventarioApi.crear(datos)
    } else {
      const cambios = cambiosDeInsumo(insumo, datos)
      if (Object.keys(cambios).length === 0) return onClose()
      if (cambios.activo === false) {
        // Qué se apaga (GET /inventario/insumos/:id/usos). Si no responde, se
        // confirma con el aviso genérico: no saber la lista no impide desactivar.
        let usos = null
        try {
          usos = await inventarioApi.usos(insumo.id_insumo)
        } catch {
          usos = null
        }
        if (!window.confirm(textoDeDesactivar(insumo.nombre, usos))) return
      }
      llamada = () => inventarioApi.actualizar(insumo.id_insumo, cambios)
    }

    setGuardando(true)
    try {
      const respuesta = await llamada()
      onGuardado(respuesta?.insumo, nuevo ? `${datos.nombre} quedó registrado.` : `${datos.nombre} quedó actualizado.`)
    } catch (err) {
      setError(mensajeNoGuardado(err))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Ventana titulo={nuevo ? 'Nuevo insumo' : `Editar · ${insumo.nombre}`} onClose={onClose}>
      <form onSubmit={guardar} aria-label={nuevo ? 'Nuevo insumo' : 'Editar insumo'} noValidate style={{ display: 'grid', gap: 12 }}>
        {error && (
          <div className="table-toast-banner error" role="alert"><span>{error}</span></div>
        )}
        <label className="sd-input-label">
          NOMBRE
          <input className="sd-input" maxLength={NOMBRE_MAX} value={form.nombre} onChange={(e) => cambiar('nombre', e.target.value)} autoFocus />
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="sd-input-label" style={{ flex: '1 1 160px' }}>
            UNIDAD
            <select className="sd-input" value={form.unidad} onChange={(e) => cambiar('unidad', e.target.value)}>
              {UNIDADES.map((u) => (
                <option key={u.valor} value={u.valor}>{u.etiqueta}</option>
              ))}
            </select>
          </label>
          <label className="sd-input-label" style={{ flex: '1 1 140px' }}>
            STOCK MÍNIMO
            <input className="sd-input" inputMode="decimal" placeholder="0" value={form.stock_minimo} onChange={(e) => cambiar('stock_minimo', e.target.value)} />
          </label>
          {nuevo && (
            <label className="sd-input-label" style={{ flex: '1 1 140px' }}>
              STOCK INICIAL (OPCIONAL)
              <input className="sd-input" inputMode="decimal" value={form.stock_inicial} onChange={(e) => cambiar('stock_inicial', e.target.value)} />
            </label>
          )}
        </div>
        {nuevo ? (
          <p style={{ color: 'var(--sd-text-muted)', margin: 0 }}>
            El stock inicial entra como una entrada en el historial. Si todavía no ha llegado, déjalo vacío.
          </p>
        ) : (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.activo} onChange={(e) => cambiar('activo', e.target.checked)} />
            Activo (en uso en la carta)
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="sd-btn sd-btn-secondary" onClick={onClose}>CANCELAR</button>
          <button type="submit" className="sd-btn sd-btn-primary" disabled={guardando}>{guardando ? 'GUARDANDO…' : 'GUARDAR'}</button>
        </div>
      </form>
    </Ventana>
  )
}
