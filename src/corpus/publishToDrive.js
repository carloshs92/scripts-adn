/**
 * publishToDrive.js
 *
 * Caso de uso: subir los CSVs del corpus a Google Drive como hojas de cálculo.
 * Es la vía de consulta humana, no la que alimenta la app.
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { uploadCSV } from '../platform/drive.js';

/**
 * Sube todos los CSVs de la carpeta de output a una carpeta de Drive.
 *
 * @param {Object} params
 * @param {string} params.outputDir - Carpeta con los CSVs
 * @param {string} params.folderId - ID de la carpeta destino en Drive
 * @param {Function} [params.onFile] - Notificación por archivo subido
 * @returns {Promise<{uploaded: Array, failed: Array}>}
 */
export async function publishToDrive({ outputDir, folderId, onFile = () => {} }) {
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID no está definida en el archivo .env');
  }
  if (!fs.existsSync(outputDir)) {
    throw new Error(`La carpeta de output no existe: ${outputDir}`);
  }

  const csvFiles = (await glob(`${outputDir}/*.csv`)).sort();
  if (csvFiles.length === 0) {
    throw new Error(`No se encontraron CSVs en ${outputDir}`);
  }

  const uploaded = [];
  const failed = [];

  for (const csvPath of csvFiles) {
    const fileName = path.basename(csvPath);
    try {
      const result = await uploadCSV(csvPath, folderId);
      uploaded.push({ fileName, result });
      onFile({ fileName, result });
    } catch (error) {
      failed.push({ fileName, message: error.message });
      onFile({ fileName, error: error.message });
    }
  }

  return { uploaded, failed };
}

export default { publishToDrive };
