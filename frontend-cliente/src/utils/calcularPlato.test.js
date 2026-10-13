import { describe, expect, it } from 'vitest';
import menuEjemplo from '../mocks/ejemplo-menu.json';
import {
  calcularPlato,
  pasosPendientes,
  validarPaso,
} from './calcularPlato';

const platosArmables = menuEjemplo.flatMap((cat) => cat.platos || []);
const bowl = platosArmables.find((p) => p.id_plato === 1001);

describe('calcularPlato y validaciones del constructor', () => {
  it('1. Sin extras el precio es el precio base del plato', () => {
    const selecciones = {
      101: { 1: 'normal' }, // Arroz Integral (precio_extra: 0)
      102: { 4: 'normal' }, // Pollo a la Plancha (precio_extra: 0)
    };

    const resultado = calcularPlato(bowl, selecciones);
    expect(resultado.precio).toBe(bowl.precio);
  });

  it('2. Un ingrediente en "extra" suma su precio_extra; en "ligera" o "normal" no suma', () => {
    // Quinoa (id 2, precio_extra: 2000), Carne Desmechada (id 5, precio_extra: 2500)
    const enNormalYLigera = calcularPlato(bowl, {
      101: { 2: 'normal' },
      102: { 5: 'ligera' },
    });
    expect(enNormalYLigera.precio).toBe(bowl.precio);

    const enExtra = calcularPlato(bowl, {
      101: { 2: 'extra' },
      102: { 5: 'normal' },
    });
    expect(enExtra.precio).toBe(bowl.precio + 2000);
  });

  it('3. Calcula calorias aplicando los factores 0.5 (ligera), 1 (normal) y 1.5 (extra) con redondeo', () => {
    // Arroz Integral (180 kcal) en ligera -> 90
    // Pollo a la Plancha (220 kcal) en normal -> 220
    // Tomate Picado (25 kcal) en extra -> 37.5
    // Total = 347.5 -> Math.round = 348
    const resultado = calcularPlato(bowl, {
      101: { 1: 'ligera' },
      102: { 4: 'normal' },
      103: { 9: 'extra' },
    });

    expect(resultado.calorias).toBe(Math.round(180 * 0.5 + 220 * 1 + 25 * 1.5));
    expect(resultado.calorias).toBe(348);
  });

  it('4. Devuelve la lista de alergenos sin repetidos de los ingredientes elegidos', () => {
    const bowlConAlergenos = {
      ...bowl,
      pasos: bowl.pasos.map((paso) => ({
        ...paso,
        ingredientes: paso.ingredientes.map((ing) => {
          if (ing.id_ingrediente === 1) {
            return { ...ing, alergenos: ['gluten', 'soya'] };
          }
          if (ing.id_ingrediente === 4) {
            return { ...ing, alergenos: ['soya', 'lacteos'] };
          }
          return ing;
        }),
      })),
    };

    const resultado = calcularPlato(bowlConAlergenos, {
      101: { 1: 'normal' },
      102: { 4: 'extra' },
    });

    expect(resultado.alergenos).toEqual(['gluten', 'soya', 'lacteos']);
  });

  it('5. El arreglo "ingredientes" solo trae { id_ingrediente, porcion } sin ningun campo de precio', () => {
    const resultado = calcularPlato(bowl, {
      101: { 2: 'extra' },
      102: { 5: 'ligera' },
    });

    expect(resultado.ingredientes).toEqual([
      { id_ingrediente: 2, porcion: 'extra' },
      { id_ingrediente: 5, porcion: 'ligera' },
    ]);
    for (const item of resultado.ingredientes) {
      expect(Object.keys(item).sort()).toEqual(['id_ingrediente', 'porcion']);
      expect(item).not.toHaveProperty('precio');
      expect(item).not.toHaveProperty('precio_extra');
    }
  });

  it('6. validarPaso evalua minimo incumplido, maximo excedido y paso opcional vacio valido', () => {
    const pasoObligatorio = bowl.pasos.find((p) => p.id_paso === 101); // min_sel 1, max_sel 1
    const pasoOpcional = bowl.pasos.find((p) => p.id_paso === 103); // min_sel 0, max_sel 3

    const sinElegirObligatorio = validarPaso(pasoObligatorio, {});
    expect(sinElegirObligatorio.valido).toBe(false);
    expect(sinElegirObligatorio.faltan).toBe(1);
    expect(sinElegirObligatorio.excede).toBe(false);

    const excedido = validarPaso(pasoOpcional, {
      8: 'normal',
      9: 'normal',
      10: 'normal',
      11: 'normal',
    });
    expect(excedido.valido).toBe(false);
    expect(excedido.excede).toBe(true);

    const opcionalVacio = validarPaso(pasoOpcional, {});
    expect(opcionalVacio.valido).toBe(true);
    expect(opcionalVacio.faltan).toBe(0);
    expect(opcionalVacio.excede).toBe(false);
  });

  it('7. pasosPendientes devuelve los nombres de los pasos con min_sel sin cumplir', () => {
    const todosPendientes = pasosPendientes(bowl, {});
    expect(todosPendientes).toEqual(['Elige tu Base', 'Elige tu Proteína']);

    const soloFaltaProteina = pasosPendientes(bowl, {
      101: { 1: 'normal' },
    });
    expect(soloFaltaProteina).toEqual(['Elige tu Proteína']);

    const completo = pasosPendientes(bowl, {
      101: { 1: 'normal' },
      102: { 4: 'normal' },
    });
    expect(completo).toEqual([]);
  });
});
