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
export const FIELDS = Object.freeze([
  'title',
  'shortDescription',
  'category',
  'largeDescription',
  'company',
  'year',
  'score',
  'source_file',
]);

/** Las únicas categorías admitidas. Cualquier otra se coacciona a la primera. */
export const CATEGORIES = Object.freeze(['sustainability', 'talent', 'innovation', 'security']);

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

  // Los textos se normalizan acá y no al serializar: el corpus en Markdown se
  // lee campo por línea, así que un salto de línea dentro de un valor rompería
  // el registro, y un doble espacio en `source_file` haría que el mismo hito
  // tenga identidades distintas a cada lado de la frontera de repos.
  const text = (value, fallback) => {
    const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
    return clean || fallback;
  };

  return {
    title: text(item.title, MISSING),
    shortDescription: text(item.shortDescription, MISSING),
    category,
    largeDescription: text(item.largeDescription, MISSING),
    company: text(item.company, FALLBACK_COMPANY),
    year: text(item.year, MISSING),
    score: typeof item.score === 'number' ? item.score : MISSING,
    source_file: text(sourceFile, MISSING),
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
