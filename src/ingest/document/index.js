import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { glob } from 'glob';
import { logger } from '../../platform/log.js';
import { config } from '../../config.js';
import { extractTextFromXLSX } from './spreadsheet.js';

const EXCEL_EXTENSIONS = ['.xlsx', '.xlsm', '.xls'];

/**
 * Indica si la extensión del archivo corresponde a un Excel
 * @param {string} filePath
 * @returns {boolean}
 */
export function isExcel(filePath) {
  return EXCEL_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Busca documentos soportados (PDF y Excel) según un patrón de ruta
 * @param {string} pdfPattern - Patrón de ruta (ej: './pdfs/*' o './pdfs/archivo.xlsx')
 * @returns {Promise<Array>} Array con rutas de documentos válidos
 */
export async function findPDFs(pdfPattern) {
  try {
    // Resolver el patrón glob
    const files = await glob(pdfPattern, { absolute: false });

    if (files.length === 0) {
      return [];
    }

    // Validar que los archivos existan y tengan una extensión soportada
    const validFiles = files.filter((file) => {
      return (
        fs.existsSync(file) &&
        config.paths.supportedExtensions.includes(path.extname(file).toLowerCase())
      );
    });

    return validFiles;
  } catch (error) {
    throw new Error(`Error procesando patrón de ruta: ${error.message}`);
  }
}

/**
 * Extrae texto de un archivo PDF
 * @param {string} pdfPath - Ruta del archivo PDF
 * @returns {Promise<string>} Texto extraído del PDF
 */
export async function extractTextFromPDF(pdfPath) {
  try {
    const fileBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(fileBuffer);
    return data.text;
  } catch (error) {
    throw new Error(`Error extrayendo texto del PDF ${pdfPath}: ${error.message}`);
  }
}

/**
 * Extrae el texto de un documento eligiendo el lector según su extensión
 * @param {string} filePath - Ruta del PDF o Excel
 * @returns {Promise<string>} Texto extraído
 */
export async function extractTextFromDocument(filePath) {
  return isExcel(filePath)
    ? extractTextFromXLSX(filePath)
    : extractTextFromPDF(filePath);
}

/**
 * Extrae múltiples documentos (PDF y/o Excel) y retorna sus contenidos.
 * Si un archivo falla, se registra el error y se continúa con el resto.
 * @param {Array<string>} pdfFiles - Array de rutas de documentos
 * @returns {Promise<Array>} Array con objetos {fileName, filePath, content}
 */
export async function extractMultiplePDFs(pdfFiles) {
  const results = [];

  for (const file of pdfFiles) {
    logger.debug(`Procesando: ${path.basename(file)}`);
    try {
      const content = await extractTextFromDocument(file);
      results.push({
        fileName: path.basename(file),
        filePath: file,
        content: content,
      });
    } catch (error) {
      logger.warn(error.message);
    }
  }

  return results;
}

export default {
  findPDFs,
  isExcel,
  extractTextFromPDF,
  extractTextFromDocument,
  extractMultiplePDFs,
};
