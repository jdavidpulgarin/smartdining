/**
 * Calendario semanal de promociones del "Plato del día".
 * Cada entrada define el plato destacado de cada día con su descripción,
 * títulos en dos líneas para estilo póster, lema, nombre exacto en la carta (sin precios hardcodeados)
 * y opcionalmente video promocional y portada.
 */
export const CALENDARIO_PLATO_DEL_DIA = {
  lunes: {
    dia: 'lunes',
    diaEtiqueta: 'lunes',
    nombreCarta: 'Hamburguesa Smart Angus',
    titulo1: 'HAMBURGUESA',
    titulo2: 'SMART ANGUS',
    lema: 'a la parrilla',
    descripcion: '200 g de carne Angus jugosa con queso cheddar madurado, tocineta ahumada y cebolla caramelizada en suave pan brioche.',
  },
  martes: {
    dia: 'martes',
    diaEtiqueta: 'martes',
    nombreCarta: 'Salchipapa con todo',
    titulo1: 'SALCHIPAPA',
    titulo2: 'CON TODO',
    lema: 'como debe ser',
    descripcion: 'Papas a la francesa crocantes con salchicha premium, chorizo artesanal, queso fundido, tocineta crujiente y salsas de la casa.',
    video: '/videos/plato-del-dia/salchipapa.mp4',
    poster: '/videos/plato-del-dia/salchipapa.webp',
  },
  miercoles: {
    dia: 'miercoles',
    diaEtiqueta: 'miércoles',
    nombreCarta: 'Pastas a la boloñesa',
    titulo1: 'PASTAS A LA',
    titulo2: 'BOLOÑESA',
    lema: 'receta de la casa',
    descripcion: 'Pasta artesanal cocida al dente con salsa boloñesa tradicional cocinada a fuego lento y queso parmesano.',
  },
  jueves: {
    dia: 'jueves',
    diaEtiqueta: 'jueves',
    nombreCarta: 'Pollo asado',
    titulo1: 'POLLO',
    titulo2: 'ASADO',
    lema: 'dorado al carbón',
    descripcion: 'Pollo marinado con finas hierbas y especias de la casa, dorado a la perfección y acompañado de papas rústicas.',
  },
  viernes: {
    dia: 'viernes',
    diaEtiqueta: 'viernes',
    nombreCarta: 'Pizza',
    titulo1: 'PIZZA',
    titulo2: 'DE LA CASA',
    lema: 'recién horneada',
    descripcion: 'Masa crujiente artesanal con salsa pomodoro de la casa, queso mozzarella fundido y albahaca fresca.',
  },
  sabado: {
    dia: 'sabado',
    diaEtiqueta: 'sábado',
    nombreCarta: 'Carne asada con papas',
    titulo1: 'CARNE ASADA',
    titulo2: 'CON PAPAS',
    lema: 'al carbón',
    descripcion: 'Corte premium de res a la parrilla con el toque justo de brasa, papas criollas doradas y chimichurri.',
  },
  domingo: {
    dia: 'domingo',
    diaEtiqueta: 'domingo',
    nombreCarta: 'Volcán de chocolate',
    titulo1: 'VOLCÁN DE',
    titulo2: 'CHOCOLATE',
    lema: 'para cerrar con broche',
    descripcion: 'Bizcocho tibio de chocolate amargo con centro líquido fluido, servido con helado artesanal de vainilla.',
  },
};

export default CALENDARIO_PLATO_DEL_DIA;
