import { useState, useEffect, useCallback, useContext, useRef } from 'react'
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
import { agotadosApi, platosApi, categoriasApi, mensajeNoGuardado } from '../services/api'
import { EditorPasos } from '../components/admin/EditorPasos'
import { HistorialPrecios } from '../components/admin/HistorialPrecios'
import { SubirImagen } from '../components/admin/SubirImagen'
import { AuthContext } from '../context/authContextDef'
import { useSocketListener } from '../hooks'
import { crearUltimoPorId } from '../utils/dedupeEventos'
import { confirmacionAlCambiar, ETIQUETA_DISPONIBILIDAD, NO_DISPONIBLE } from '../utils/disponibilidadPlato'
import { urlImagenGuardable, MENSAJE_URL_IMAGEN, fotoDePlato, FOTO_AREPA, esArepaRellena } from '../utils/imagenes'
import '../styles/menu.css'

/**
 * Carta para ADMINISTRAR: todas las categorías y TODOS los platos, también los
 * agotados. GET /menu no sirve aquí: es la carta del comensal y solo trae los
 * platos disponibles, así que un plato agotado desaparecería del panel y no
 * habría cómo reponerlo.
 */
/** Lo que ve el comensal: encendido a mano Y con stock para una unidad. */
const estaDisponible = (dish) => dish.available && dish.stockOk !== false

// Fotos SOLO para pintar la tarjeta; nunca se mandan como url_imagen.
const FOTO_RESPALDO = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'

async function obtenerCartaAdmin() {
  const [respCategorias, respPlatos] = await Promise.all([categoriasApi.listar(), platosApi.listar()])
  const platos = respPlatos?.platos || []
  return {
    categorias: (respCategorias?.categorias || []).map((c) => ({
      ...c,
      platos: platos.filter((p) => p.id_categoria === c.id_categoria),
    })),
  }
}

