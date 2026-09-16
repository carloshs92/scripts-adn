#!/usr/bin/env node

/**
 * merge-csv.js
 *
 * Combina los CSVs por documento en output/merged.csv.
 *
 * Para publicar además el corpus de la app y verificar su índice en una sola
 * pasada, usar `npm run publish:corpus`.
 */

import dotenv from 'dotenv';
import chalk from 'chalk';
import { consolidate } from '../src/corpus/consolidate.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const MERGED_NAME = process.env.MERGED_NAME || 'merged.csv';

async function main() {
  console.log(chalk.blue.bold('\n🔀 Consolidar el corpus\n'));

  const result = await consolidate({
    outputDir: OUTPUT_DIR,
    mergedName: MERGED_NAME,
    onFile: ({ fileName, rows, skipped, error }) => {
      if (error) return console.log(chalk.red(`❌ ${fileName}: ${error}`));
      if (skipped) return console.log(chalk.yellow(`⚠️  ${fileName}: vacío, se omite`));
      console.log(chalk.green(`✅ ${fileName}: ${rows} hito(s)`));
    },
  });

  console.log(chalk.blue('\n' + '─'.repeat(46)));
  console.log(chalk.green(`✅ ${result.path}`));
  console.log(chalk.gray(`   ${result.milestones} hito(s) de ${result.sources} archivo(s)`));
  console.log(chalk.gray(`   Columnas: ${result.columns.join(', ')}`));
  console.log(chalk.cyan(`\n   Para publicar a la app: npm run publish:corpus\n`));
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
