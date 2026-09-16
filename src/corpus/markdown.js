import { hasValue } from '../milestone/index.js';

/**
 * markdownService.js
 *
 * Convierte las filas del CSV combinado a Markdown. Dos consumidores:
 *   - update-vector-store.js: un archivo por fuente (mejor chunking)
 *   - export-corpus.js: un único archivo (data/milestones.md de la app)
 *
 * Ambos comparten el mismo formato: `## <title>` seguido de líneas
 * `- **campo**: valor`, que es lo que parsea `parseMarkdown()` en
 * scripts/build-graph.mjs del proyecto intercorp-adn.
 */

/**
 * Convierte un hito en una sección Markdown autocontenida.
 *
 * El `replace(/\s+/g, ' ')` no es cosmético: el parser del otro repo lee los
 * campos con una regex por línea, así que un salto de línea dentro de un valor
 * rompería el registro. La garantía vive acá, en el escritor.
 *
 * @param {Object} milestone - Hito
 * @param {number} index - Posición, usada solo si falta el título
 * @returns {string}
 */
export function rowToSection(milestone, index) {
  const title = hasValue(milestone.title) ? milestone.title : `Ítem ${index + 1}`;
  const fields = Object.entries(milestone)
    .filter(([field, value]) => field !== 'title' && hasValue(value))
    .map(([field, value]) => `- **${field}**: ${String(value).replace(/\s+/g, ' ').trim()}`);

  return `## ${title}\n${fields.join('\n')}`;
}

/**
 * Agrupa las filas por documento de origen conservando el orden de aparición
 * @param {Array<Object>} rows
 * @returns {Map<string, Array<Object>>}
 */
export function groupBySource(rows) {
  const bySource = new Map();
  for (const row of rows) {
    const source = row.source_file || 'sin-fuente';
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(row);
  }
  return bySource;
}

/**
 * Markdown de una sola fuente, con encabezado propio
 * @param {string} source - Nombre del documento de origen
 * @param {Array<Object>} rows - Filas de esa fuente
 * @returns {string}
 */
export function buildSourceMarkdown(source, rows) {
  return `# ${source}\n\nFuente: ${source}\n\n${rows.map(rowToSection).join('\n\n')}\n`;
}

/**
 * Markdown único con todo el corpus, en el orden del CSV
 * @param {Array<Object>} rows - Todas las filas
 * @returns {string}
 */
export function buildCorpusMarkdown(rows) {
  return `# Base de conocimiento Intercorp ADN\n\n${rows.map(rowToSection).join('\n\n')}\n`;
}

export default { rowToSection, groupBySource, buildSourceMarkdown, buildCorpusMarkdown };
