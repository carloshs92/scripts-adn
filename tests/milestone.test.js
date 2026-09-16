import { describe, it, expect } from 'vitest';
import {
  FIELDS, CATEGORIES, MISSING, PROMPT_SCHEMA,
  coerce, hasValue, key, titleKey, changedFields, dedupe,
} from '../src/milestone/index.js';

describe('schema', () => {
  it('declara las ocho columnas en orden', () => {
    expect([...FIELDS]).toEqual([
      'title', 'shortDescription', 'category', 'largeDescription',
      'company', 'year', 'score', 'source_file',
    ]);
  });

  it('FIELDS y CATEGORIES están congelados', () => {
    // COLUMNS los aliasea: sin congelar, un push desde otro módulo los corrompe
    expect(() => FIELDS.push('x')).toThrow();
    expect(() => CATEGORIES.push('x')).toThrow();
  });

  it('el esquema del prompt escapa las llaves para LangChain', () => {
    // PromptTemplate usa f-string: una llave simple se interpreta como variable
    expect(PROMPT_SCHEMA).toContain('{{');
    expect(PROMPT_SCHEMA).toContain('}}');
    expect(PROMPT_SCHEMA.match(/(?<!\{)\{(?!\{)/)).toBeNull();
  });

  it('el esquema del prompt nombra todas las columnas menos source_file', () => {
    // source_file lo impone quien conoce el origen, nunca el modelo
    FIELDS.filter((f) => f !== 'source_file').forEach((campo) => {
      expect(PROMPT_SCHEMA, `falta ${campo}`).toContain(`"${campo}"`);
    });
    expect(PROMPT_SCHEMA).not.toContain('"source_file"');
  });
});

describe('coerce', () => {
  it('siempre devuelve las ocho columnas', () => {
    expect(Object.keys(coerce({}, 'f.pdf')).sort()).toEqual([...FIELDS].sort());
  });

  it('cae a innovation ante una categoría inventada', () => {
    expect(coerce({ category: 'inventada' }, 'f.pdf').category).toBe('innovation');
    expect(coerce({ category: 'talent' }, 'f.pdf').category).toBe('talent');
  });

  it('cae a Intercorp cuando no hay subsidiaria', () => {
    expect(coerce({}, 'f.pdf').company).toBe('Intercorp');
  });

  it('marca N/A los campos vacíos y descarta un score no numérico', () => {
    const h = coerce({ score: '85' }, 'f.pdf');
    expect(h.score).toBe(MISSING);
    expect(h.year).toBe(MISSING);
    expect(coerce({ score: 85 }, 'f.pdf').score).toBe(85);
  });

  it('impone source_file y nunca lo toma del modelo', () => {
    expect(coerce({ source_file: 'mentira.pdf' }, 'real.pdf').source_file).toBe('real.pdf');
  });

  it('colapsa saltos de línea y espacios repetidos', () => {
    // El corpus en Markdown se lee campo por línea: un salto rompe el registro
    const h = coerce({ title: 'A\nB', shortDescription: '  x   y  ' }, 'f  g.pdf');
    expect(h.title).toBe('A B');
    expect(h.shortDescription).toBe('x y');
    expect(h.source_file).toBe('f g.pdf');
  });
});

describe('hasValue', () => {
  it('trata N/A y vacío como ausencia', () => {
    expect(hasValue('algo')).toBe(true);
    expect(hasValue(MISSING)).toBe(false);
    expect(hasValue('')).toBe(false);
    expect(hasValue(undefined)).toBe(false);
  });
});

describe('key — identidad entre versiones del corpus', () => {
  it('combina documento y título', () => {
    expect(key({ source_file: 'a.pdf', title: 'X' })).toBe('a.pdf::X');
  });

  it('es estable ante espacios repetidos', () => {
    // El serializador a Markdown los colapsa: sin esto el mismo hito tendría
    // identidades distintas a cada lado de la frontera de repos
    expect(key({ source_file: 'a  b.pdf', title: 'X' }))
      .toBe(key({ source_file: 'a b.pdf', title: 'X' }));
  });

  it('distingue el mismo título en documentos distintos', () => {
    expect(key({ source_file: 'a.pdf', title: 'X' }))
      .not.toBe(key({ source_file: 'b.pdf', title: 'X' }));
  });

  it('no colapsa hitos sin datos en una misma clave ambigua', () => {
    expect(key({})).toBe('N/A::N/A');
  });
});

describe('titleKey — identidad dentro de una extracción', () => {
  it('ignora mayúsculas, tildes y puntuación', () => {
    expect(titleKey('¿Qué es SIP?')).toBe(titleKey('que es sip'));
    expect(titleKey('Educación Financiera')).toBe(titleKey('educacion financiera'));
  });

  it('no confunde títulos distintos', () => {
    expect(titleKey('Puente Chilina')).not.toBe(titleKey('Puente Punta Negra'));
  });
});

describe('changedFields', () => {
  it('lista solo los campos distintos', () => {
    expect(changedFields({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual(['b']);
  });

  it('trata ausente y vacío como iguales', () => {
    expect(changedFields({ a: '1' }, { a: '1', b: '' })).toEqual([]);
  });
});

describe('dedupe', () => {
  const hito = (title, score, largeDescription = 'x') =>
    ({ title, score, largeDescription, source_file: 'f.pdf' });

  it('conserva el de mayor score', () => {
    const { milestones, duplicates } = dedupe([hito('Mismo', 70), hito('mismo!', 90)]);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].score).toBe(90);
    expect(duplicates).toBe(1);
  });

  it('ante empate gana la descripción más larga', () => {
    const { milestones } = dedupe([hito('A', 80, 'corta'), hito('a', 80, 'una descripción larga')]);
    expect(milestones[0].largeDescription).toBe('una descripción larga');
  });

  it('descarta hitos sin título', () => {
    expect(dedupe([hito('', 90), hito('Válido', 50)]).milestones).toHaveLength(1);
  });

  it('no toca títulos genuinamente distintos', () => {
    expect(dedupe([hito('A', 1), hito('B', 1)]).milestones).toHaveLength(2);
  });
});
