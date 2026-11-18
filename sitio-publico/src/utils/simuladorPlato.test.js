import { describe, it, expect } from 'vitest';
import {
  inicializarSeleccion,
  alternarOpcion,
  calcularTotalSimulador,
  calcularCaloriasSimulador,
  reglaTextoPaso,
} from './simuladorPlato.js';

describe('Lógica pura de simuladorPlato', () => {
  const pasosEjemplo = [
    {
      nombre: 'Tipo de Arepa',
      obligatorio: true,
      min_sel: 1,
      max_sel: 1,
      ingredientes: [
        { nombre: 'Maíz', precio_extra: 0, calorias: 180, disponible: false },
        { nombre: 'Chócolo', precio_extra: 1500, calorias: 220, disponible: true },
      ],
    },
    {
      nombre: 'Relleno',
      obligatorio: true,
      min_sel: 1,
      max_sel: 1,
      ingredientes: [
        { nombre: 'Pollo', precio_extra: 0, calorias: 200, disponible: true },
        { nombre: 'Carne', precio_extra: 2500, calorias: 260, disponible: true },
      ],
    },
    {
      nombre: 'Extras',
      obligatorio: false,
      min_sel: 0,
      max_sel: 2,
      ingredientes: [
        { nombre: 'Aguacate', precio_extra: 1500, calorias: 120, disponible: true },
        { nombre: 'Queso', precio_extra: 1000, calorias: 110, disponible: true },
        { nombre: 'Tocineta', precio_extra: 2000, calorias: null, disponible: true },
      ],
    },
  ];

  it('selección inicial: los obligatorios arrancan con la primera opción disponible y los opcionales vacíos', () => {
    const sel = inicializarSeleccion(pasosEjemplo);
    // En el paso 0, 'Maíz' está agotado, así que toma 'Chócolo' (índice 1)
    expect(sel[0]).toEqual([1]);
    // En el paso 1, 'Pollo' está disponible (índice 0)
    expect(sel[1]).toEqual([0]);
    // En el paso 2, es opcional -> []
    expect(sel[2]).toEqual([]);
  });

  it('reemplazo en max 1: al elegir otra opción en paso max=1 reemplaza la anterior', () => {
    const selInicial = [[1], [0], []];
    const { nuevaSel } = alternarOpcion({
      pasos: pasosEjemplo,
      sel: selInicial,
      pasoIndex: 1,
      opcionIndex: 1, // Carne
    });
    expect(nuevaSel[1]).toEqual([1]);
  });

  it('no quitar el último de un obligatorio', () => {
    const selInicial = [[1], [0], []];
    const { nuevaSel } = alternarOpcion({
      pasos: pasosEjemplo,
      sel: selInicial,
      pasoIndex: 1,
      opcionIndex: 0, // intenta desmarcar Pollo
    });
    // Debe permanecer intacto
    expect(nuevaSel[1]).toEqual([0]);
  });

  it('opciones agotadas no son seleccionables', () => {
    const selInicial = [[1], [0], []];
    const { nuevaSel } = alternarOpcion({
      pasos: pasosEjemplo,
      sel: selInicial,
      pasoIndex: 0,
      opcionIndex: 0, // Maíz está agotado (disponible: false)
    });
    expect(nuevaSel[0]).toEqual([1]);
  });

  it('tope en max N: en paso con max=2, al seleccionar un tercero devuelve mensaje de tope y no añade', () => {
    const selConDos = [[1], [0], [0, 1]];
    const { nuevaSel, mensajeTope } = alternarOpcion({
      pasos: pasosEjemplo,
      sel: selConDos,
      pasoIndex: 2,
      opcionIndex: 2, // intenta añadir Tocineta
    });
    expect(mensajeTope).toContain('Máximo 2: quita uno para cambiar.');
    expect(nuevaSel[2]).toEqual([0, 1]);
  });

  it('deselección en paso opcional: permite quitar una opción', () => {
    const selConUno = [[1], [0], [0]];
    const { nuevaSel } = alternarOpcion({
      pasos: pasosEjemplo,
      sel: selConUno,
      pasoIndex: 2,
      opcionIndex: 0,
    });
    expect(nuevaSel[2]).toEqual([]);
  });

  it('total con extras suma el precio base y los adicionales seleccionados', () => {
    const sel = [[1], [1], [0]]; // Chócolo (+1500) + Carne (+2500) + Aguacate (+1500) = +5500
    const total = calcularTotalSimulador({
      precioBase: 15000,
      pasos: pasosEjemplo,
      sel,
    });
    expect(total).toBe(20500);
  });

  it('kcal solo si todas las opciones elegidas tienen calorías declaradas', () => {
    // Caso 1: Chócolo (220) + Carne (260) + Aguacate (120) = 600
    const selConCalorias = [[1], [1], [0]];
    const kcal1 = calcularCaloriasSimulador({
      pasos: pasosEjemplo,
      sel: selConCalorias,
    });
    expect(kcal1).toBe(600);

    // Caso 2: Tocineta tiene calorias: null
    const selConNulo = [[1], [1], [2]];
    const kcal2 = calcularCaloriasSimulador({
      pasos: pasosEjemplo,
      sel: selConNulo,
    });
    expect(kcal2).toBeNull();
  });

  it('reglaTextoPaso formatea las etiquetas de regla', () => {
    expect(reglaTextoPaso(pasosEjemplo[0])).toBe('Obligatorio, elige 1');
    expect(reglaTextoPaso({ obligatorio: true, min_sel: 1, max_sel: 3 })).toBe(
      'Obligatorio, elige hasta 3'
    );
    expect(reglaTextoPaso(pasosEjemplo[2])).toBe('Opcional, hasta 2');
  });
});
