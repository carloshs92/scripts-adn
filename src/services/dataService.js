import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from 'langchain/prompts';
import { extractMultiplePDFs } from './pdfService.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY no está definida en el archivo .env');
}

export const COLUMNS = [
  'title',
  'shortDescription',
  'category',
  'largeDescription',
  'company',
  'year',
  'score',
  'source_file',
];

export const VALID_CATEGORIES = ['sustainability', 'talent', 'innovation', 'security'];

const EXTRACTION_PROMPT = `Eres un extractor de datos estructurados. Analiza el siguiente documento y extrae el máximo de ítems relevantes.

REGLAS OBLIGATORIAS:
1. Solo usa información presente en el documento. No inventes ni alucines datos.
2. Cada ítem debe clasificarse en exactamente una de estas categorías: sustainability, talent, innovation, security.
3. Identifica la empresa subsidiaria específica de cada dato. Si aplica al holding en general o no se especifica, usa "Intercorp".
4. Asigna un score del 1 al 100 indicando la precisión del dato dentro del documento.
5. Extrae el maximo de items posibles. Pero recuerda la precisión es más importante que la cantidad.
6. Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional antes ni después.
7. Construcción del Título: El campo title debe ser siempre una frase corta, creativa y descriptiva que resuma el hito o la iniciativa (por ejemplo: "Lanzamiento de Nueva App" o "Programa de Mentoring"). Ignora por completo los nombres de los documentos de origen; está estrictamente prohibido incluir nombres de archivos, rutas o extensiones (como .pdf o .docx) en cualquier parte de la respuesta.

FORMATO DE SALIDA:
{{
  "list": [
    {{
      "title": "Título conciso del dato",
      "shortDescription": "Descripción breve (1-2 oraciones)",
      "category": "sustainability | talent | innovation | security",
      "largeDescription": "Descripción detallada con contexto completo del documento",
      "company": "Nombre de la subsidiaria o Intercorp",
      "year": "Año al que corresponde el dato (si se menciona)",
      "score": 85
    }}
  ]
}}

DOCUMENTO:
{content}`;

function createModel() {
  return new ChatOpenAI({
    openaiApiKey,
    modelName
  });
}

/**
 * Extrae las filas de un único objeto de contenido PDF usando la chain de LangChain.
 * @param {Object} pdf - Objeto {fileName, filePath, content}
 * @param {Object} chain - Chain de LangChain lista para invocar
 * @returns {Promise<Array>} Filas extraídas para ese PDF
 */
async function extractRowsFromContent(pdf, chain) {
  let responseText;
  try {
    const result = await chain.invoke({ content: pdf.content });
    responseText = result.content.trim();
  } catch (err) {
    logger.warn(`Error llamando a OpenAI para ${pdf.fileName}: ${err.message}`);
    return [];
  }

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`No se encontró JSON en la respuesta de ${pdf.fileName}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    logger.warn(`JSON inválido para ${pdf.fileName}`);
    return [];
  }

  if (!Array.isArray(parsed.list)) {
    logger.warn(`Respuesta sin campo "list" para ${pdf.fileName}`);
    return [];
  }

  const rows = parsed.list.slice(0, 7).map((item) => {
    const category = VALID_CATEGORIES.includes(item.category) ? item.category : 'innovation';
    return {
      title: item.title || 'N/A',
      shortDescription: item.shortDescription || 'N/A',
      category,
      largeDescription: item.largeDescription || 'N/A',
      company: item.company || 'Intercorp',
      year: item.year || 'N/A',
      score: typeof item.score === 'number' ? item.score : 'N/A',
      source_file: pdf.fileName,
    };
  });

  logger.debug(`${rows.length} ítem(s) extraídos de ${pdf.fileName}`);
  return rows;
}

/**
 * Extrae datos de cada PDF por separado.
 * @param {Array<string>} pdfFiles - Rutas de los PDFs
 * @returns {Promise<Array<{fileName, filePath, rows}>>} Un objeto por PDF con sus filas
 */
export async function extractDataPerFile(pdfFiles) {
  const pdfContents = await extractMultiplePDFs(pdfFiles);
  const chain = PromptTemplate.fromTemplate(EXTRACTION_PROMPT).pipe(createModel());
  const results = [];

  for (const pdf of pdfContents) {
    logger.debug(`Extrayendo ítems de: ${pdf.fileName}`);
    const rows = await extractRowsFromContent(pdf, chain);
    results.push({ fileName: pdf.fileName, filePath: pdf.filePath, rows });
  }

  return results;
}

/**
 * Extrae hasta 7 ítems estructurados de cada PDF según el schema IItemList.
 * @param {Array<string>} pdfFiles - Rutas de los PDFs
 * @returns {Promise<Array>} Filas listas para escribir en CSV
 */
export async function extractData(pdfFiles) {
  const perFile = await extractDataPerFile(pdfFiles);
  return perFile.flatMap((r) => r.rows);
}

export default { extractData, extractDataPerFile, COLUMNS };
