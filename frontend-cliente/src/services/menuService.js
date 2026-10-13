import { categorias } from '../mocks/categorias';
import { platos } from '../mocks/platos';
import menuEjemplo from '../mocks/ejemplo-menu.json';

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

export const obtenerPlatosArmables = () => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const armables = (menuEjemplo || [])
        .flatMap((cat) => cat.platos || [])
        .filter((plato) => plato.personalizable === true);
      resolve(armables);
    }, 300);
  });
};

export const obtenerPlatoArmable = (idPlato) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const idNumerico = Number(idPlato);
      const encontrado = (menuEjemplo || [])
        .flatMap((cat) => cat.platos || [])
        .find(
          (plato) =>
            Number(plato.id_plato) === idNumerico &&
            plato.personalizable === true
        );

      if (!encontrado) {
        resolve(null);
        return;
      }

      const pasosOrdenados = [...(encontrado.pasos || [])].sort(
        (a, b) => (a.orden ?? 0) - (b.orden ?? 0)
      );

      resolve({
        ...encontrado,
        pasos: pasosOrdenados,
      });
    }, 300);
  });
};

export default {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  obtenerPlatoArmable,
};
