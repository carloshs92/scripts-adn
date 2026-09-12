/**
 * schema.js
 *
 * El hito es la entidad central del sistema: una iniciativa, logro o noticia
 * de una empresa del grupo, extraída de un documento o de un sitio web.
 *
 * Este archivo es la única definición de su forma. Antes el esquema vivía en
 * `dataService`, las categorías válidas también, la coerción estaba duplicada
 * entre `dataService` y `webDataService`, y la identidad en `historyService`:
 * seis piezas del mismo concepto repartidas en cuatro archivos.
 */

/** Columnas del hito, en el orden en que se escriben al CSV. */
export const FIELDS = [
  'title',
  'shortDescription',
  'category',
  'largeDescription',
  'company',
  'year',
  'score',
  'source_file',
];

/** Las únicas categorías admitidas. Cualquier otra se coacciona a la primera. */
export const CATEGORIES = ['sustainability', 'talent', 'innovation', 'security'];

/** Categoría a la que cae un valor no reconocido. */
export const FALLBACK_CATEGORY = 'innovation';

/** Empresa a la que cae un hito sin subsidiaria identificada. */
export const FALLBACK_COMPANY = 'Intercorp';

/** Marca de campo sin información. */
export const MISSING = 'N/A';

/**
 * El esquema expresado para el modelo, listo para interpolar en un prompt.
 *
 * Las llaves van dobladas porque `PromptTemplate` de LangChain usa sintaxis
 * f-string: `{{` escapa una llave literal. Vive acá y no en cada prompt para
 * que agregar una columna no exija recordar los dos sitios donde se declara.
 */
export const PROMPT_SCHEMA = `{{
  "list": [
    {{
      "title": "Frase corta y descriptiva del hito (máx. 8 palabras)",
      "shortDescription": "Descripción breve (1-2 oraciones)",
      "category": "sustainability | talent | innovation | security",
      "largeDescription": "Descripción detallada con contexto completo",
      "company": "Nombre de la subsidiaria o Intercorp",
      "year": "Año del dato si se menciona, si no N/A",
      "score": 85
    }}
  ]
}}`;

/**
 * Convierte un ítem crudo del modelo en un hito válido.
 *
 * La coerción es total: siempre devuelve las ocho columnas, porque el CSV no
 * admite filas de forma variable y el corpus no admite campos ausentes. El
 * `source_file` nunca viene del modelo — lo impone quien conoce el origen.
 *
 * @param {Object} item - Ítem tal como lo devolvió el modelo
 * @param {string} sourceFile - Documento o dominio de origen
 * @returns {Object} Hito con las ocho columnas
 */
export function coerce(item, sourceFile) {
  const category = CATEGORIES.includes(item.category) ? item.category : FALLBACK_CATEGORY;

  return {
    title: item.title || MISSING,
    shortDescription: item.shortDescription || MISSING,
    category,
    largeDescription: item.largeDescription || MISSING,
    company: item.company || FALLBACK_COMPANY,
    year: item.year || MISSING,
    score: typeof item.score === 'number' ? item.score : MISSING,
    source_file: sourceFile,
  };
}

/**
 * Indica si un campo tiene información aprovechable
 * @param {*} value
 * @returns {boolean}
 */
export function hasValue(value) {
  return Boolean(value) && value !== MISSING;
}

export default { FIELDS, CATEGORIES, PROMPT_SCHEMA, coerce, hasValue };
