/**
 * ejemplo-uso-programatico.js
 * 
 * Este archivo muestra cómo usar el script de manera programática
 * en lugar de usar la CLI interactiva. Útil si necesitas integrarlo
 * con otros scripts o procesos.
 */

import * as pdfService from '../ingest/document/index.js';
import * as dataService from '../ingest/extractFromDocuments.js';
import * as csvService from '../platform/csv.js';
import { logger } from '../platform/log.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Ejemplo 1: Flujo completo desde PDFs hasta CSV
 */
export async function ejemploCompleto() {
  try {
    logger.header('🔧 Ejemplo completo: PDFs -> CSV');

    // Paso 1: Procesar PDFs
    logger.section('Paso 1: Procesando PDFs...');
    const pdfPattern = './pdfs/*.pdf';
    const pdfFiles = await pdfService.findPDFs(pdfPattern);

    if (pdfFiles.length === 0) {
      logger.warn('Crea una carpeta "pdfs" y añade archivos PDF');
      return;
    }

    logger.success(`Se encontraron ${pdfFiles.length} PDF(s)`);

    // Paso 2: Definir columnas
    logger.section('Paso 2: Definiendo columnas automáticamente...');
    const columns = await dataService.defineColumns(pdfFiles);
    logger.success(`Columnas: ${columns.join(', ')}`);

    // Paso 3: Crear CSV
    logger.section('Paso 3: Creando archivo CSV...');
    const outputDir = './output';
    const csvPath = path.join(outputDir, 'datos_ejemplo.csv');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await csvService.create(csvPath, columns);
    logger.success(`CSV creado: ${csvPath}`);

    // Paso 4: Extraer datos
    logger.section('Paso 4: Extrayendo datos de PDFs...');
    const data = await dataService.extractData(pdfFiles, columns);
    logger.success(`Se extrajeron ${data.length} registros`);

    // Paso 5: Guardar datos en CSV
    logger.section('Paso 5: Guardando datos en CSV...');
    await csvService.addRows(csvPath, data, columns);
    logger.success(`Datos guardados`);

    // Paso 6: Ver estadísticas
    logger.section('Paso 6: Estadísticas del CSV:');
    const stats = await csvService.getStats(csvPath);
    logger.info(`📊 Total de filas: ${stats.totalRows}`);
    logger.info(`📋 Total de columnas: ${stats.columnCount}`);
    logger.info(`🏷️  Columnas: ${stats.columns.join(', ')}`);
    console.log('');

    logger.header('✅ ¡Ejemplo completado exitosamente!');
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
}

/**
 * Ejemplo 2: Procesar un PDF específico
 */
export async function ejemploUnPDF() {
  try {
    logger.header('🔧 Ejemplo: Procesar un PDF específico');

    const miPDF = './pdfs/documento.pdf';

    // Verificar que el archivo existe
    if (!fs.existsSync(miPDF)) {
      logger.warn(`No se encontró: ${miPDF}`);
      return;
    }

    logger.processing('Extrayendo texto del PDF...');
    const contenido = await pdfService.extractTextFromPDF(miPDF);

    logger.success('Primeros 500 caracteres del PDF:');
    console.log(contenido.substring(0, 500) + '...\n');
  } catch (error) {
    logger.error(error.message);
  }
}

/**
 * Ejemplo 3: Añadir más datos a un CSV existente
 */
export async function ejemploAnadirAlCSV() {
  try {
    logger.header('🔧 Ejemplo: Añadir datos a CSV existente');

    const csvPath = './output/datos_ejemplo.csv';

    if (!fs.existsSync(csvPath)) {
      logger.warn(`No existe: ${csvPath}`);
      logger.warn('Ejecuta primero: ejemploCompleto()');
      console.log('');
      return;
    }

    // Procesar nuevos PDFs
    const nuevosPDFs = await pdfService.findPDFs('./pdfs/*.pdf');
    if (nuevosPDFs.length === 0) return;

    // Obtener columnas existentes
    const columns = await csvService.getColumns(csvPath);

    logger.processing('Extrayendo datos de nuevos PDFs...');
    const nuevosDatos = await dataService.extractData(nuevosPDFs, columns);

    logger.processing('Añadiendo al CSV existente...');
    await csvService.addRows(csvPath, nuevosDatos, columns);

    logger.success('Datos añadidos correctamente\n');
  } catch (error) {
    logger.error(error.message);
  }
}

// Ejecutar ejemplo completo por defecto
ejemploCompleto();

// Descomenta para ejecutar otros ejemplos:
// ejemploUnPDF();
// ejemploAnadirAlCSV();
