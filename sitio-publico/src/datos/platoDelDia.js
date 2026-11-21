/**
 * Calendario semanal de promociones del "Plato del día".
 * Cada entrada define el plato destacado de cada día con su descripción
 * y opcionalmente su video promocional y portada.
 */
export const CALENDARIO_PLATO_DEL_DIA = {
  lunes: {
    dia: 'lunes',
    diaEtiqueta: 'lunes',
    nombre: 'Hamburguesa Smart Angus',
    descripcion: '200 g de carne Angus jugosa con queso cheddar madurado, tocineta ahumada y cebolla caramelizada en suave pan brioche.',
  },
  martes: {
    dia: 'martes',
    diaEtiqueta: 'martes',
    nombre: 'Salchipapa con todo',
    descripcion: 'Papas a la francesa crocantes con salchicha premium, chorizo artesanal, queso fundido, tocineta crujiente y salsas de la casa.',
    video: '/videos/plato-del-dia/salchipapa.mp4',
    poster: '/videos/plato-del-dia/salchipapa.webp',
  },
  miercoles: {
    dia: 'miercoles',
    diaEtiqueta: 'miércoles',
    nombre: 'Pastas a la boloñesa',
    descripcion: 'Pasta artesanal cocida al dente con salsa boloñesa tradicional cocinada a fuego lento y queso parmesano.',
  },
  jueves: {
    dia: 'jueves',
    diaEtiqueta: 'jueves',
    nombre: 'Pollo asado',
    descripcion: 'Pollo marinado con finas hierbas y especias de la casa, dorado a la perfección y acompañado de papas rústicas.',
  },
  viernes: {
    dia: 'viernes',
    diaEtiqueta: 'viernes',
    nombre: 'Pizza',
    descripcion: 'Masa crujiente artesanal con salsa pomodoro de la casa, queso mozzarella fundido y albahaca fresca.',
  },
  sabado: {
    dia: 'sabado',
    diaEtiqueta: 'sábado',
    nombre: 'Carne asada con papas',
    descripcion: 'Corte premium de res a la parrilla con el toque justo de brasa, papas criollas doradas y chimichurri.',
  },
  domingo: {
    dia: 'domingo',
    diaEtiqueta: 'domingo',
    nombre: 'Volcán de chocolate',
    descripcion: 'Bizcocho tibio de chocolate amargo con centro líquido fluido, servido con helado artesanal de vainilla.',
  },
};

export default CALENDARIO_PLATO_DEL_DIA;
