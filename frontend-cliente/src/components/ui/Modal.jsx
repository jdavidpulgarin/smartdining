import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

function Modal({ abierto = false, onCerrar, titulo, children }) {
  const tituloId = useId();
  const modalRef = useRef(null);
  const onCerrarRef = useRef(onCerrar);

  useEffect(() => {
    onCerrarRef.current = onCerrar;
  });

  useEffect(() => {
    if (!abierto) return;

    // Guardar elemento activo previo para restaurar foco al cerrar
    const elementoPrevio = document.activeElement;

    // Bloqueo de scroll en body
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Foco al contenedor del modal
    modalRef.current?.focus();

    // Listener para tecla Escape
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCerrarRef.current?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = overflowPrevio;
      window.removeEventListener('keydown', handleKeyDown);
      elementoPrevio?.focus?.();
    };
  }, [abierto]);

  if (!abierto) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-end justify-center md:items-center p-0 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCerrar?.();
        }
      }}
    >
      {/* Overlay oscuro al 70% */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onCerrar}
      />

      {/* Contenedor del contenido */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-h-[90vh] flex flex-col bg-superficie border border-borde rounded-t-2xl md:rounded-2xl max-w-md shadow-2xl focus:outline-none overflow-hidden pb-[env(safe-area-inset-bottom)] md:pb-0 text-texto"
      >
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-borde shrink-0">
          <h2 id={tituloId} className="text-xl font-etiqueta uppercase tracking-wide font-bold text-texto truncate">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="min-w-12 min-h-12 -mr-2 inline-flex items-center justify-center text-texto-suave hover:text-texto hover:bg-superficie-2 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cuerpo con scroll interno */}
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default Modal;
