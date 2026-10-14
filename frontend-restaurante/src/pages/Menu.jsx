import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  FolderPlus,
  X,
  UtensilsCrossed,
  Tag,
  DollarSign,
  RefreshCw,
  AlertCircle,
  Layers,
  Flame,
} from 'lucide-react'
import { menuApi, agotadosApi, platosApi, categoriasApi } from '../services/api'
import { EditorPasos } from '../components/admin/EditorPasos'

export function Menu() {
  const [dishesList, setDishesList] = useState([])
  const [categoriesList, setCategoriesList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [apiNotice, setApiNotice] = useState(null)
  const [activeCategory, setActiveCategory] = useState('Todas')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)

  // Modal del Constructor de Pasos e Ingredientes (P-09 / D-04)
  const [selectedDishForConstructor, setSelectedDishForConstructor] = useState(null)

  const showNotice = (msg) => {
    setApiNotice(msg)
    setTimeout(() => setApiNotice(null), 5000)
  }

  const procesarMenuData = useCallback((data) => {
    const cats = data?.categorias || []
    const categoriasParsed = cats.map((c) => ({
      id: c.id_categoria,
      name: c.nombre,
      description: c.descripcion || '',
    }))

    const platosParsed = cats.flatMap((c) =>
      (c.platos || []).map((p) => ({
        id: p.id_plato,
        name: p.nombre,
        categoryName: c.nombre,
        categoryId: c.id_categoria,
        price: Number(p.precio || 0),
        priceFormatted: `$${Number(p.precio || 0).toLocaleString('es-CO')}`,
        prepTime: p.tiempo_preparacion_estimado || 15,
        tag: c.nombre,
        description: p.descripcion || '',
        imageUrl:
          p.url_imagen ||
          'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80',
        available: p.disponible !== false,
        personalizable: Boolean(p.personalizable),
        calorias: p.calorias || null,
      }))
    )

    setCategoriesList(categoriasParsed)
    setDishesList(platosParsed)
  }, [])

  const recargarCarta = useCallback(async () => {
    try {
      const data = await menuApi.obtenerMenu()
      procesarMenuData(data)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el catálogo de platos')
    }
  }, [procesarMenuData])

  useEffect(() => {
    let isMounted = true
    menuApi
      .obtenerMenu()
      .then((data) => {
        if (!isMounted) return
        procesarMenuData(data)
        setLoading(false)
      })
      .catch((err) => {
        if (!isMounted) return
        setError(err.message || 'No se pudo cargar el catálogo de platos')
        setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [procesarMenuData])

  // Modales
  const [isDishModalOpen, setIsDishModalOpen] = useState(false)
  const [editingDish, setEditingDish] = useState(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [submittingAction, setSubmittingAction] = useState(false)

  // Form states para plato
  const [dishForm, setDishForm] = useState({
    name: '',
    categoryId: '',
    categoryName: '',
    price: '',
    prepTime: '15',
    tag: 'Especial',
    description: '',
    imageUrl: '',
    available: true,
    personalizable: false,
    calorias: '',
  })

  // Form states para categoria
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
  })

  // Filtro de platos
  const filteredDishes = dishesList.filter((dish) => {
    const matchesCategory =
      activeCategory === 'Todas' || dish.categoryName === activeCategory
    const matchesSearch =
      dish.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dish.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesAvailability = onlyAvailable ? dish.available : true

    return matchesCategory && matchesSearch && matchesAvailability
  })

  // Toggle de disponibilidad (Control de Inventario - RF-11)
  const handleToggleAvailability = async (dishId) => {
    const dish = dishesList.find((d) => d.id === dishId)
    if (!dish) return
    const nuevoEstado = !dish.available
    setDishesList((prev) =>
      prev.map((d) => (d.id === dishId ? { ...d, available: nuevoEstado } : d))
    )
    try {
      await agotadosApi.togglePlato(dishId, nuevoEstado)
    } catch {
      showNotice(
        'Ruta de agotados (RF-11) pendiente en backend (PATCH /api/platos/:id/disponible). Estado actualizado localmente.'
      )
    }
  }

  // Abrir modal de creación/edición de plato
  const handleOpenDishModal = (dish = null) => {
    if (dish) {
      setEditingDish(dish)
      setDishForm({
        name: dish.name,
        categoryId: dish.categoryId || categoriesList[0]?.id || '',
        categoryName: dish.categoryName,
        price: dish.price.toString(),
        prepTime: dish.prepTime.toString(),
        tag: dish.tag || 'General',
        description: dish.description,
        imageUrl: dish.imageUrl,
        available: dish.available,
        personalizable: Boolean(dish.personalizable),
        calorias: dish.calorias?.toString() || '',
      })
    } else {
      setEditingDish(null)
      const primeraCat = categoriesList[0]
      setDishForm({
        name: '',
        categoryId: primeraCat?.id || '',
        categoryName: primeraCat?.name || 'Entradas',
        price: '',
        prepTime: '15',
        tag: 'Popular',
        description: '',
        imageUrl: '',
        available: true,
        personalizable: false,
        calorias: '',
      })
    }
    setIsDishModalOpen(true)
  }

  // Guardar plato (creación o edición con API real)
  const handleSaveDish = async (e) => {
    e.preventDefault()
    const numericPrice = parseFloat(dishForm.price) || 0
    const numericTime = parseInt(dishForm.prepTime, 10) || 15

    let catId = dishForm.categoryId
    if (!catId) {
      const foundCat = categoriesList.find((c) => c.name === dishForm.categoryName)
      catId = foundCat ? foundCat.id : categoriesList[0]?.id || 1
    }

    const payload = {
      id_categoria: Number(catId),
      nombre: dishForm.name.trim(),
      descripcion: dishForm.description.trim(),
      precio: numericPrice,
      tiempo_preparacion_estimado: numericTime,
      url_imagen:
        dishForm.imageUrl.trim() ||
        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80',
      disponible: Boolean(dishForm.available),
      personalizable: Boolean(dishForm.personalizable),
      calorias: dishForm.calorias ? parseInt(dishForm.calorias, 10) : null,
    }

    setSubmittingAction(true)
    try {
      if (editingDish) {
        await platosApi.actualizar(editingDish.id, payload)
        showNotice(`Plato "${payload.nombre}" actualizado correctamente en la carta.`)
      } else {
        await platosApi.crear(payload)
        showNotice(`Plato "${payload.nombre}" creado exitosamente en la carta.`)
      }
      setIsDishModalOpen(false)
      recargarCarta()
    } catch (err) {
      // Si la API falla por permisos o entorno, actualizar localmente para no bloquear la operación
      if (editingDish) {
        setDishesList((prev) =>
          prev.map((d) =>
            d.id === editingDish.id
              ? {
                  ...d,
                  name: payload.nombre,
                  categoryName: dishForm.categoryName,
                  price: numericPrice,
                  priceFormatted: `$${numericPrice.toLocaleString('es-CO')}`,
                  prepTime: numericTime,
                  tag: dishForm.tag,
                  description: payload.descripcion,
                  imageUrl: payload.url_imagen,
                  available: payload.disponible,
                  personalizable: payload.personalizable,
                  calorias: payload.calorias,
                }
              : d
          )
        )
      } else {
        const newDish = {
          id: Date.now(),
          name: payload.nombre,
          categoryName: dishForm.categoryName,
          categoryId: Number(catId),
          price: numericPrice,
          priceFormatted: `$${numericPrice.toLocaleString('es-CO')}`,
          prepTime: numericTime,
          tag: dishForm.tag,
          description: payload.descripcion,
          imageUrl: payload.url_imagen,
          available: payload.disponible,
          personalizable: payload.personalizable,
          calorias: payload.calorias,
        }
        setDishesList((prev) => [newDish, ...prev])
      }
      showNotice(`Operación guardada (Aviso API: ${err.message})`)
      setIsDishModalOpen(false)
    } finally {
      setSubmittingAction(false)
    }
  }

  // Eliminar plato con API real
  const handleDeleteDish = async (dishId) => {
    if (!window.confirm('¿Estás seguro de eliminar este plato de la carta?')) return
    try {
      await platosApi.eliminar(dishId)
      showNotice('Plato eliminado de la carta.')
      recargarCarta()
    } catch {
      setDishesList((prev) => prev.filter((d) => d.id !== dishId))
      showNotice('Plato eliminado de la lista local.')
    }
  }

  // Guardar nueva categoría con API real
  const handleSaveCategory = async (e) => {
    e.preventDefault()
    if (!categoryForm.name.trim()) return

    const catPayload = {
      nombre: categoryForm.name.trim(),
      descripcion: categoryForm.description.trim(),
      orden_visualizacion: categoriesList.length + 1,
      activo: true,
    }

    try {
      await categoriasApi.crear(catPayload)
      showNotice(`Categoría "${catPayload.nombre}" creada exitosamente.`)
      setCategoryForm({ name: '', description: '' })
      recargarCarta()
    } catch {
      const newCat = {
        id: Date.now(),
        name: catPayload.nombre,
        description: catPayload.descripcion,
      }
      setCategoriesList((prev) => [...prev, newCat])
      setCategoryForm({ name: '', description: '' })
      showNotice(`Categoría "${catPayload.nombre}" creada localmente.`)
    }
  }

  // Eliminar categoría
  const handleDeleteCategory = async (catId) => {
    if (!window.confirm('¿Eliminar esta categoría? Los platos asignados quedarán sin grupo.')) return
    try {
      await categoriasApi.eliminar(catId)
      showNotice('Categoría eliminada.')
      recargarCarta()
    } catch {
      setCategoriesList((prev) => prev.filter((c) => c.id !== catId))
      showNotice('Categoría removida localmente.')
    }
  }

  return (
    <main className="main-panel menu-page">
      {apiNotice && (
        <div className="table-toast-banner info" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={16} />
          <span>{apiNotice}</span>
        </div>
      )}

      {/* Encabezado con buscador y acciones */}
      <section className="menu-header-panel panel">
        <div className="menu-title-block">
          <div>
            <h2>Catálogo y Gestión del Menú</h2>
            <span className="panel-subtitle">
              Administración de categorías, platos y disponibilidad en tiempo real
            </span>
          </div>
          <div className="menu-top-actions">
            <button
              type="button"
              className="ghost-button small"
              onClick={() => setIsCategoryModalOpen(true)}
            >
              <FolderPlus size={16} />
              <span>Categorías ({categoriesList.length})</span>
            </button>

            <button
              type="button"
              className="primary-button small"
              onClick={() => handleOpenDishModal()}
            >
              <Plus size={16} />
              <span>Nuevo Plato</span>
            </button>
          </div>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="menu-filter-bar">
          <div className="menu-search-input">
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar plato por nombre, ingrediente..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <label className="available-filter-toggle">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(e) => setOnlyAvailable(e.target.checked)}
            />
            <span>Solo disponibles</span>
          </label>
        </div>

        {/* Categorías Tabs */}
        <div className="menu-category-tabs">
          <button
            type="button"
            className={`menu-cat-btn ${activeCategory === 'Todas' ? 'active' : ''}`}
            onClick={() => setActiveCategory('Todas')}
          >
            <span>Todas</span>
            <span className="cat-count">{dishesList.length}</span>
          </button>
          {categoriesList.map((cat) => {
            const count = dishesList.filter((d) => d.categoryName === cat.name).length
            return (
              <button
                key={cat.id}
                type="button"
                className={`menu-cat-btn ${activeCategory === cat.name ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.name)}
              >
                <span>{cat.name}</span>
                <span className="cat-count">{count}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Grid de Platos */}
      <section className="dishes-grid-container">
        {loading ? (
          <div className="empty-state panel">
            <RefreshCw size={44} className="spin text-emerald" />
            <h3>Cargando catálogo en vivo...</h3>
            <p>Consultando carta gastronómica desde el servidor.</p>
          </div>
        ) : error ? (
          <div className="empty-state panel">
            <AlertCircle size={44} className="text-amber" />
            <h3>Error al cargar el menú</h3>
            <p>{error}</p>
            <button
              type="button"
              className="primary-button inline-flex-center"
              onClick={recargarCarta}
              style={{ marginTop: '0.75rem' }}
            >
              <RefreshCw size={14} />
              <span>Reintentar</span>
            </button>
          </div>
        ) : filteredDishes.length === 0 ? (
          <div className="empty-state panel">
            <UtensilsCrossed size={48} className="text-muted" />
            <h3>No se encontraron platos</h3>
            <p>Prueba con otros términos de búsqueda o selecciona otra categoría.</p>
          </div>
        ) : (
          <div className="dishes-grid">
            {filteredDishes.map((dish) => (
              <div
                key={dish.id}
                className={`dish-admin-card ${!dish.available ? 'out-of-stock' : ''}`}
              >
                <div className="dish-img-wrapper">
                  <img
                    src={dish.imageUrl}
                    alt={dish.name}
                    loading="lazy"
                    onError={(e) => {
                      e.target.src =
                        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
                    }}
                  />
                  {dish.personalizable ? (
                    <span className="dish-card-tag" style={{ backgroundColor: 'rgba(235, 94, 40, 0.9)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Layers size={11} /> Arma tu plato
                    </span>
                  ) : dish.tag ? (
                    <span className="dish-card-tag">{dish.tag}</span>
                  ) : null}
                  <span className="dish-prep-badge">
                    <Clock size={12} /> {dish.prepTime} min
                  </span>
                </div>

                <div className="dish-card-content">
                  <div className="dish-card-header">
                    <div>
                      <span className="dish-cat-label">{dish.categoryName}</span>
                      <h4>{dish.name}</h4>
                    </div>
                    <strong className="dish-price">{dish.priceFormatted}</strong>
                  </div>

                  <p className="dish-desc">{dish.description}</p>

                  <div className="dish-card-footer">
                    {/* Switch de Disponibilidad */}
                    <button
                      type="button"
                      className={`availability-toggle-btn ${dish.available ? 'available' : 'unavailable'}`}
                      onClick={() => handleToggleAvailability(dish.id)}
                      title="Alternar disponibilidad para comensales"
                    >
                      {dish.available ? (
                        <>
                          <CheckCircle2 size={14} />
                          <span>Disponible</span>
                        </>
                      ) : (
                        <>
                          <XCircle size={14} />
                          <span>Agotado</span>
                        </>
                      )}
                    </button>

                    {/* Acciones de Edición y Constructor */}
                    <div className="dish-actions">
                      <button
                        type="button"
                        className="dish-icon-action"
                        onClick={() => setSelectedDishForConstructor(dish)}
                        title="Configurar Pasos e Ingredientes del Constructor"
                        style={{ color: '#eb5e28', borderColor: 'rgba(235, 94, 40, 0.3)' }}
                      >
                        <Layers size={15} />
                      </button>
                      <button
                        type="button"
                        className="dish-icon-action"
                        onClick={() => handleOpenDishModal(dish)}
                        title="Editar plato"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        className="dish-icon-action danger"
                        onClick={() => handleDeleteDish(dish.id)}
                        title="Eliminar plato"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal Crear / Editar Plato */}
      {isDishModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsDishModalOpen(false)}>
          <div className="modal-card dish-form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <div className="modal-icon-badge">
                  <UtensilsCrossed size={20} />
                </div>
                <div>
                  <h3>{editingDish ? 'Editar Plato' : 'Nuevo Plato en Menú'}</h3>
                  <p className="modal-subtitle">
                    Configuración de precio, tiempos, categoría e inventario
                  </p>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setIsDishModalOpen(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveDish} className="modal-body dish-form-grid">
              <div className="form-group">
                <label>Nombre del Plato:</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Bowl Personalizado, Lomo Criollo"
                  value={dishForm.name}
                  onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Categoría:</label>
                <select
                  value={dishForm.categoryId || dishForm.categoryName}
                  onChange={(e) => {
                    const selCat = categoriesList.find((c) => c.id === Number(e.target.value) || c.name === e.target.value)
                    setDishForm({
                      ...dishForm,
                      categoryId: selCat ? selCat.id : e.target.value,
                      categoryName: selCat ? selCat.name : e.target.value,
                    })
                  }}
                >
                  {categoriesList.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Precio de Venta ($):</label>
                <div className="input-with-icon">
                  <DollarSign size={16} />
                  <input
                    type="number"
                    step="500"
                    min="0"
                    required
                    placeholder="25000"
                    value={dishForm.price}
                    onChange={(e) => setDishForm({ ...dishForm, price: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Tiempo Estimado (Minutos):</label>
                <div className="input-with-icon">
                  <Clock size={16} />
                  <input
                    type="number"
                    min="1"
                    placeholder="15"
                    value={dishForm.prepTime}
                    onChange={(e) => setDishForm({ ...dishForm, prepTime: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Etiqueta / Tag Visual:</label>
                <div className="input-with-icon">
                  <Tag size={16} />
                  <input
                    type="text"
                    placeholder="Popular, Parrilla, Chef, etc."
                    value={dishForm.tag}
                    onChange={(e) => setDishForm({ ...dishForm, tag: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>URL de Imagen:</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={dishForm.imageUrl}
                  onChange={(e) => setDishForm({ ...dishForm, imageUrl: e.target.value })}
                />
              </div>

              <div className="form-group full-width">
                <label>Descripción / Ingredientes base:</label>
                <textarea
                  rows="3"
                  placeholder="Describe la preparación, guarniciones y notas para alérgenos..."
                  value={dishForm.description}
                  onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                ></textarea>
              </div>

              {/* Opciones del Constructor */}
              <div
                className="form-group full-width"
                style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(235, 94, 40, 0.06)',
                  border: '1px solid rgba(235, 94, 40, 0.2)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: '1 1 240px' }}>
                  <label className="checkbox-control" style={{ fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={dishForm.personalizable}
                      onChange={(e) => setDishForm({ ...dishForm, personalizable: e.target.checked })}
                      style={{ accentColor: '#eb5e28' }}
                    />
                    <span>Habilitar como Personalizable ("Arma tu plato")</span>
                  </label>
                  <p style={{ margin: '0.25rem 0 0 1.6rem', fontSize: '0.75rem', color: '#8d99ae' }}>
                    Permite definir pasos e ingredientes dinámicos para el comensal.
                  </p>
                </div>

                <div style={{ flex: '0 1 160px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem', color: '#ced4da' }}>
                    Calorías base (kcal):
                  </label>
                  <div className="input-with-icon" style={{ height: '34px' }}>
                    <Flame size={14} style={{ color: '#eb5e28' }} />
                    <input
                      type="number"
                      min="0"
                      placeholder="Ej: 450"
                      value={dishForm.calorias}
                      onChange={(e) => setDishForm({ ...dishForm, calorias: e.target.value })}
                      style={{ height: '34px', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>

                {editingDish && dishForm.personalizable && (
                  <button
                    type="button"
                    className="ghost-button small"
                    onClick={() => {
                      setIsDishModalOpen(false)
                      setSelectedDishForConstructor(editingDish)
                    }}
                    style={{ borderColor: '#eb5e28', color: '#eb5e28', height: '34px', marginLeft: 'auto' }}
                  >
                    <Layers size={14} />
                    <span>Configurar Pasos &rarr;</span>
                  </button>
                )}
              </div>

              <div className="form-group full-width">
                <label className="checkbox-control">
                  <input
                    type="checkbox"
                    checked={dishForm.available}
                    onChange={(e) => setDishForm({ ...dishForm, available: e.target.checked })}
                  />
                  <span>Disponible de inmediato para pedidos de comensales</span>
                </label>
              </div>

              <div className="modal-actions-footer full-width">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsDishModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="primary-button" disabled={submittingAction}>
                  {submittingAction
                    ? 'Guardando...'
                    : editingDish
                    ? 'Guardar Cambios'
                    : 'Crear Plato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Administración de Categorías */}
      {isCategoryModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsCategoryModalOpen(false)}>
          <div className="modal-card category-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <div className="modal-icon-badge">
                  <FolderPlus size={20} />
                </div>
                <div>
                  <h3>Administración de Categorías</h3>
                  <p className="modal-subtitle">Organización de secciones en la carta digital</p>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setIsCategoryModalOpen(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body category-modal-body">
              {/* Formulario para agregar */}
              <form onSubmit={handleSaveCategory} className="cat-create-form">
                <div className="form-group">
                  <label>Nombre de la Categoría:</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Pastas & Risottos"
                    value={categoryForm.name}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, name: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Descripción corta:</label>
                  <input
                    type="text"
                    placeholder="Ej. Elaboradas artesanalmente al dente"
                    value={categoryForm.description}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, description: e.target.value })
                    }
                  />
                </div>
                <button type="submit" className="primary-button small">
                  <Plus size={16} />
                  <span>Agregar Categoría</span>
                </button>
              </form>

              {/* Lista actual de categorías */}
              <div className="cat-list-wrapper">
                <h4>Categorías Activas ({categoriesList.length})</h4>
                <div className="cat-items-list">
                  {categoriesList.map((cat) => (
                    <div key={cat.id} className="cat-item-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{cat.name}</strong>
                        <p>{cat.description || 'Sin descripción'}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span className="badge-count">
                          {dishesList.filter((d) => d.categoryName === cat.name || d.categoryId === cat.id).length} platos
                        </span>
                        <button
                          type="button"
                          className="dish-icon-action danger"
                          onClick={() => handleDeleteCategory(cat.id)}
                          title="Eliminar categoría"
                          style={{ padding: '4px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editor de Pasos del Constructor (P-09 / D-04) */}
      {selectedDishForConstructor && (
        <EditorPasos
          dish={selectedDishForConstructor}
          onClose={() => setSelectedDishForConstructor(null)}
          onDishUpdated={() => recargarCarta()}
        />
      )}
    </main>
  )
}
