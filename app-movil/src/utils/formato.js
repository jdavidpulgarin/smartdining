// Copiado de frontend-cliente; pasar a packages/core (R-22)
export const formatearPrecio = (valor) => {
  const num = Number(valor) || 0;
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `$${Math.round(num).toLocaleString('es-CO')}`;
  }
};
