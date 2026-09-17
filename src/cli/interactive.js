import inquirer from 'inquirer';
import * as path from 'path';
import { findPDFs } from '../ingest/document/index.js';
import { extractDataPerFile, COLUMNS } from '../ingest/extractFromDocuments.js';
import { mergeRuns } from '../milestone/index.js';
import * as csvService from '../platform/csv.js';
import { logger } from '../platform/log.js';
import { validatePDFPath, ensureDirectory } from '../platform/paths.js';
import { filterUnprocessed, markProcessed } from '../ingest/processed.js';

const OUTPUT_DIR = './output';

/** Patrón por defecto, el mismo que ofrece el prompt interactivo. */
const DEFAULT_PATTERN = './pdfs/*.{pdf,xlsx,xlsm,xls}';

async function askForPDFPath() {
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'pdfPath',
      message: 'Ingresa la ruta de los documentos (ej: ./pdfs/*.pdf, ./pdfs/*.xlsx o ./pdfs/archivo.xlsx):',
      default: DEFAULT_PATTERN,
    },
  ]);

  validatePDFPath(answer.pdfPath);
  return answer.pdfPath;
}

/**
 * Dibuja una barra de progreso que se reescribe sobre sí misma.
 *
 * El troceado convirtió una llamada por documento en decenas, así que una
 * corrida completa tarda minutos. Sin esto la consola queda muda y no hay modo
 * de distinguir un proceso trabajando de uno colgado.
 *
 * @param {Object} p - Progreso emitido por extractDataPerFile
 */
function renderProgreso({ fileName, fileIndex, totalFiles, chunk, totalChunks, milestones, chars }) {
  const ANCHO = 24;
  const fraccion = totalChunks > 0 ? chunk / totalChunks : 0;
  const llenos = Math.round(fraccion * ANCHO);
  const barra = '█'.repeat(llenos) + '░'.repeat(ANCHO - llenos);

  const documento = `${fileIndex + 1}/${totalFiles}`;
  const trozos = totalChunks > 1 ? ` trozo ${String(chunk).padStart(2)}/${totalChunks}` : '';
  const nombre = fileName.length > 34 ? `${fileName.slice(0, 33)}…` : fileName.padEnd(34);
  const tamaño = chars > 50000 ? chalk.gray(` ${Math.round(chars / 1000)}k`) : '';

  process.stdout.write(
    `\r  ${chalk.cyan(documento)} ${chalk.blue(barra)} ${nombre}${trozos}` +
      `  ${chalk.green(String(milestones).padStart(3))} hitos${tamaño}   `
  );

  // Cerrar la línea cuando el documento termina, para que la siguiente empiece limpia
  if (chunk === totalChunks) process.stdout.write('\n');
}

/**
 * Genera el nombre del CSV a partir del documento origen, evitando que
 * dos archivos con el mismo nombre base (informe.pdf / informe.xlsx)
 * se pisen entre sí dentro de una misma corrida.
 * @param {string} fileName - Nombre del documento origen
 * @param {Set<string>} usedNames - Nombres ya asignados en esta corrida
 * @returns {string} Nombre del CSV
 */
function buildCSVName(fileName, usedNames) {
  const { name, ext } = path.parse(fileName);
  let csvName = `${name}.csv`;

  if (usedNames.has(csvName)) {
    csvName = `${name}-${ext.replace('.', '')}.csv`;
  }

  usedNames.add(csvName);
  return csvName;
}

