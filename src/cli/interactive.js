import inquirer from 'inquirer';
import * as path from 'path';
import { findPDFs } from '../services/pdfService.js';
import { extractDataPerFile, COLUMNS } from '../services/dataService.js';
import * as csvService from '../services/csvService.js';
import { logger } from '../utils/logger.js';
import { validatePDFPath, ensureDirectory } from '../utils/validator.js';
import { filterUnprocessed, markProcessed } from '../utils/tracker.js';

const OUTPUT_DIR = './output';

async function askForPDFPath() {
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'pdfPath',
      message: 'Ingresa la ruta de los PDFs (ej: ./pdfs/*.pdf o ./pdfs/archivo.pdf):',
      default: './pdfs/*.pdf',
    },
  ]);

  validatePDFPath(answer.pdfPath);
  return answer.pdfPath;
}

export async function run({ pdfArg } = {}) {
  logger.header('📄 PDF to CSV Converter con LangChain');

  try {
    // Paso 1: Localizar PDFs
    logger.section('Paso 1: Localizando PDFs');
    const pdfPath = pdfArg ?? await askForPDFPath();

    logger.processing('Buscando archivos PDF...');
    const pdfFiles = await findPDFs(pdfPath);

    if (pdfFiles.length === 0) {
      logger.error('No se encontraron archivos PDF en la ruta especificada.');
      return;
    }

    logger.success(`Se encontraron ${pdfFiles.length} archivo(s) PDF`);

    // Filtrar PDFs ya procesados
    const { unprocessed, alreadyProcessed } = filterUnprocessed(pdfFiles);
    let filesToProcess = pdfFiles;

    if (alreadyProcessed.length > 0) {
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
          message: 'Algunos PDFs ya fueron procesados. ¿Qué deseas hacer?',
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

    // Paso 2: Extraer datos de cada PDF
    logger.section('Paso 2: Extrayendo datos');
    logger.processing(`Procesando ${filesToProcess.length} PDF(s)...`);

    const perFileResults = await extractDataPerFile(filesToProcess);

    // Paso 3: Guardar un CSV por PDF
    logger.section('Paso 3: Guardando CSV por PDF');

    let totalItems = 0;

    for (const { fileName, rows } of perFileResults) {
      const csvName = path.basename(fileName, '.pdf') + '.csv';
      const csvPath = path.join(OUTPUT_DIR, csvName);

      // Siempre sobreescribe el CSV del PDF (cada PDF es dueño de su CSV)
      await csvService.create(csvPath, COLUMNS);

      if (rows.length > 0) {
        await csvService.addRows(csvPath, rows, COLUMNS);
        logger.success(`${csvName} → ${rows.length} ítem(s) guardados`);
      } else {
        logger.warn(`${csvName} → sin datos extraídos`);
      }

      totalItems += rows.length;
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
