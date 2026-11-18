import { useMemo } from 'react';

const DIAS_SEMANA = [
  { clave: 'lunes', etiqueta: 'Lunes' },
  { clave: 'martes', etiqueta: 'Martes' },
  { clave: 'miercoles', etiqueta: 'Miércoles' },
  { clave: 'jueves', etiqueta: 'Jueves' },
  { clave: 'viernes', etiqueta: 'Viernes' },
  { clave: 'sabado', etiqueta: 'Sábado' },
  { clave: 'domingo', etiqueta: 'Domingo' },
];

/**
 * Sección 'Contacto': dirección con address, mapa embebido de Google Maps,
 * teléfono, WhatsApp con mensaje inicial, correo, horario completo y redes sociales.
 */
function Contacto({ datosRestaurante = {} }) {
  const nombre = datosRestaurante.nombre || 'SmartDining Restaurante';
  const direccion = datosRestaurante.direccion;

  const direccionTexto = useMemo(() => {
    if (!direccion) return '';
    const partes = [direccion.calle, direccion.ciudad, direccion.region].filter(Boolean);
    return partes.join(', ');
  }, [direccion]);

  const queryMapa = useMemo(() => {
    const texto = [direccion?.calle, direccion?.ciudad].filter(Boolean).join(', ');
    return encodeURIComponent(texto || nombre);
  }, [direccion, nombre]);

  const urlWhatsapp = useMemo(() => {
    if (!datosRestaurante.whatsapp) return '';
    const mensaje = encodeURIComponent('Hola, quiero información');
    return `https://wa.me/${datosRestaurante.whatsapp}?text=${mensaje}`;
  }, [datosRestaurante.whatsapp]);

  return (
    <section
      id="contacto"
      aria-labelledby="titulo-contacto"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-12"
    >
      <div className="space-y-2">
        <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
          Encuéntranos
        </span>
        <h2
          id="titulo-contacto"
          className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none"
        >
          Contacto
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Columna izquierda: Información, horario y canales */}
        <div className="space-y-6">
          {direccionTexto && (
            <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-2 shadow-lg">
              <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                Ubicación
              </h3>
              <address className="not-italic text-base text-texto font-cuerpo leading-relaxed">
                {direccionTexto}
              </address>
            </div>
          )}

          {/* Teléfono, WhatsApp y Correo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {datosRestaurante.telefono && datosRestaurante.telefonoVisible && (
              <div className="bg-superficie rounded-2xl border border-borde p-5 space-y-1.5 shadow-sm">
                <h4 className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento">
                  Teléfono
                </h4>
                <p className="text-base text-texto font-cuerpo">
                  <a
                    href={`tel:${datosRestaurante.telefono}`}
                    className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    {datosRestaurante.telefonoVisible}
                  </a>
                </p>
              </div>
            )}

            {urlWhatsapp && datosRestaurante.whatsappVisible && (
              <div className="bg-superficie rounded-2xl border border-borde p-5 space-y-1.5 shadow-sm">
                <h4 className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento">
                  WhatsApp
                </h4>
                <p className="text-base text-texto font-cuerpo">
                  <a
                    href={urlWhatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    {datosRestaurante.whatsappVisible}
                  </a>
                </p>
              </div>
            )}

            {datosRestaurante.correo && (
              <div className="bg-superficie rounded-2xl border border-borde p-5 space-y-1.5 shadow-sm sm:col-span-2">
                <h4 className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento">
                  Correo electrónico
                </h4>
                <p className="text-base text-texto font-cuerpo break-all">
                  <a
                    href={`mailto:${datosRestaurante.correo}`}
                    className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    {datosRestaurante.correo}
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* Horario de atención */}
          {(datosRestaurante.horarioVisible || datosRestaurante.horario) && (
            <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-4 shadow-lg">
              <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                Horario de atención
              </h3>
              {datosRestaurante.horarioVisible && (
                <p className="text-base text-texto font-cuerpo font-medium">
                  {datosRestaurante.horarioVisible}
                </p>
              )}

              {datosRestaurante.horario && typeof datosRestaurante.horario === 'object' && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm pt-3 border-t border-borde/60">
                  {DIAS_SEMANA.map(({ clave, etiqueta }) => {
                    const dia = datosRestaurante.horario[clave];
                    const textoDia =
                      dia && dia.abre && dia.cierra
                        ? `${dia.abre} - ${dia.cierra}`
                        : 'Cerrado';
                    return (
                      <div
                        key={clave}
                        className="flex items-center justify-between py-1.5 border-b border-borde/40 last:border-b-0"
                      >
                        <dt className="font-semibold text-texto">{etiqueta}</dt>
                        <dd className="text-texto-suave font-etiqueta tracking-wide text-base">
                          {textoDia}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>
          )}

          {/* Redes sociales */}
          {Array.isArray(datosRestaurante.redes) && datosRestaurante.redes.length > 0 && (
            <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-3 shadow-lg">
              <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                Redes sociales
              </h3>
              <ul className="flex flex-wrap gap-2.5">
                {datosRestaurante.redes.map((red) => (
                  <li key={red.url || red.nombre}>
                    <a
                      href={red.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${red.nombre} de ${nombre} (se abre en otra pestaña)`}
                      className="min-h-11 px-4 py-2 rounded-xl bg-superficie-2 border border-borde hover:border-acento text-sm font-etiqueta uppercase tracking-wider font-bold text-texto inline-flex items-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
                    >
                      <span>{red.nombre}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Columna derecha: Mapa interactivo embebido */}
        <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-4 shadow-lg sticky top-24">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
              Mapa
            </h3>
            <a
              href={`https://www.google.com/maps?q=${queryMapa}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-acento hover:underline font-semibold inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto rounded-lg"
            >
              Abrir en Google Maps ↗
            </a>
          </div>

          <div className="w-full h-72 sm:h-96 rounded-2xl overflow-hidden border border-borde bg-superficie-2">
            <iframe
              title={`Mapa de ${nombre}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://www.google.com/maps?q=${queryMapa}&output=embed`}
              className="w-full h-full border-0"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default Contacto;
