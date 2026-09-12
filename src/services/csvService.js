import { createObjectCsvWriter, createObjectCsvStringifier } from 'csv-writer';
import { createReadStream, existsSync, writeFileSync } from 'fs';
import csv from 'csv-parser';
import { MISSING } from '../milestone/index.js';
import { logger } from '../utils/logger.js';

/**
 * Verifica si un archivo CSV existe
 * @param {string} csvPath - Ruta del archivo CSV
 * @returns {boolean} True si existe, False si no
 */
export function exists(csvPath) {
  return existsSync(csvPath);
}

/**
 * Obtiene las columnas existentes de un CSV
 * @param {string} csvPath - Ruta del archivo CSV
 * @returns {Promise<Array<string>>} Array de nombres de columnas
 */
export async function getColumns(csvPath) {
  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(csv())
      .on('headers', (headers) => {
        resolve(headers);
      })
      .on('error', reject);
  });
}

/**
 * Crea un nuevo archivo CSV con las columnas especificadas
 * @param {string} csvPath - Ruta del archivo CSV a crear
 * @param {Array<string>} columns - Nombres de las columnas
 * @returns {Promise<void>}
 */
export async function create(csvPath, columns) {
  try {
    // Se escribe solo la línea de encabezado. Usar writeRecords([]) dejaba una
    // fila en blanco extra que después se leía como un ítem vacío.
    const stringifier = createObjectCsvStringifier({
      header: columns.map((col) => ({
        id: col,
        title: col,
      })),
      alwaysQuote: false,
    });

    writeFileSync(csvPath, stringifier.getHeaderString(), 'utf-8');
    logger.debug(`CSV creado: ${csvPath}`);
  } catch (error) {
    throw new Error(`Error creando CSV: ${error.message}`);
  }
}

/**
 * Añade datos a un archivo CSV existente
 * @param {string} csvPath - Ruta del archivo CSV
 * @param {Array<Object>} data - Array de objetos con los datos a añadir
 * @param {Array<string>} columns - Nombres de las columnas
 * @returns {Promise<void>}
 */
export async function addRows(csvPath, data, columns) {
  try {
    const writer = createObjectCsvWriter({
      path: csvPath,
      header: columns.map((col) => ({
        id: col,
        title: col,
      })),
      alwaysQuote: false,
      append: true,
    });

    // Filtrar datos para incluir solo las columnas definidas
    const filteredData = data.map((record) => {
      const filtered = {};
      columns.forEach((col) => {
        filtered[col] = record[col] || MISSING;
      });
      return filtered;
    });

    await writer.writeRecords(filteredData);
    logger.debug(`${filteredData.length} filas añadidas al CSV`);
  } catch (error) {
    throw new Error(`Error añadiendo datos al CSV: ${error.message}`);
  }
}

/**
 * Lee todos los datos de un CSV existente
 * @param {string} csvPath - Ruta del archivo CSV
 * @returns {Promise<Array<Object>>} Array de objetos con los datos
 */
export async function read(csvPath) {
  return new Promise((resolve, reject) => {
    const results = [];

    createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        // Descartar filas totalmente vacías (CSVs generados antes del fix
        // del encabezado traen una línea en blanco)
        if (Object.values(row).some((value) => String(value || '').trim() !== '')) {
          results.push(row);
        }
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', reject);
  });
}

/**
 * Obtiene estadísticas del CSV
 * @param {string} csvPath - Ruta del archivo CSV
 * @returns {Promise<Object>} Objeto con estadísticas
 */
export async function getStats(csvPath) {
  try {
    const data = await read(csvPath);
    const columns = data.length > 0 ? Object.keys(data[0]) : [];

    return {
      totalRows: data.length,
      columns: columns,
      columnCount: columns.length,
    };
  } catch (error) {
    throw new Error(`Error obteniendo estadísticas del CSV: ${error.message}`);
  }
}

export default {
  exists,
  getColumns,
  create,
  addRows,
  read,
  getStats,
};
