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
        (c.platos || []).map((p) => ({ ...p, categoriaNombre: c.nombre }))
      ).filter((p) => p.nombre.toLowerCase().includes(texto))
    } else {
      const cat = categorias.find((c) => c.id_categoria === categoriaSeleccionada)
      platos = (cat?.platos || []).map((p) => ({ ...p, categoriaNombre: cat.nombre }))
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
      <div
        style={{
          background: 'var(--sd-surface)',
          border: '1px solid var(--sd-border)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(224, 165, 38, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--sd-gold)',
            }}
          >
            <User size={20} />
          </div>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--sd-text-muted)' }}>Pidiendo para:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--sd-text)' }}>{comensal}</strong>
              <button
                type="button"
                onClick={onCambiarComensal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--sd-red)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '2px 4px',
                }}
              >
                Pedir para otra persona
              </button>
            </div>
          </div>
        </div>

        {/* Buscador */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 260px', maxWidth: '400px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--sd-text-muted)',
              }}
            />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar plato en la carta..."
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '8px 12px 8px 36px',
                borderRadius: '8px',
                background: 'var(--sd-surface-2)',
                border: '1px solid var(--sd-border)',
                color: 'var(--sd-text)',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Botón flotante para ver resumen */}
        {totalItemsEnCarrito > 0 && (
          <button
            type="button"
            className="table-btn-primary"
            onClick={onIrAResumen}
            style={{
              minHeight: '44px',
              padding: '8px 18px',
              background: 'var(--sd-red)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShoppingBag size={18} />
            <span>Ver comanda ({totalItemsEnCarrito})</span>
          </button>
        )}
      </div>

      {/* Pestañas de categorías si no hay búsqueda activa */}
      {!busqueda.trim() && categorias.length > 0 && (
        <div
          className="tabs-categorias"
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '12px',
            marginBottom: '16px',
          }}
        >
          {categorias.map((cat) => {
            const activa = cat.id_categoria === categoriaSeleccionada
            return (
              <button
                key={cat.id_categoria}
                type="button"
                onClick={() => setCategoriaSeleccionada(cat.id_categoria)}
                style={{
                  minHeight: '44px',
                  padding: '8px 18px',
                  borderRadius: '24px',
                  border: activa ? '1px solid var(--sd-red)' : '1px solid var(--sd-border)',
                  background: activa ? 'var(--sd-red)' : 'var(--sd-surface)',
                  color: activa ? '#fff' : 'var(--sd-text-muted)',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat.nombre}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '14px',
            borderRadius: '8px',
            background: 'rgba(238, 28, 37, 0.1)',
            color: 'var(--sd-red)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
          <button
            type="button"
            onClick={cargarCarta}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--sd-red)',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--sd-text-muted)' }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px' }} />
          <span>Cargando platos de la carta...</span>
        </div>
      ) : platosVisibles.length > 0 ? (
        <div
          className="grid-platos"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '16px',
          }}
        >
          {platosVisibles.map((plato) => {
            const esPersonalizable = Boolean(plato.personalizable)
            const agotado = plato.disponible === false

            return (
              <div
                key={plato.id_plato}
                style={{
                  background: 'var(--sd-surface)',
                  border: '1px solid var(--sd-border)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  opacity: agotado ? 0.5 : 1,
                  position: 'relative',
                }}
              >
                {/* Cabecera plato */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--sd-text)' }}>
                      {plato.nombre}
                    </h3>

                    {agotado ? (
                      <span
                        style={{
                          background: 'rgba(238, 28, 37, 0.2)',
                          color: 'var(--sd-red)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        Agotado
                      </span>
                    ) : esPersonalizable ? (
                      <span
                        style={{
                          background: 'rgba(224, 165, 38, 0.15)',
                          color: 'var(--sd-gold)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        Arma tu plato
                      </span>
                    ) : null}
                  </div>

                  {plato.descripcion && (
                    <p
                      style={{
                        margin: '0 0 12px',
                        fontSize: '0.82rem',
                        color: 'var(--sd-text-muted)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {plato.descripcion}
                    </p>
                  )}
                </div>

                {/* Pie plato: precio y botón de agregar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '12px',
                    paddingTop: '10px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <strong style={{ fontSize: '1.05rem', color: 'var(--sd-text)' }}>
                    ${Number(plato.precio).toLocaleString('es-CO')}
                  </strong>

                  {esPersonalizable ? (
                    <button
                      type="button"
                      disabled={agotado}
                      onClick={() => setPlatoEnConstruccion(plato)}
                      className="table-btn-primary"
                      style={{
                        minHeight: '44px',
                        padding: '8px 14px',
                        fontSize: '0.82rem',
                        background: agotado ? 'var(--sd-border)' : 'var(--sd-gold)',
                        color: agotado ? 'var(--sd-text-muted)' : '#000',
                        fontWeight: 600,
                        cursor: agotado ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Sliders size={16} />
                      <span>Personalizar</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={agotado}
                      onClick={() => handleAgregarEstandar(plato)}
                      className="table-btn-primary"
                      style={{
                        minHeight: '44px',
                        padding: '8px 16px',
                        fontSize: '0.82rem',
                        background: agotado ? 'var(--sd-border)' : 'var(--sd-red)',
                        cursor: agotado ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
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
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--sd-text-muted)' }}>
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
