#!/usr/bin/env node

/**
 * sync-spreadsheet.js
 *
 * Sube los CSVs de output/ a Google Drive como hojas de cálculo.
 * Es la vía de consulta humana del corpus, no la que alimenta la app.
 */

import dotenv from 'dotenv';
import chalk from 'chalk';
import { publishToDrive } from '../src/corpus/publishToDrive.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

async function main() {
  console.log(chalk.blue.bold('\n📊 Publicar el corpus en Google Drive\n'));
  console.log(chalk.gray(`   Carpeta destino: ${FOLDER_ID}\n`));

  const { uploaded, failed } = await publishToDrive({
    outputDir: OUTPUT_DIR,
    folderId: FOLDER_ID,
    onFile: ({ fileName, result, error }) => {
      if (error) return console.log(chalk.red(`❌ ${fileName}: ${error}`));
      console.log(chalk.green(`✅ ${fileName}`) + chalk.gray(` → ${result?.webViewLink ?? 'subido'}`));
    },
  });

  console.log(chalk.blue('\n' + '─'.repeat(46)));
  console.log(chalk.green(`✅ ${uploaded.length} archivo(s) en Drive`));
  if (failed.length > 0) console.log(chalk.red(`❌ ${failed.length} fallido(s)`));
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
