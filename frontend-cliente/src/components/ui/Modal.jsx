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
      {/* Overlay oscuro */}
      <div
        className="fixed inset-0 bg-black/60"
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
        className="relative z-10 w-full max-h-[90vh] flex flex-col bg-white rounded-t-2xl md:rounded-2xl md:max-w-lg shadow-2xl focus:outline-none overflow-hidden pb-[env(safe-area-inset-bottom)] md:pb-0"
      >
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 id={tituloId} className="text-lg font-bold text-gray-900 truncate">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="p-1.5 -mr-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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
