import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

function Modal({ abierto = false, onCerrar, titulo, tamano = 'normal', children }) {
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

    // Listener para Escape y focus trap con Tab / Shift+Tab dentro del modal
    const selectorFoco =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCerrarRef.current?.();
        return;
      }

      if (event.key === 'Tab' && modalRef.current) {
        const enfocables = Array.from(modalRef.current.querySelectorAll(selectorFoco)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement
        );
        if (enfocables.length === 0) {
          event.preventDefault();
          modalRef.current.focus();
          return;
        }
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        if (event.shiftKey && (document.activeElement === primero || document.activeElement === modalRef.current)) {
          event.preventDefault();
          ultimo.focus();
        } else if (!event.shiftKey && document.activeElement === ultimo) {
          event.preventDefault();
          primero.focus();
        }
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

  const esGrande = tamano === 'grande';

  const modalNode = (
    <div
      className={`fixed inset-0 z-60 flex justify-center p-0 ${
        esGrande
          ? 'items-stretch md:items-center md:p-4'
          : 'items-end md:items-center md:p-4'
      }`}
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
        className={`relative z-10 w-full flex flex-col bg-superficie shadow-2xl focus:outline-none overflow-hidden pb-[env(safe-area-inset-bottom)] md:pb-0 text-texto ${
          esGrande
            ? 'h-[100dvh] md:h-auto md:max-h-[90vh] md:rounded-3xl border-none md:border md:border-borde max-w-none md:max-w-4xl'
            : 'max-h-[90vh] border border-borde rounded-t-2xl md:rounded-2xl max-w-md'
        }`}
      >
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-borde shrink-0 bg-superficie">
          <h2 id={tituloId} className="text-xl md:text-2xl font-etiqueta uppercase tracking-wide font-bold text-texto truncate mr-2">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="min-w-11 min-h-11 -mr-2 inline-flex items-center justify-center text-texto-suave hover:text-texto hover:bg-superficie-2 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto cursor-pointer shrink-0"
          >
            <svg
              className="w-5 h-5 sm:w-6 sm:h-6"
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
        <div className="overflow-y-auto flex-1 flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modalNode, document.body)
    : modalNode;
}

export default Modal;
