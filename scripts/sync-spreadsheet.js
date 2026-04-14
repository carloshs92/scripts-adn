#!/usr/bin/env node

/**
 * sync-spreadsheet.js
 *
 * Sube todos los CSVs de la carpeta output/ a una carpeta de Google Drive
 * como Google Sheets. Si el archivo ya existe, lo actualiza.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_SERVICE_ACCOUNT_KEY  - Ruta al JSON de la service account
 *   GOOGLE_DRIVE_FOLDER_ID      - ID de la carpeta destino en Google Drive
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { glob } from 'glob';
import { uploadCSV } from '../src/services/driveService.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

async function main() {
  console.log(chalk.blue.bold('\n☁️  Sync CSV → Google Drive\n'));

  if (!FOLDER_ID) {
    console.error(chalk.red('❌ GOOGLE_DRIVE_FOLDER_ID no está definida en el archivo .env'));
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(chalk.red(`❌ La carpeta de output no existe: ${OUTPUT_DIR}`));
    process.exit(1);
  }

  const csvFiles = await glob(`${OUTPUT_DIR}/*.csv`);

  if (csvFiles.length === 0) {
    console.log(chalk.yellow('⚠️  No se encontraron archivos CSV en la carpeta output/'));
    console.log(chalk.yellow('   Ejecuta primero: npm start\n'));
    process.exit(0);
  }

  console.log(chalk.cyan(`Archivos encontrados: ${csvFiles.length}\n`));

  let uploaded = 0;
  let failed = 0;

  for (const csvPath of csvFiles) {
    const fileName = path.basename(csvPath);
    process.stdout.write(chalk.yellow(`⏳ Subiendo ${fileName}...`));

    try {
      const result = await uploadCSV(csvPath, FOLDER_ID);
      process.stdout.write('\r');
      console.log(chalk.green(`✅ ${fileName}`));
      console.log(chalk.gray(`   ${result.url}\n`));
      uploaded++;
    } catch (error) {
      process.stdout.write('\r');
      console.log(chalk.red(`❌ ${fileName}: ${error.message}\n`));
      failed++;
    }
  }

  console.log(chalk.blue('─'.repeat(40)));
  console.log(chalk.green(`✅ Subidos: ${uploaded}`));
  if (failed > 0) {
    console.log(chalk.red(`❌ Fallidos: ${failed}`));
  }
  console.log('');
}

main().catch((error) => {
  console.error(chalk.red('\n❌ Error fatal:'), error.message);
  process.exit(1);
});
