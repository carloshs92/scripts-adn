import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { glob } from 'glob';
import { logger } from '../utils/logger.js';

/**
 * Procesa múltiples archivos PDF y retorna la ruta de los que existen
 * @param {string} pdfPattern - Patrón de ruta (ej: './pdfs/*.pdf' o './pdfs/archivo.pdf')
 * @returns {Promise<Array>} Array con rutas de archivos PDF válidos
 */
export async function findPDFs(pdfPattern) {
  try {
    // Resolver el patrón glob
    const files = await glob(pdfPattern, { absolute: false });

    if (files.length === 0) {
      return [];
    }

    // Validar que todos los archivos existan y sean PDFs
    const validFiles = files.filter((file) => {
      return fs.existsSync(file) && path.extname(file).toLowerCase() === '.pdf';
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
 * Extrae múltiples PDFs y retorna sus contenidos
 * @param {Array<string>} pdfFiles - Array de rutas de PDFs
 * @returns {Promise<Array>} Array con objetos {fileName, filePath, content}
 */
export async function extractMultiplePDFs(pdfFiles) {
  try {
    const results = [];

    for (const file of pdfFiles) {
      logger.debug(`Procesando: ${path.basename(file)}`);
      const content = await extractTextFromPDF(file);
      results.push({
        fileName: path.basename(file),
        filePath: file,
        content: content,
      });
    }

    return results;
  } catch (error) {
    throw new Error(`Error procesando múltiples PDFs: ${error.message}`);
  }
}

export default {
  findPDFs,
  extractTextFromPDF,
  extractMultiplePDFs,
};
