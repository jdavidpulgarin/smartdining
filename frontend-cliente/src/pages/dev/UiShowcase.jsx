import { useState } from 'react';
import Badge from '../../components/ui/Badge';
import BottomBar from '../../components/ui/BottomBar';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Imagen from '../../components/ui/Imagen';
import IngredientCard from '../../components/ui/IngredientCard';
import ProgressBar from '../../components/ui/ProgressBar';

const INGREDIENTES_MUESTRA = [
  {
    id: 'ing-pollo',
    nombre: 'Pollo a la Plancha',
    imagen: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=300&q=80',
    precioExtra: 0,
    calorias: 220,
    disabled: false,
  },
  {
    id: 'ing-carne',
    nombre: 'Carne Desmechada',
    imagen: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=300&q=80',
    precioExtra: 2500,
    calorias: 260,
    disabled: false,
  },
  {
    id: 'ing-arroz',
    nombre: 'Arroz Artesanal',
    imagen: 'https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=300&q=80',
    precioExtra: 0,
    calorias: 185,
    disabled: false,
  },
  {
    id: 'ing-queso',
    nombre: 'Queso Madurado',
    imagen: 'https://images.unsplash.com/photo-1452195100486-9cc805987862?auto=format&fit=crop&w=300&q=80',
    precioExtra: 3500,
    calorias: 120,
    disabled: true,
  },
];

function UiShowcase() {
  const [seleccionados, setSeleccionados] = useState(['ing-pollo']);
  const [paso, setPaso] = useState(2);

  const alternarIngrediente = (id) => {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const precioBase = 15000;
  const caloriasBase = 400;

  const totalExtra = INGREDIENTES_MUESTRA.filter((i) => seleccionados.includes(i.id)).reduce(
    (acc, i) => acc + i.precioExtra,
    0
  );
  const totalCalorias =
    caloriasBase +
    INGREDIENTES_MUESTRA.filter((i) => seleccionados.includes(i.id)).reduce(
      (acc, i) => acc + i.calorias,
      0
    );

  return (
    <div className="min-h-screen bg-fondo text-texto pb-28">
      <header className="bg-superficie border-b border-borde px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-titulo text-primario tracking-wide">
              SmartDining · UI Base (Tema Oscuro)
            </h1>
            <p className="text-xs text-texto-suave font-cuerpo">
              Catálogo de componentes del sistema de diseño oscuro
            </p>
          </div>
          <Badge variante="alerta">DEV ONLY</Badge>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* 1. Botones */}
        <Card className="space-y-4">
          <h2 className="text-xl font-etiqueta uppercase text-texto font-bold">1. Botones (Button)</h2>
          <div className="flex flex-col gap-2.5">
            <Button variante="primario">SIGUIENTE</Button>
            <Button variante="secundario">ANTERIOR</Button>
            <Button variante="primario" disabled>
              DESHABILITADO
            </Button>
            <Button variante="secundario" disabled>
              SECUNDARIO DESHABILITADO
            </Button>
          </div>
        </Card>

        {/* 2. Badges */}
        <Card className="space-y-4">
          <h2 className="text-xl font-etiqueta uppercase text-texto font-bold">2. Insignias (Badge)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variante="obligatorio">OBLIGATORIO</Badge>
            <Badge variante="preparando">PREPARANDO</Badge>
            <Badge variante="entregado">ENTREGADO</Badge>
            <Badge variante="pagado">PAGADO</Badge>
            <Badge variante="pendiente">PENDIENTE</Badge>
            <Badge variante="neutro">MESA 5</Badge>
          </div>
        </Card>

        {/* 3. Barra de progreso */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-etiqueta uppercase text-texto font-bold">3. Progreso (ProgressBar)</h2>
            <div className="flex gap-2">
              <Button
                variante="secundario"
                onClick={() => setPaso((p) => Math.max(1, p - 1))}
                disabled={paso <= 1}
                className="min-h-9 text-xs px-2.5 py-1"
              >
                ANT
              </Button>
              <Button
                variante="primario"
                onClick={() => setPaso((p) => Math.min(4, p + 1))}
                disabled={paso >= 4}
                className="min-h-9 text-xs px-2.5 py-1"
              >
                SIG
              </Button>
            </div>
          </div>
          <ProgressBar
            pasoActual={paso}
            totalPasos={4}
            etiqueta="Relleno principal"
          />
        </Card>

        {/* 4. Imágenes */}
        <Card className="space-y-4">
          <h2 className="text-xl font-etiqueta uppercase text-texto font-bold">4. Imágenes (Imagen)</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Imagen
                src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80"
                alt="Plato de muestra"
                aspecto="4/3"
                className="rounded-xl border border-borde"
              />
              <p className="text-[11px] text-texto-suave">Imagen válida</p>
            </div>
            <div className="space-y-1">
              <Imagen
                src="https://url-invalida-ejemplo.local/no-existe.jpg"
                alt="Plato con respaldo automático"
                aspecto="4/3"
                className="rounded-xl border border-borde"
              />
              <p className="text-[11px] text-texto-suave">Respaldo oscuro</p>
            </div>
          </div>
        </Card>

        {/* 5. Tarjetas de ingrediente */}
        <Card className="space-y-4">
          <h2 className="text-xl font-etiqueta uppercase text-texto font-bold">5. Ingredientes (IngredientCard)</h2>
          <div className="space-y-2.5">
            {INGREDIENTES_MUESTRA.map((ing) => (
              <IngredientCard
                key={ing.id}
                nombre={ing.nombre}
                imagen={ing.imagen}
                precioExtra={ing.precioExtra}
                calorias={ing.calorias}
                seleccionado={seleccionados.includes(ing.id)}
                disabled={ing.disabled}
                onToggle={() => alternarIngrediente(ing.id)}
              />
            ))}
          </div>
        </Card>
      </main>

      {/* 6. Barra inferior */}
      <BottomBar precioTotal={precioBase + totalExtra} calorias={totalCalorias}>
        <Button variante="primario">SIGUIENTE</Button>
      </BottomBar>
    </div>
  );
}

export default UiShowcase;
