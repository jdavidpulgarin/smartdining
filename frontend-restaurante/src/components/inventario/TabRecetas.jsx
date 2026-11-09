import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { inventarioApi } from '../../services/api'
import { mensajeDeCarga } from '../../utils/configuracion'
import {
  disponibilidadEnCarta,
  estadoDeReceta,
  resumenCarta,
  filtrarCarta,
  agruparPorCategoria,
  agruparOpciones,
} from '../../utils/inventario'
import { EditorReceta } from './EditorReceta'

/**
 * Pestaña Recetas de Inventario (P-22), contra GET /api/inventario/carta
 * (D-17 PR 3) y las rutas de receta de D-17 PR 2.
 *
 * Muestra qué platos y qué opciones del constructor tienen receta, y cómo están
 * en la carta (disponible, apagado a mano o sin stock). Un plato personalizable
 * sin receta propia sale como "consume por sus opciones": no es un faltante.
 * El servidor ya manda el orden (platos por categoría y nombre; opciones por
 * plato, paso y nombre); aquí solo se agrupa.
 */
export function TabRecetas() {
  const [carta, setCarta] = useState(null)
  const [insumos, setInsumos] = useState([])
  const [errorCarga, setErrorCarga] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(null) // { tipo, item }

  const cargar = useCallback(async () => {
    try {
      const [dataCarta, dataInsumos] = await Promise.all([inventarioApi.carta(), inventarioApi.listar()])
      setCarta({ platos: dataCarta?.platos || [], ingredientes: dataCarta?.ingredientes || [] })
      setInsumos(dataInsumos?.insumos || [])
      setErrorCarga(null)
    } catch (err) {
      setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar la carta'))
    }
  }, [])

  useEffect(() => {
    let vivo = true
    Promise.all([inventarioApi.carta(), inventarioApi.listar()])
      .then(([dataCarta, dataInsumos]) => {
        if (!vivo) return
        setCarta({ platos: dataCarta?.platos || [], ingredientes: dataCarta?.ingredientes || [] })
        setInsumos(dataInsumos?.insumos || [])
      })
      .catch((err) => {
        if (vivo) setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar la carta'))
      })
    return () => {
      vivo = false
    }
  }, [])

  const cerrar = useCallback(() => setEditando(null), [])

  if (errorCarga) {
    return (
      <div className="sd-card" style={{ textAlign: 'center', padding: 32 }}>
        <p role="alert" style={{ color: 'var(--sd-text)' }}>No se pudo cargar la carta: {errorCarga}.</p>
        <button type="button" className="sd-btn sd-btn-primary" onClick={() => { setErrorCarga(null); setCarta(null); cargar() }} style={{ margin: '12px auto 0' }}>
          <RefreshCw size={14} /> <span>REINTENTAR</span>
        </button>
      </div>
    )
  }

  if (!carta) {
    return <p style={{ color: 'var(--sd-text-muted)' }}>Cargando carta…</p>
  }

  const faltan = resumenCarta(carta)
  const visible = filtrarCarta(carta, { soloFaltantes, busqueda })
  const categorias = agruparPorCategoria(visible.platos)
  const platosConOpciones = agruparOpciones(visible.ingredientes)

  const fila = (tipo, item, primeraCelda) => {
    const disp = disponibilidadEnCarta(item)
    const receta = estadoDeReceta(item, tipo)
    const etiqueta = tipo === 'plato' ? item.nombre : `${item.plato} · ${item.paso} · ${item.nombre}`
    return (
      <tr key={`${tipo}-${item.id}`} data-testid={`${tipo}-${item.id}`}>
        <td>{primeraCelda}</td>
        <td><span className={`sd-badge ${disp.clase}`}>{disp.texto}</span></td>
        <td><span className={`sd-badge ${receta.clase}`}>{receta.texto}</span></td>
        <td style={{ textAlign: 'right' }}>
          <button type="button" className="sd-btn sd-btn-secondary" aria-label={`Receta de ${etiqueta}`} onClick={() => setEditando({ tipo, item })}>
            {item.tiene_receta ? 'EDITAR RECETA' : 'AGREGAR RECETA'}
          </button>
        </td>
      </tr>
    )
  }

  const cabecera = (primera) => (
    <thead>
      <tr>
        <th>{primera}</th>
        <th>EN LA CARTA</th>
        <th>RECETA</th>
        <th />
      </tr>
    </thead>
  )

  return (
    <div>
      {aviso && (
        <div className="table-toast-banner success" role="status" style={{ marginBottom: 16 }}>
          <span>{aviso}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p data-testid="resumen-recetas" style={{ margin: 0 }}>
          Sin receta: <strong>{faltan.platos}</strong> plato{faltan.platos === 1 ? '' : 's'} · <strong>{faltan.opciones}</strong> opci{faltan.opciones === 1 ? 'ón' : 'ones'}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" aria-pressed={soloFaltantes} className={`sd-btn ${soloFaltantes ? 'sd-btn-primary' : 'sd-btn-secondary'}`} onClick={() => setSoloFaltantes((v) => !v)}>
            Solo lo que falta
          </button>
          <input className="sd-input" type="search" aria-label="Buscar en la carta" placeholder="Buscar plato u opción…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 240 }} />
          <button type="button" className="sd-btn sd-btn-secondary" onClick={cargar}>
            <RefreshCw size={14} /> <span>ACTUALIZAR</span>
          </button>
        </div>
      </div>

      <section aria-label="Platos" style={{ marginBottom: 28 }}>
        <h2 className="sd-card-title">Platos</h2>
        {categorias.length === 0 ? (
          <p style={{ color: 'var(--sd-text-muted)' }}>{soloFaltantes ? 'Todos los platos tienen receta.' : 'Ningún plato coincide.'}</p>
        ) : (
          categorias.map((grupo) => (
            <div key={grupo.categoria} style={{ marginBottom: 16, overflowX: 'auto' }}>
              <h3 className="sd-input-label" style={{ margin: '8px 0' }}>{grupo.categoria.toUpperCase()}</h3>
              <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                {cabecera('PLATO')}
                <tbody>{grupo.platos.map((p) => fila('plato', p, p.nombre))}</tbody>
              </table>
            </div>
          ))
        )}
      </section>

      <section aria-label="Opciones del constructor">
        <h2 className="sd-card-title">Opciones del constructor</h2>
        {platosConOpciones.length === 0 ? (
          <p style={{ color: 'var(--sd-text-muted)' }}>{soloFaltantes ? 'Todas las opciones tienen receta.' : 'Ninguna opción coincide.'}</p>
        ) : (
          platosConOpciones.map((plato) => (
            <div key={plato.id_plato} style={{ marginBottom: 16, overflowX: 'auto' }}>
              <h3 className="sd-input-label" style={{ margin: '8px 0' }}>{String(plato.plato).toUpperCase()}</h3>
              <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                {cabecera('PASO · OPCIÓN')}
                <tbody>
                  {plato.pasos.flatMap((paso) =>
                    paso.opciones.map((op) => fila('ingrediente', op, (
                      <>
                        <span style={{ color: 'var(--sd-text-muted)' }}>{paso.paso_orden}. {paso.paso} · </span>
                        {op.nombre}
                      </>
                    )))
                  )}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>

      {editando && (
        <EditorReceta
          tipo={editando.tipo}
          item={editando.item}
          insumos={insumos}
          onClose={cerrar}
          onGuardado={(texto) => {
            setEditando(null)
            setAviso(texto)
            cargar()
          }}
        />
      )}
    </div>
  )
}
