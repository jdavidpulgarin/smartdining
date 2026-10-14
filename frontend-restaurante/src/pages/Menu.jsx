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
      name: c.nombre || c.categoria || '',
      description: c.descripcion || '',
    }))

    const platosParsed = cats.flatMap((c) => {
      const catNombre = c.nombre || c.categoria || 'General'
      return (c.platos || []).map((p) => ({
        id: p.id_plato,
        name: p.nombre,
        categoryName: catNombre,
        categoryId: c.id_categoria,
        price: Number(p.precio || 0),
        priceFormatted: `$${Number(p.precio || 0).toLocaleString('es-CO')}`,
        prepTime: p.tiempo_preparacion_estimado || 15,
        tag: catNombre,
        description: p.descripcion || '',
        imageUrl:
          p.url_imagen ||
          'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80',
        available: p.disponible !== false,
        personalizable: Boolean(p.personalizable),
        calorias: p.calorias || null,
      }))
    })

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
    <div className="sd-page-wrapper">
      {apiNotice && (
        <div className="table-toast-banner info" style={{ margin: '0 24px 1rem 24px' }}>
          <AlertCircle size={16} />
          <span>{apiNotice}</span>
        </div>
      )}

      {/* Encabezado Editorial con Acciones */}
      <div className="sd-page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 className="sd-page-title">MENÚ</h1>
            <p className="sd-page-subtitle">
              Administración de categorías, platos y disponibilidad en tiempo real
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              onClick={() => setIsCategoryModalOpen(true)}
            >
              <FolderPlus size={16} />
              <span>CATEGORÍAS ({categoriesList.length})</span>
            </button>
            <button
              type="button"
              className="sd-btn sd-btn-primary"
              onClick={() => handleOpenDishModal()}
            >
              <Plus size={16} />
              <span>NUEVO PLATO</span>
            </button>
          </div>
        </div>
      </div>

      {/* Franja Roja con Filtros de Categorías y Buscador */}
      <div className="sd-red-band">
        <div className="sd-red-band-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          {/* Categorías Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 2 }}>
            <button
              type="button"
              className={`sd-band-pill ${activeCategory === 'Todas' ? 'active' : ''}`}
              onClick={() => setActiveCategory('Todas')}
            >
              <span>TODAS</span>
              <span className="sd-pill-count">{dishesList.length}</span>
            </button>
            {categoriesList.map((cat) => {
              const catName = cat.name || ''
              const count = dishesList.filter((d) => d.categoryName === catName).length
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`sd-band-pill ${activeCategory === catName ? 'active' : ''}`}
                  onClick={() => setActiveCategory(catName)}
                >
                  <span>{catName.toUpperCase()}</span>
                  <span className="sd-pill-count">{count}</span>
                </button>
              )
            })}
          </div>

          {/* Buscador + Solo Disponibles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div className="sd-band-search-box">
              <Search size={14} aria-hidden="true" />
              <input
                type="text"
                placeholder="Buscar plato por nombre, ingrediente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="sd-band-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 2 }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', cursor: 'pointer', color: 'var(--sd-white)', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                style={{ accentColor: 'var(--sd-white)' }}
              />
              <span>SOLO DISPONIBLES</span>
            </label>
          </div>
        </div>
      </div>

      {/* Grid de Platos */}
      <div className="sd-page-container">
        {loading ? (
          <div className="sd-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <RefreshCw size={44} className="spin" style={{ color: 'var(--sd-white)', margin: '0 auto 16px auto', display: 'block' }} />
            <h3 className="sd-card-title">Cargando catálogo en vivo...</h3>
            <p style={{ color: 'var(--sd-text-muted)' }}>Consultando carta gastronómica desde el servidor.</p>
          </div>
        ) : error ? (
          <div className="sd-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <AlertCircle size={44} style={{ color: 'var(--sd-red)', margin: '0 auto 16px auto', display: 'block' }} />
            <h3 className="sd-card-title">Error al cargar el menú</h3>
            <p style={{ color: 'var(--sd-text-muted)' }}>{error}</p>
            <button
              type="button"
              className="sd-btn sd-btn-primary"
              onClick={recargarCarta}
              style={{ margin: '16px auto 0 auto' }}
            >
              <RefreshCw size={14} />
              <span>REINTENTAR</span>
            </button>
          </div>
        ) : filteredDishes.length === 0 ? (
          <div className="sd-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <UtensilsCrossed size={48} style={{ color: 'var(--sd-text-muted)', margin: '0 auto 16px auto', display: 'block' }} />
            <h3 className="sd-card-title">No se encontraron platos</h3>
            <p style={{ color: 'var(--sd-text-muted)' }}>Prueba con otros términos de búsqueda o selecciona otra categoría.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
            {filteredDishes.map((dish) => (
              <div
                key={dish.id}
                className="sd-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: 0,
                  opacity: dish.available ? 1 : 0.65,
                  borderTop: !dish.available
                    ? '4px solid var(--sd-red)'
                    : dish.personalizable
                    ? '4px solid var(--sd-gold)'
                    : '4px solid var(--sd-border-strong)',
                }}
              >
                <div style={{ position: 'relative', width: '100%', height: 180, background: '#0a0807', overflow: 'hidden' }}>
                  <img
                    src={dish.imageUrl}
                    alt={dish.name}
                    loading="lazy"
                    onError={(e) => {
                      e.target.src =
                        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {dish.personalizable ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        padding: '4px 10px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 800,
                        fontFamily: 'var(--sd-font-heading)',
                        letterSpacing: '0.04em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'var(--sd-gold)',
                        color: 'var(--sd-gold-text)',
                      }}
                    >
                      <Layers size={12} /> Arma tu plato
                    </span>
                  ) : dish.tag ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        padding: '4px 10px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 800,
                        fontFamily: 'var(--sd-font-heading)',
                        letterSpacing: '0.04em',
                        background: 'rgba(30, 26, 25, 0.9)',
                        color: 'var(--sd-text-muted)',
                        border: '1px solid var(--sd-border)',
                      }}
                    >
                      {dish.tag}
                    </span>
                  ) : null}
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: 'var(--sd-font-heading)',
                      background: 'rgba(0,0,0,0.75)',
                      color: 'var(--sd-text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Clock size={12} /> {dish.prepTime} min
                  </span>
                </div>

                <div style={{ padding: 18, display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <div>
                        <span style={{ color: 'var(--sd-text-muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--sd-font-heading)', fontWeight: 700 }}>
                          {dish.categoryName}
                        </span>
                        <h4 style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 22, fontWeight: 800, margin: '2px 0 0 0', color: 'var(--sd-text)' }}>
                          {dish.name}
                        </h4>
                      </div>
                      <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 20, fontWeight: 800, color: 'var(--sd-white)', whiteSpace: 'nowrap' }}>
                        {dish.priceFormatted}
                      </strong>
                    </div>

                    <p style={{ fontSize: 13, color: 'var(--sd-text-muted)', margin: 0, lineClamp: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {dish.description || 'Sin descripción disponible.'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--sd-border)', paddingTop: 12, marginTop: 'auto' }}>
                    {/* Disponibilidad (sin verde: disponible en BLANCO, agotado en ROJO) */}
                    <button
                      type="button"
                      onClick={() => handleToggleAvailability(dish.id)}
                      title="Alternar disponibilidad para comensales"
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: 'var(--sd-font-heading)',
                        letterSpacing: '0.04em',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: dish.available ? 'var(--sd-surface)' : 'var(--sd-red)',
                        color: 'var(--sd-white)',
                        border: dish.available ? '1px solid var(--sd-border-strong)' : 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {dish.available ? (
                        <>
                          <CheckCircle2 size={13} />
                          <span>DISPONIBLE</span>
                        </>
                      ) : (
                        <>
                          <XCircle size={13} />
                          <span>AGOTADO</span>
                        </>
                      )}
                    </button>

                    {/* Acciones */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        className="sd-topbar-icon-btn"
                        onClick={() => setSelectedDishForConstructor(dish)}
                        title="Configurar Pasos e Ingredientes del Constructor"
                        style={{
                          width: 36,
                          height: 36,
                          border: '1px solid var(--sd-border-strong)',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: dish.personalizable ? 'var(--sd-gold)' : 'var(--sd-text)',
                        }}
                      >
                        <Layers size={16} />
                      </button>
                      <button
                        type="button"
                        className="sd-topbar-icon-btn"
                        onClick={() => handleOpenDishModal(dish)}
                        title="Editar plato"
                        style={{ width: 36, height: 36, border: '1px solid var(--sd-border-strong)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        className="sd-topbar-icon-btn"
                        onClick={() => handleDeleteDish(dish.id)}
                        title="Eliminar plato"
                        style={{ width: 36, height: 36, border: '1px solid var(--sd-border-strong)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sd-red-text)' }}
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
      </div>

      {/* Modal Crear / Editar Plato */}
      {isDishModalOpen && (
        <div className="sd-modal-backdrop" onClick={() => setIsDishModalOpen(false)}>
          <div
            className="sd-card sd-table-detail-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 640 }}
          >
            <div className="sd-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <UtensilsCrossed size={22} style={{ color: 'var(--sd-white)' }} />
                <div>
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 24 }}>
                    {editingDish ? 'Editar Plato' : 'Nuevo Plato en Menú'}
                  </h3>
                  <small style={{ color: 'var(--sd-text-muted)' }}>
                    Configuración de precio, tiempos, categoría e inventario
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="sd-topbar-icon-btn"
                onClick={() => setIsDishModalOpen(false)}
                aria-label="Cerrar modal"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveDish} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label className="sd-input-label">NOMBRE DEL PLATO</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Bowl Personalizado, Lomo Criollo"
                    value={dishForm.name}
                    onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                    className="sd-input"
                  />
                </div>

                <div>
                  <label className="sd-input-label">CATEGORÍA</label>
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
                    className="sd-input"
                  >
                    {categoriesList.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label className="sd-input-label">PRECIO DE VENTA ($)</label>
                  <div style={{ position: 'relative' }}>
                    <DollarSign size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--sd-text-muted)' }} />
                    <input
                      type="number"
                      step="500"
                      min="0"
                      required
                      placeholder="25000"
                      value={dishForm.price}
                      onChange={(e) => setDishForm({ ...dishForm, price: e.target.value })}
                      className="sd-input"
                      style={{ paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div>
                  <label className="sd-input-label">TIEMPO ESTIMADO (MIN)</label>
                  <div style={{ position: 'relative' }}>
                    <Clock size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--sd-text-muted)' }} />
                    <input
                      type="number"
                      min="1"
                      placeholder="15"
                      value={dishForm.prepTime}
                      onChange={(e) => setDishForm({ ...dishForm, prepTime: e.target.value })}
                      className="sd-input"
                      style={{ paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div>
                  <label className="sd-input-label">TAG VISUAL</label>
                  <div style={{ position: 'relative' }}>
                    <Tag size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--sd-text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Popular, Parrilla, Chef"
                      value={dishForm.tag}
                      onChange={(e) => setDishForm({ ...dishForm, tag: e.target.value })}
                      className="sd-input"
                      style={{ paddingLeft: 32 }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="sd-input-label">URL DE IMAGEN</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={dishForm.imageUrl}
                  onChange={(e) => setDishForm({ ...dishForm, imageUrl: e.target.value })}
                  className="sd-input"
                />
              </div>

              <div>
                <label className="sd-input-label">DESCRIPCIÓN / INGREDIENTES BASE</label>
                <textarea
                  rows="3"
                  placeholder="Describe la preparación, guarniciones y notas para alérgenos..."
                  value={dishForm.description}
                  onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                  className="sd-input"
                  style={{ resize: 'vertical' }}
                ></textarea>
              </div>

              {/* Opciones del Constructor */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  backgroundColor: 'rgba(224, 165, 38, 0.08)',
                  border: '1px solid rgba(224, 165, 38, 0.25)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: '1 1 240px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={dishForm.personalizable}
                      onChange={(e) => setDishForm({ ...dishForm, personalizable: e.target.checked })}
                      style={{ accentColor: 'var(--sd-gold)' }}
                    />
                    <span>HABILITAR COMO PERSONALIZABLE ("ARMA TU PLATO")</span>
                  </label>
                  <p style={{ margin: '4px 0 0 24px', fontSize: 12, color: 'var(--sd-text-muted)' }}>
                    Permite definir pasos e ingredientes dinámicos para el comensal.
                  </p>
                </div>

                <div style={{ flex: '0 1 160px' }}>
                  <label className="sd-input-label">CALORÍAS (KCAL)</label>
                  <div style={{ position: 'relative' }}>
                    <Flame size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--sd-gold)' }} />
                    <input
                      type="number"
                      min="0"
                      placeholder="450"
                      value={dishForm.calorias}
                      onChange={(e) => setDishForm({ ...dishForm, calorias: e.target.value })}
                      className="sd-input"
                      style={{ paddingLeft: 30, height: 36, fontSize: 13 }}
                    />
                  </div>
                </div>

                {editingDish && dishForm.personalizable && (
                  <button
                    type="button"
                    className="sd-btn sd-btn-secondary"
                    onClick={() => {
                      setIsDishModalOpen(false)
                      setSelectedDishForConstructor(editingDish)
                    }}
                    style={{ borderColor: 'var(--sd-gold)', color: 'var(--sd-gold)', height: 36, marginLeft: 'auto', fontSize: 13 }}
                  >
                    <Layers size={14} />
                    <span>Configurar Pasos &rarr;</span>
                  </button>
                )}
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dishForm.available}
                    onChange={(e) => setDishForm({ ...dishForm, available: e.target.checked })}
                    style={{ accentColor: 'var(--sd-white)' }}
                  />
                  <span>DISPONIBLE DE INMEDIATO PARA PEDIDOS</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--sd-border)', paddingTop: 16 }}>
                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={() => setIsDishModalOpen(false)}
                >
                  CANCELAR
                </button>
                <button type="submit" className="sd-btn sd-btn-primary" disabled={submittingAction}>
                  {submittingAction
                    ? 'GUARDANDO...'
                    : editingDish
                    ? 'GUARDAR CAMBIOS'
                    : 'CREAR PLATO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Administración de Categorías */}
      {isCategoryModalOpen && (
        <div className="sd-modal-backdrop" onClick={() => setIsCategoryModalOpen(false)}>
          <div
            className="sd-card sd-table-detail-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 540 }}
          >
            <div className="sd-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <FolderPlus size={22} style={{ color: 'var(--sd-white)' }} />
                <div>
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 24 }}>
                    Administración de Categorías
                  </h3>
                  <small style={{ color: 'var(--sd-text-muted)' }}>
                    Organización de secciones en la carta digital
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="sd-topbar-icon-btn"
                onClick={() => setIsCategoryModalOpen(false)}
                aria-label="Cerrar modal"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Formulario para agregar */}
              <form onSubmit={handleSaveCategory} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'rgba(0,0,0,0.25)', borderRadius: 8 }}>
                <div>
                  <label className="sd-input-label">NOMBRE DE LA CATEGORÍA</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Pastas & Risottos"
                    value={categoryForm.name}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, name: e.target.value })
                    }
                    className="sd-input"
                  />
                </div>
                <div>
                  <label className="sd-input-label">DESCRIPCIÓN CORTA</label>
                  <input
                    type="text"
                    placeholder="Ej. Elaboradas artesanalmente al dente"
                    value={categoryForm.description}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, description: e.target.value })
                    }
                    className="sd-input"
                  />
                </div>
                <button type="submit" className="sd-btn sd-btn-primary" style={{ alignSelf: 'flex-start' }}>
                  <Plus size={16} />
                  <span>AGREGAR CATEGORÍA</span>
                </button>
              </form>

              {/* Lista actual de categorías */}
              <div>
                <h4 style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 18, color: 'var(--sd-text)', margin: '0 0 10px 0' }}>
                  Categorías Activas ({categoriesList.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                  {categoriesList.map((cat) => (
                    <div
                      key={cat.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: 'var(--sd-surface)',
                        border: '1px solid var(--sd-border)',
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <strong style={{ fontFamily: 'var(--sd-font-heading)', fontSize: 16, color: 'var(--sd-text)' }}>{cat.name}</strong>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--sd-text-muted)' }}>{cat.description || 'Sin descripción'}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--sd-font-heading)', color: 'var(--sd-text-muted)' }}>
                          {dishesList.filter((d) => d.categoryName === cat.name || d.categoryId === cat.id).length} platos
                        </span>
                        <button
                          type="button"
                          className="sd-topbar-icon-btn"
                          onClick={() => handleDeleteCategory(cat.id)}
                          title="Eliminar categoría"
                          style={{ width: 32, height: 32, color: 'var(--sd-red-text)', border: '1px solid var(--sd-border)' }}
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
    </div>
  )
}
