/**
 * Tokens visuales del diseño oscuro de SmartDining, alineados con la PWA (frontend-cliente).
 */
export const colores = {
  fondo: '#0B0B0B',
  superficie: '#161616',
  superficie2: '#1F1F1F',
  borde: '#2A2A2A',
  primario: '#E3242B',
  primarioHover: '#C81E24',
  primarioTexto: '#FF5A5F',
  texto: '#FFFFFF',
  textoSuave: '#A3A3A3',
  textoTenue: '#6B6B6B',
  acento: '#F2B705',
  exito: '#2FA35A',
};

export const tipografia = {
  familias: {
    titulo: 'System',
    etiqueta: 'System',
    cuerpo: 'System',
  },
  tamanos: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 18,
    xl: 22,
    titulo: 32,
    hero: 42,
  },
};

export const espaciado = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radios = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const tema = {
  colores,
  tipografia,
  espaciado,
  radios,
};

export default tema;
