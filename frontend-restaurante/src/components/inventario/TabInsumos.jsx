import { useState, useEffect, useCallback } from 'react'
import { Plus, RefreshCw, ArrowLeftRight, History, Pencil, X } from 'lucide-react'
import { inventarioApi, usuariosApi } from '../../services/api'
import { useSocketListener } from '../../hooks'
import { mensajeDeCarga } from '../../utils/configuracion'
import { crearVentanaEventos } from '../../utils/dedupeEventos'
import {
  ESTADOS,
  UNIDADES,
  estadoDeInsumo,
  ordenarInsumos,
  resumenInsumos,
  filtrarInsumos,
  formatoCantidad,
  textoDeAlerta,
} from '../../utils/inventario'
import { FormInsumo } from './FormInsumo'
import { FormMovimiento } from './FormMovimiento'
import { HistorialInsumo } from './HistorialInsumo'

const FILTROS = [
  { id: 'todos', etiqueta: 'Activos' },
  { id: 'bajo', etiqueta: 'Bajo el mínimo' },
  { id: 'inactivos', etiqueta: 'Inactivos' },
]

const MAX_ALERTAS = 5

/**
 * Pestaña Insumos de Inventario (P-22), contra D-17 PR 2.
 *
 * - Lista: GET /api/inventario/insumos (hasta 200), con `bajo` y `agotado` que
 *   calcula el servidor. Filtros y búsqueda se aplican sobre esa lista.
 * - Alta y edición, movimientos e historial, en ventanas aparte.
 * - En vivo: `inventario:alerta` (EVENTS.md §5.5) muestra el aviso y recarga la
 *   lista. Se descarta un `eventId` repetido. No hay un evento por cada
 *   movimiento, así que además se recarga después de cada acción propia, al
 *   volver a la pestaña del navegador y con el botón Actualizar.
 */
