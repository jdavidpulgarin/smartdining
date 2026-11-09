import { useState } from 'react'
import { inventarioApi, mensajeNoGuardado } from '../../services/api'
import { TIPOS_MANUALES, MOTIVO_MAX, formatoCantidad, validarMovimiento } from '../../utils/inventario'
import { Ventana } from './Ventana'

/**
 * Entrada, merma o ajuste por conteo (POST /api/inventario/insumos/:id/movimientos).
 *
 * El ajuste pregunta "¿Cuánto hay contado?" y manda la diferencia con signo,
 * que es lo que espera el contrato. Antes de guardar muestra en cuánto quedaría
 * el stock. Si el servidor responde 400 `movimiento_invalido` (el stock cambió
 * mientras tanto, p. ej. por un pedido), se muestra su mensaje y se avisa el
 * stock real para refrescar la fila.
 */
export function FormMovimiento({ insumo, onGuardado, onStockReal, onClose }) {
  const [form, setForm] = useState({ tipo: 'entrada', cantidad: '', contado: '', motivo: '' })
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }))
  const previa = validarMovimiento(form, insumo.stock_actual)
  const unidad = insumo.unidad

  const guardar = async (e) => {
    e.preventDefault()
    setError(null)
    if (previa.error) return setError(previa.error)
    setGuardando(true)
    try {
      const respuesta = await inventarioApi.registrarMovimiento(insumo.id_insumo, previa.datos)
      const etiqueta = TIPOS_MANUALES.find((t) => t.valor === previa.datos.tipo)?.etiqueta
      // Sin punto final: la unidad corta ya puede terminar en punto ("8 und.").
      onGuardado(respuesta?.stock_actual, `${etiqueta} registrada en ${insumo.nombre}: quedó en ${formatoCantidad(respuesta?.stock_actual, unidad)}`)
    } catch (err) {
      setError(mensajeNoGuardado(err))
      const real = err?.data?.stock_actual
      if (err?.data?.motivo === 'movimiento_invalido' && Number.isFinite(Number(real))) onStockReal(Number(real))
    } finally {
      setGuardando(false)
    }
  }

  const ayuda = TIPOS_MANUALES.find((t) => t.valor === form.tipo)?.ayuda
  const motivoObligatorio = form.tipo !== 'entrada'

  return (
    <Ventana titulo={`Movimiento · ${insumo.nombre}`} onClose={onClose}>
      <form onSubmit={guardar} aria-label="Registrar movimiento" noValidate style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--sd-text-muted)' }}>
          Stock actual: <strong style={{ color: 'var(--sd-text)' }}>{formatoCantidad(insumo.stock_actual, unidad)}</strong>
        </p>
        {error && (
          <div className="table-toast-banner error" role="alert"><span>{error}</span></div>
        )}

        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <legend className="sd-input-label" style={{ marginBottom: 6 }}>TIPO</legend>
          {TIPOS_MANUALES.map((t) => (
            <label key={t.valor} className={`sd-btn ${form.tipo === t.valor ? 'sd-btn-primary' : 'sd-btn-secondary'}`} style={{ cursor: 'pointer' }}>
              <input type="radio" name="tipo" value={t.valor} checked={form.tipo === t.valor} onChange={() => cambiar('tipo', t.valor)} style={{ marginRight: 6 }} />
              {t.etiqueta}
            </label>
          ))}
        </fieldset>
        <p style={{ margin: 0, color: 'var(--sd-text-muted)' }}>{ayuda}</p>

        {form.tipo === 'ajuste' ? (
          <label className="sd-input-label">
            ¿CUÁNTO HAY CONTADO? ({unidad})
            <input className="sd-input" inputMode="decimal" value={form.contado} onChange={(e) => cambiar('contado', e.target.value)} />
          </label>
        ) : (
          <label className="sd-input-label">
            CANTIDAD ({unidad})
            <input className="sd-input" inputMode="decimal" value={form.cantidad} onChange={(e) => cambiar('cantidad', e.target.value)} />
          </label>
        )}

        <label className="sd-input-label">
          MOTIVO{motivoObligatorio ? '' : ' (OPCIONAL)'}
          <textarea className="sd-input" rows={2} maxLength={MOTIVO_MAX} value={form.motivo} onChange={(e) => cambiar('motivo', e.target.value)} />
        </label>

        {previa.datos && (
          <p role="status" style={{ margin: 0 }}>
            Quedará en <strong>{formatoCantidad(previa.resultante, unidad)}</strong>
            {previa.datos.tipo === 'ajuste' && ` (ajuste de ${previa.datos.cantidad > 0 ? '+' : ''}${formatoCantidad(previa.datos.cantidad, unidad)})`}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="sd-btn sd-btn-secondary" onClick={onClose}>CANCELAR</button>
          <button type="submit" className="sd-btn sd-btn-primary" disabled={guardando}>{guardando ? 'GUARDANDO…' : 'REGISTRAR'}</button>
        </div>
      </form>
    </Ventana>
  )
}
