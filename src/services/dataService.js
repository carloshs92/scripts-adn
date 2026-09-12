import { PromptTemplate } from 'langchain/prompts';
import { extractMultiplePDFs } from './pdfService.js';
import { createChatModel } from './llmService.js';
import { FIELDS, extractWithChain, PROMPT_SCHEMA } from '../milestone/index.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

// Re-export por compatibilidad: el esquema vive en src/milestone/schema.js
export const COLUMNS = FIELDS;

const EXTRACTION_PROMPT = `Eres un extractor de datos estructurados. Analiza el siguiente documento y extrae el máximo de ítems relevantes.

El documento puede ser un texto corrido (PDF) o una hoja de cálculo exportada como texto. En el segundo caso, cada sección "### Hoja: <nombre>" es una hoja del Excel, la primera fila suele ser el encabezado y las columnas vienen separadas por " | ": interpreta cada fila de datos como un ítem potencial.

REGLAS OBLIGATORIAS:
1. Solo usa información presente en el documento. No inventes ni alucines datos.
2. Cada ítem debe clasificarse en exactamente una de estas categorías: sustainability, talent, innovation, security.
3. Identifica la empresa subsidiaria específica de cada dato. Si aplica al holding en general o no se especifica, usa "Intercorp".
4. Asigna un score del 1 al 100 indicando la precisión del dato dentro del documento.
5. Extrae el maximo de items posibles. Pero recuerda la precisión es más importante que la cantidad.
6. Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional antes ni después.
7. Construcción del Título: El campo title debe ser siempre una frase corta, creativa y descriptiva que resuma el hito o la iniciativa (por ejemplo: "Lanzamiento de Nueva App" o "Programa de Mentoring"). Ignora por completo los nombres de los documentos de origen; está estrictamente prohibido incluir nombres de archivos, rutas o extensiones (como .pdf o .docx) en cualquier parte de la respuesta.

FORMATO DE SALIDA:
${PROMPT_SCHEMA}

DOCUMENTO:
{content}`;


/**
 * Extrae datos de cada documento (PDF o Excel) por separado.
 * @param {Array<string>} pdfFiles - Rutas de los documentos
 * @returns {Promise<Array<{fileName, filePath, rows}>>} Un objeto por PDF con sus filas
 */
export async function extractDataPerFile(pdfFiles) {
  const pdfContents = await extractMultiplePDFs(pdfFiles);
  const chain = PromptTemplate.fromTemplate(EXTRACTION_PROMPT).pipe(createChatModel());
  const results = [];

  for (const pdf of pdfContents) {
    logger.debug(`Extrayendo hitos de: ${pdf.fileName}`);
    const rows = await extractWithChain(chain, pdf.content, pdf.fileName);
    results.push({ fileName: pdf.fileName, filePath: pdf.filePath, rows });
  }

  return results;
}

/**
 * Extrae los hitos de todos los documentos, en una sola lista
 * @param {Array<string>} pdfFiles - Rutas de los documentos
 * @returns {Promise<Array>} Hitos listos para escribir en CSV
 */
export async function extractData(pdfFiles) {
  const perFile = await extractDataPerFile(pdfFiles);
  return perFile.flatMap((r) => r.rows);
}

export default { extractData, extractDataPerFile, COLUMNS };
