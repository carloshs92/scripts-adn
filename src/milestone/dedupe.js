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

/**
 * Palabras significativas de un título, para detectar casi-duplicados.
 * @param {string} title
 * @returns {Set<string>}
 */
function significativas(title) {
  return new Set(titleKey(title).split(' ').filter((w) => w.length > 4));
}

/**
 * Si todas las palabras significativas de un título están en el otro.
 * "Museo Sipán" ⊂ "Museo de Sipán Renovado": el mismo hito con otro nombre.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function unoContieneAlOtro(a, b) {
  const [x, y] = [significativas(a), significativas(b)];
  const chico = x.size < y.size ? x : y;
  const grande = x.size < y.size ? y : x;
  return chico.size > 0 && [...chico].every((w) => grande.has(w));
}

/**
 * Fusiona una extracción nueva con lo que ya se tenía de la misma fuente.
 *
 * La extracción no es determinista: el mismo documento devolvió 22, 13 y 10
 * hitos en corridas distintas, y una vez un JSON inválido. Reemplazar el CSV
 * en cada corrida perdía lo que esa corrida no vio, así que se acumula.
 *
 * Los nuevos van primero porque traen las reglas de prompt vigentes: ante
 * títulos equivalentes `dedupe` conserva el de mayor score. Después se
 * descartan los casi-duplicados, que `dedupe` no ve por comparar el título
 * completo.
 *
 * @param {Array<Object>} nuevos - Hitos de la corrida actual
 * @param {Array<Object>} previos - Hitos que ya estaban en el CSV
 * @returns {Array<Object>}
 */
export function mergeRuns(nuevos, previos) {
  // Ante un título repetido gana el de la corrida nueva, no el de mayor score:
  // el nuevo se extrajo con las reglas de prompt vigentes, y esas reglas
  // existen justamente porque la versión anterior tenía algo mal. Dejarlo a
  // `dedupe` lo decidía por score, que no dice nada sobre la calidad del texto.
  const clavesNuevas = new Set(nuevos.map((h) => titleKey(h.title)));
  const soloPrevios = previos.filter((h) => !clavesNuevas.has(titleKey(h.title)));

  const { milestones } = dedupe([...nuevos, ...soloPrevios]);
  const conservados = [];
  for (const hito of milestones) {
    if (conservados.some((c) => unoContieneAlOtro(c.title, hito.title))) continue;
    conservados.push(hito);
  }
  return conservados;
}

export default { dedupe, mergeRuns };