export function Menu() {
  const [dishesList, setDishesList] = useState([])
  const [categoriesList, setCategoriesList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [apiNotice, setApiNotice] = useState(null)
  const [apiNoticeTipo, setApiNoticeTipo] = useState('info')
  const [activeCategory, setActiveCategory] = useState('Todas')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)

  // Modal del Constructor de Pasos e Ingredientes (P-09 / D-04)
  const [selectedDishForConstructor, setSelectedDishForConstructor] = useState(null)

  // "Ver historial" de precios (P-21, P2). GET /platos/:id/historial-precios es
  // solo de admin y Menú lo ven todos los roles del panel: al resto no se le
  // ofrece un enlace que terminaría en 403. Se lee el contexto sin useAuth para
  // no exigir un AuthProvider (sin sesión, no hay enlace).
  const sesion = useContext(AuthContext)
  const esAdmin = sesion?.user?.rol === 'admin'
  // Crear, editar y borrar platos y categorías, configurar pasos y cambiar la
  // disponibilidad son solo de admin en el backend (la disponibilidad también de
  // cocina, que no usa el panel). Al mesero y al cajero el Menú les queda de solo
  // consulta: ven el estado del plato como etiqueta, no como interruptor.
  const Disponibilidad = esAdmin ? 'button' : 'span'
  const [platoHistorial, setPlatoHistorial] = useState(null)

  // tipo 'error': el cambio NO se guardó; se queda más tiempo a la vista.
  const showNotice = (msg, tipo = 'info') => {
    setApiNotice(msg)
    setApiNoticeTipo(tipo)
    setTimeout(() => setApiNotice(null), tipo === 'error' ? 8000 : 5000)
  }

  const procesarMenuData = useCallback((data) => {
    const cats = data?.categorias || []
    const categoriasParsed = cats.map((c) => ({
      id: c.id_categoria,
      name: c.categoria || c.nombre || '',
      description: c.descripcion || '',
    }))

    const platosParsed = cats.flatMap((c) => {
      const catNombre = c.categoria || c.nombre || 'General'
      return (c.platos || []).map((p) => {
        return {
          id: p.id_plato,
          name: p.nombre,
          categoryName: catNombre,
          categoryId: c.id_categoria,
          price: Number(p.precio || 0),
          priceFormatted: `$${Number(p.precio || 0).toLocaleString('es-CO')}`,
          prepTime: p.tiempo_estimado ?? p.tiempo_preparacion_estimado ?? 15,
          tag: catNombre,
          description: p.descripcion || '',
          // imageUrl es SOLO para pintar la tarjeta: la foto del plato y, si no
          // tiene, la local de la arepa o la de respaldo. Lo que se edita y se guarda es
          // urlImagenGuardada: el url_imagen real del plato, o '' si no tiene.
          // La url_imagen pasa por la lista blanca de la app (#212): una
          // /imagenes/<uuid>.webp subida al backend se pinta con el origen de
          // la API; http://, javascript:, data: y demás, con el respaldo.
          imageUrl: fotoDePlato(p.nombre, p.url_imagen, FOTO_RESPALDO),
          urlImagenGuardada: p.url_imagen || '',
          // available = interruptor MANUAL de la cocina (platos.disponible).
          // stockOk = lo que calcula la base desde el inventario (stock_suficiente,
          // script 27). El comensal ve los dos juntos: ver estaDisponible().
          available: p.disponible !== false,
          stockOk: p.stock_suficiente !== false,
          personalizable: Boolean(p.personalizable),
          calorias: p.calorias || null,
        }
      })
    })

    setCategoriesList(categoriasParsed)
    setDishesList(platosParsed)
  }, [])

  const recargarCarta = useCallback(async () => {
    try {
      const data = await obtenerCartaAdmin()
      procesarMenuData(data)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el catálogo de platos')
    }
  }, [procesarMenuData])

  useEffect(() => {
    let isMounted = true
    obtenerCartaAdmin()
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
  const [subiendoImagen, setSubiendoImagen] = useState(false)
  // Error al guardar el plato: va DENTRO del modal, que tapa el aviso de la página.
  const [dishFormError, setDishFormError] = useState(null)

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
    const matchesAvailability = onlyAvailable ? estaDisponible(dish) : true

    return matchesCategory && matchesSearch && matchesAvailability
  })

  // Toggle de disponibilidad (Control de Inventario - RF-11)
  const handleToggleAvailability = async (dishId) => {
    const dish = dishesList.find((d) => d.id === dishId)
    if (!dish) return
    const nuevoEstado = !dish.available
    // T8: desactivar se confirma (los comensales dejan de poder pedirlo).
    const pregunta = confirmacionAlCambiar(dish, nuevoEstado)
    if (pregunta && !window.confirm(pregunta)) return
    const ponerEstado = (estado) =>
      setDishesList((prev) => prev.map((d) => (d.id === dishId ? { ...d, available: estado } : d)))

    // Optimista para que el interruptor responda al instante, pero si la API
    // falla se REVIERTE: nada queda en pantalla como guardado sin estarlo.
    ponerEstado(nuevoEstado)
    try {
      const plato = await agotadosApi.togglePlato(dishId, nuevoEstado)
      // Manda el servidor, no lo que se pidió.
      if (typeof plato?.disponible === 'boolean') ponerEstado(plato.disponible)
      if (typeof plato?.stock_suficiente === 'boolean') ponerFlags(dishId, { stockOk: plato.stock_suficiente })
    } catch (err) {
      ponerEstado(dish.available)
      showNotice(mensajeNoGuardado(err), 'error')
    }
  }

  function ponerFlags(idPlato, cambios) {
    setDishesList((prev) => prev.map((d) => (d.id === idPlato ? { ...d, ...cambios } : d)))
  }

  // plato:disponibilidad { id_plato, disponible, emitidoEn } (EVENTS.md §5.4):
  // otro admin, la cocina o el inventario agotó o repuso un plato. No trae
  // eventId (es estado completo): se descarta un aviso más viejo que el último
  // aplicado para ese plato.
  //
  // El aviso no dice POR QUÉ: el que sale del inventario trae el disponible
  // EFECTIVO (manual Y stock) y el del PATCH manual trae solo el interruptor.
  // Así que no se adivina: se relee el plato (GET /platos/:id, público) y se
  // aplican los dos campos tal como están en la base. De varias relecturas del
  // mismo plato solo vale la última que se pidió.
  const [platoViejo] = useState(() => crearUltimoPorId())
  const relecturas = useRef(new Map())

  useSocketListener('plato:disponibilidad', async (data) => {
    const idPlato = Number(data?.id_plato)
    if (!Number.isInteger(idPlato) || typeof data?.disponible !== 'boolean') return
    if (platoViejo(idPlato, data.emitidoEn)) return
    const turno = (relecturas.current.get(idPlato) || 0) + 1
    relecturas.current.set(idPlato, turno)
    try {
      const plato = await platosApi.obtener(idPlato)
      if (relecturas.current.get(idPlato) !== turno) return
      ponerFlags(idPlato, {
        available: plato?.disponible !== false,
        stockOk: plato?.stock_suficiente !== false,
      })
    } catch {
      if (relecturas.current.get(idPlato) !== turno) return
      // Sin la relectura, lo mejor que se sabe es el efectivo del aviso: un
      // true dice que los dos están bien; un false se muestra como falta de
      // stock solo si el interruptor manual estaba encendido.
      if (data.disponible) ponerFlags(idPlato, { available: true, stockOk: true })
      else
        setDishesList((prev) =>
          prev.map((d) => (d.id !== idPlato ? d : d.available ? { ...d, stockOk: false } : d))
        )
    }
  })

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
        // El valor real, no la foto que se pinta: si no, editar un plato sin
        // foto (o la arepa) guardaba la foto de respaldo (o /img/...).
        imageUrl: dish.urlImagenGuardada ?? '',
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
    setDishFormError(null)
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
      disponible: Boolean(dishForm.available),
      personalizable: Boolean(dishForm.personalizable),
      calorias: dishForm.calorias ? parseInt(dishForm.calorias, 10) : null,
    }
    // Con el campo vacío NO se manda url_imagen: el plato queda sin foto (al
    // crear) o con la que ya tenía (al editar). Antes se mandaba la foto de
    // respaldo y quedaba guardada como si fuera la real.
    const urlImagen = dishForm.imageUrl.trim()
    // Lo mismo que acepta el backend (#209): https:// o /imagenes/<uuid>.webp.
    // Se avisa aquí en vez de mandar algo que el backend va a rechazar.
    if (!urlImagenGuardable(urlImagen)) {
      setDishFormError(MENSAJE_URL_IMAGEN)
      return
    }
    if (urlImagen) payload.url_imagen = urlImagen

    setSubmittingAction(true)
    setDishFormError(null)
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
      // El modal sigue abierto con lo escrito, para reintentar sin perderlo.
      setDishFormError(mensajeNoGuardado(err))
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
    } catch (err) {
      showNotice(mensajeNoGuardado(err), 'error')
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
    } catch (err) {
      showNotice(mensajeNoGuardado(err), 'error')
    }
  }

  // Eliminar categoría
  const handleDeleteCategory = async (catId) => {
    if (!window.confirm('¿Eliminar esta categoría? Los platos asignados quedarán sin grupo.')) return
    try {
      await categoriasApi.eliminar(catId)
      showNotice('Categoría eliminada.')
      recargarCarta()
    } catch (err) {
      showNotice(mensajeNoGuardado(err), 'error')
    }
  }

  return (
    <div className="menu-pagina tema-comanda">
      {apiNotice && (
        // Fijo arriba de la pantalla: el interruptor que falló puede estar
        // muy abajo en la carta, y un aviso al inicio de la página no se vería.
        <div
          className={`menu-aviso ${apiNoticeTipo}`}
          role={apiNoticeTipo === 'error' ? 'alert' : 'status'}
        >
          <AlertCircle size={18} aria-hidden="true" />
          <span>{apiNotice}</span>
        </div>
      )}

      <div className="menu-cont">
        {/* Encabezado con acciones */}
        <div className="menu-cab">
          <div className="menu-cab-izq">
            <h1 className="menu-titulo">MENÚ</h1>
            <span className="menu-sub">
              {esAdmin
                ? 'Administración de categorías, platos y disponibilidad en tiempo real'
                : 'Carta del restaurante y disponibilidad en tiempo real (solo consulta)'}
            </span>
          </div>
          {esAdmin && (
            <div className="menu-acciones">
              <button
                type="button"
                className="menu-btn claro"
                onClick={() => setIsCategoryModalOpen(true)}
              >
                <FolderPlus size={18} aria-hidden="true" />
                <span>CATEGORÍAS ({categoriesList.length})</span>
              </button>
              <button
                type="button"
                className="menu-btn"
                onClick={() => handleOpenDishModal()}
              >
                <Plus size={18} aria-hidden="true" />
                <span>NUEVO PLATO</span>
              </button>
            </div>
          )}
        </div>

        {/* Filtros: categorías, buscador y solo disponibles */}
        <div className="menu-filtros">
          <div className="menu-chips">
            <button
              type="button"
              className={`menu-chip ${activeCategory === 'Todas' ? 'activa' : ''}`}
              onClick={() => setActiveCategory('Todas')}
            >
              <span>TODAS</span>
              <span className="menu-chip-n">{dishesList.length}</span>
            </button>
            {categoriesList.map((cat) => {
              const catName = cat.name || ''
              const count = dishesList.filter((d) => d.categoryName === catName).length
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`menu-chip ${activeCategory === catName ? 'activa' : ''}`}
                  onClick={() => setActiveCategory(catName)}
                >
                  <span>{catName.toUpperCase()}</span>
                  <span className="menu-chip-n">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="menu-busqueda">
            <div className="menu-buscar">
              <Search size={18} aria-hidden="true" />
              <input
                type="text"
                placeholder="Buscar plato por nombre, ingrediente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="menu-inp"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="menu-buscar-x"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <label className="menu-solo">
              <input
                type="checkbox"
                className="menu-sw"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              <span>SOLO DISPONIBLES</span>
            </label>
          </div>
        </div>

        {/* Platos */}
        {loading ? (
          <div className="menu-estado">
            <RefreshCw size={44} className="spin" aria-hidden="true" />
            <h3>Cargando catálogo en vivo...</h3>
            <p>Consultando carta gastronómica desde el servidor.</p>
          </div>
        ) : error ? (
          <div className="menu-estado">
            <AlertCircle size={44} className="menu-estado-error" aria-hidden="true" />
            <h3>Error al cargar el menú</h3>
            <p>{error}</p>
            <button
              type="button"
              className="menu-btn oscuro"
              onClick={recargarCarta}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>REINTENTAR</span>
            </button>
          </div>
        ) : filteredDishes.length === 0 ? (
          <div className="menu-estado">
            <UtensilsCrossed size={48} aria-hidden="true" />
            <h3>No se encontraron platos</h3>
            <p>Prueba con otros términos de búsqueda o selecciona otra categoría.</p>
          </div>
        ) : (
          <div className="menu-platos">
            {filteredDishes.map((dish) => (
              // sd-card: la usan las pruebas y la demo para encontrar la tarjeta.
              <div
                key={dish.id}
                className={`sd-card menu-plato ${estaDisponible(dish) ? '' : 'apagado'} ${dish.personalizable ? 'armable' : ''}`}
                style={{ opacity: estaDisponible(dish) ? 1 : 0.65 }}
              >
                <div className="menu-foto">
                  <img
                    src={dish.imageUrl}
                    alt={dish.name}
                    loading="lazy"
                    onError={(e) => {
                      // La foto propia no cargó: respaldo (la local, si es la arepa).
                      e.target.src = esArepaRellena(dish.name) ? FOTO_AREPA : FOTO_RESPALDO
                    }}
                  />
                  {dish.personalizable ? (
                    <span className="menu-etq osc">
                      <Layers size={13} aria-hidden="true" /> Arma tu plato
                    </span>
                  ) : dish.tag ? (
                    <span className="menu-etq">{dish.tag}</span>
                  ) : null}
                  <span className="menu-tiempo">
                    <Clock size={13} aria-hidden="true" /> {dish.prepTime} min
                  </span>
                </div>

                <div className="menu-plato-cuerpo">
                  <span className="menu-plato-cat">{dish.categoryName}</span>
                  <h4 className="menu-plato-nombre">{dish.name}</h4>
                  <p className="menu-plato-desc">
                    {dish.description || 'Sin descripción disponible.'}
                  </p>
                </div>

                <div className="menu-plato-precio">
                  <strong>{dish.priceFormatted}</strong>
                  {esAdmin && (
                    <button
                      type="button"
                      className="menu-historial"
                      onClick={() => setPlatoHistorial(dish)}
                      aria-label={`Ver historial de precios de ${dish.name}`}
                    >
                      Ver historial
                    </button>
                  )}
                </div>

                <div className="menu-plato-pie">
                  {/* Disponibilidad: el interruptor es el estado MANUAL; el texto, el que ve el comensal */}
                  <Disponibilidad
                    {...(esAdmin
                      ? {
                          type: 'button',
                          onClick: () => handleToggleAvailability(dish.id),
                          title: 'Alternar disponibilidad para comensales',
                          // Interruptor: encendido = el admin lo dejó disponible.
                          'aria-pressed': dish.available,
                          'aria-label': `Disponible: ${dish.name}`,
                        }
                      : { 'data-testid': `disponibilidad-${dish.id}` })}
                    className={`menu-disp ${esAdmin ? 'interruptor' : ''} ${estaDisponible(dish) ? '' : 'no'}`}
                  >
                    {estaDisponible(dish) ? (
                      <>
                        <CheckCircle2 size={15} aria-hidden="true" />
                        <span>DISPONIBLE</span>
                      </>
                    ) : dish.available ? (
                      // Encendido a mano pero sin stock: lo apagó el inventario, no
                      // la cocina. El botón sigue siendo el interruptor MANUAL (un clic
                      // lo apaga a mano); el plato vuelve solo con una entrada.
                      <>
                        <XCircle size={15} aria-hidden="true" />
                        <span title="Sin stock en Inventario: vuelve solo al registrar una entrada">
                          AGOTADO · SIN STOCK
                        </span>
                      </>
                    ) : (
                      // Apagado a mano (T8): no es falta de stock, así que no dice
                      // «AGOTADO». Vuelve cuando el admin lo activa.
                      <>
                        <XCircle size={15} aria-hidden="true" />
                        <span>{ETIQUETA_DISPONIBILIDAD[NO_DISPONIBLE]}</span>
                      </>
                    )}
                  </Disponibilidad>

                  {/* Acciones (solo admin: el backend las niega al resto) */}
                  {esAdmin && (
                    <div className="menu-plato-acc">
                      <button
                        type="button"
                        className={`menu-ico ${dish.personalizable ? 'armable' : ''}`}
                        onClick={() => setSelectedDishForConstructor(dish)}
                        title="Configurar Pasos e Ingredientes del Constructor"
                      >
                        <Layers size={17} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="menu-ico"
                        onClick={() => handleOpenDishModal(dish)}
                        title="Editar plato"
                      >
                        <Edit2 size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="menu-ico peligro"
                        onClick={() => handleDeleteDish(dish.id)}
                        title="Eliminar plato"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Crear / Editar Plato */}
      {isDishModalOpen && (
        <div className="menu-velo" onClick={() => setIsDishModalOpen(false)}>
          <div
            className="menu-ventana"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="menu-ventana-cab">
              <div>
                <h3>{editingDish ? 'Editar Plato' : 'Nuevo Plato en Menú'}</h3>
                <small>Configuración de precio, tiempos, categoría e inventario</small>
              </div>
              <button
                type="button"
                className="menu-cerrar"
                onClick={() => setIsDishModalOpen(false)}
                aria-label="Cerrar modal"
              >
                <X size={18} strokeWidth={3} />
              </button>
            </div>

            <form className="menu-form" onSubmit={handleSaveDish}>
              <div className="menu-campo mitad">
                <label className="menu-lbl">NOMBRE DEL PLATO</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Bowl Personalizado, Lomo Criollo"
                  value={dishForm.name}
                  onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                  className="menu-inp"
                />
              </div>

              <div className="menu-campo mitad">
                <label className="menu-lbl">CATEGORÍA</label>
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
                  className="menu-inp"
                >
                  {categoriesList.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="menu-campo">
                <label className="menu-lbl">PRECIO DE VENTA ($)</label>
                <div className="menu-inp-ico">
                  <DollarSign size={16} aria-hidden="true" />
                  <input
                    type="number"
                    step="500"
                    min="0"
                    required
                    placeholder="25000"
                    value={dishForm.price}
                    onChange={(e) => setDishForm({ ...dishForm, price: e.target.value })}
                    className="menu-inp"
                  />
                </div>
              </div>

              <div className="menu-campo">
                <label className="menu-lbl">TIEMPO ESTIMADO (MIN)</label>
                <div className="menu-inp-ico">
                  <Clock size={16} aria-hidden="true" />
                  <input
                    type="number"
                    min="1"
                    placeholder="15"
                    value={dishForm.prepTime}
                    onChange={(e) => setDishForm({ ...dishForm, prepTime: e.target.value })}
                    className="menu-inp"
                  />
                </div>
              </div>

              <div className="menu-campo">
                <label className="menu-lbl">TAG VISUAL</label>
                <div className="menu-inp-ico">
                  <Tag size={16} aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Popular, Parrilla, Chef"
                    value={dishForm.tag}
                    onChange={(e) => setDishForm({ ...dishForm, tag: e.target.value })}
                    className="menu-inp"
                  />
                </div>
              </div>

              <div className="menu-campo entera">
                <label className="menu-lbl">URL DE IMAGEN</label>
                {/* type="text": una imagen subida se guarda como /imagenes/<uuid>.webp,
                    que el type="url" del navegador no deja enviar. */}
                <input
                  type="text"
                  inputMode="url"
                  placeholder="https://… o /imagenes/<código>.webp"
                  value={dishForm.imageUrl}
                  onChange={(e) => setDishForm({ ...dishForm, imageUrl: e.target.value })}
                  className="menu-inp"
                />
                {/* La subida es asíncrona: se actualiza con la forma funcional para
                    no pisar lo que se haya escrito mientras subía. */}
                <SubirImagen
                  etiqueta="imagen del plato"
                  valor={dishForm.imageUrl}
                  onCambio={(ruta) => setDishForm((f) => ({ ...f, imageUrl: ruta }))}
                  onSubiendo={setSubiendoImagen}
                />
              </div>

              <div className="menu-campo entera">
                <label className="menu-lbl">DESCRIPCIÓN / INGREDIENTES BASE</label>
                <textarea
                  rows="3"
                  placeholder="Describe la preparación, guarniciones y notas para alérgenos..."
                  value={dishForm.description}
                  onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                  className="menu-inp"
                ></textarea>
              </div>

              {/* Opciones del Constructor */}
              <div className="menu-armable entera">
                <div className="menu-armable-txt">
                  <label className="menu-check">
                    <input
                      type="checkbox"
                      className="menu-sw"
                      checked={dishForm.personalizable}
                      onChange={(e) => setDishForm({ ...dishForm, personalizable: e.target.checked })}
                    />
                    <span>HABILITAR COMO PERSONALIZABLE ("ARMA TU PLATO")</span>
                  </label>
                  <p>Permite definir pasos e ingredientes dinámicos para el comensal.</p>
                </div>

                <div className="menu-campo menu-kcal">
                  <label className="menu-lbl">CALORÍAS (KCAL)</label>
                  <div className="menu-inp-ico">
                    <Flame size={16} aria-hidden="true" />
                    <input
                      type="number"
                      min="0"
                      placeholder="450"
                      value={dishForm.calorias}
                      onChange={(e) => setDishForm({ ...dishForm, calorias: e.target.value })}
                      className="menu-inp"
                    />
                  </div>
                </div>

                {editingDish && dishForm.personalizable && (
                  <button
                    type="button"
                    className="menu-btn contorno mini"
                    onClick={() => {
                      setIsDishModalOpen(false)
                      setSelectedDishForConstructor(editingDish)
                    }}
                  >
                    <Layers size={15} aria-hidden="true" />
                    <span>Configurar Pasos &rarr;</span>
                  </button>
                )}
              </div>

              <label className="menu-check entera">
                <input
                  type="checkbox"
                  className="menu-sw"
                  checked={dishForm.available}
                  onChange={(e) => setDishForm({ ...dishForm, available: e.target.checked })}
                />
                <span>DISPONIBLE DE INMEDIATO PARA PEDIDOS</span>
              </label>

              {dishFormError && (
                <div className="menu-form-error entera" role="alert">
                  <AlertCircle size={18} aria-hidden="true" />
                  <span>{dishFormError}</span>
                </div>
              )}

              <div className="menu-form-pie entera">
                <button
                  type="button"
                  className="menu-btn contorno"
                  onClick={() => setIsDishModalOpen(false)}
                >
                  CANCELAR
                </button>
                <button type="submit" className="menu-btn oscuro" disabled={submittingAction || subiendoImagen}>
                  {subiendoImagen
                    ? 'SUBIENDO IMAGEN...'
                    : submittingAction
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
        <div className="menu-velo" onClick={() => setIsCategoryModalOpen(false)}>
          <div
            className="menu-ventana angosta"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="menu-ventana-cab">
              <div>
                <h3>Administración de Categorías</h3>
                <small>Organización de secciones en la carta digital</small>
              </div>
              <button
                type="button"
                className="menu-cerrar"
                onClick={() => setIsCategoryModalOpen(false)}
                aria-label="Cerrar modal"
              >
                <X size={18} strokeWidth={3} />
              </button>
            </div>

            {/* Formulario para agregar */}
            <form className="menu-form" onSubmit={handleSaveCategory}>
              <div className="menu-campo entera">
                <label className="menu-lbl">NOMBRE DE LA CATEGORÍA</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Pastas & Risottos"
                  value={categoryForm.name}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, name: e.target.value })
                  }
                  className="menu-inp"
                />
              </div>
              <div className="menu-campo entera">
                <label className="menu-lbl">DESCRIPCIÓN CORTA</label>
                <input
                  type="text"
                  placeholder="Ej. Elaboradas artesanalmente al dente"
                  value={categoryForm.description}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, description: e.target.value })
                  }
                  className="menu-inp"
                />
              </div>
              <button type="submit" className="menu-btn oscuro entera">
                <Plus size={18} aria-hidden="true" />
                <span>AGREGAR CATEGORÍA</span>
              </button>
            </form>

            {/* Lista actual de categorías */}
            <div className="menu-cats">
              <h4>Categorías Activas ({categoriesList.length})</h4>
              <div className="menu-cats-lista">
                {categoriesList.map((cat) => (
                  <div key={cat.id} className="menu-cat">
                    <div className="menu-cat-txt">
                      <strong>{cat.name}</strong>
                      <span>{cat.description || 'Sin descripción'}</span>
                    </div>
                    <span className="menu-cat-n">
                      {dishesList.filter((d) => d.categoryName === cat.name || d.categoryId === cat.id).length} platos
                    </span>
                    <button
                      type="button"
                      className="menu-ico peligro"
                      onClick={() => handleDeleteCategory(cat.id)}
                      title="Eliminar categoría"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
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

      {platoHistorial && (
        <HistorialPrecios plato={platoHistorial} onClose={() => setPlatoHistorial(null)} />
      )}
    </div>
  )
}
