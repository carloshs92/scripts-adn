/**
 * fromModelResponse.js
 *
 * Convierte la respuesta cruda de un modelo en hitos válidos.
 *
 * Esta lógica estaba duplicada palabra por palabra entre `dataService` (PDFs y
 * Excel) y `webDataService` (sitios web): 38 líneas idénticas de las cuales la
 * única diferencia real era el prompt y de dónde sale `source_file`.
 *
 * Cuatro compuertas, todas degradando a lista vacía con warning en vez de
 * abortar la corrida: un documento que el modelo no supo leer no debe tumbar
 * los otros veintinueve.
 */

import { coerce } from '../milestone/schema.js';
import { logger } from '../platform/log.js';

/**
 * @param {string} responseText - Contenido devuelto por el modelo
 * @param {string} sourceFile - Documento o dominio de origen
 * @returns {Array<Object>} Hitos válidos, o [] si la respuesta no sirve
 */
export function fromModelResponse(responseText, sourceFile) {
  // El modelo suele envolver el JSON en prosa o en cercas de Markdown
  const jsonMatch = String(responseText).match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`No se encontró JSON en la respuesta de ${sourceFile}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    logger.warn(`JSON inválido para ${sourceFile}`);
    return [];
  }

  if (!Array.isArray(parsed.list)) {
    logger.warn(`Respuesta sin campo "list" para ${sourceFile}`);
    return [];
  }

  const milestones = parsed.list.map((item) => coerce(item, sourceFile));
  logger.debug(`${milestones.length} hito(s) extraídos de ${sourceFile}`);
  return milestones;
}

/**
 * Invoca una chain de LangChain y convierte su respuesta en hitos.
 * Si la llamada falla, se registra y se devuelve lista vacía.
 *
 * @param {Object} chain - Chain de LangChain lista para invocar
 * @param {string} content - Texto del documento o del sitio
 * @param {string} sourceFile - Documento o dominio de origen
 * @returns {Promise<Array<Object>>} Hitos extraídos
 */
export async function extractWithChain(chain, content, sourceFile) {
  let responseText;
  try {
    const result = await chain.invoke({ content });
    responseText = result.content.trim();
  } catch (err) {
    logger.warn(`Error llamando al modelo para ${sourceFile}: ${err.message}`);
    return [];
  }

  return fromModelResponse(responseText, sourceFile);
}

export default { fromModelResponse, extractWithChain };
