import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from 'langchain/prompts';
import { COLUMNS, VALID_CATEGORIES } from './dataService.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY no está definida en el archivo .env');
}

// Prompt específico para contenido web: más enfocado en noticias, productos e iniciativas
const WEB_EXTRACTION_PROMPT = `Eres un analista de información corporativa especializado en el ecosistema Intercorp. Analiza el siguiente contenido extraído de páginas web de una empresa del grupo y extrae todos los ítems relevantes sobre sus iniciativas, productos, logros y noticias.

REGLAS OBLIGATORIAS:
1. Solo usa información explícitamente presente en el contenido. No inventes ni alucines datos.
2. Enfócate en encontrar: noticias corporativas, lanzamientos de productos/servicios, iniciativas de sostenibilidad, programas de talento y cultura, innovación tecnológica, logros empresariales, alianzas estratégicas, premios y reconocimientos.
3. Cada ítem debe clasificarse en exactamente una de estas categorías: sustainability, talent, innovation, security.
4. Identifica la empresa del contenido (izipay, Interfondos, Expressnet, Inteligo, Interseguro, Interbank, etc.). Si no se especifica subsidiaria, usa "Intercorp".
5. Asigna un score del 1 al 100 indicando la relevancia e impacto del ítem para el grupo Intercorp.
6. Extrae el máximo de ítems posibles. La precisión es más importante que la cantidad.
7. Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional antes ni después.
8. El campo title debe ser una frase corta (máx. 8 palabras), creativa y descriptiva del hito o iniciativa. Nunca incluyas URLs, dominios ni nombres de archivo.

FORMATO DE SALIDA:
{{
  "list": [
    {{
      "title": "Frase corta y descriptiva del hito",
      "shortDescription": "Descripción breve (1-2 oraciones)",
      "category": "sustainability | talent | innovation | security",
      "largeDescription": "Descripción detallada con contexto completo del dato",
      "company": "Nombre de la empresa (ej: Interbank, izipay, Interseguro)",
      "year": "Año del dato si se menciona, si no N/A",
      "score": 85
    }}
  ]
}}

CONTENIDO WEB:
{content}`;

function createModel() {
  return new ChatOpenAI({
    openaiApiKey,
    modelName,
  });
}

/**
 * Extrae ítems estructurados del contenido web de un sitio usando LangChain + OpenAI.
 * @param {Object} scraped - Objeto {url, domain, content} retornado por webScraperService
 * @returns {Promise<Array>} Filas listas para escribir en CSV (mismo formato que dataService)
 */
export async function extractDataFromWeb({ url, domain, content }) {
  const chain = PromptTemplate.fromTemplate(WEB_EXTRACTION_PROMPT).pipe(createModel());

  let responseText;
  try {
    const result = await chain.invoke({ content });
    responseText = result.content.trim();
  } catch (err) {
    logger.warn(`Error llamando a OpenAI para ${domain}: ${err.message}`);
    return [];
  }

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`No se encontró JSON en la respuesta de ${domain}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    logger.warn(`JSON inválido para ${domain}`);
    return [];
  }

  if (!Array.isArray(parsed.list)) {
    logger.warn(`Respuesta sin campo "list" para ${domain}`);
    return [];
  }

  const rows = parsed.list.map((item) => {
    const category = VALID_CATEGORIES.includes(item.category) ? item.category : 'innovation';
    return {
      title: item.title || 'N/A',
      shortDescription: item.shortDescription || 'N/A',
      category,
      largeDescription: item.largeDescription || 'N/A',
      company: item.company || domain,
      year: item.year || 'N/A',
      score: typeof item.score === 'number' ? item.score : 'N/A',
      source_file: domain,
    };
  });

  logger.debug(`${rows.length} ítem(s) extraídos de ${domain}`);
  return rows;
}

export { COLUMNS };
export default { extractDataFromWeb, COLUMNS };
