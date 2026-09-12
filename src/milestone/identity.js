/**
 * identity.js
 *
 * Cuándo dos hitos son "el mismo". Hay dos nociones distintas y conviene no
 * confundirlas, porque responden preguntas distintas:
 *
 *   key()       — identidad entre versiones del corpus. Un hito es el mismo si
 *                 viene del mismo documento y conserva el título. Renombrar un
 *                 título cuenta como baja más alta, no como modificación.
 *
 *   titleKey()  — identidad dentro de una misma extracción. El modelo repite la
 *                 misma iniciativa descrita en varias páginas del sitio, con el
 *                 título apenas distinto; normaliza agresivamente para atrapar
 *                 esas variantes.
 */

/**
 * Identidad de un hito entre versiones del corpus
 * @param {Object} milestone
 * @returns {string}
 */
export function key(milestone) {
  return `${milestone.source_file || 'N/A'}::${milestone.title || 'N/A'}`;
}

/**
 * Título normalizado para detectar duplicados: minúsculas, sin tildes, sin
 * puntuación y sin espacios repetidos.
 * @param {string} title
 * @returns {string}
 */
export function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Campos que cambiaron entre dos versiones del mismo hito
 * @param {Object} before
 * @param {Object} after
 * @returns {Array<string>}
 */
export function changedFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((field) => (before[field] || '') !== (after[field] || ''));
}

export default { key, titleKey, changedFields };
