/**
 * consolidate.js
 *
 * Caso de uso: combinar los CSVs por documento en un único corpus.
 *
 * `output/merged.csv` es la fuente de verdad de todo lo que viene después —
 * el corpus de la app, el histórico y la copia en Drive salen de acá.
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { createObjectCsvWriter } from 'csv-writer';
import * as csv from '../platform/csv.js';
import { FIELDS } from '../milestone/index.js';

/**
 * Combina todos los CSVs por documento en uno solo.
 *
 * @param {Object} params
 * @param {string} params.outputDir - Carpeta donde viven los CSVs
 * @param {string} params.mergedName - Nombre del CSV combinado
 * @param {Function} [params.onFile] - Notificación por archivo leído
 * @returns {Promise<{path, milestones, sources, skipped, failed}>}
 */
export async function consolidate({ outputDir, mergedName, onFile = () => {} }) {
  if (!fs.existsSync(outputDir)) {
    throw new Error(`La carpeta de output no existe: ${outputDir}`);
  }

  const all = await glob(`${outputDir}/*.csv`);
  const sources = all.filter((f) => path.basename(f) !== mergedName).sort();

  if (sources.length === 0) {
    throw new Error(`No se encontraron CSVs individuales en ${outputDir}`);
  }

  const milestones = [];
  const skipped = [];
  const failed = [];
  // Las columnas salen del primer CSV con datos y no de FIELDS, para no
  // descartar en silencio una columna que alguien haya agregado a mano.
  let columns = null;

  for (const csvPath of sources) {
    const fileName = path.basename(csvPath);
    try {
      const rows = await csv.read(csvPath);
      if (rows.length === 0) {
        skipped.push(fileName);
        onFile({ fileName, rows: 0, skipped: true });
        continue;
      }
      if (!columns) columns = Object.keys(rows[0]);
      milestones.push(...rows);
      onFile({ fileName, rows: rows.length });
    } catch (error) {
      failed.push({ fileName, message: error.message });
      onFile({ fileName, error: error.message });
    }
  }

  if (milestones.length === 0) {
    throw new Error('Ningún CSV aportó filas');
  }

  const mergedPath = path.join(outputDir, mergedName);
  await createObjectCsvWriter({
    path: mergedPath,
    header: (columns ?? FIELDS).map((col) => ({ id: col, title: col })),
    alwaysQuote: false,
  }).writeRecords(milestones);

  return {
    path: mergedPath,
    milestones: milestones.length,
    columns: columns ?? [...FIELDS],
    sources: sources.length,
    skipped,
    failed,
  };
}

export default { consolidate };
