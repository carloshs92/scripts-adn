import { describe, it, expect } from 'vitest';
import { buildCorpusMarkdown, buildSourceMarkdown, groupBySource } from '../src/corpus/markdown.js';
import { coerce, FIELDS, key } from '../src/milestone/index.js';

/**
 * El contrato entre los dos repositorios.
 *
 * No hay API ni base compartida: el acoplamiento es un Markdown que este
 * proyecto escribe y build-graph.mjs del proyecto vecino parsea. Si la
 * gramática cambia de un lado, el otro no falla — descarta los registros en
 * silencio. Esta es la única prueba que cubre esa frontera.
 */

/** Copia literal de parseMarkdown() en intercorp-adn/scripts/build-graph.mjs. */
function parseMarkdown(text) {
  return text
    .split(/\n## /)
    .slice(1)
    .map((block) => {
      const [heading, ...lines] = block.split('\n');
      const record = { title: heading.trim() };
      for (const line of lines) {
        const match = /^- \*\*(\w+)\*\*:\s*(.*)$/.exec(line);
        if (match) record[match[1]] = match[2].trim();
      }
      return record;
    })
    .filter((r) => r.title && r.category);
}

const hito = (over = {}) =>
  coerce({
    title: 'Puente Chilina',
    shortDescription: 'Obra pública en Arequipa bajo Obras por Impuestos.',
    category: 'innovation',
    largeDescription: 'Contexto completo de la obra.',
    company: 'Urbi Proyectos S.A.C.',
    year: '2024',
    score: 90,
    ...over,
  }, '260616 PPT URBI OxI.pdf');

describe('ida y vuelta por la gramática del corpus', () => {
  it('lo que se escribe se vuelve a leer sin perder hitos', () => {
    const hitos = [hito(), hito({ title: 'Puente Punta Negra' })];
    expect(parseMarkdown(buildCorpusMarkdown(hitos))).toHaveLength(2);
  });

  it('conserva el valor de cada campo', () => {
    const [leido] = parseMarkdown(buildCorpusMarkdown([hito()]));
    const original = hito();
    FIELDS.forEach((campo) => {
      expect(String(leido[campo]), `se perdió ${campo}`).toBe(String(original[campo]));
    });
  });

  it('conserva la identidad del hito a ambos lados', () => {
    const original = hito();
    const [leido] = parseMarkdown(buildCorpusMarkdown([original]));
    expect(key(leido)).toBe(key(original));
  });

  it('sobrevive a un doble espacio en el nombre del documento', () => {
    // Regresión real: "[Intercorp] Estudio estratégico 2025  (1).pdf" tenía una
    // identidad a cada lado de la frontera, y sus 22 hitos parecían faltar.
    const original = coerce({ title: 'X', category: 'talent' }, 'a  b  (1).pdf');
    const [leido] = parseMarkdown(buildCorpusMarkdown([original]));
    expect(key(leido)).toBe(key(original));
  });

  it('no pierde hitos cuyo texto traía saltos de línea', () => {
    // La regex del lector es por línea: la garantía vive en coerce()
    const original = hito({ largeDescription: 'una\nlínea\npartida' });
    const leidos = parseMarkdown(buildCorpusMarkdown([original]));
    expect(leidos).toHaveLength(1);
    expect(leidos[0].largeDescription).toBe('una línea partida');
  });

  it('el serializador defiende la gramática aunque el hito no pase por coerce', () => {
    // consolidate() lee las filas del CSV tal cual: un CSV editado a mano con
    // un salto de línea dentro de un valor llega crudo al serializador, así
    // que la defensa tiene que vivir también ahí y no solo en coerce().
    const crudo = {
      title: 'Con salto',
      shortDescription: 'antes\ndespués',
      category: 'talent',
      largeDescription: 'otra\nlínea',
      company: 'Intercorp',
      score: 80,
      source_file: 'a.pdf',
    };
    const leidos = parseMarkdown(buildCorpusMarkdown([crudo]));
    expect(leidos).toHaveLength(1);
    expect(leidos[0].shortDescription).toBe('antes después');
    expect(leidos[0].largeDescription).toBe('otra línea');
  });

  it('omite los campos N/A en vez de escribirlos', () => {
    const md = buildCorpusMarkdown([hito({ year: undefined })]);
    expect(md).not.toContain('**year**');
    expect(parseMarkdown(md)).toHaveLength(1);
  });

  it('un hito sin categoría lo descarta el lector: nunca debe generarse', () => {
    // coerce siempre emite una categoría válida, así que esto no puede pasar
    // por el pipeline; la prueba documenta qué ocurriría si alguien lo saltara.
    const crudo = { title: 'Sin categoría', shortDescription: 'x' };
    expect(parseMarkdown(buildCorpusMarkdown([crudo]))).toHaveLength(0);
    expect(parseMarkdown(buildCorpusMarkdown([coerce(crudo, 'f.pdf')]))).toHaveLength(1);
  });

  it('las claves de campo son \\w+, sin guiones ni acentos', () => {
    // El lector captura con \w+: una columna "fecha-inicio" se escribiría y
    // desaparecería al parsear, sin error
    FIELDS.forEach((campo) => expect(campo).toMatch(/^\w+$/));
  });
});

describe('markdown por fuente', () => {
  it('encabeza con la fuente y es parseable igual', () => {
    const md = buildSourceMarkdown('sip.pe', [hito({ title: 'Qué es Sip' })]);
    expect(md.startsWith('# sip.pe')).toBe(true);
    expect(parseMarkdown(md)).toHaveLength(1);
  });

  it('groupBySource conserva todos los hitos', () => {
    const hitos = [hito(), hito({ title: 'Otro' }), coerce({ title: 'Z', category: 'talent' }, 'b.pdf')];
    const grupos = groupBySource(hitos);
    expect(grupos.size).toBe(2);
    expect([...grupos.values()].flat()).toHaveLength(3);
  });
});
