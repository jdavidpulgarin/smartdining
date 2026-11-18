import {
  carritoReducer,
  ESTADO_INICIAL_CARRITO,
  calcularSubtotalLinea,
  calcularTotalCarrito,
  calcularTotalUnidades,
} from '../carrito';

describe('carrito puro y totales', () => {
  test('agrega lineas, calcula subtotales, total general y unidades', () => {
    let estado = carritoReducer(ESTADO_INICIAL_CARRITO, {
      type: 'AGREGAR_LINEA',
      payload: {
        id_linea: 'l1',
        id_plato: 1006,
        nombre: 'Hamburguesa',
        precioUnitario: 34000,
        cantidad: 2,
        notas: 'Sin cebolla',
      },
    });
    estado = carritoReducer(estado, {
      type: 'AGREGAR_LINEA',
      payload: {
        id_linea: 'l2',
        id_plato: 1008,
        nombre: 'Limonada',
        precioUnitario: 12000,
        cantidad: 1,
      },
    });

    expect(calcularSubtotalLinea(estado.lineas[0])).toBe(68000);
    expect(calcularTotalCarrito(estado.lineas)).toBe(80000);
    expect(calcularTotalUnidades(estado.lineas)).toBe(3);
  });

  test('actualiza cantidades con limites, edita notas y elimina al llegar a 0', () => {
    let estado = carritoReducer(ESTADO_INICIAL_CARRITO, {
      type: 'AGREGAR_LINEA',
      payload: {
        id_linea: 'l1',
        id_plato: 1001,
        nombre: 'Bowl',
        precioUnitario: 20000,
        cantidad: 1,
      },
    });

    estado = carritoReducer(estado, {
      type: 'ACTUALIZAR_CANTIDAD',
      payload: { id_linea: 'l1', cantidad: 25 },
    });
    expect(estado.lineas[0].cantidad).toBe(20);

    estado = carritoReducer(estado, {
      type: 'ACTUALIZAR_NOTAS',
      payload: { id_linea: 'l1', notas: 'Salsa aparte' },
    });
    expect(estado.lineas[0].notas).toBe('Salsa aparte');

    estado = carritoReducer(estado, {
      type: 'ACTUALIZAR_CANTIDAD',
      payload: { id_linea: 'l1', cantidad: 0 },
    });
    expect(estado.lineas).toHaveLength(0);
    expect(calcularTotalCarrito(estado.lineas)).toBe(0);
  });
});
