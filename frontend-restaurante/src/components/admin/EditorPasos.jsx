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
    <div className="sd-modal-backdrop" onClick={onClose}>
      <div
        className="sd-card sd-table-detail-modal"
        style={{ maxWidth: 880, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Cabecera del Modal */}
        <div className="sd-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: 'rgba(238, 28, 37, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--sd-red)',
              }}
            >
              <Layers size={22} />
            </div>
            <div>
              <h3 className="sd-card-title" style={{ margin: 0, fontSize: 24 }}>
                Constructor de Plato
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--sd-text-muted)' }}>
                {dish?.name} &bull; Configuración de pasos, selecciones e ingredientes
              </p>
            </div>
          </div>
          <button
            type="button"
            className="sd-topbar-icon-btn"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Notificaciones */}
        {notice && (
          <div className="table-toast-banner info" style={{ margin: '1rem 0 0 0' }}>
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="table-toast-banner alert" style={{ margin: '1rem 0 0 0' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Configuración Base del Plato */}
        <div style={{ marginTop: 20 }}>
          <form
            onSubmit={handleSaveBaseConfig}
            style={{
              padding: 18,
              borderRadius: 8,
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--sd-border)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              alignItems: 'flex-end',
            }}
          >
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700, fontFamily: 'var(--sd-font-heading)' }}>
                <input
                  type="checkbox"
                  checked={personalizable}
                  onChange={(e) => setPersonalizable(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--sd-gold)' }}
                />
                <span>Habilitar como Personalizable ("Arma tu plato")</span>
              </label>
              <p style={{ margin: '4px 0 0 26px', fontSize: 12, color: 'var(--sd-text-muted)' }}>
                Permite al comensal armar el plato seleccionando sus ingredientes por pasos.
              </p>
            </div>

            <div style={{ flex: '0 1 180px' }}>
              <label className="sd-input-label">CALORÍAS BASE (KCAL):</label>
              <div style={{ position: 'relative' }}>
                <Flame size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--sd-gold)' }} />
                <input
                  type="number"
                  min="0"
                  value={caloriasBase}
                  onChange={(e) => setCaloriasBase(e.target.value)}
                  placeholder="Ej: 450"
                  className="sd-input"
                  style={{ paddingLeft: 32, height: 38 }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingBaseConfig}
              className="sd-btn sd-btn-primary"
              style={{ height: 38, fontSize: 13 }}
            >
              <Save size={16} />
              <span>{savingBaseConfig ? 'GUARDANDO...' : 'GUARDAR ESTADO'}</span>
            </button>
          </form>
        </div>

        {/* Sección de Pasos del Constructor */}
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h4 style={{ margin: 0, fontFamily: 'var(--sd-font-heading)', fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>PASOS DEL CONSTRUCTOR</span>
                <span
                  style={{
                    fontSize: 12,
                    backgroundColor: 'rgba(238, 28, 37, 0.2)',
                    color: 'var(--sd-red-text)',
                    padding: '2px 8px',
                    borderRadius: 12,
                  }}
                >
                  {pasos.length} pasos
                </span>
              </h4>
              <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--sd-text-muted)' }}>
                Secuencia de elección del cliente (ej: Base &rarr; Proteína &rarr; Toppings &rarr; Salsas)
              </p>
            </div>

            <button
              type="button"
              className="sd-btn sd-btn-primary"
              onClick={() => handleOpenPasoModal()}
              style={{ fontSize: 13, padding: '8px 14px' }}
            >
              <Plus size={16} />
              <span>NUEVO PASO</span>
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sd-text-muted)' }}>
              Cargando estructura del constructor...
            </div>
          ) : pasos.length === 0 ? (
            <div
              style={{
                padding: '2.5rem',
                textAlign: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                borderRadius: 8,
                border: '1px dashed var(--sd-border)',
              }}
            >
              <Layers size={36} style={{ color: 'var(--sd-text-muted)', margin: '0 auto 0.75rem', opacity: 0.5 }} />
              <p style={{ margin: 0, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', fontSize: 16 }}>
                Este plato aún no tiene pasos configurados
              </p>
              <p style={{ margin: '4px 0 1rem', fontSize: 13, color: 'var(--sd-text-muted)' }}>
                Crea el primer paso para habilitar la personalización por ingredientes.
              </p>
              <button
                type="button"
                className="sd-btn sd-btn-primary"
                onClick={() => handleOpenPasoModal()}
              >
                <Plus size={16} />
                <span>AGREGAR PRIMER PASO</span>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {pasos.map((paso) => (
                <div
                  key={paso.id_paso}
                  style={{
                    backgroundColor: 'var(--sd-surface)',
                    borderRadius: 8,
                    border: '1px solid var(--sd-border)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Encabezado del Paso */}
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid var(--sd-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          backgroundColor: 'var(--sd-red)',
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 800,
                          fontFamily: 'var(--sd-font-heading)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {paso.orden}
                      </span>
                      <div>
                        <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 17, color: 'var(--sd-text)' }}>
                          {paso.nombre}
                        </strong>
                        <div style={{ fontSize: 12, color: 'var(--sd-text-muted)', display: 'flex', gap: 12, marginTop: 2 }}>
                          <span>Mín: {paso.min_sel}</span>
                          <span>Máx: {paso.max_sel}</span>
                          <span style={{ color: paso.obligatorio ? 'var(--sd-red-text)' : 'var(--sd-text-muted)', fontWeight: 700 }}>
                            {paso.obligatorio ? 'OBLIGATORIO' : 'OPCIONAL'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        className="sd-btn sd-btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => handleOpenIngModal(paso.id_paso)}
                      >
                        <Plus size={14} />
                        <span>INGREDIENTE</span>
                      </button>
                      <button
                        type="button"
                        className="sd-topbar-icon-btn"
                        style={{ width: 32, height: 32 }}
                        onClick={() => handleOpenPasoModal(paso)}
                        title="Editar paso"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        className="sd-topbar-icon-btn"
                        style={{ width: 32, height: 32, color: 'var(--sd-red-text)' }}
                        onClick={() => handleDeletePaso(paso.id_paso)}
                        title="Eliminar paso"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Lista de Ingredientes dentro del Paso */}
                  <div style={{ padding: 14 }}>
                    {(!paso.ingredientes || paso.ingredientes.length === 0) ? (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--sd-text-muted)', fontStyle: 'italic' }}>
                        Sin ingredientes en este paso. Haz clic en "+ Ingrediente" para añadir opciones.
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                          gap: 12,
                        }}
                      >
                        {paso.ingredientes.map((ing) => (
                          <div
                            key={ing.id_ingrediente}
                            style={{
                              padding: 12,
                              borderRadius: 6,
                              backgroundColor: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid var(--sd-border)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 15, color: 'var(--sd-text)' }}>
                                {ing.nombre}
                              </strong>
                              <button
                                type="button"
                                onClick={() => handleToggleIngDisponibilidad(ing)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: 0,
                                  color: ing.disponible ? 'var(--sd-white)' : 'var(--sd-red)',
                                }}
                                title={ing.disponible ? 'Disponible (clic para agotar)' : 'Agotado (clic para activar)'}
                              >
                                {ing.disponible ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                              </button>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--sd-text-muted)' }}>
                              <span>
                                {Number(ing.precio_extra) > 0
                                  ? `+$${Number(ing.precio_extra).toLocaleString('es-CO')}`
                                  : 'Sin recargo'}
                              </span>
                              {ing.calorias && <span>{ing.calorias} kcal</span>}
                            </div>

                            {ing.alergenos && ing.alergenos.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                                {(Array.isArray(ing.alergenos) ? ing.alergenos : [ing.alergenos]).map((al, idx) => (
                                  <span
                                    key={idx}
                                    style={{
                                      fontSize: 11,
                                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      color: 'var(--sd-text-muted)',
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
                                gap: 6,
                                marginTop: 4,
                                paddingTop: 6,
                                borderTop: '1px solid var(--sd-border)',
                              }}
                            >
                              <button
                                type="button"
                                className="sd-topbar-icon-btn"
                                style={{ width: 28, height: 28, color: 'var(--sd-text-muted)' }}
                                onClick={() => handleOpenIngModal(paso.id_paso, ing)}
                                title="Editar ingrediente"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                type="button"
                                className="sd-topbar-icon-btn"
                                style={{ width: 28, height: 28, color: 'var(--sd-red-text)' }}
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
          <div className="sd-modal-backdrop" onClick={() => setIsPasoModalOpen(false)}>
            <div
              className="sd-card sd-table-detail-modal"
              style={{ maxWidth: 460 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="sd-modal-header">
                <h3 className="sd-card-title" style={{ margin: 0, fontSize: 22 }}>
                  {editingPaso ? 'Editar Paso' : 'Nuevo Paso del Constructor'}
                </h3>
                <button
                  type="button"
                  className="sd-topbar-icon-btn"
                  onClick={() => setIsPasoModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePaso} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                <div>
                  <label className="sd-input-label">NOMBRE DEL PASO:</label>
                  <input
                    type="text"
                    required
                    value={pasoForm.nombre}
                    onChange={(e) => setPasoForm({ ...pasoForm, nombre: e.target.value })}
                    placeholder="Ej: Elige tu Base, Elige tu Proteína"
                    className="sd-input"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="sd-input-label">ORDEN:</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={pasoForm.orden}
                      onChange={(e) => setPasoForm({ ...pasoForm, orden: parseInt(e.target.value, 10) || 1 })}
                      className="sd-input"
                    />
                  </div>
                  <div>
                    <label className="sd-input-label">MÍNIMO:</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={pasoForm.min_sel}
                      onChange={(e) => setPasoForm({ ...pasoForm, min_sel: parseInt(e.target.value, 10) || 0 })}
                      className="sd-input"
                    />
                  </div>
                  <div>
                    <label className="sd-input-label">MÁXIMO:</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={pasoForm.max_sel}
                      onChange={(e) => setPasoForm({ ...pasoForm, max_sel: parseInt(e.target.value, 10) || 1 })}
                      className="sd-input"
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'var(--sd-font-heading)', fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={pasoForm.obligatorio}
                      onChange={(e) => setPasoForm({ ...pasoForm, obligatorio: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: 'var(--sd-red)' }}
                    />
                    <span>¿PASO OBLIGATORIO PARA EL CLIENTE?</span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--sd-border)', paddingTop: 14 }}>
                  <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setIsPasoModalOpen(false)}>
                    CANCELAR
                  </button>
                  <button type="submit" className="sd-btn sd-btn-primary">
                    {editingPaso ? 'ACTUALIZAR PASO' : 'CREAR PASO'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Ingrediente (Crear / Editar) */}
        {isIngModalOpen && (
          <div className="sd-modal-backdrop" onClick={() => setIsIngModalOpen(false)}>
            <div
              className="sd-card sd-table-detail-modal"
              style={{ maxWidth: 500 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="sd-modal-header">
                <h3 className="sd-card-title" style={{ margin: 0, fontSize: 22 }}>
                  {editingIng ? 'Editar Ingrediente' : 'Nuevo Ingrediente'}
                </h3>
                <button
                  type="button"
                  className="sd-topbar-icon-btn"
                  onClick={() => setIsIngModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveIng} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                <div>
                  <label className="sd-input-label">NOMBRE DEL INGREDIENTE:</label>
                  <input
                    type="text"
                    required
                    value={ingForm.nombre}
                    onChange={(e) => setIngForm({ ...ingForm, nombre: e.target.value })}
                    placeholder="Ej: Aguacate Hass, Pollo a la plancha"
                    className="sd-input"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="sd-input-label">PRECIO EXTRA (COP):</label>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={ingForm.precio_extra}
                      onChange={(e) => setIngForm({ ...ingForm, precio_extra: e.target.value })}
                      placeholder="0 si no tiene recargo"
                      className="sd-input"
                    />
                  </div>
                  <div>
                    <label className="sd-input-label">CALORÍAS (KCAL):</label>
                    <input
                      type="number"
                      min="0"
                      value={ingForm.calorias}
                      onChange={(e) => setIngForm({ ...ingForm, calorias: e.target.value })}
                      placeholder="Ej: 120"
                      className="sd-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="sd-input-label">ALÉRGENOS (SEPARADOS POR COMA):</label>
                  <input
                    type="text"
                    value={ingForm.alergenos}
                    onChange={(e) => setIngForm({ ...ingForm, alergenos: e.target.value })}
                    placeholder="Ej: Gluten, Lácteos, Maní"
                    className="sd-input"
                  />
                </div>

                <div>
                  <label className="sd-input-label">URL IMAGEN (UNSPLASH / PEXELS):</label>
                  <input
                    type="url"
                    value={ingForm.url_imagen}
                    onChange={(e) => setIngForm({ ...ingForm, url_imagen: e.target.value })}
                    placeholder="https://images.unsplash.com/..."
                    className="sd-input"
                  />
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'var(--sd-font-heading)', fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={ingForm.disponible}
                      onChange={(e) => setIngForm({ ...ingForm, disponible: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: 'var(--sd-white)' }}
                    />
                    <span>DISPONIBLE EN CARTA (NO AGOTADO)</span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--sd-border)', paddingTop: 14 }}>
                  <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setIsIngModalOpen(false)}>
                    CANCELAR
                  </button>
                  <button type="submit" className="sd-btn sd-btn-primary">
                    {editingIng ? 'ACTUALIZAR INGREDIENTE' : 'GUARDAR INGREDIENTE'}
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
