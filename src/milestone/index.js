/**
 * El hito: entidad central del sistema.
 *
 * Punto de entrada único del modelo de dominio. Los servicios de extracción,
 * el CSV, el corpus y el histórico deben hablar de hitos a través de acá, no
 * redefinir sus reglas cada uno.
 */

export {
  FIELDS,
  CATEGORIES,
  FALLBACK_CATEGORY,
  FALLBACK_COMPANY,
  MISSING,
  PROMPT_SCHEMA,
  coerce,
  hasValue,
} from './schema.js';
export { key, titleKey, changedFields } from './identity.js';
export { dedupe } from './dedupe.js';
export { fromModelResponse, extractWithChain } from './fromModelResponse.js';