export function TabInsumos() {
  const [insumos, setInsumos] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [alertas, setAlertas] = useState([])
  const [filtro, setFiltro] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [ventana, setVentana] = useState(null) // { tipo: 'nuevo'|'editar'|'movimiento'|'historial', insumo? }
  const [nombres, setNombres] = useState({})
  const [alertaVista] = useState(() => crearVentanaEventos())

  const cargar = useCallback(async () => {
    try {
      const data = await inventarioApi.listar()
      setInsumos(data?.insumos || [])
      setErrorCarga(null)
    } catch (err) {
      setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar el inventario'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Primera carga (con guarda) y el personal, solo para poner nombre en el historial.
  useEffect(() => {
    let vivo = true
    inventarioApi
      .listar()
      .then((data) => {
        if (vivo) setInsumos(data?.insumos || [])
      })
      .catch((err) => {
        if (vivo) setErrorCarga(mensajeDeCarga(err, 'No se pudo cargar el inventario'))
      })
      .finally(() => {
        if (vivo) setLoading(false)
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
  }, [])

  // Al volver a la pestaña del navegador el stock pudo cambiar por los pedidos.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar])

  const alAlertar = useCallback(
    (data) => {
      if (!data || alertaVista(data.eventId)) return
      setAlertas((prev) => [{ id: data.eventId || `${data.id_insumo}-${data.emitidoEn}`, texto: textoDeAlerta(data), agotado: Boolean(data.agotado) }, ...prev].slice(0, MAX_ALERTAS))
      cargar()
    },
    [alertaVista, cargar]
  )
  useSocketListener('inventario:alerta', alAlertar)

  const cerrar = useCallback(() => setVentana(null), [])

  const alGuardarInsumo = (_insumo, texto) => {
    setVentana(null)
    setAviso({ tipo: 'ok', texto })
    cargar()
  }

  const alGuardarMovimiento = (_stock, texto) => {
    setVentana(null)
    setAviso({ tipo: 'ok', texto })
    cargar()
  }

  // El servidor rechazó un movimiento por el stock: se pone el valor real en la fila.
  const alStockReal = (idInsumo, stock) =>
    setInsumos((prev) => prev.map((i) => (i.id_insumo === idInsumo ? { ...i, stock_actual: stock } : i)))

  if (loading) {
    return <p style={{ color: 'var(--sd-text-muted)' }}>Cargando inventario…</p>
  }

  if (errorCarga) {
    return (
      <div className="sd-card" style={{ textAlign: 'center', padding: 32 }}>
        <p role="alert" style={{ color: 'var(--sd-text)' }}>No se pudo cargar el inventario: {errorCarga}.</p>
        <button type="button" className="sd-btn sd-btn-primary" onClick={() => { setLoading(true); cargar() }} style={{ margin: '12px auto 0' }}>
          <RefreshCw size={14} /> <span>REINTENTAR</span>
        </button>
      </div>
    )
  }

  const { bajo, agotado } = resumenInsumos(insumos)
  const visibles = ordenarInsumos(filtrarInsumos(insumos, { filtro, busqueda }))
  const insumoDe = (id) => insumos.find((i) => i.id_insumo === id)

  return (
    <div>
      {alertas.length > 0 && (
        <section aria-label="Alertas de inventario" style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {alertas.map((a) => (
            <div key={a.id} className="table-toast-banner error" role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{a.texto}</span>
              <button type="button" className="sd-topbar-icon-btn" aria-label={`Descartar: ${a.texto}`} onClick={() => setAlertas((prev) => prev.filter((x) => x.id !== a.id))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </section>
      )}

      {aviso && (
        <div className={`table-toast-banner ${aviso.tipo === 'error' ? 'error' : 'success'}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ marginBottom: 16 }}>
          <span>{aviso.texto}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p data-testid="resumen-inventario" style={{ margin: 0 }}>
          <strong>{bajo}</strong> bajo el mínimo · <strong>{agotado}</strong> agotado{agotado === 1 ? '' : 's'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="sd-btn sd-btn-secondary" onClick={cargar}>
            <RefreshCw size={14} /> <span>ACTUALIZAR</span>
          </button>
          <button type="button" className="sd-btn sd-btn-primary" onClick={() => setVentana({ tipo: 'nuevo' })}>
            <Plus size={14} /> <span>NUEVO INSUMO</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <div role="group" aria-label="Filtrar insumos" style={{ display: 'flex', gap: 8 }}>
          {FILTROS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filtro === f.id} className={`sd-btn ${filtro === f.id ? 'sd-btn-primary' : 'sd-btn-secondary'}`} onClick={() => setFiltro(f.id)}>
              {f.etiqueta}
            </button>
          ))}
        </div>
        <input className="sd-input" type="search" aria-label="Buscar insumo" placeholder="Buscar insumo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260 }} />
      </div>

      {visibles.length === 0 ? (
        <p style={{ color: 'var(--sd-text-muted)' }}>
          {insumos.length === 0 ? 'Todavía no hay insumos registrados.' : 'Ningún insumo coincide con el filtro.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="sd-config-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>INSUMO</th>
                <th>UNIDAD</th>
                <th style={{ textAlign: 'right' }}>STOCK</th>
                <th style={{ textAlign: 'right' }}>MÍNIMO</th>
                <th>ESTADO</th>
                <th style={{ textAlign: 'right' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((insumo) => {
                const estado = ESTADOS[estadoDeInsumo(insumo)]
                return (
                  <tr key={insumo.id_insumo} data-testid={`insumo-${insumo.id_insumo}`}>
                    <td>{insumo.nombre}</td>
                    <td>{UNIDADES.find((u) => u.valor === insumo.unidad)?.etiqueta || insumo.unidad}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoCantidad(insumo.stock_actual, insumo.unidad)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoCantidad(insumo.stock_minimo, insumo.unidad)}</td>
                    <td><span className={`sd-badge ${estado.clase}`}>{estado.etiqueta}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="sd-topbar-icon-btn" title={`Movimiento de ${insumo.nombre}`} aria-label={`Movimiento de ${insumo.nombre}`} onClick={() => setVentana({ tipo: 'movimiento', id: insumo.id_insumo })}>
                        <ArrowLeftRight size={16} />
                      </button>
                      <button type="button" className="sd-topbar-icon-btn" title={`Historial de ${insumo.nombre}`} aria-label={`Historial de ${insumo.nombre}`} onClick={() => setVentana({ tipo: 'historial', id: insumo.id_insumo })}>
                        <History size={16} />
                      </button>
                      <button type="button" className="sd-topbar-icon-btn" title={`Editar ${insumo.nombre}`} aria-label={`Editar ${insumo.nombre}`} onClick={() => setVentana({ tipo: 'editar', id: insumo.id_insumo })}>
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {ventana?.tipo === 'nuevo' && <FormInsumo onGuardado={alGuardarInsumo} onClose={cerrar} />}
      {ventana?.tipo === 'editar' && insumoDe(ventana.id) && (
        <FormInsumo insumo={insumoDe(ventana.id)} onGuardado={alGuardarInsumo} onClose={cerrar} />
      )}
      {ventana?.tipo === 'movimiento' && insumoDe(ventana.id) && (
        <FormMovimiento
          insumo={insumoDe(ventana.id)}
          onGuardado={alGuardarMovimiento}
          onStockReal={(stock) => alStockReal(ventana.id, stock)}
          onClose={cerrar}
        />
      )}
      {ventana?.tipo === 'historial' && insumoDe(ventana.id) && (
        <HistorialInsumo insumo={insumoDe(ventana.id)} nombres={nombres} onClose={cerrar} />
      )}
    </div>
  )
}
