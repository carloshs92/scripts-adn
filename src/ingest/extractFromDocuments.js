import { PromptTemplate } from 'langchain/prompts';
import { extractMultiplePDFs } from './document/index.js';
import { createChatModel } from '../platform/llm.js';
import { FIELDS, PROMPT_SCHEMA, mergeRuns } from '../milestone/index.js';
import { config } from '../config.js';
import { extractWithChain } from './fromModelResponse.js';
import { logger } from '../platform/log.js';
import dotenv from 'dotenv';

dotenv.config();

// Re-export por compatibilidad: el esquema vive en src/milestone/schema.js
export const COLUMNS = FIELDS;

const EXTRACTION_PROMPT = `Eres un extractor de datos estructurados. Analiza el siguiente documento y extrae el máximo de ítems relevantes.

El documento puede ser un texto corrido (PDF) o una hoja de cálculo exportada como texto. En el segundo caso, cada sección "### Hoja: <nombre>" es una hoja del Excel, la primera fila suele ser el encabezado y las columnas vienen separadas por " | ": interpreta cada fila de datos como un ítem potencial.

REGLAS OBLIGATORIAS:
0. TODA la salida va en español, sin excepción, aunque el documento esté en inglés. Traduce los nombres propios que tengan forma establecida en español ("Chilina Bridge" → "Puente Chilina", "Naval Lyceum" → "Liceo Naval") y deja sin traducir solo las marcas registradas. Está prohibido que un title mezcle idiomas: "Proyecto Chilina Bridge" es incorrecto, "Puente Chilina" es correcto.
1. Solo usa información presente en el documento. No inventes ni alucines datos.
1.b Cada ítem debe entenderse solo, sin el documento al lado. El corpus se busca por significado: una descripción vaga vuelve al ítem imposible de encontrar. shortDescription empieza nombrando QUÉ es la cosa, y agrega DÓNDE está o a quién alcanza y bajo qué programa o iniciativa se hizo.
    INCORRECTO: "Estrategia de conexión vial en Arequipa." — no dice qué es, ni que sea una obra pública, ni en qué país, ni cómo se financió.
    INCORRECTO: "Conectando Arequipa con infraestructura moderna." — es un eslogan, no un dato.
    CORRECTO: "El Puente Chilina es una obra pública de infraestructura vial en Arequipa, Perú, ejecutada bajo el mecanismo de Obras por Impuestos."
    La misma exigencia vale para iniciativas, programas y cifras: "Programa de becas" es insuficiente; "Programa de becas de UTP que financió 1.112 cupos en 2024 para estudiantes de alto rendimiento" sirve.
2. Cada ítem debe clasificarse en exactamente una de estas categorías: sustainability, talent, innovation, security.
3. Identifica la empresa subsidiaria específica de cada dato. Si aplica al holding en general o no se especifica, usa "Intercorp".
4. Asigna un score del 1 al 100 indicando la precisión del dato dentro del documento.
5. Extrae el maximo de items posibles. Pero recuerda la precisión es más importante que la cantidad.
6. Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional antes ni después.
7. Obras y proyectos con nombre propio: ADEMÁS de los ítems que ya extraerías, genera uno por cada obra, proyecto, sede o programa que el documento nombre —aunque aparezca dentro de una lista, una tabla o una enumeración—, con su nombre propio en el title. Estos ítems se SUMAN a los de cifras agregadas, portafolios y logros generales; no los reemplazan. El largeDescription menciona también el nombre original si el documento lo trae en otro idioma.
8. FICHAS INSTITUCIONALES. Por cada empresa del grupo que el documento describa —qué es, a qué se dedica, a quién atiende, qué escala tiene— genera un ítem aparte titulado "Qué es <Empresa>", con score 95 o más. Un reporte corporativo describe varias subsidiarias: generá una ficha por cada una que el documento caracterice, no solo por la principal.
    El largeDescription responde la pregunta "¿qué es esta empresa?" con los datos del documento: rubro, alcance, cifras de escala y propuesta de valor. Si el documento solo menciona a la empresa de pasada, sin caracterizarla, NO inventes una ficha.
9. Construcción del Título: El campo title debe ser siempre una frase corta, creativa y descriptiva que resuma el hito o la iniciativa (por ejemplo: "Lanzamiento de Nueva App" o "Programa de Mentoring"). Ignora por completo los nombres de los documentos de origen; está estrictamente prohibido incluir nombres de archivos, rutas o extensiones (como .pdf o .docx) en cualquier parte de la respuesta.

FORMATO DE SALIDA:
${PROMPT_SCHEMA}

DOCUMENTO:
{content}`;


