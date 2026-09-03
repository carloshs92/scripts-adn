import ExcelJS from 'exceljs';
import { config } from '../config.js';

/**
 * Convierte el valor de una celda de ExcelJS a texto plano.
 * Maneja fórmulas, texto enriquecido, hipervínculos, fechas y errores.
 * @param {*} value - Valor crudo de la celda
 * @returns {string} Representación en texto de la celda
 */
function cellToText(value) {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  if (typeof value === 'object') {
    // Fórmula: usar el resultado calculado
    if ('result' in value) return cellToText(value.result);
    // Texto enriquecido
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    // Hipervínculo
    if ('text' in value) return cellToText(value.text);
    if ('hyperlink' in value) return String(value.hyperlink);
    // Celda con error (#N/A, #REF!, etc.)
    if ('error' in value) return '';
    return '';
  }

  return String(value);
}

/**
 * Convierte una hoja de cálculo a texto tabular delimitado por " | ".
 * @param {Object} worksheet - Hoja de ExcelJS
 * @returns {string} Contenido de la hoja como texto
 */
function worksheetToText(worksheet) {
  const lines = [];

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    // row.values es 1-indexado: la posición 0 siempre viene vacía
    for (let i = 1; i <= worksheet.columnCount; i++) {
      cells.push(cellToText(row.getCell(i).value).replace(/\s+/g, ' ').trim());
    }

    // Descartar filas totalmente vacías
    if (cells.some((c) => c !== '')) {
      lines.push(cells.join(' | '));
    }
  });

  return lines.join('\n');
}

/**
 * Extrae el texto de un archivo Excel, hoja por hoja.
 * Cada hoja se antecede con su nombre para dar contexto al modelo.
 * @param {string} xlsxPath - Ruta del archivo .xlsx/.xlsm/.xls
 * @returns {Promise<string>} Texto extraído del Excel
 */
export async function extractTextFromXLSX(xlsxPath) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath);

    const sections = [];

    workbook.eachSheet((worksheet) => {
      const content = worksheetToText(worksheet);
      if (content.trim() === '') return;
      sections.push(`### Hoja: ${worksheet.name}\n${content}`);
    });

    const text = sections.join('\n\n');
    const maxChars = config.xlsx.maxCharactersForExtraction;

    if (text.length > maxChars) {
      return `${text.slice(0, maxChars)}\n\n[...contenido truncado...]`;
    }

    return text;
  } catch (error) {
    throw new Error(`Error extrayendo texto del Excel ${xlsxPath}: ${error.message}`);
  }
}

export default { extractTextFromXLSX };
