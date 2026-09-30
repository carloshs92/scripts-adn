import { describe, it, expect } from 'vitest';
import { SOURCES, etiqueta, slug } from '../scripts/scrape-web.js';

/**
 * La procedencia de un hito web y el nombre de su CSV salen de la planilla del
 * cliente. Dos reglas silenciosas si se rompen: una etiqueta mal compuesta
 * cambia la identidad de todos los hitos de esa empresa (`key()` es
 * `source_file::title`), y dos empresas con el mismo slug comparten archivo y
 * una pisa a la otra sin error.
 */
describe('etiqueta()', () => {
  it('compone plataforma / empresa / usuario', () => {
    expect(
      etiqueta({ plataforma: 'Servicios Corporativos', empresa: 'Intercorp', usuario: 'AACC' })
    ).toBe('Servicios Corporativos / Intercorp / AACC');
  });

  it('omite el usuario cuando la fila no lo declara', () => {
    expect(etiqueta({ plataforma: 'Retail', empresa: 'Promart' })).toBe('Retail / Promart');
  });

  it('descarta la "x" con que la planilla marca "sin usuario propio"', () => {
    expect(etiqueta({ plataforma: 'IFS', empresa: 'Interbank', usuario: 'x' })).toBe(
      'IFS / Interbank'
    );
    expect(etiqueta({ plataforma: 'IFS', empresa: 'Interbank', usuario: 'X' })).toBe(
      'IFS / Interbank'
    );
  });
});

describe('slug()', () => {
  it('quita tildes, que si no producen nombres de archivo distintos por acento', () => {
    expect(slug('Educación / UTP')).toBe('educacion-utp');
  });

  it('colapsa separadores y no deja guiones colgando en los bordes', () => {
    expect(slug('Entretenimiento y hospitalidad / NGR / Papa Johns')).toBe(
      'entretenimiento-y-hospitalidad-ngr-papa-johns'
    );
  });
});

describe('SOURCES', () => {
  it('no tiene dos fuentes que escriban el mismo CSV', () => {
    const archivos = SOURCES.map((entrada) => slug(etiqueta(entrada)));
    const repetidos = archivos.filter((a, i) => archivos.indexOf(a) !== i);
    expect(repetidos).toEqual([]);
    expect(new Set(archivos).size).toBe(SOURCES.length);
  });

  it('separa las marcas que comparten dominio', () => {
    // realplaza.com sirve a Real Plaza y a Don Belisario: agrupando por dominio
    // —como se hacía antes— los hitos de una marca caían bajo la otra.
    const enRealPlaza = SOURCES.filter((e) =>
      e.urls.some((u) => u.includes('realplaza.com'))
    ).map(etiqueta);
    expect(enRealPlaza).toEqual([
      'Retail / Real Plaza',
      'Entretenimiento y hospitalidad / NGR / Don Belisario',
    ]);
  });

  it('cada fuente declara al menos una URL', () => {
    for (const entrada of SOURCES) {
      expect(entrada.urls.length, etiqueta(entrada)).toBeGreaterThan(0);
    }
  });
});
