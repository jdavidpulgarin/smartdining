import { describe, expect, it } from 'vitest';
import {
  VIDEOS_SITIO,
  POSTER_RESPALDO,
  debeCargarVideo,
  elegirPosterPortada,
  elegirPosterArmaTuPlato,
  describirReglaPaso,
} from './sitioPublico';

describe('sitioPublico utils', () => {
  it('define las rutas de video en VIDEOS_SITIO apuntando a /videos/', () => {
    expect(VIDEOS_SITIO).toEqual({
      portada: '/videos/portada.mp4',
      armaTuPlato: '/videos/arma-tu-plato.mp4',
    });
  });

  it('debeCargarVideo desactiva el video con prefersReducedMotion o saveData', () => {
    expect(debeCargarVideo()).toBe(true);
    expect(
      debeCargarVideo({ prefersReducedMotion: false, saveData: false })
    ).toBe(true);
    expect(
      debeCargarVideo({ prefersReducedMotion: true, saveData: false })
    ).toBe(false);
    expect(
      debeCargarVideo({ prefersReducedMotion: false, saveData: true })
    ).toBe(false);
    expect(
      debeCargarVideo({ prefersReducedMotion: true, saveData: true })
    ).toBe(false);
  });

  it('elegirPosterPortada y elegirPosterArmaTuPlato usan imagenes existentes del menu o respaldo local', () => {
    const platos = [
      { id: 1, imagen: null },
      { id: 2, imagen: 'https://img.com/plato.jpg' },
    ];
    const armables = [{ id_plato: 10, url_imagen: 'https://img.com/bowl.jpg' }];

    expect(elegirPosterPortada(platos, armables)).toBe(
      'https://img.com/plato.jpg'
    );
    expect(elegirPosterArmaTuPlato(armables, platos)).toBe(
      'https://img.com/bowl.jpg'
    );
    expect(elegirPosterPortada([], [])).toBe(POSTER_RESPALDO);
    expect(elegirPosterArmaTuPlato([], [])).toBe(POSTER_RESPALDO);
  });

  it('describirReglaPaso formatea si el paso es obligatorio u opcional y su limite', () => {
    expect(
      describirReglaPaso({ obligatorio: true, min_sel: 1, max_sel: 1 })
    ).toBe('Obligatorio · Elige 1');
    expect(
      describirReglaPaso({ obligatorio: false, min_sel: 0, max_sel: 3 })
    ).toBe('Opcional · Hasta 3');
  });
});
