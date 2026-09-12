/**
 * publishToApp.js
 *
 * Caso de uso: publicar el corpus como el Markdown que indexa la app.
 *
 * El destino es `data/milestones.md` del proyecto intercorp-adn, entrada de
 * `build-graph.mjs` y por lo tanto del índice de búsqueda. Ese archivo se
 * exportaba a mano desde el vector store y quedaba desactualizado en silencio:
 * la app respondía con datos viejos sin que nada fallara.
 */

import fs from 'fs';
import path from 'path';
import * as csv from '../platform/csv.js';
import { buildCorpusMarkdown, groupBySource } from './markdown.js';
import { recordVersion } from './version.js';

/** Ruta del corpus en el proyecto de la app, que vive al mismo nivel. */
export const APP_CORPUS = '../intercorp-adn/data/milestones.md';

/**
 * Escribe el corpus en Markdown y registra la versión.
 *
 * @param {Object} params
 * @param {string} params.mergedPath - CSV combinado de entrada
 * @param {string} params.outPath - Dónde escribir el Markdown
 * @returns {Promise<{outPath, milestones, sources, bytes, previousBytes, entry}>}
 */
export async function publishToApp({ mergedPath, outPath }) {
  if (!fs.existsSync(mergedPath)) {
    throw new Error(`No se encontró: ${mergedPath}`);
  }

  const milestones = await csv.read(mergedPath);
  if (milestones.length === 0) {
    throw new Error(`${mergedPath} no contiene filas`);
  }

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    throw new Error(`No existe el directorio destino: ${outDir}`);
  }

  const markdown = buildCorpusMarkdown(milestones);
  const previousBytes = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  fs.writeFileSync(outPath, markdown, 'utf-8');

  const bytes = Buffer.byteLength(markdown);
  const entry = await recordVersion({ csvPath: mergedPath, target: outPath, bytes });

  return {
    outPath,
    milestones: milestones.length,
    sources: groupBySource(milestones).size,
    bytes,
    previousBytes,
    entry,
  };
}

export default { publishToApp, APP_CORPUS };
