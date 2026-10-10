import { useState } from 'react'
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
} from 'lucide-react'
import {
  dishes as initialDishes,
  categories as initialCategories,
} from '../constants/mockData'

export function Menu() {
  const [dishesList, setDishesList] = useState(initialDishes)
  const [categoriesList, setCategoriesList] = useState(initialCategories)
  const [activeCategory, setActiveCategory] = useState('Todas')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)

  // Modales
  const [isDishModalOpen, setIsDishModalOpen] = useState(false)
  const [editingDish, setEditingDish] = useState(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)

  // Form states para plato
  const [dishForm, setDishForm] = useState({
    name: '',
    categoryName: 'Hamburguesas & Fuertes',
    price: '',
    prepTime: '15',
    tag: 'Especial',
    description: '',
    imageUrl: '',
    available: true,
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

  // Toggle de disponibilidad (Control de Inventario)
  const handleToggleAvailability = (dishId) => {
    setDishesList((prev) =>
      prev.map((d) => (d.id === dishId ? { ...d, available: !d.available } : d))
    )
  }

  // Abrir modal de creación/edición de plato
  const handleOpenDishModal = (dish = null) => {
    if (dish) {
      setEditingDish(dish)
      setDishForm({
        name: dish.name,
        categoryName: dish.categoryName,
        price: dish.price.toString(),
        prepTime: dish.prepTime.toString(),
        tag: dish.tag || 'General',
        description: dish.description,
        imageUrl: dish.imageUrl,
        available: dish.available,
      })
    } else {
      setEditingDish(null)
      setDishForm({
        name: '',
        categoryName: categoriesList[0]?.name || 'Entradas',
        price: '',
        prepTime: '15',
        tag: 'Popular',
        description: '',
        imageUrl: '',
        available: true,
      })
    }
    setIsDishModalOpen(true)
  }

  // Guardar plato (creación o edición)
  const handleSaveDish = (e) => {
    e.preventDefault()
    const numericPrice = parseFloat(dishForm.price) || 0
    const numericTime = parseInt(dishForm.prepTime, 10) || 15

    if (editingDish) {
      setDishesList((prev) =>
        prev.map((d) =>
          d.id === editingDish.id
            ? {
                ...d,
                name: dishForm.name,
                categoryName: dishForm.categoryName,
                price: numericPrice,
                priceFormatted: `$${numericPrice.toFixed(2)}`,
                prepTime: numericTime,
                tag: dishForm.tag,
                description: dishForm.description,
                imageUrl: dishForm.imageUrl || d.imageUrl,
                available: dishForm.available,
              }
            : d
        )
      )
    } else {
      const newDish = {
        id: Date.now(),
        name: dishForm.name,
        categoryName: dishForm.categoryName,
        price: numericPrice,
        priceFormatted: `$${numericPrice.toFixed(2)}`,
        prepTime: numericTime,
        tag: dishForm.tag,
        description: dishForm.description,
        imageUrl:
          dishForm.imageUrl ||
          'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80',
        available: dishForm.available,
      }
      setDishesList((prev) => [newDish, ...prev])
    }
    setIsDishModalOpen(false)
  }

  // Eliminar plato
  const handleDeleteDish = (dishId) => {
    if (window.confirm('¿Estás seguro de archivar este plato de la carta?')) {
      setDishesList((prev) => prev.filter((d) => d.id !== dishId))
    }
  }

  // Guardar nueva categoría
  const handleSaveCategory = (e) => {
    e.preventDefault()
    if (!categoryForm.name.trim()) return

    const newCat = {
      id: Date.now(),
      name: categoryForm.name.trim(),
      description: categoryForm.description.trim(),
    }

    setCategoriesList((prev) => [...prev, newCat])
    setCategoryForm({ name: '', description: '' })
  }

  return (
    <main className="main-panel menu-page">
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
        {filteredDishes.length === 0 ? (
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
                  {dish.tag && <span className="dish-card-tag">{dish.tag}</span>}
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

                    {/* Acciones de Edición */}
                    <div className="dish-actions">
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
                        title="Archivar plato"
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
                    Configuración de precio, tiempos e inventario
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
                  placeholder="Ej. Lomo Saltado Criollo"
                  value={dishForm.name}
                  onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Categoría:</label>
                <select
                  value={dishForm.categoryName}
                  onChange={(e) => setDishForm({ ...dishForm, categoryName: e.target.value })}
                >
                  {categoriesList.map((cat) => (
                    <option key={cat.id} value={cat.name}>
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
                    step="0.5"
                    min="0"
                    required
                    placeholder="25.00"
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
                <label>Descripción / Ingredientes:</label>
                <textarea
                  rows="3"
                  placeholder="Describe la preparación, guarniciones y notas para alérgenos..."
                  value={dishForm.description}
                  onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                ></textarea>
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
                <button type="submit" className="primary-button">
                  {editingDish ? 'Guardar Cambios' : 'Crear Plato'}
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
                    <div key={cat.id} className="cat-item-row">
                      <div>
                        <strong>{cat.name}</strong>
                        <p>{cat.description || 'Sin descripción'}</p>
                      </div>
                      <span className="badge-count">
                        {dishesList.filter((d) => d.categoryName === cat.name).length} platos
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
