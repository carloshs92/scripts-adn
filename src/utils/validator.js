import fs from 'fs';
import path from 'path';

/**
 * Valida que la ruta del CSV sea válida
 */
export function validateCSVPath(csvPath) {
  if (!csvPath || csvPath.trim() === '') {
    throw new Error('La ruta del CSV no puede estar vacía');
  }

  const ext = path.extname(csvPath).toLowerCase();
  if (ext !== '.csv') {
    throw new Error('El archivo debe tener extensión .csv');
  }

  return true;
}

/**
 * Valida que la ruta de PDFs sea válida
 */
export function validatePDFPath(pdfPath) {
  if (!pdfPath || pdfPath.trim() === '') {
    throw new Error('La ruta de PDFs no puede estar vacía');
  }

  return true;
}

/**
 * Valida que la API key de OpenAI esté configurada
 */
export function validateOpenAIKey(apiKey) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no está definida en el archivo .env');
  }

  if (!apiKey.startsWith('sk-')) {
    throw new Error('OPENAI_API_KEY inválida. Debe comenzar con "sk-"');
  }

  return true;
}

/**
 * Crea el directorio si no existe
 */
export function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return true;
}

export default {
  validateCSVPath,
  validatePDFPath,
  validateOpenAIKey,
  ensureDirectory,
};
