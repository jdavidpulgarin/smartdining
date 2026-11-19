import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  actualizarDisponibilidadEnCache,
  actualizarDisponibilidadPlatoEnCache,
  adaptarPlatoArmable,
  obtenerPlatoArmable,
  recargarMenu,
  refrescarMenu,
  suscribirCambiosMenu,
} from '../services/menuService';
import { useMesaSocketContext } from '../context/MesaSocketContext';
import {
  constructorReducer,
  estadoInicial,
} from '../components/constructor/constructorReducer';
import PasoConstructor from '../components/constructor/PasoConstructor';
import ProgressBar from '../components/ui/ProgressBar';
import BottomBar from '../components/ui/BottomBar';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Imagen from '../components/ui/Imagen';
import { useCarrito } from '../context/CarritoContext';
import { obtenerApodo } from '../utils/apodo';
import { generarIdLinea } from '../utils/id';
import {
  calcularPlato,
  pasosPendientes,
  validarPaso,
} from '../utils/calcularPlato';
import { ALERGENOS_MAP } from '../constants/dieta';
import { urlImagen } from '../utils/imagenes';

const ETIQUETA_PORCION = {
  ligera: 'Ligera',
  normal: 'Normal',
  extra: 'Extra',
};

function Constructor() {
  const { idPlato } = useParams();
  const navigate = useNavigate();
  const notasId = useId();
  const { agregarLinea } = useCarrito();
  const { on: socketOn } = useMesaSocketContext();

  const [estadoCarga, setEstadoCarga] = useState({
    idCargado: null,
    plato: null,
  });
  const [error, setError] = useState(null);
  const [reintentando, setReintentando] = useState(false);
  const [estado, despachador] = useReducer(constructorReducer, estadoInicial);

  const cargando = reintentando || estadoCarga.idCargado !== idPlato;
  const plato = cargando ? null : estadoCarga.plato;

  useEffect(() => {
    let activo = true;
    despachador({ type: 'REINICIAR' });

    async function cargarPlato() {
      try {
        refrescarMenu().catch(() => {});
        const resultado = await obtenerPlatoArmable(idPlato);
        if (activo) {
          setEstadoCarga({ idCargado: idPlato, plato: resultado });
          setError(null);
        }
      } catch (err) {
        console.error('Error al cargar plato armable:', err);
        if (activo) {
          setEstadoCarga({ idCargado: idPlato, plato: null });
          setError(err);
        }
      }
    }

    cargarPlato();

    return () => {
      activo = false;
    };
  }, [idPlato]);

  useEffect(() => {
    return suscribirCambiosMenu((nuevoMenu) => {
      if (!nuevoMenu) return;
      const platoNuevo = adaptarPlatoArmable(nuevoMenu, idPlato);
      setEstadoCarga((prev) => (prev.idCargado === idPlato ? { idCargado: idPlato, plato: platoNuevo } : prev));
      if (platoNuevo) despachador({ type: 'PODAR_SELECCIONES', plato: platoNuevo });
    });
  }, [idPlato]);

  useEffect(() => {
    if (!socketOn) return undefined;
    const bajaIng = socketOn('ingrediente:disponibilidad', (data) => {
      const idIng = Number(data?.id_ingrediente ?? data?.idIngrediente);
      const disponible = Boolean(data?.disponible);
      if (!idIng) return;

      actualizarDisponibilidadEnCache(idIng, disponible);

      if (!disponible) {
        despachador({ type: 'QUITAR_NO_DISPONIBLE', id_ingrediente: idIng });
      }

      setEstadoCarga((prev) => {
        if (!prev.plato || !Array.isArray(prev.plato.pasos)) return prev;
        const nuevosPasos = prev.plato.pasos.map((paso) => ({
          ...paso,
          ingredientes: (paso.ingredientes || []).map((ing) =>
            Number(ing.id_ingrediente) === idIng
              ? { ...ing, disponible }
              : ing
          ),
        }));
        return {
          ...prev,
          plato: { ...prev.plato, pasos: nuevosPasos },
        };
      });
    });

    const bajaPlato = socketOn('plato:disponibilidad', (data) => {
      const idPlatoEv = Number(data?.id_plato ?? data?.idPlato);
      const disponible = Boolean(data?.disponible);
      if (!idPlatoEv) return;

      actualizarDisponibilidadPlatoEnCache(idPlatoEv, disponible);

      setEstadoCarga((prev) => {
        if (!prev.plato || Number(prev.plato.id_plato) !== idPlatoEv) return prev;
        return {
          ...prev,
          plato: { ...prev.plato, disponible },
        };
      });
    });

    return () => {
      bajaIng?.();
      bajaPlato?.();
    };
  }, [socketOn]);

  const manejarReintentar = async () => {
    recargarMenu();
    setReintentando(true);
    setError(null);
    try {
      const resultado = await obtenerPlatoArmable(idPlato);
      setEstadoCarga({ idCargado: idPlato, plato: resultado });
    } catch (err) {
      console.error('Error al reintentar plato armable:', err);
      setError(err);
    } finally {
      setReintentando(false);
    }
  };

  const calculo = useMemo(
    () => calcularPlato(plato, estado.selecciones),
    [plato, estado.selecciones]
  );

  const pendientes = useMemo(
    () => pasosPendientes(plato, estado.selecciones),
    [plato, estado.selecciones]
  );

  if (cargando) {
    return (
      <div className="space-y-6 pb-24 max-w-md mx-auto" aria-busy="true" aria-label="Cargando constructor">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-48 bg-papel/60 rounded" />
          <div className="h-4 w-64 bg-papel/40 rounded" />
          <div className="h-2 w-full bg-carbon/20 rounded-full" />
        </div>
        <div className="space-y-3">
          <div className="h-28 bg-papel/70 rounded-2xl animate-pulse border-2 border-carbon/20" />
          <div className="h-28 bg-papel/70 rounded-2xl animate-pulse border-2 border-carbon/20" />
          <div className="h-28 bg-papel/70 rounded-2xl animate-pulse border-2 border-carbon/20" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="text-center py-12 px-4 space-y-4 max-w-md mx-auto ticket-comanda bg-papel">
        <h1 className="font-titulo text-2xl font-bold uppercase tracking-wider text-carbon">
          No pudimos cargar el plato
        </h1>
        <p className="text-rojo-tinta font-semibold font-cuerpo">
          {error.mensaje || error.message || 'Ocurrió un problema inesperado.'}
        </p>
        <Button variante="secundario" onClick={manejarReintentar} className="btn-comanda btn-comanda-borde font-titulo text-base">
          Reintentar
        </Button>
      </div>
    );
  }

  if (!plato || plato.disponible === false) {
    return (
      <div className="text-center space-y-4 py-8 max-w-md mx-auto ticket-comanda bg-papel p-6">
        <h1 className="text-carbon font-titulo uppercase text-2xl font-bold">
          Este plato ya no está disponible
        </h1>
        <Button variante="secundario" onClick={() => navigate('/menu')} className="btn-comanda font-titulo text-base">
          Volver al menú
        </Button>
      </div>
    );
  }

  const pasos = plato.pasos || [];
  const totalPasos = pasos.length;
  const esUltimoPaso = estado.pasoActual >= totalPasos - 1;
  const pasoActualObj = pasos[estado.pasoActual] || null;
  const seleccionesPasoActual = pasoActualObj
    ? estado.selecciones[pasoActualObj.id_paso] || {}
    : {};
  const validacionPasoActual = validarPaso(pasoActualObj, seleccionesPasoActual);
  const cumpleMinimoPaso = validacionPasoActual.valido;
  const minSelActual = pasoActualObj ? Number(pasoActualObj.min_sel) || 0 : 0;

  const manejarAnterior = () => {
    if (!estado.enResumen && estado.pasoActual === 0) {
      navigate('/menu');
      return;
    }
    despachador({ type: 'ANTERIOR' });
  };

  const manejarSiguiente = () => {
    if (!cumpleMinimoPaso) return;
    despachador({ type: 'SIGUIENTE', totalPasos });
  };

  const manejarAgregarAMesa = () => {
    if (!plato || plato.disponible === false || pendientes.length > 0) return;

    const notasLimpias = estado.notas.trim();
    const linea = {
      id_linea: generarIdLinea(),
      comensal: obtenerApodo(),
      id_plato: plato.id_plato,
      cantidad: 1,
      notas: notasLimpias,
      nombre: plato.nombre,
      precioUnitario: calculo.precio,
      ingredientes: calculo.ingredientes,
      detalle: calculo.detalle,
      calorias: calculo.calorias,
      notasCliente: notasLimpias,
    };

    agregarLinea(linea);
    despachador({ type: 'REINICIAR' });
    navigate('/carrito');
  };

  const portadaUrl = urlImagen(plato.url_imagen);

  return (
    <div className="space-y-4 pb-32 max-w-md mx-auto">
      {/* Portada / Hero del plato */}
      <div className="-mx-4 -mt-4 mb-2 relative overflow-hidden rounded-b-3xl bg-carbon min-h-[160px] border-b-2 border-carbon">
        <div className="h-48 sm:h-56 w-full relative">
          <Imagen
            src={portadaUrl}
            alt={plato.nombre}
            width={800}
            height={533}
            fetchPriority="high"
            loading="eager"
            aspecto="auto"
            className="w-full h-full"
            imgClassName="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-carbon via-carbon/75 to-transparent pointer-events-none" />
        </div>
        <div className="absolute bottom-0 inset-x-0 p-4">
          <button
            type="button"
            onClick={() => navigate('/menu')}
            className="min-h-11 font-manuscrita text-xl text-ambar hover:underline inline-flex items-center gap-1 mb-1 cursor-pointer"
          >
            ← Volver al menú
          </button>
          <h1 className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-papel leading-none [text-shadow:3px_3px_0_var(--color-brasa)]">
            {plato.nombre}
          </h1>
          {plato.descripcion && (
            <p className="text-xs sm:text-sm text-papel/80 font-cuerpo mt-1 line-clamp-2">
              {plato.descripcion}
            </p>
          )}
        </div>
      </div>

      <ProgressBar
        pasoActual={estado.enResumen ? totalPasos : estado.pasoActual + 1}
        totalPasos={totalPasos}
        etiqueta={
          estado.enResumen
            ? 'Resumen de tu plato'
            : pasoActualObj?.nombre || ''
        }
      />

      {estado.enResumen ? (
        <div className="ticket-comanda bg-papel text-tinta">
          <div className="banda-comanda flex items-center justify-between">
            <h2 className="font-titulo text-xl tracking-wide uppercase text-ambar">
              TU PLATO
            </h2>
            <button
              type="button"
              onClick={manejarAnterior}
              className="text-xs font-titulo uppercase tracking-wider px-2.5 py-1 rounded bg-ambar text-carbon hover:bg-ambar/90 transition-colors cursor-pointer"
            >
              Editar
            </button>
          </div>

          <div className="p-4 space-y-3 bg-papel">
            <div className="space-y-3 divide-y divide-dashed divide-papel-linea">
              {pasos.map((paso) => {
                const itemsPaso = calculo.detalle.filter(
                  (d) => d.paso === paso.nombre
                );
                return (
                  <div key={paso.id_paso} className="pt-2.5 first:pt-0">
                    <h3 className="text-xs font-titulo font-bold uppercase tracking-wider text-papel-suave">
                      {paso.nombre}
                    </h3>
                    {itemsPaso.length === 0 ? (
                      <p className="text-xs text-papel-suave/70 italic mt-0.5 font-cuerpo">
                        Sin selección
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {itemsPaso.map((item, idx) => (
                          <li
                            key={`${paso.id_paso}-${idx}`}
                            className="text-sm font-semibold text-carbon font-cuerpo flex items-center justify-between"
                          >
                            <span>{item.nombre}</span>
                            <span className="font-titulo uppercase text-xs tracking-wider px-2 py-0.5 rounded bg-carbon/10 text-carbon">
                              {ETIQUETA_PORCION[item.porcion] || item.porcion}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5 pt-2 border-t-2 border-dashed border-papel-linea">
              <p className="text-xs font-titulo font-bold uppercase tracking-wider text-papel-suave">
                Alérgenos
              </p>
              {calculo.alergenos.length === 0 ? (
                <p className="text-xs text-papel-suave font-cuerpo">Sin alérgenos declarados</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {calculo.alergenos.map((alergeno) => (
                    <Badge
                      key={alergeno}
                      className="bg-brasa/15 text-rojo-tinta border border-brasa/30 font-titulo text-xs uppercase px-2 py-0.5"
                    >
                      {ALERGENOS_MAP[alergeno] || alergeno}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5 pt-2 border-t-2 border-dashed border-papel-linea">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={notasId}
                  className="text-xs font-titulo uppercase tracking-wider text-papel-suave"
                >
                  Notas para cocina (opcional)
                </label>
                <span className="text-xs text-papel-suave font-cuerpo">
                  {estado.notas.length}/200
                </span>
              </div>
              <textarea
                id={notasId}
                rows={3}
                maxLength={200}
                value={estado.notas}
                onChange={(e) =>
                  despachador({ type: 'CAMBIAR_NOTAS', notas: e.target.value })
                }
                placeholder="Ej: Salsa aparte, bien cocido..."
                className="w-full min-h-[80px] bg-[repeating-linear-gradient(transparent_0_31px,#e3cfb8_31px_33px)] leading-[33px] px-2 font-manuscrita text-2xl text-carbon placeholder:text-papel-suave/60 border-0 focus:outline-none focus:ring-2 focus:ring-brasa rounded resize-y"
              />
            </div>

            {pendientes.length > 0 && (
              <p role="alert" className="text-xs font-bold text-rojo-tinta font-cuerpo pt-1">
                Falta completar: {pendientes.join(', ')}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <PasoConstructor
            paso={pasoActualObj}
            seleccionesDelPaso={seleccionesPasoActual}
            despachador={despachador}
          />

          {!cumpleMinimoPaso && (
            <p
              role="status"
              className="text-xs font-bold text-rojo-tinta text-right font-cuerpo"
            >
              Elige al menos {minSelActual}
            </p>
          )}
        </>
      )}

      <BottomBar precioTotal={calculo.precio} calorias={calculo.calorias}>
        <Button
          variante="secundario"
          onClick={manejarAnterior}
          className="btn-comanda btn-comanda-borde text-papel border-papel hover:bg-papel/20 font-titulo text-base cursor-pointer"
        >
          Anterior
        </Button>
        {estado.enResumen ? (
          <Button
            variante="primario"
            disabled={pendientes.length > 0}
            onClick={manejarAgregarAMesa}
            className="btn-comanda bg-ambar text-carbon hover:bg-ambar/90 font-titulo text-lg px-4 cursor-pointer"
          >
            Añadir a la mesa
          </Button>
        ) : (
          <Button
            variante="primario"
            disabled={!cumpleMinimoPaso}
            onClick={manejarSiguiente}
            className="btn-comanda bg-ambar text-carbon hover:bg-ambar/90 font-titulo text-lg px-4 cursor-pointer"
          >
            {esUltimoPaso ? 'Ver resumen' : 'Siguiente'}
          </Button>
        )}
      </BottomBar>
    </div>
  );
}

export default Constructor;
