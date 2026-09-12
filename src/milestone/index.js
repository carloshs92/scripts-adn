/**
 * El hito: entidad central del sistema.
 *
 * Punto de entrada único del modelo de dominio. La ingesta, el CSV, el corpus y
 * el histórico deben hablar de hitos a través de acá, no redefinir sus reglas
 * cada uno.
 *
 * Acá NO va lógica de aplicación: convertir la respuesta de un modelo en hitos
 * necesita conocer LangChain y el logger, así que vive en `ingest/`. El dominio
 * solo depende de sí mismo.
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