/**
 * Parte un texto largo en trozos que el modelo pueda agotar.
 *
 * Un reporte de sostenibilidad llega a 432.000 caracteres. Entra en el
 * contexto, pero pedirle al modelo que extraiga "el máximo de ítems" sobre esa
 * masa produce un resumen: la densidad cae de 147 hitos por cada 10.000
 * caracteres en un documento de una página a 1,6 en uno de 400.000. Troceando,
 * cada llamada ve una porción acotada y la agota.
 *
 * El corte busca un salto de línea cerca del límite para no partir una oración,
 * y los trozos se solapan para no perder un hito que quede a caballo.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
export function chunkText(text) {
  const { maxCharactersPerCall: max, overlapCharacters: overlap } = config.chunking;
  if (text.length <= max) return [text];

  const trozos = [];
  let inicio = 0;

  while (inicio < text.length) {
    let fin = Math.min(inicio + max, text.length);

    if (fin < text.length) {
      // Retroceder hasta un salto de línea, sin irse más de un 20% del trozo
      const corte = text.lastIndexOf('\n', fin);
      if (corte > inicio + max * 0.8) fin = corte;
    }

    trozos.push(text.slice(inicio, fin));
    if (fin >= text.length) break;
    inicio = Math.max(fin - overlap, inicio + 1);
  }

  return trozos;
}

/**
 * Ejecuta `tarea` sobre cada elemento con un tope de tareas en vuelo.
 *
 * Conserva el orden de entrada en la salida: los trozos se fusionan después en
 * el orden del documento, así que dos corridas con el mismo material producen
 * el mismo resultado aunque terminen en distinto orden.
 *
 * @param {Array} elementos
 * @param {number} limite - Tareas simultáneas
 * @param {Function} tarea - (elemento, indice) => Promise
 * @returns {Promise<Array>} Resultados en el orden de entrada
 */
async function conConcurrencia(elementos, limite, tarea) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;

  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      resultados[i] = await tarea(elementos[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajador));
  return resultados;
}

/**
 * Extrae datos de cada documento (PDF o Excel) por separado.
 *
 * Trocear multiplica las llamadas al modelo —un reporte de 432.000 caracteres
 * pasa de una a treinta y una— así que informa el avance en vez de dejar la
 * consola muda varios minutos.
 *
 * @param {Array<string>} pdfFiles - Rutas de los documentos
 * @param {Object} [opciones]
 * @param {Function} [opciones.onProgress] - Recibe {fileName, fileIndex, totalFiles, chunk, totalChunks, milestones}
 * @returns {Promise<Array<{fileName, filePath, rows}>>} Un objeto por documento con sus filas
 */
export async function extractDataPerFile(pdfFiles, { onProgress } = {}) {
  const pdfContents = await extractMultiplePDFs(pdfFiles);
  const chain = PromptTemplate.fromTemplate(EXTRACTION_PROMPT).pipe(createChatModel());
  const results = [];

  for (const [fileIndex, pdf] of pdfContents.entries()) {
    const trozos = chunkText(pdf.content);
    let rows = [];

    const avisar = (chunk) =>
      onProgress?.({
        fileName: pdf.fileName,
        fileIndex,
        totalFiles: pdfContents.length,
        chunk,
        totalChunks: trozos.length,
        milestones: rows.length,
        chars: pdf.content.length,
      });

    avisar(0);
    let terminados = 0;

    // Los trozos no dependen entre sí, así que van en paralelo con un tope.
    const porTrozo = await conConcurrencia(trozos, config.chunking.concurrency, async (trozo) => {
      const extraido = await extractWithChain(chain, trozo, pdf.fileName);
      terminados++;
      // El progreso reporta trozos terminados; los hitos se cuentan al fusionar
      onProgress?.({
        fileName: pdf.fileName,
        fileIndex,
        totalFiles: pdfContents.length,
        chunk: terminados,
        totalChunks: trozos.length,
        milestones: rows.length,
        chars: pdf.content.length,
      });
      return extraido;
    });

    // La fusión va en el orden del documento, no en el de llegada: el solape
    // hace que un mismo hito aparezca en dos trozos, y así el resultado no
    // depende de cuál respondió primero.
    for (const delTrozo of porTrozo) rows = mergeRuns(delTrozo, rows);
    avisar(trozos.length);

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
