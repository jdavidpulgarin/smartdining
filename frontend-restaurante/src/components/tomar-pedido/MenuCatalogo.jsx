// Copiado y adaptado desde frontend-cliente/src/pages/Menu.jsx y components/menu/
// Adaptado para frontend-restaurante en J-16

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Search,
  Sliders,
  Plus,
  AlertCircle,
  RefreshCw,
  ShoppingBag,
  User,
} from 'lucide-react'
import { menuApi } from '../../services/api'
import { useSocketListener } from '../../hooks'
import { ConstructorModal } from './ConstructorModal'

export function MenuCatalogo({
  comensal,
  onCambiarComensal,
  onAgregarItem,
  onIrAResumen,
  totalItemsEnCarrito = 0,
}) {
  const [categorias, setCategorias] = useState([])
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  // Modal para plato personalizable (constructor)
  const [platoEnConstruccion, setPlatoEnConstruccion] = useState(null)

  // Cargar menú desde la API
  const cargarCarta = useCallback(async () => {
    try {
      setCargando(true)
      setError(null)
      const data = await menuApi.obtenerMenu()
      const cats = Array.isArray(data?.categorias) ? data.categorias : []
      setCategorias(cats)
      if (cats.length > 0) {
        setCategoriaSeleccionada((prev) => prev || cats[0].id_categoria)
      }
    } catch (err) {
      setError(err.message || 'Error al cargar la carta del menú')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    let activo = true
    menuApi
      .obtenerMenu()
      .then((data) => {
        if (!activo) return
        const cats = Array.isArray(data?.categorias) ? data.categorias : []
        setCategorias(cats)
        if (cats.length > 0) {
          setCategoriaSeleccionada((prev) => prev || cats[0].id_categoria)
        }
        setCargando(false)
      })
      .catch((err) => {
        if (!activo) return
        setError(err.message || 'Error al cargar la carta del menú')
        setCargando(false)
      })

    return () => {
      activo = false
    }
  }, [])

  // Escuchar en vivo cambios de disponibilidad de platos
  useSocketListener('plato:disponibilidad', (data) => {
    if (!data || data.id_plato === undefined) return
    const idPlatoNum = Number(data.id_plato)
    const nuevoDisponible = Boolean(data.disponible)

    setCategorias((prevCats) =>
      prevCats.map((cat) => ({
        ...cat,
        platos: (cat.platos || []).map((p) => {
          if (Number(p.id_plato) === idPlatoNum) {
            return { ...p, disponible: nuevoDisponible }
          }
          return p
        }),
      }))
    )
  })

  // Escuchar en vivo cambios de disponibilidad de ingredientes
  useSocketListener('ingrediente:disponibilidad', (data) => {
    if (!data || data.id_ingrediente === undefined) return
    const idIngNum = Number(data.id_ingrediente)
    const nuevoDisponible = Boolean(data.disponible)

    setCategorias((prevCats) =>
      prevCats.map((cat) => ({
        ...cat,
        platos: (cat.platos || []).map((p) => {
          if (!Array.isArray(p.pasos)) return p
          return {
            ...p,
            pasos: p.pasos.map((paso) => ({
              ...paso,
              ingredientes: (paso.ingredientes || []).map((ing) => {
                if (Number(ing.id_ingrediente) === idIngNum) {
                  return { ...ing, disponible: nuevoDisponible }
                }
                return ing
              }),
            })),
          }
        }),
      }))
    )
  })

  // Filtrado de platos por categoría y búsqueda
  const platosVisibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    let platos = []

    if (texto) {
      // Búsqueda global en todas las categorías
      platos = categorias.flatMap((c) =>
        (c.platos || []).map((p) => ({ ...p, categoriaNombre: c.categoria || c.nombre || '' }))
      ).filter((p) => (p.nombre || '').toLowerCase().includes(texto))
    } else {
      const cat = categorias.find((c) => c.id_categoria === categoriaSeleccionada)
      platos = (cat?.platos || []).map((p) => ({ ...p, categoriaNombre: cat?.categoria || cat?.nombre || '' }))
    }

    return platos
  }, [categorias, categoriaSeleccionada, busqueda])

  const handleAgregarEstandar = (plato) => {
    if (plato.disponible === false) return
    onAgregarItem({
      id_plato: plato.id_plato,
      nombre: plato.nombre,
      precio: Number(plato.precio) || 0,
      cantidad: 1,
      comensal,
    })
  }

  return (
    <div className="menu-catalogo-container">
      {/* Barra de control superior: Comensal activo, búsqueda y carrito */}
      <div className="tp-barra-menu">
        <div className="tp-barra-para">
          <div className="tp-barra-para-icono">
            <User size={20} />
          </div>
          <div>
            <span className="tp-para-rotulo">Pidiendo para:</span>
            <div className="tp-barra-para-fila">
              <strong className="tp-barra-para-nombre">{comensal}</strong>
              <button
                type="button"
                onClick={onCambiarComensal}
                className="tp-enlace"
              >
                Pedir para otra persona
              </button>
            </div>
          </div>
        </div>

        {/* Buscador */}
        <div className="tp-buscador">
          <div className="tp-buscador-caja">
            <Search
              size={16}
              className="tp-buscador-icono"
            />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar plato en la carta..."
              className="tp-input tp-buscador-input"
            />
          </div>
        </div>

        {/* Botón flotante para ver resumen */}
        {totalItemsEnCarrito > 0 && (
          <button
            type="button"
            className="tp-btn tp-btn-ambar"
            onClick={onIrAResumen}
          >
            <ShoppingBag size={18} />
            <span>Ver comanda ({totalItemsEnCarrito})</span>
          </button>
        )}
      </div>

      {/* Pestañas de categorías si no hay búsqueda activa */}
      {!busqueda.trim() && categorias.length > 0 && (
        <div
          className="tabs-categorias tp-categorias"
        >
          {categorias.map((cat) => {
            const activa = cat.id_categoria === categoriaSeleccionada
            return (
              <button
                key={cat.id_categoria}
                type="button"
                onClick={() => setCategoriaSeleccionada(cat.id_categoria)}
                className={activa ? 'tp-chip tp-chip-activa' : 'tp-chip'}
              >
                {cat.categoria || cat.nombre}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div className="tp-aviso tp-aviso-error tp-aviso-fila">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button
            type="button"
            onClick={cargarCarta}
            className="tp-enlace tp-reintentar"
          >
            Reintentar
          </button>
        </div>
      )}

      {cargando ? (
        <div className="tp-vacio tp-cargando">
          <RefreshCw size={24} className="animate-spin tp-cargando-icono" />
          <span>Cargando platos de la carta...</span>
        </div>
      ) : platosVisibles.length > 0 ? (
        <div
          className="grid-platos tp-platos"
        >
          {platosVisibles.map((plato) => {
            const esPersonalizable = Boolean(plato.personalizable)
            const agotado = plato.disponible === false

            return (
              <div
                key={plato.id_plato}
                className={agotado ? 'tp-plato tp-plato-agotado' : 'tp-plato'}
              >
                {/* Cabecera plato */}
                <div>
                  <div className="tp-plato-cabeza">
                    <h3 className="tp-plato-nombre">
                      {plato.nombre}
                    </h3>

                    {agotado ? (
                      <span className="tp-etiqueta tp-etiqueta-agotado">
                        Agotado
                      </span>
                    ) : esPersonalizable ? (
                      <span className="tp-etiqueta tp-etiqueta-arma">
                        Arma tu plato
                      </span>
                    ) : null}
                  </div>

                  {plato.descripcion && (
                    <p className="tp-plato-desc">
                      {plato.descripcion}
                    </p>
                  )}
                </div>

                {/* Pie plato: precio y botón de agregar */}
                <div className="tp-plato-pie">
                  <strong className="tp-plato-precio">
                    ${Number(plato.precio).toLocaleString('es-CO')}
                  </strong>

                  {esPersonalizable ? (
                    <button
                      type="button"
                      disabled={agotado}
                      onClick={() => setPlatoEnConstruccion(plato)}
                      className="tp-btn tp-btn-ambar tp-btn-mini"
                    >
                      <Sliders size={16} />
                      <span>Personalizar</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={agotado}
                      onClick={() => handleAgregarEstandar(plato)}
                      className="tp-btn tp-btn-oscuro tp-btn-mini"
                    >
                      <Plus size={16} />
                      <span>Agregar</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="tp-vacio">
          No se encontraron platos {busqueda ? `para "${busqueda}"` : 'en esta categoría'}.
        </div>
      )}

      {/* Modal del Constructor de platos */}
      {platoEnConstruccion && (
        <ConstructorModal
          plato={platoEnConstruccion}
          comensal={comensal}
          onAgregar={onAgregarItem}
          onClose={() => setPlatoEnConstruccion(null)}
        />
      )}
    </div>
  )
}
