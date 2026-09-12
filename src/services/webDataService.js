import { PromptTemplate } from 'langchain/prompts';
import { COLUMNS, VALID_CATEGORIES } from './dataService.js';
import { createChatModel } from './llmService.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

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
9. PRIORIDAD MÁXIMA: si el contenido incluye una página institucional (quiénes somos, nosotros, sobre nosotros, about, conócenos), el PRIMER ítem de la lista debe responder de forma directa "¿Qué es esta empresa?". Ese ítem debe titularse "Qué es <Nombre de la empresa>", resumir en largeDescription a qué se dedica, qué ofrece, a quién atiende y qué la distingue, y llevar score 95 o más.
10. No repitas ítems: si dos páginas describen la misma iniciativa, produce un solo ítem consolidando la información de ambas. Cada title debe ser único dentro de la respuesta.

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


/**
 * Normaliza un título para comparar duplicados: minúsculas, sin tildes,
 * sin puntuación y sin espacios repetidos.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Elimina ítems duplicados por título, conservando el de mayor score.
 * El modelo puede repetir una misma iniciativa cuando aparece en varias
 * páginas del mismo sitio (home, blog, quiénes somos).
 * @param {Array<Object>} rows - Filas extraídas
 * @returns {{rows: Array<Object>, duplicates: number}}
 */
export function dedupeRows(rows) {
  const byTitle = new Map();
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (key === '') continue;

    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, row);
      continue;
    }

    duplicates++;
    // Conservar el ítem con mayor score (o el más descriptivo si empatan)
    const currentScore = typeof row.score === 'number' ? row.score : 0;
    const existingScore = typeof existing.score === 'number' ? existing.score : 0;

    if (
      currentScore > existingScore ||
      (currentScore === existingScore &&
        String(row.largeDescription).length > String(existing.largeDescription).length)
    ) {
      byTitle.set(key, row);
    }
  }

  return { rows: [...byTitle.values()], duplicates };
}

/**
 * Extrae ítems estructurados del contenido web de un sitio usando LangChain + OpenAI.
 * @param {Object} scraped - Objeto {url, domain, content} retornado por webScraperService
 * @returns {Promise<Array>} Filas listas para escribir en CSV (mismo formato que dataService)
 */
export async function extractDataFromWeb({ url, domain, content }) {
  const chain = PromptTemplate.fromTemplate(WEB_EXTRACTION_PROMPT).pipe(createChatModel());

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

  const { rows: unique, duplicates } = dedupeRows(rows);
  if (duplicates > 0) {
    logger.debug(`${duplicates} ítem(s) duplicados descartados en ${domain}`);
  }

  logger.debug(`${unique.length} ítem(s) extraídos de ${domain}`);
  return unique;
}

export { COLUMNS };
export default { extractDataFromWeb, dedupeRows, COLUMNS };
