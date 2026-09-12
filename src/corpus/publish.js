/**
 * publish.js
 *
 * Caso de uso: publicar el corpus, de punta a punta.
 *
 * Este archivo existe porque su ausencia costó dos semanas de datos viejos.
 * "Publicar el corpus" eran tres comandos que había que recordar correr en
 * orden, y nada verificaba el resultado: el índice que servía la app quedó en
 * 609 hitos del 31 de agosto mientras el CSV ya tenía 620, sin una sola
 * excepción ni línea de log que lo delatara.
 *
 * Consolidar y publicar ahora son un solo paso, y al final se compara lo
 * publicado contra el índice que la app tiene commiteado. La verificación no
 * puede regenerar ese índice —vive en el otro repositorio y requiere su propio
 * comando— pero sí puede decir en voz alta que quedó atrás.
 */

import fs from 'fs';
import path from 'path';
import { consolidate } from './consolidate.js';
import { publishToApp, APP_CORPUS } from './publishToApp.js';
import { key as milestoneKey } from '../milestone/index.js';
import * as csv from '../platform/csv.js';

/** Índice de búsqueda de la app, relativo a este proyecto. */
const APP_INDEX = '../intercorp-adn/lib/search-index.generated.json';

/**
 * Compara el corpus recién publicado contra el índice que sirve la app.
 *
 * Compara identidades de hito, no cantidades: dos corpus pueden tener 620
 * filas y no ser el mismo corpus. Un conteo habría dado "al día" ante un hito
 * renombrado o reemplazado por otro, que es justo el cambio que la app
 * serviría mal sin avisar. El orden sí se ignora a propósito — dentro del
 * índice cada vector está apareado con su registro por posición, así que
 * reordenar el corpus no lo invalida.
 *
 * @param {Array<Object>} published - Hitos publicados
 * @returns {{state, indexed?, published, missing?, extra?, path}}
 */
export async function verifyAppIndex(published) {
  const total = published.length;

  if (!fs.existsSync(APP_INDEX)) {
    return { state: 'missing', published: total, path: APP_INDEX };
  }

  let records;
  try {
    records = JSON.parse(fs.readFileSync(APP_INDEX, 'utf-8')).records;
  } catch {
    return { state: 'unreadable', published: total, path: APP_INDEX };
  }
  if (!Array.isArray(records)) {
    return { state: 'unreadable', published: total, path: APP_INDEX };
  }

  const enIndice = new Set(records.map(milestoneKey));
  const enCorpus = new Set(published.map(milestoneKey));

  // Publicados que el índice no tiene: la app no puede responder sobre ellos
  const missing = [...enCorpus].filter((k) => !enIndice.has(k));
  // Indexados que ya no están en el corpus: la app responde con hitos retirados
  const extra = [...enIndice].filter((k) => !enCorpus.has(k));

  return {
    state: missing.length === 0 && extra.length === 0 ? 'current' : 'stale',
    indexed: records.length,
    published: total,
    missing,
    extra,
    path: APP_INDEX,
  };
}

/**
 * Consolida los CSVs, publica el corpus de la app y verifica el índice.
 *
 * @param {Object} params
 * @param {string} params.outputDir
 * @param {string} params.mergedName
 * @param {string} [params.corpusPath] - Destino del Markdown
 * @param {Function} [params.onStep] - Notificación por etapa
 * @returns {Promise<{consolidated, published, index}>}
 */
export async function publish({
  outputDir,
  mergedName,
  corpusPath = APP_CORPUS,
  onStep = () => {},
}) {
  onStep({ step: 'consolidate', state: 'start' });
  const consolidated = await consolidate({ outputDir, mergedName });
  onStep({ step: 'consolidate', state: 'done', result: consolidated });

  onStep({ step: 'publish', state: 'start', outPath: corpusPath });
  const published = await publishToApp({
    mergedPath: consolidated.path,
    outPath: corpusPath,
  });
  onStep({ step: 'publish', state: 'done', result: published });

  const index = await verifyAppIndex(await csv.read(consolidated.path));
  onStep({ step: 'verify', state: 'done', result: index });

  return { consolidated, published, index };
}

/** Comando que hay que correr en la app para poner el índice al día. */
export const REBUILD_COMMAND = `cd ${path.dirname(path.dirname(APP_INDEX))} && node scripts/build-graph.mjs`;

export default { publish, verifyAppIndex, APP_INDEX, REBUILD_COMMAND };
