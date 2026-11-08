import { describe, expect, it } from 'vitest';
import menuEjemplo from '../../mocks/ejemplo-menu.json';
import {
  constructorReducer,
  estadoInicial,
} from './constructorReducer';

const bowl = menuEjemplo
  .flatMap((cat) => cat.platos || [])
  .find((p) => p.id_plato === 1001);

const pasoBase = bowl.pasos.find((p) => p.id_paso === 101); // max_sel = 1
const pasoProteina = bowl.pasos.find((p) => p.id_paso === 102); // incluye Panceta agotada (id 7)
const pasoToppings = bowl.pasos.find((p) => p.id_paso === 103); // max_sel = 3

describe('constructorReducer', () => {
  it('agrega un ingrediente disponible con porcion por defecto "normal"', () => {
    const arroz = pasoBase.ingredientes.find((i) => i.id_ingrediente === 1);
    const nuevoEstado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoBase,
      ingrediente: arroz,
    });

    expect(nuevoEstado.selecciones[101]).toEqual({ 1: 'normal' });
  });

  it('en pasos con max_sel === 1 reemplaza al ingrediente elegido (comportamiento radio)', () => {
    const arroz = pasoBase.ingredientes.find((i) => i.id_ingrediente === 1);
    const quinoa = pasoBase.ingredientes.find((i) => i.id_ingrediente === 2);

    const conArroz = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoBase,
      ingrediente: arroz,
    });
    const conQuinoa = constructorReducer(conArroz, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoBase,
      ingrediente: quinoa,
    });

    expect(conQuinoa.selecciones[101]).toEqual({ 2: 'normal' });
  });

  it('respeta el tope de max_sel cuando max_sel > 1 y permite deseleccionar', () => {
    const [ing1, ing2, ing3, ing4] = pasoToppings.ingredientes;

    let estado = estadoInicial;
    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoToppings,
      ingrediente: ing1,
    });
    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoToppings,
      ingrediente: ing2,
    });
    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoToppings,
      ingrediente: ing3,
    });

    // Intentar agregar un 4to cuando max_sel es 3 no cambia el estado
    const intentoCuarto = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoToppings,
      ingrediente: ing4,
    });
    expect(Object.keys(intentoCuarto.selecciones[103])).toHaveLength(3);

    // Deseleccionar uno existente lo quita
    const trasQuitar = constructorReducer(intentoCuarto, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoToppings,
      ingrediente: ing1,
    });
    expect(Object.keys(trasQuitar.selecciones[103])).toHaveLength(2);
  });

  it('no permite elegir un ingrediente agotado (disponible === false)', () => {
    const pancetaAgotada = pasoProteina.ingredientes.find(
      (i) => i.id_ingrediente === 7
    );
    expect(pancetaAgotada.disponible).toBe(false);

    const estado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoProteina,
      ingrediente: pancetaAgotada,
    });

    expect(estado).toBe(estadoInicial);
    expect(estado.selecciones[102]).toBeUndefined();
  });

  it('CAMBIAR_PORCION actualiza la porcion de un ingrediente elegido e ignora valores invalidos', () => {
    const arroz = pasoBase.ingredientes.find((i) => i.id_ingrediente === 1);
    const conArroz = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoBase,
      ingrediente: arroz,
    });

    const enExtra = constructorReducer(conArroz, {
      type: 'CAMBIAR_PORCION',
      id_paso: 101,
      id_ingrediente: 1,
      porcion: 'extra',
    });
    expect(enExtra.selecciones[101][1]).toBe('extra');

    const porcionInvalida = constructorReducer(enExtra, {
      type: 'CAMBIAR_PORCION',
      id_paso: 101,
      id_ingrediente: 1,
      porcion: 'gigante',
    });
    expect(porcionInvalida.selecciones[101][1]).toBe('extra');
  });

  it('REINICIAR devuelve el estado inicial limpio', () => {
    const arroz = pasoBase.ingredientes.find((i) => i.id_ingrediente === 1);
    let estado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoBase,
      ingrediente: arroz,
    });
    estado = constructorReducer(estado, {
      type: 'SIGUIENTE',
      totalPasos: 4,
    });
    estado = constructorReducer(estado, {
      type: 'CAMBIAR_NOTAS',
      notas: 'Sin sal',
    });

    const reiniciado = constructorReducer(estado, { type: 'REINICIAR' });
    expect(reiniciado).toEqual(estadoInicial);
  });

  it('QUITAR_NO_DISPONIBLE elimina el ingrediente de selecciones si estaba elegido', () => {
    const arroz = pasoBase.ingredientes.find((i) => i.id_ingrediente === 1);
    const pollo = pasoProteina.ingredientes.find((i) => i.id_ingrediente === 4);

    let estado = constructorReducer(estadoInicial, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoBase,
      ingrediente: arroz,
    });
    estado = constructorReducer(estado, {
      type: 'ALTERNAR_INGREDIENTE',
      paso: pasoProteina,
      ingrediente: pollo,
    });

    expect(estado.selecciones[101][1]).toBe('normal');
    expect(estado.selecciones[102][4]).toBe('normal');

    // Quitar pollo (id 4)
    const sinPollo = constructorReducer(estado, {
      type: 'QUITAR_NO_DISPONIBLE',
      id_ingrediente: 4,
    });

    expect(sinPollo.selecciones[101][1]).toBe('normal');
    expect(sinPollo.selecciones[102][4]).toBeUndefined();

    // Si el ingrediente no estaba elegido, no muta el estado
    const sinCambio = constructorReducer(sinPollo, {
      type: 'QUITAR_NO_DISPONIBLE',
      id_ingrediente: 9999,
    });
    expect(sinCambio).toBe(sinPollo);
  });
});

