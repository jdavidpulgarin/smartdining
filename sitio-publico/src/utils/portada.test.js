import { describe, it, expect } from 'vitest';
import { elegirFuentePortada } from './portada.js';

describe('elegirFuentePortada', () => {
  it('reducedMotion devuelve null', () => {
    expect(elegirFuentePortada({ anchoPantalla: 1024, prefs: { reducedMotion: true } })).toBeNull();
    expect(elegirFuentePortada({ anchoPantalla: 1024, prefs: { prefersReducedMotion: true } })).toBeNull();
  });

  it('saveData devuelve null', () => {
    expect(elegirFuentePortada({ anchoPantalla: 1024, prefs: { saveData: true } })).toBeNull();
  });

  it('ancho 400 devuelve portada-480.mp4', () => {
    expect(elegirFuentePortada({ anchoPantalla: 400, prefs: {} })).toBe('/videos/portada-480.mp4');
  });

  it('ancho 1280 devuelve portada.mp4', () => {
    expect(elegirFuentePortada({ anchoPantalla: 1280, prefs: {} })).toBe('/videos/portada.mp4');
  });
});
