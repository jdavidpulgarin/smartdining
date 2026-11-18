import { constructorReducer, estadoInicial } from '../constructorReducer';

const PASO_UNICO = { id_paso: 1, min_sel: 1, max_sel: 1 };
const PASO_MULTI = { id_paso: 2, min_sel: 0, max_sel: 2 };

const ING_A = { id_ingrediente: 10, nombre: 'Arroz', disponible: true };
const ING_B = { id_ingrediente: 11, nombre: 'Quinoa', disponible: true };
const ING_AGOTADO = { id_ingrediente: 12, nombre: 'Panceta', disponible: false };
const ING_C = { id_ingrediente: 13, nombre: 'Maíz', disponible: true };

describe('constructorReducer', () => {
  test('reemplaza seleccion cuando max_sel es 1 y bloquea ingredientes agotados', () => {
    let estado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_UNICO,
      ingrediente: ING_AGOTADO,
    });
    expect(estado.selecciones).toEqual({});

    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_UNICO,
      ingrediente: ING_A,
    });
    expect(estado.selecciones[1]).toEqual({ 10: 'normal' });

    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_UNICO,
      ingrediente: ING_B,
    });
    expect(estado.selecciones[1]).toEqual({ 11: 'normal' });
  });

  test('respeta el limite max_sel en seleccion multiple y permite quitar', () => {
    let estado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_MULTI,
      ingrediente: ING_A,
    });
    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_MULTI,
      ingrediente: ING_B,
    });
    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_MULTI,
      ingrediente: ING_C,
    });

    expect(Object.keys(estado.selecciones[2])).toEqual(['10', '11']);

    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_MULTI,
      ingrediente: ING_A,
    });
    expect(estado.selecciones[2]).toEqual({ 11: 'normal' });
  });

  test('cambia la porcion de un ingrediente seleccionado y avanza pasos', () => {
    let estado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: PASO_UNICO,
      ingrediente: ING_A,
    });

    estado = constructorReducer(estado, {
      type: 'CAMBIAR_PORCION',
      id_paso: 1,
      id_ingrediente: 10,
      porcion: 'extra',
    });
    expect(estado.selecciones[1][10]).toBe('extra');

    estado = constructorReducer(estado, { type: 'SIGUIENTE', totalPasos: 1 });
    expect(estado.enResumen).toBe(true);

    estado = constructorReducer(estado, {
      type: 'CAMBIAR_NOTAS',
      notas: 'Sin salsa picante',
    });
    expect(estado.notas).toBe('Sin salsa picante');
  });
});
