import { useEffect, useState } from 'react';

const IMAGEN_RESPALDO =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%231F1F1F'/><g fill='none' stroke='%23E3242B' stroke-width='8' stroke-linecap='round' stroke-linejoin='round' opacity='0.45'><circle cx='200' cy='150' r='55'/><path d='M120 110v80M105 110v30a15 15 0 0 0 30 0v-30M280 110v80M280 110c15 0 20 15 20 35h-20'/></g></svg>";

/**
 * Componente de imagen con proporción fija, carga diferida y respaldo ante error.
 *
 * Props:
 * - src: URL de la imagen
 * - alt: texto alternativo OBLIGATORIO para accesibilidad
 * - aspecto: proporción de aspecto CSS (por defecto '4/3', p. ej. '1/1', '16/9')
 * - className: clases adicionales para el contenedor
 * - imgClassName: clases adicionales para la etiqueta <img>
 * - srcRespaldo: URL o data URI opcional para mostrar cuando falla la carga
 */
function Imagen({
  src,
  alt,
  aspecto = '4/3',
  className = '',
  imgClassName = '',
  srcRespaldo = IMAGEN_RESPALDO,
  ...rest
}) {
  const [srcFallido, setSrcFallido] = useState(null);

  useEffect(() => {
    if (import.meta.env.DEV && (!alt || typeof alt !== 'string' || !alt.trim())) {
      console.warn('[Imagen] La prop "alt" es obligatoria para accesibilidad.', { src });
    }
  }, [alt, src]);

  const falloCarga = Boolean(src && srcFallido === src);
  const mostrarRespaldo = !src || falloCarga;

  return (
    <div
      style={{ aspectRatio: aspecto }}
      className={`relative overflow-hidden bg-superficie-2 ${className}`.trim()}
    >
      <img
        src={mostrarRespaldo ? srcRespaldo : src}
        alt={alt || 'Imagen del plato'}
        loading="lazy"
        onError={() => {
          if (src && srcFallido !== src) {
            setSrcFallido(src);
          }
        }}
        className={`w-full h-full object-cover ${imgClassName}`.trim()}
        {...rest}
      />
    </div>
  );
}

export default Imagen;
