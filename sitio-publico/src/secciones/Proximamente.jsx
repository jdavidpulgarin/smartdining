/**
 * Sección 'Próximamente': canales de venta futuros (Para llevar y Domicilios).
 * No contiene enlaces ni botones interactivos.
 */
function Proximamente() {
  return (
    <section
      id="proximamente"
      aria-labelledby="titulo-proximamente"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-10"
    >
      <div className="space-y-2">
        <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
          Nuevas experiencias
        </span>
        <h2
          id="titulo-proximamente"
          className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none"
        >
          Próximamente
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <article className="bg-superficie rounded-3xl border border-borde p-6 sm:p-8 space-y-4 shadow-lg flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-titulo text-3xl uppercase tracking-wide text-texto">
                Para llevar
              </h3>
              <span className="px-3 py-1 rounded-full bg-acento/15 text-acento border border-acento/30 text-xs font-etiqueta font-bold tracking-widest uppercase">
                Próximamente
              </span>
            </div>
            <p className="text-sm sm:text-base text-texto-suave font-cuerpo leading-relaxed">
              Podrás ordenar tus platos preferidos antes de salir de casa o del trabajo y recogerlos listos en el restaurante sin filas ni demoras.
            </p>
          </div>
        </article>

        <article className="bg-superficie rounded-3xl border border-borde p-6 sm:p-8 space-y-4 shadow-lg flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-titulo text-3xl uppercase tracking-wide text-texto">
                Domicilios
              </h3>
              <span className="px-3 py-1 rounded-full bg-acento/15 text-acento border border-acento/30 text-xs font-etiqueta font-bold tracking-widest uppercase">
                Próximamente
              </span>
            </div>
            <p className="text-sm sm:text-base text-texto-suave font-cuerpo leading-relaxed">
              Llevaremos la auténtica sazón vallenata y los ingredientes de nuestra tierra directamente hasta la puerta de tu hogar.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

export default Proximamente;
