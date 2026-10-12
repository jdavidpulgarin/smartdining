import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { obtenerPlatoArmable } from '../services/menuService';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

function Constructor() {
  const { idPlato } = useParams();
  const navigate = useNavigate();
  const [estadoCarga, setEstadoCarga] = useState({
    idCargado: null,
    plato: null,
  });
  const cargando = estadoCarga.idCargado !== idPlato;
  const plato = cargando ? null : estadoCarga.plato;

  useEffect(() => {
    let activo = true;

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

  return (
    <div className="space-y-4 pb-8">
      <header className="space-y-1">
        <h1 className="font-titulo text-2xl font-bold text-cafe">
          {plato.nombre}
        </h1>
        {plato.descripcion && (
          <p className="text-sm text-gray-600">{plato.descripcion}</p>
        )}
      </header>
    </div>
  );
}

export default Constructor;
