const restaurante = {
  nombre: 'SmartDining Restaurante',
  eslogan: 'Sabor vallenato, servicio inteligente.',
  historia:
    'SmartDining nació en 2016 como una pequeña cocina familiar en el centro de Valledupar, con la idea de servir los sabores de siempre del Cesar con un toque moderno. Diez años después seguimos cocinando con productos de la región y recetas de la casa, pero cambiamos la forma de atender: hoy cada mesa tiene su código QR para pedir y pagar desde el celular, sin filas ni esperas. Lo que no cambia es la sazón ni el gusto por recibir a cada cliente como en casa.',
  anioFundacion: 2016,
  direccion: {
    calle: 'Carrera 9 # 16-45, Centro',
    ciudad: 'Valledupar',
    region: 'Cesar',
    codigoPostal: '',
    pais: 'CO',
  },
  telefono: '+573008233204',
  telefonoVisible: '300 823 3204',
  whatsapp: '573046654848',
  whatsappVisible: '304 665 4848',
  correo: 'contacto@smartdining.com.co',
  horario: {
    lunes: { abre: '11:30', cierra: '23:00' },
    martes: { abre: '11:30', cierra: '23:00' },
    miercoles: { abre: '11:30', cierra: '23:00' },
    jueves: { abre: '11:30', cierra: '23:00' },
    viernes: { abre: '11:30', cierra: '23:00' },
    sabado: { abre: '11:30', cierra: '23:00' },
    domingo: { abre: '11:30', cierra: '23:00' },
  },
  horarioVisible: 'Lunes a domingo, 11:30 a. m. – 11:00 p. m.',
  redes: [
    { nombre: 'Instagram', url: 'https://www.instagram.com/smartdining' },
    { nombre: 'Facebook', url: 'https://www.facebook.com/smartdining' },
    { nombre: 'TikTok', url: 'https://www.tiktok.com/@smartdining' },
  ],
  videosPlatos: {
    'Arepa Rellena': {
      archivo: '/videos/arepa.mp4',
      poster: '/videos/arepa-poster.webp',
      ia: true,
      credito: '',
    },
    'Bowl Personalizado': {
      archivo: '/videos/bowl.mp4',
      poster: '/videos/bowl-poster.webp',
      ia: true,
      credito: 'Imagen base: Freepik',
    },
    'Wrap Personalizado': {
      archivo: '/videos/wrap.mp4',
      poster: '/videos/wrap-poster.webp',
      ia: true,
      credito: '',
    },
  },
};

export default restaurante;
