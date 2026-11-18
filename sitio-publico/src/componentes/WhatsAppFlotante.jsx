import { useEffect, useState } from 'react';
import restauranteDefault from '../datos/restaurante.js';

/**
 * Botón flotante accesible de WhatsApp con ícono en línea SVG.
 * Permanece fijo en la esquina inferior derecha respetando safe-area-inset-bottom.
 *
 * Se muestra únicamente cuando el usuario ha descendido de la sección #inicio
 * y se oculta automáticamente cuando un modal o detalle de plato está activo.
 */
function WhatsAppFlotante({
  datosRestaurante = restauranteDefault,
  visibleInicial = false,
  oculto = false,
}) {
  const [bajoPortada, setBajoPortada] = useState(() => Boolean(visibleInicial));

  const whatsapp = datosRestaurante?.whatsapp || restauranteDefault.whatsapp;
  const nombre = datosRestaurante?.nombre || restauranteDefault.nombre;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const elementoInicio = document.getElementById('inicio');
    if (!elementoInicio || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Visible solo cuando el usuario ya bajó de la portada (#inicio ya no intersecta)
        setBajoPortada(!entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    observer.observe(elementoInicio);
    return () => observer.disconnect();
  }, []);

  if (!bajoPortada || oculto) {
    return null;
  }

  const mensaje = encodeURIComponent('Hola, quiero información');
  const urlWhatsapp = `https://wa.me/${whatsapp}?text=${mensaje}`;

  return (
    <a
      href={urlWhatsapp}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Escribir por WhatsApp a ${nombre} (se abre en otra pestaña)`}
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
      className="fixed right-4 sm:right-6 z-40 w-14 h-14 w-[56px] h-[56px] rounded-full bg-exito hover:brightness-110 active:brightness-95 text-white flex items-center justify-center shadow-xl cursor-pointer motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-110 motion-safe:active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto focus-visible:ring-offset-2 focus-visible:ring-offset-fondo"
    >
      <svg
        className="w-7 h-7 fill-current"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
      </svg>
    </a>
  );
}

export default WhatsAppFlotante;
