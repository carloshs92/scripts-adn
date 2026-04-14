#!/usr/bin/env node

/**
 * merge-csv.js
 *
 * Combina todos los CSVs individuales de output/ en un único archivo merged.csv.
 * Cada PDF genera su propio CSV; este script los fusiona para tener una vista unificada.
 *
 * Uso:
 *   npm run merge:csv
 *
 * Opciones de entorno:
 *   OUTPUT_DIR  - Carpeta donde están los CSVs individuales (default: ./output)
 *   MERGED_NAME - Nombre del archivo de salida (default: merged.csv)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { glob } from 'glob';
import { createReadStream } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import csv from 'csv-parser';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const MERGED_NAME = process.env.MERGED_NAME || 'merged.csv';
const MERGED_PATH = path.join(OUTPUT_DIR, MERGED_NAME);

/**
 * Lee todas las filas de un archivo CSV
 * @param {string} csvPath
 * @returns {Promise<Array<Object>>}
 */
function readCSV(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        // Ignorar filas vacías (líneas en blanco del CSV)
        if (Object.values(row).some((v) => v !== '')) rows.push(row);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  console.log(chalk.blue.bold('\n🔀 Merge CSV → merged.csv\n'));

  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(chalk.red(`❌ La carpeta de output no existe: ${OUTPUT_DIR}`));
    process.exit(1);
  }

  // Buscar todos los CSVs excepto el merged mismo
  const allCSVs = await glob(`${OUTPUT_DIR}/*.csv`);
  const csvFiles = allCSVs.filter((f) => path.basename(f) !== MERGED_NAME);

  if (csvFiles.length === 0) {
    console.log(chalk.yellow('⚠️  No se encontraron CSVs individuales en output/'));
    console.log(chalk.yellow('   Ejecuta primero: npm start\n'));
    process.exit(0);
  }

  console.log(chalk.cyan(`Archivos a combinar: ${csvFiles.length}\n`));

  // Leer todos los CSVs y acumular filas
  let allRows = [];
  let columns = null;

  for (const csvPath of csvFiles) {
    const fileName = path.basename(csvPath);
    try {
      const rows = await readCSV(csvPath);

      if (rows.length === 0) {
        console.log(chalk.yellow(`⚠️  ${fileName}: vacío, se omite`));
        continue;
      }

      // Tomar las columnas del primer CSV con datos
      if (!columns) {
        columns = Object.keys(rows[0]);
      }

      allRows = allRows.concat(rows);
      console.log(chalk.green(`✅ ${fileName}: ${rows.length} fila(s)`));
    } catch (error) {
      console.log(chalk.red(`❌ ${fileName}: ${error.message}`));
    }
  }

  if (allRows.length === 0) {
    console.log(chalk.yellow('\n⚠️  No hay datos para combinar.\n'));
    process.exit(0);
  }

  // Escribir merged.csv
  const writer = createObjectCsvWriter({
    path: MERGED_PATH,
    header: columns.map((col) => ({ id: col, title: col })),
    alwaysQuote: false,
  });

  await writer.writeRecords(allRows);

  console.log(chalk.blue('\n' + '─'.repeat(40)));
  console.log(chalk.green(`✅ Archivo generado: ${MERGED_PATH}`));
  console.log(chalk.cyan(`   Total de filas: ${allRows.length}`));
  console.log(chalk.cyan(`   Columnas: ${columns.join(', ')}`));
  console.log('');
}

main().catch((error) => {
  console.error(chalk.red('\n❌ Error fatal:'), error.message);
  process.exit(1);
});
