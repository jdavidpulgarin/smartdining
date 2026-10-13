import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { obtenerPlatoArmable, recargarMenu } from '../services/menuService';
import {
  constructorReducer,
  estadoInicial,
} from '../components/constructor/constructorReducer';
import PasoConstructor from '../components/constructor/PasoConstructor';
import ProgressBar from '../components/ui/ProgressBar';
import BottomBar from '../components/ui/BottomBar';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { useCarrito } from '../context/CarritoContext';
import { obtenerApodo } from '../utils/apodo';
import { generarIdLinea } from '../utils/id';
import {
  calcularPlato,
  pasosPendientes,
  validarPaso,
} from '../utils/calcularPlato';
import { ALERGENOS_MAP } from '../constants/dieta';

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
      <div className="space-y-6 pb-24" aria-busy="true" aria-label="Cargando constructor">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="h-4 w-64 bg-gray-200 rounded" />
          <div className="h-2 w-full bg-gray-200 rounded-full" />
        </div>
        <div className="space-y-3">
          <div className="h-28 bg-gray-200 rounded-2xl animate-pulse" />
          <div className="h-28 bg-gray-200 rounded-2xl animate-pulse" />
          <div className="h-28 bg-gray-200 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 px-4 space-y-4">
        <p className="text-red-600 font-medium">
          {error.mensaje || error.message || 'No pudimos cargar el plato'}
        </p>
        <Button variante="secundario" onClick={manejarReintentar}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!plato) {
    return (
      <Card className="text-center space-y-4 py-8">
        <p className="text-cafe font-semibold text-base">
          Este plato ya no está disponible
        </p>
        <Button variante="secundario" onClick={() => navigate('/menu')}>
          Volver al menú
        </Button>
      </Card>
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
    if (pendientes.length > 0) return;

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

  return (
    <div className="space-y-4 pb-32">
      <header className="space-y-1">
        <h1 className="font-titulo text-2xl font-bold text-cafe">
          {plato.nombre}
        </h1>
        {plato.descripcion && (
          <p className="text-sm text-gray-600">{plato.descripcion}</p>
        )}
      </header>

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
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-titulo text-xl font-bold text-cafe">
              Tu plato
            </h2>
            <Button variante="secundario" onClick={manejarAnterior}>
              Editar
            </Button>
          </div>

          <div className="space-y-3 divide-y divide-gray-100">
            {pasos.map((paso) => {
              const itemsPaso = calculo.detalle.filter(
                (d) => d.paso === paso.nombre
              );
              return (
                <div key={paso.id_paso} className="pt-2.5 first:pt-0">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">
                    {paso.nombre}
                  </h3>
                  {itemsPaso.length === 0 ? (
                    <p className="text-sm text-gray-500 italic mt-0.5">
                      Sin selección
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {itemsPaso.map((item, idx) => (
                        <li
                          key={`${paso.id_paso}-${idx}`}
                          className="text-sm font-medium text-cafe"
                        >
                          {item.nombre} ·{' '}
                          <span className="font-semibold text-primary">
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

          <div className="space-y-1.5 pt-2 border-t border-gray-100">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-600">
              Alérgenos
            </p>
            {calculo.alergenos.length === 0 ? (
              <p className="text-xs text-gray-600">Sin alérgenos declarados</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {calculo.alergenos.map((alergeno) => (
                  <Badge key={alergeno} variante="alerta">
                    {ALERGENOS_MAP[alergeno] || alergeno}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <label
                htmlFor={notasId}
                className="text-sm font-semibold text-cafe"
              >
                Notas para cocina (opcional)
              </label>
              <span className="text-xs text-gray-600">
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
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-cafe focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          {pendientes.length > 0 && (
            <p role="alert" className="text-xs font-semibold text-primary">
              Falta completar: {pendientes.join(', ')}
            </p>
          )}
        </Card>
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
              className="text-xs font-semibold text-primary text-right"
            >
              Elige al menos {minSelActual}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button variante="secundario" onClick={manejarAnterior}>
              Anterior
            </Button>
          </div>
        </>
      )}

      <BottomBar precioTotal={calculo.precio} calorias={calculo.calorias}>
        {estado.enResumen ? (
          <Button
            variante="primario"
            disabled={pendientes.length > 0}
            onClick={manejarAgregarAMesa}
          >
            Agregar a la mesa
          </Button>
        ) : (
          <Button
            variante="primario"
            disabled={!cumpleMinimoPaso}
            onClick={manejarSiguiente}
          >
            {esUltimoPaso ? 'Ver resumen' : 'Siguiente'}
          </Button>
        )}
      </BottomBar>
    </div>
  );
}

export default Constructor;
