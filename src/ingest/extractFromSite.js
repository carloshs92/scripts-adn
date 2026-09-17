import { PromptTemplate } from 'langchain/prompts';
import { createChatModel } from '../platform/llm.js';
import { FIELDS, dedupe, PROMPT_SCHEMA } from '../milestone/index.js';
import { extractWithChain } from './fromModelResponse.js';
import { logger } from '../platform/log.js';
import dotenv from 'dotenv';

dotenv.config();

// Re-export por compatibilidad: el esquema vive en src/milestone/schema.js
const COLUMNS = FIELDS;

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
10. NO extraigas contenido comercial. Quedan fuera: productos concretos del catálogo con su presentación o formato ("Jugo Naranja 1L", "Serum 30ml"), precios, descuentos, cupones, campañas de temporada ("Black Friday", "Back to School"), programas de fidelización, mecánicas de compra o entrega, y avisos de reclutamiento. Un sitio de e-commerce habla sobre todo de eso y no es lo que este corpus registra.
    Sí extraes, en cambio, lo que la empresa ES y HACE como compañía: su propuesta de valor, sus líneas de negocio, su presencia, sus iniciativas de sostenibilidad, talento, innovación y seguridad, y los productos o servicios que constituyen una innovación propia (una pasarela de pagos, una carrera nueva), no un artículo de góndola.
11. No repitas ítems: si dos páginas describen la misma iniciativa, produce un solo ítem consolidando la información de ambas. Cada title debe ser único dentro de la respuesta.

FORMATO DE SALIDA:
${PROMPT_SCHEMA}

CONTENIDO WEB:
{content}`;


/**
 * Extrae ítems estructurados del contenido web de un sitio usando LangChain + OpenAI.
 * @param {Object} scraped - Objeto {url, domain, content} retornado por webScraperService
 * @returns {Promise<Array>} Hitos deduplicados, listos para escribir en CSV
 */
export async function extractDataFromWeb({ url, domain, content }) {
  const chain = PromptTemplate.fromTemplate(WEB_EXTRACTION_PROMPT).pipe(createChatModel());
  const extracted = await extractWithChain(chain, content, domain);

  const { milestones, duplicates } = dedupe(extracted);
  if (duplicates > 0) {
    logger.debug(`${duplicates} hito(s) duplicados descartados en ${domain}`);
  }

  return milestones;
}

export { COLUMNS };
export default { extractDataFromWeb, COLUMNS };
