import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Save,
  ToggleLeft,
  ToggleRight,
  Flame,
} from 'lucide-react'
import { constructorApi, platosApi } from '../../services/api'

export function EditorPasos({ dish, onClose, onDishUpdated }) {
  const [loading, setLoading] = useState(true)
  const [pasos, setPasos] = useState([])
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  // Configuración base del plato (personalizable y calorías)
  const [personalizable, setPersonalizable] = useState(Boolean(dish?.personalizable))
  const [caloriasBase, setCaloriasBase] = useState(dish?.calorias?.toString() || '400')
  const [savingBaseConfig, setSavingBaseConfig] = useState(false)

  // Estado del modal de paso
  const [isPasoModalOpen, setIsPasoModalOpen] = useState(false)
  const [editingPaso, setEditingPaso] = useState(null)
  const [pasoForm, setPasoForm] = useState({
    nombre: '',
    orden: 1,
    min_sel: 0,
    max_sel: 1,
    obligatorio: false,
  })

  // Estado del modal de ingrediente
  const [isIngModalOpen, setIsIngModalOpen] = useState(false)
  const [targetPasoId, setTargetPasoId] = useState(null)
  const [editingIng, setEditingIng] = useState(null)
  const [ingForm, setIngForm] = useState({
    nombre: '',
    precio_extra: '0',
    calorias: '',
    alergenos: '',
    url_imagen: '',
    disponible: true,
  })

  const showToast = (msg, isError = false) => {
    if (isError) {
      setError(msg)
      setNotice(null)
    } else {
      setNotice(msg)
      setError(null)
    }
    setTimeout(() => {
      setNotice(null)
      setError(null)
    }, 4000)
  }

  // Recargar pasos del plato
  const recargarPasos = useCallback(async () => {
    if (!dish?.id) return
    try {
      const data = await constructorApi.obtenerPasos(dish.id)
      const list = Array.isArray(data) ? data : data?.pasos || []
      list.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
      setPasos(list)
    } catch (err) {
      showToast(err.message || 'Error al cargar los pasos del constructor', true)
    }
  }, [dish?.id])

  useEffect(() => {
    let cancel = false
    if (!dish?.id) {
      return
    }

    constructorApi
      .obtenerPasos(dish.id)
      .then((data) => {
        if (cancel) return
        const list = Array.isArray(data) ? data : data?.pasos || []
        list.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
        setPasos(list)
        setLoading(false)
      })
      .catch((err) => {
        if (cancel) return
        setError(err.message || 'Error al cargar los pasos del constructor')
        setLoading(false)
      })

    return () => {
      cancel = true
    }
  }, [dish?.id])

  // Guardar configuración base (personalizable y calorías)
  const handleSaveBaseConfig = async (e) => {
    e.preventDefault()
    setSavingBaseConfig(true)
    try {
      await platosApi.marcarPersonalizable(dish.id, {
        personalizable,
        calorias: caloriasBase ? Number(caloriasBase) : null,
      })
      showToast('Configuración base del plato actualizada exitosamente')
      if (onDishUpdated) {
        onDishUpdated({
          ...dish,
          personalizable,
          calorias: caloriasBase ? Number(caloriasBase) : null,
        })
      }
    } catch (err) {
      showToast(err.message || 'Error al actualizar configuración base', true)
    } finally {
      setSavingBaseConfig(false)
    }
  }

  // Abrir modal de paso
  const handleOpenPasoModal = (paso = null) => {
    if (paso) {
      setEditingPaso(paso)
      setPasoForm({
        nombre: paso.nombre || '',
        orden: Number(paso.orden) || pasos.length + 1,
        min_sel: Number(paso.min_sel) || 0,
        max_sel: Number(paso.max_sel) || 1,
        obligatorio: Boolean(paso.obligatorio),
      })
    } else {
      setEditingPaso(null)
      setPasoForm({
        nombre: '',
        orden: pasos.length + 1,
        min_sel: 0,
        max_sel: 1,
        obligatorio: false,
      })
    }
    setIsPasoModalOpen(true)
  }

  // Guardar paso (crear o editar)
  const handleSavePaso = async (e) => {
    e.preventDefault()
    if (!pasoForm.nombre.trim()) {
      showToast('El nombre del paso es requerido', true)
      return
    }
    if (Number(pasoForm.min_sel) > Number(pasoForm.max_sel)) {
      showToast('El mínimo de selección no puede ser mayor que el máximo', true)
      return
    }

    try {
      if (editingPaso) {
        await constructorApi.actualizarPaso(editingPaso.id_paso, pasoForm)
        showToast('Paso actualizado correctamente')
      } else {
        await constructorApi.guardarPaso(dish.id, pasoForm)
        showToast('Nuevo paso agregado al constructor')
      }
      setIsPasoModalOpen(false)
      recargarPasos()
    } catch (err) {
      showToast(err.message || 'Error al guardar el paso', true)
    }
  }

  // Eliminar paso
  const handleDeletePaso = async (idPaso) => {
    if (!window.confirm('¿Seguro de eliminar este paso y todos sus ingredientes?')) return
    try {
      await constructorApi.eliminarPaso(idPaso)
      showToast('Paso eliminado')
      recargarPasos()
    } catch (err) {
      showToast(err.message || 'Error al eliminar el paso', true)
    }
  }

  // Abrir modal de ingrediente
  const handleOpenIngModal = (idPaso, ingrediente = null) => {
    setTargetPasoId(idPaso)
    if (ingrediente) {
      setEditingIng(ingrediente)
      setIngForm({
        nombre: ingrediente.nombre || '',
        precio_extra: (Number(ingrediente.precio_extra) || 0).toString(),
        calorias: ingrediente.calorias?.toString() || '',
        alergenos: Array.isArray(ingrediente.alergenos)
          ? ingrediente.alergenos.join(', ')
          : ingrediente.alergenos || '',
        url_imagen: ingrediente.url_imagen || '',
        disponible: ingrediente.disponible !== false,
      })
    } else {
      setEditingIng(null)
      setIngForm({
        nombre: '',
        precio_extra: '0',
        calorias: '',
        alergenos: '',
        url_imagen: '',
        disponible: true,
      })
    }
    setIsIngModalOpen(true)
  }

  // Guardar ingrediente (crear o editar)
  const handleSaveIng = async (e) => {
    e.preventDefault()
    if (!ingForm.nombre.trim()) {
      showToast('El nombre del ingrediente es requerido', true)
      return
    }

    const payload = {
      nombre: ingForm.nombre.trim(),
      precio_extra: parseFloat(ingForm.precio_extra) || 0,
      calorias: ingForm.calorias ? parseInt(ingForm.calorias, 10) : null,
      alergenos: ingForm.alergenos
        ? ingForm.alergenos.split(',').map((a) => a.trim()).filter(Boolean)
        : [],
      url_imagen: ingForm.url_imagen.trim(),
      disponible: Boolean(ingForm.disponible),
    }

    try {
      if (editingIng) {
        await constructorApi.actualizarIngrediente(editingIng.id_ingrediente, payload)
        showToast('Ingrediente actualizado')
      } else {
        await constructorApi.guardarIngrediente(targetPasoId, payload)
        showToast('Ingrediente agregado al paso')
      }
      setIsIngModalOpen(false)
      recargarPasos()
    } catch (err) {
      showToast(err.message || 'Error al guardar el ingrediente', true)
    }
  }

  // Eliminar ingrediente
  const handleDeleteIng = async (idIngrediente) => {
    if (!window.confirm('¿Seguro de eliminar este ingrediente?')) return
    try {
      await constructorApi.eliminarIngrediente(idIngrediente)
      showToast('Ingrediente eliminado')
      recargarPasos()
    } catch (err) {
      showToast(err.message || 'Error al eliminar el ingrediente', true)
    }
  }

  // Toggle disponibilidad de ingrediente rápido
  const handleToggleIngDisponibilidad = async (ing) => {
    const nuevoEstado = !ing.disponible
    try {
      await constructorApi.actualizarIngrediente(ing.id_ingrediente, { disponible: nuevoEstado })
      recargarPasos()
    } catch (err) {
      showToast(err.message || 'Error al cambiar disponibilidad', true)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-content large" style={{ maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Cabecera del Modal */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                backgroundColor: 'rgba(235, 94, 40, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#eb5e28',
              }}
            >
              <Layers size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Constructor de Plato</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#8d99ae' }}>
                {dish?.name} &bull; Configuración de pasos, selecciones e ingredientes
              </p>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Notificaciones */}
        {notice && (
          <div className="table-toast-banner info" style={{ margin: '1rem 1.5rem 0' }}>
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="table-toast-banner alert" style={{ margin: '1rem 1.5rem 0' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Configuración Base del Plato */}
        <div style={{ padding: '1.5rem 1.5rem 0' }}>
          <form
            onSubmit={handleSaveBaseConfig}
            style={{
              padding: '1.25rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              alignItems: 'flex-end',
            }}
          >
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={personalizable}
                  onChange={(e) => setPersonalizable(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: '#eb5e28' }}
                />
                <span>Habilitar como Personalizable ("Arma tu plato")</span>
              </label>
              <p style={{ margin: '0.35rem 0 0 1.6rem', fontSize: '0.8rem', color: '#8d99ae' }}>
                Permite al comensal armar el plato seleccionando sus ingredientes por pasos.
              </p>
            </div>

            <div style={{ flex: '0 1 180px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem', color: '#ced4da' }}>
                Calorías Base (kcal):
              </label>
              <div style={{ position: 'relative' }}>
                <Flame size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#eb5e28' }} />
                <input
                  type="number"
                  min="0"
                  value={caloriasBase}
                  onChange={(e) => setCaloriasBase(e.target.value)}
                  placeholder="Ej: 450"
                  style={{ width: '100%', paddingLeft: '32px', height: '36px' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingBaseConfig}
              className="primary-button small"
              style={{ height: '36px' }}
            >
              <Save size={16} />
              <span>{savingBaseConfig ? 'Guardando...' : 'Guardar Estado'}</span>
            </button>
          </form>
        </div>

        {/* Sección de Pasos del Constructor */}
        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
            }}
          >
            <div>
              <h4 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Pasos del Constructor</span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    backgroundColor: 'rgba(235, 94, 40, 0.2)',
                    color: '#eb5e28',
                    padding: '2px 8px',
                    borderRadius: '12px',
                  }}
                >
                  {pasos.length} pasos
                </span>
              </h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#8d99ae' }}>
                Secuencia de elección del cliente (ej: Base &rarr; Proteína &rarr; Toppings &rarr; Salsas)
              </p>
            </div>

            <button
              type="button"
              className="ghost-button small"
              onClick={() => handleOpenPasoModal()}
              style={{ borderColor: '#eb5e28', color: '#eb5e28' }}
            >
              <Plus size={16} />
              <span>Nuevo Paso</span>
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#8d99ae' }}>
              Cargando estructura del constructor...
            </div>
          ) : pasos.length === 0 ? (
            <div
              style={{
                padding: '2.5rem',
                textAlign: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                border: '1px dashed rgba(255, 255, 255, 0.1)',
              }}
            >
              <Layers size={36} style={{ color: '#8d99ae', margin: '0 auto 0.75rem', opacity: 0.5 }} />
              <p style={{ margin: 0, fontWeight: 500 }}>Este plato aún no tiene pasos configurados</p>
              <p style={{ margin: '0.25rem 0 1rem', fontSize: '0.85rem', color: '#8d99ae' }}>
                Crea el primer paso para habilitar la personalización por ingredientes.
              </p>
              <button
                type="button"
                className="primary-button small"
                onClick={() => handleOpenPasoModal()}
              >
                <Plus size={16} />
                <span>Agregar Primer Paso</span>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {pasos.map((paso) => (
                <div
                  key={paso.id_paso}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Encabezado del Paso */}
                  <div
                    style={{
                      padding: '0.85rem 1rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: '#eb5e28',
                          color: '#fff',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {paso.orden}
                      </span>
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{paso.nombre}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#8d99ae', display: 'flex', gap: '0.75rem', marginTop: '2px' }}>
                          <span>Mín: {paso.min_sel}</span>
                          <span>Máx: {paso.max_sel}</span>
                          <span style={{ color: paso.obligatorio ? '#eb5e28' : '#8d99ae' }}>
                            {paso.obligatorio ? 'Obligatorio' : 'Opcional'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="ghost-button small"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleOpenIngModal(paso.id_paso)}
                      >
                        <Plus size={14} />
                        <span>Ingrediente</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        style={{ padding: '6px' }}
                        onClick={() => handleOpenPasoModal(paso)}
                        title="Editar paso"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        style={{ padding: '6px', color: '#e63946' }}
                        onClick={() => handleDeletePaso(paso.id_paso)}
                        title="Eliminar paso"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Lista de Ingredientes dentro del Paso */}
                  <div style={{ padding: '0.75rem 1rem' }}>
                    {(!paso.ingredientes || paso.ingredientes.length === 0) ? (
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#8d99ae', fontStyle: 'italic' }}>
                        Sin ingredientes en este paso. Haz clic en "+ Ingrediente" para añadir opciones.
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                          gap: '0.75rem',
                        }}
                      >
                        {paso.ingredientes.map((ing) => (
                          <div
                            key={ing.id_ingrediente}
                            style={{
                              padding: '0.65rem 0.75rem',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <strong style={{ fontSize: '0.85rem' }}>{ing.nombre}</strong>
                              <button
                                type="button"
                                onClick={() => handleToggleIngDisponibilidad(ing)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: 0,
                                  color: ing.disponible ? '#2a9d8f' : '#e63946',
                                }}
                                title={ing.disponible ? 'Disponible (clic para agotar)' : 'Agotado (clic para activar)'}
                              >
                                {ing.disponible ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                              </button>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#8d99ae' }}>
                              <span>
                                {Number(ing.precio_extra) > 0
                                  ? `+$${Number(ing.precio_extra).toLocaleString('es-CO')}`
                                  : 'Sin recargo'}
                              </span>
                              {ing.calorias && <span>{ing.calorias} kcal</span>}
                            </div>

                            {ing.alergenos && ing.alergenos.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                                {(Array.isArray(ing.alergenos) ? ing.alergenos : [ing.alergenos]).map((al, idx) => (
                                  <span
                                    key={idx}
                                    style={{
                                      fontSize: '0.65rem',
                                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                      color: '#ced4da',
                                    }}
                                  >
                                    {al}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '0.35rem',
                                marginTop: '4px',
                                paddingTop: '4px',
                                borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                              }}
                            >
                              <button
                                type="button"
                                className="icon-button"
                                style={{ padding: '3px', color: '#8d99ae' }}
                                onClick={() => handleOpenIngModal(paso.id_paso, ing)}
                                title="Editar ingrediente"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                style={{ padding: '3px', color: '#e63946' }}
                                onClick={() => handleDeleteIng(ing.id_ingrediente)}
                                title="Eliminar ingrediente"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal de Paso (Crear / Editar) */}
        {isPasoModalOpen && (
          <div className="modal-backdrop" style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}>
            <div className="modal-content" style={{ maxWidth: '450px' }}>
              <div className="modal-header">
                <h3>{editingPaso ? 'Editar Paso' : 'Nuevo Paso del Constructor'}</h3>
                <button type="button" className="icon-button" onClick={() => setIsPasoModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePaso} style={{ padding: '1.25rem' }}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    Nombre del Paso:
                  </label>
                  <input
                    type="text"
                    required
                    value={pasoForm.nombre}
                    onChange={(e) => setPasoForm({ ...pasoForm, nombre: e.target.value })}
                    placeholder="Ej: Elige tu Base, Elige tu Proteína"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>Orden:</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={pasoForm.orden}
                      onChange={(e) => setPasoForm({ ...pasoForm, orden: parseInt(e.target.value, 10) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>Mínimo:</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={pasoForm.min_sel}
                      onChange={(e) => setPasoForm({ ...pasoForm, min_sel: parseInt(e.target.value, 10) || 0 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>Máximo:</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={pasoForm.max_sel}
                      onChange={(e) => setPasoForm({ ...pasoForm, max_sel: parseInt(e.target.value, 10) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={pasoForm.obligatorio}
                      onChange={(e) => setPasoForm({ ...pasoForm, obligatorio: e.target.checked })}
                      style={{ width: '16px', height: '16px', accentColor: '#eb5e28' }}
                    />
                    <span>¿Paso obligatorio para el cliente?</span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" className="ghost-button small" onClick={() => setIsPasoModalOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="primary-button small">
                    {editingPaso ? 'Actualizar Paso' : 'Crear Paso'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Ingrediente (Crear / Editar) */}
        {isIngModalOpen && (
          <div className="modal-backdrop" style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}>
            <div className="modal-content" style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h3>{editingIng ? 'Editar Ingrediente' : 'Nuevo Ingrediente'}</h3>
                <button type="button" className="icon-button" onClick={() => setIsIngModalOpen(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveIng} style={{ padding: '1.25rem' }}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    Nombre del Ingrediente:
                  </label>
                  <input
                    type="text"
                    required
                    value={ingForm.nombre}
                    onChange={(e) => setIngForm({ ...ingForm, nombre: e.target.value })}
                    placeholder="Ej: Aguacate Hass, Pollo a la plancha"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                      Precio Extra (COP):
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={ingForm.precio_extra}
                      onChange={(e) => setIngForm({ ...ingForm, precio_extra: e.target.value })}
                      placeholder="0 si no tiene recargo"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                      Calorías (kcal):
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={ingForm.calorias}
                      onChange={(e) => setIngForm({ ...ingForm, calorias: e.target.value })}
                      placeholder="Ej: 120"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    Alérgenos (separados por coma):
                  </label>
                  <input
                    type="text"
                    value={ingForm.alergenos}
                    onChange={(e) => setIngForm({ ...ingForm, alergenos: e.target.value })}
                    placeholder="Ej: Gluten, Lácteos, Maní"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    URL Imagen (Unsplash / Pexels):
                  </label>
                  <input
                    type="url"
                    value={ingForm.url_imagen}
                    onChange={(e) => setIngForm({ ...ingForm, url_imagen: e.target.value })}
                    placeholder="https://images.unsplash.com/..."
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={ingForm.disponible}
                      onChange={(e) => setIngForm({ ...ingForm, disponible: e.target.checked })}
                      style={{ width: '16px', height: '16px', accentColor: '#eb5e28' }}
                    />
                    <span>Disponible en carta (no agotado)</span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" className="ghost-button small" onClick={() => setIsIngModalOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="primary-button small">
                    {editingIng ? 'Actualizar Ingrediente' : 'Guardar Ingrediente'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
