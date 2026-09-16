import { PromptTemplate } from 'langchain/prompts';
import { extractMultiplePDFs } from './document/index.js';
import { createChatModel } from '../platform/llm.js';
import { FIELDS, PROMPT_SCHEMA } from '../milestone/index.js';
import { extractWithChain } from './fromModelResponse.js';
import { logger } from '../platform/log.js';
import dotenv from 'dotenv';

dotenv.config();

// Re-export por compatibilidad: el esquema vive en src/milestone/schema.js
export const COLUMNS = FIELDS;

const EXTRACTION_PROMPT = `Eres un extractor de datos estructurados. Analiza el siguiente documento y extrae el máximo de ítems relevantes.

El documento puede ser un texto corrido (PDF) o una hoja de cálculo exportada como texto. En el segundo caso, cada sección "### Hoja: <nombre>" es una hoja del Excel, la primera fila suele ser el encabezado y las columnas vienen separadas por " | ": interpreta cada fila de datos como un ítem potencial.

REGLAS OBLIGATORIAS:
1. Solo usa información presente en el documento. No inventes ni alucines datos.
1.b Cada ítem debe entenderse solo, sin el documento al lado. shortDescription y largeDescription tienen que decir QUÉ es, DÓNDE está o a quién alcanza, y bajo qué programa o iniciativa se hizo. Un texto de folleto como "Conectando Arequipa con infraestructura moderna" no sirve: no dice que sea una obra, ni que esté en Perú, ni cómo se financió. El corpus se busca por significado, así que una descripción vaga vuelve al ítem imposible de encontrar.
2. Cada ítem debe clasificarse en exactamente una de estas categorías: sustainability, talent, innovation, security.
3. Identifica la empresa subsidiaria específica de cada dato. Si aplica al holding en general o no se especifica, usa "Intercorp".
4. Asigna un score del 1 al 100 indicando la precisión del dato dentro del documento.
5. Extrae el maximo de items posibles. Pero recuerda la precisión es más importante que la cantidad.
6. Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional antes ni después.
7. Obras y proyectos con nombre propio: ADEMÁS de los ítems que ya extraerías, genera uno por cada obra, proyecto, sede o programa que el documento nombre —aunque aparezca dentro de una lista, una tabla o una enumeración—, con su nombre propio en el title. Estos ítems se SUMAN a los de cifras agregadas, portafolios y logros generales; no los reemplazan. Si el documento está en inglés y el nombre tiene forma equivalente en español (por ejemplo "Chilina Bridge"), usa la forma española ("Puente Chilina") y menciona ambas en largeDescription.
8. Construcción del Título: El campo title debe ser siempre una frase corta, creativa y descriptiva que resuma el hito o la iniciativa (por ejemplo: "Lanzamiento de Nueva App" o "Programa de Mentoring"). Ignora por completo los nombres de los documentos de origen; está estrictamente prohibido incluir nombres de archivos, rutas o extensiones (como .pdf o .docx) en cualquier parte de la respuesta.

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
