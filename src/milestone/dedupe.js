/**
 * dedupe.js
 *
 * El modelo repite hitos: la misma iniciativa aparece en la home, en el blog y
 * en "quiénes somos", y vuelve como tres ítems con títulos apenas distintos.
 * La regla del prompt que pide títulos únicos no se cumple sola, así que hay
 * esta pasada determinista después.
 */

import { titleKey } from './identity.js';

/**
 * Descarta hitos con el mismo título normalizado.
 *
 * Ante colisión gana el de mayor `score`; con empate, el de `largeDescription`
 * más larga, por ser el que más contexto aporta al corpus.
 *
 * @param {Array<Object>} milestones
 * @returns {{milestones: Array<Object>, duplicates: number}}
 */
export function dedupe(milestones) {
  const byTitle = new Map();
  let duplicates = 0;

  for (const milestone of milestones) {
    const id = titleKey(milestone.title);
    if (id === '') continue;

    const existing = byTitle.get(id);
    if (!existing) {
      byTitle.set(id, milestone);
      continue;
    }

    duplicates++;
    if (wins(milestone, existing)) byTitle.set(id, milestone);
  }

  return { milestones: [...byTitle.values()], duplicates };
}

/**
 * Si el candidato debe reemplazar al ya guardado
 * @param {Object} candidate
 * @param {Object} current
 * @returns {boolean}
 */
function wins(candidate, current) {
  const a = typeof candidate.score === 'number' ? candidate.score : 0;
  const b = typeof current.score === 'number' ? current.score : 0;

  if (a !== b) return a > b;
  return String(candidate.largeDescription).length > String(current.largeDescription).length;
}

export default { dedupe };
