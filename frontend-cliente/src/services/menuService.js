import { categorias } from '../mocks/categorias';
import { platos } from '../mocks/platos';

export const obtenerCategorias = () => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(categorias);
    }, 300);
  });
};

export const obtenerPlatos = () => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(platos);
    }, 300);
  });
};

export default {
  obtenerCategorias,
  obtenerPlatos,
};
