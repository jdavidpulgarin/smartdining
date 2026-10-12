import { useEffect, useReducer, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { obtenerPlatoArmable } from '../services/menuService';
import {
  constructorReducer,
  estadoInicial,
} from '../components/constructor/constructorReducer';
import PasoConstructor from '../components/constructor/PasoConstructor';
import ProgressBar from '../components/ui/ProgressBar';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

function Constructor() {
  const { idPlato } = useParams();
  const navigate = useNavigate();
  const [estadoCarga, setEstadoCarga] = useState({
    idCargado: null,
    plato: null,
  });
  const [estado, despachador] = useReducer(constructorReducer, estadoInicial);

  const cargando = estadoCarga.idCargado !== idPlato;
  const plato = cargando ? null : estadoCarga.plato;

  useEffect(() => {
    let activo = true;
    despachador({ type: 'REINICIAR' });

    async function cargarPlato() {
      try {
        const resultado = await obtenerPlatoArmable(idPlato);
        if (activo) {
          setEstadoCarga({ idCargado: idPlato, plato: resultado });
        }
      } catch (error) {
        console.error('Error al cargar plato armable:', error);
        if (activo) {
          setEstadoCarga({ idCargado: idPlato, plato: null });
        }
      }
    }

    cargarPlato();

    return () => {
      activo = false;
    };
  }, [idPlato]);

  if (cargando) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent mb-3" />
        <p className="text-gray-600 text-sm font-medium">
          Cargando constructor...
        </p>
      </div>
    );
  }

  if (!plato) {
    return (
      <Card className="text-center space-y-4 py-8">
        <p className="text-cafe font-semibold text-base">
          Este plato no está disponible
        </p>
        <Button variante="secundario" onClick={() => navigate('/menu')}>
          Volver al menú
        </Button>
      </Card>
    );
  }

  const pasos = plato.pasos || [];
  const totalPasos = pasos.length;
  const pasoActualObj = pasos[estado.pasoActual] || null;
  const seleccionesPasoActual = pasoActualObj
    ? estado.selecciones[pasoActualObj.id_paso] || {}
    : {};
  const cantidadElegidaActual = Object.keys(seleccionesPasoActual).length;
  const minSelActual = pasoActualObj ? Number(pasoActualObj.min_sel) || 0 : 0;
  const faltanEnPaso = Math.max(0, minSelActual - cantidadElegidaActual);
  const cumpleMinimoPaso = faltanEnPaso === 0;

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

  return (
    <div className="space-y-4 pb-10">
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
        <Card className="space-y-3">
          <h2 className="font-titulo text-xl font-bold text-cafe">Tu plato</h2>
          <p className="text-sm text-gray-600">
            Revisa tu selección antes de continuar.
          </p>
          <div className="flex items-center justify-between gap-3 pt-2">
            <Button variante="secundario" onClick={manejarAnterior}>
              Anterior
            </Button>
          </div>
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
            <Button
              variante="primario"
              disabled={!cumpleMinimoPaso}
              onClick={manejarSiguiente}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default Constructor;
