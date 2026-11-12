import {
  calcularPlato,
  validarPaso,
  pasosPendientes,
} from '../calcularPlato';

const PLATO_EJEMPLO = {
  id_plato: 1001,
  nombre: 'Bowl Personalizado',
  precio: 20000,
  pasos: [
    {
      id_paso: 1,
      nombre: 'Base',
      orden: 1,
      min_sel: 1,
      max_sel: 1,
      ingredientes: [
        {
          id_ingrediente: 10,
          nombre: 'Arroz',
          precio_extra: 0,
          calorias: 180,
          alergenos: [],
          disponible: true,
        },
        {
          id_ingrediente: 11,
          nombre: 'Quinoa',
          precio_extra: 2000,
          calorias: 160,
          alergenos: ['gluten'],
          disponible: true,
        },
      ],
    },
    {
      id_paso: 2,
      nombre: 'Toppings',
      orden: 2,
      min_sel: 0,
      max_sel: 2,
      ingredientes: [
        {
          id_ingrediente: 20,
          nombre: 'Aguacate',
          precio_extra: 1500,
          calorias: 120,
          alergenos: [],
          disponible: true,
        },
        {
          id_ingrediente: 21,
          nombre: 'Queso',
          precio_extra: 1000,
          calorias: 110,
          alergenos: ['lacteos', 'gluten'],
          disponible: true,
        },
      ],
    },
  ],
};

describe('calcularPlato y reglas de pasos', () => {
  test('calcula precio base sin extras cuando las porciones son normal o ligera', () => {
    const res = calcularPlato(PLATO_EJEMPLO, {
      1: { 11: 'normal' },
      2: { 20: 'ligera' },
    });

    expect(res.precio).toBe(20000);
    expect(res.calorias).toBe(160 + 60);
    expect(res.alergenos).toEqual(['gluten']);
  });

  test('suma precio_extra y multiplica calorias por 1.5 cuando la porcion es extra', () => {
    const res = calcularPlato(PLATO_EJEMPLO, {
      1: { 11: 'extra' },
      2: { 20: 'extra', 21: 'normal' },
    });

    expect(res.precio).toBe(20000 + 2000 + 1500);
    expect(res.calorias).toBe(Math.round(160 * 1.5 + 120 * 1.5 + 110));
    expect(res.alergenos).toEqual(['gluten', 'lacteos']);
    expect(res.ingredientes).toEqual([
      { id_ingrediente: 11, porcion: 'extra' },
      { id_ingrediente: 20, porcion: 'extra' },
      { id_ingrediente: 21, porcion: 'normal' },
    ]);
  });

  test('validarPaso verifica minimo y maximo de seleccion', () => {
    const pasoObligatorio = { min_sel: 1, max_sel: 2 };
    expect(validarPaso(pasoObligatorio, {})).toEqual({
      valido: false,
      faltan: 1,
      excede: false,
    });
    expect(validarPaso(pasoObligatorio, { 1: 'normal' })).toEqual({
      valido: true,
      faltan: 0,
      excede: false,
    });
    expect(
      validarPaso(pasoObligatorio, { 1: 'normal', 2: 'normal', 3: 'normal' })
    ).toEqual({
      valido: false,
      faltan: 0,
      excede: true,
    });
  });

  test('pasosPendientes lista los pasos obligatorios sin completar', () => {
    expect(pasosPendientes(PLATO_EJEMPLO, {})).toEqual(['Base']);
    expect(pasosPendientes(PLATO_EJEMPLO, { 1: { 10: 'normal' } })).toEqual([]);
  });
});