export async function run({ pdfArg, force = false } = {}) {
  logger.header('📄 PDF / Excel to CSV Converter con LangChain');

  try {
    // Paso 1: Localizar documentos
    logger.section('Paso 1: Localizando documentos');
    // Con --force no se pregunta nada: es el modo no interactivo, pensado para
    // regenerar todo el corpus cuando cambian las reglas del prompt.
    const pdfPath = pdfArg ?? (force ? DEFAULT_PATTERN : await askForPDFPath());

    logger.processing('Buscando archivos PDF y Excel...');
    const pdfFiles = await findPDFs(pdfPath);

    if (pdfFiles.length === 0) {
      logger.error('No se encontraron archivos PDF ni Excel en la ruta especificada.');
      return;
    }

    logger.success(`Se encontraron ${pdfFiles.length} archivo(s) para procesar`);

    // Filtrar documentos ya procesados
    const { unprocessed, alreadyProcessed } = filterUnprocessed(pdfFiles);
    let filesToProcess = pdfFiles;

    if (force && alreadyProcessed.length > 0) {
      // Reprocesar sin preguntar: es la vía para regenerar un documento cuando
      // cambian las reglas del prompt, sin editar el registro a mano.
      logger.info(`--force: se reprocesan los ${pdfFiles.length} documento(s)`);
    } else if (alreadyProcessed.length > 0) {
      logger.info(
        `${alreadyProcessed.length} archivo(s) ya procesado(s): ${alreadyProcessed.map((f) => path.basename(f)).join(', ')}`
      );

      if (unprocessed.length > 0) {
        logger.info(
          `${unprocessed.length} archivo(s) nuevo(s): ${unprocessed.map((f) => path.basename(f)).join(', ')}`
        );
      }

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Algunos documentos ya fueron procesados. ¿Qué deseas hacer?',
          choices: [
            ...(unprocessed.length > 0
              ? [{ name: 'Procesar solo los nuevos', value: 'new' }]
              : []),
            { name: 'Reprocesar todos', value: 'all' },
            { name: 'Cancelar', value: 'cancel' },
          ],
          default: unprocessed.length > 0 ? 'new' : 'all',
        },
      ]);

      if (action === 'cancel') {
        logger.warn('Operación cancelada.');
        return;
      }

      filesToProcess = action === 'all' ? pdfFiles : unprocessed;

      if (filesToProcess.length === 0) {
        logger.warn('No hay archivos nuevos para procesar.');
        return;
      }
    }

    ensureDirectory(OUTPUT_DIR);

    // Paso 2: Extraer datos de cada documento
    logger.section('Paso 2: Extrayendo datos');
    logger.processing(`Procesando ${filesToProcess.length} documento(s)...`);
    // Los documentos grandes se trocean: un reporte de 400.000 caracteres son
    // más de treinta llamadas al modelo, y la corrida completa lleva minutos.
    console.log('');

    const perFileResults = await extractDataPerFile(filesToProcess, {
      onProgress: renderProgreso,
    });

    // Paso 3: Guardar un CSV por documento
    logger.section('Paso 3: Guardando CSV por documento');

    let totalItems = 0;
    const usedNames = new Set();

    for (const { fileName, rows } of perFileResults) {
      const csvName = buildCSVName(fileName, usedNames);
      const csvPath = path.join(OUTPUT_DIR, csvName);

      // Se fusiona con lo que ya había en vez de reemplazarlo: la extracción no
      // es determinista y cada corrida ve cosas distintas del mismo documento.
      const previos = await csvService.read(csvPath).catch(() => []);
      const fusionados = mergeRuns(rows, previos);

      await csvService.create(csvPath, COLUMNS);

      if (fusionados.length > 0) {
        await csvService.addRows(csvPath, fusionados, COLUMNS);
        const sumados = fusionados.length - previos.length;
        logger.success(
          `${csvName} → ${fusionados.length} hito(s)` +
            (previos.length ? ` (${previos.length} previos, ${sumados >= 0 ? '+' : ''}${sumados})` : '')
        );
      } else {
        logger.warn(`${csvName} → sin datos extraídos`);
      }

      totalItems += fusionados.length;
    }

    markProcessed(filesToProcess);

    // Resumen
    logger.header('✅ ¡Proceso completado exitosamente!');
    logger.success(`CSVs guardados en: ${OUTPUT_DIR}/`);
    logger.success(`Total de ítems extraídos: ${totalItems}`);
    logger.info(`Para unir todos los CSVs en uno: npm run merge:csv`);
    console.log('');
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
}

export default { run };
