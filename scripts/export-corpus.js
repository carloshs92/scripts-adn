#!/usr/bin/env node

/**
 * export-corpus.js
 *
 * Exporta output/merged.csv como un único Markdown con el formato que espera
 * `parseMarkdown()` de scripts/build-graph.mjs en el proyecto intercorp-adn.
 *
 * Ese corpus (data/milestones.md) es la entrada del índice de búsqueda rápida
 * de la app. Antes se exportaba a mano desde el vector store de OpenAI, y por
 * eso quedaba desactualizado sin que nadie se enterara: este comando lo
 * regenera desde la misma fuente de verdad que el resto del pipeline.
 *
 * Uso:
 *   npm run export:corpus                      # a output/milestones.md
 *   npm run export:corpus -- --out <ruta>      # a una ruta específica
 *   npm run export:corpus -- --app             # a ../intercorp-adn/data/milestones.md
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import * as csvService from '../src/services/csvService.js';
import { buildCorpusMarkdown, groupBySource } from '../src/services/markdownService.js';
import { recordVersion } from '../src/services/historyService.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const MERGED_NAME = process.env.MERGED_NAME || 'merged.csv';
const MERGED_PATH = path.join(OUTPUT_DIR, MERGED_NAME);

// Ruta del corpus en el proyecto de la app, que vive al mismo nivel
const APP_CORPUS = '../intercorp-adn/data/milestones.md';

function resolveOutPath() {
  const args = process.argv.slice(2);

  if (args.includes('--app')) return APP_CORPUS;

  const outIdx = args.indexOf('--out');
  if (outIdx !== -1) {
    const value = args[outIdx + 1];
    if (!value) {
      console.error(chalk.red('❌ --out requiere una ruta'));
      process.exit(1);
    }
    return value;
  }

  return path.join(OUTPUT_DIR, 'milestones.md');
}

/**
 * Registra la versión publicada y muestra qué cambió desde la anterior.
 * El historial colgaba de la subida al vector store; al retirarse esa vía,
 * el export del corpus pasa a ser el hito que vale la pena versionar.
 * @param {string} outPath - Dónde se escribió el corpus
 * @param {number} bytes - Tamaño del Markdown generado
 */
async function saveHistory(outPath, bytes) {
  const entry = await recordVersion({ csvPath: MERGED_PATH, target: outPath, bytes });
  const { added, removed, modified, unchanged, sources } = entry.changes;

  if (entry.previousRowCount === 0) {
    console.log(chalk.green(`\n   ✓ Primera versión registrada: ${entry.rowCount} ítem(s)`));
  } else {
    console.log(
      chalk.green(`\n   ✓ ${entry.previousRowCount} → ${entry.rowCount} ítem(s)`) +
        chalk.gray(
          `  (+${added.length} nuevos, -${removed.length} eliminados, ` +
            `~${modified.length} modificados, ${unchanged} sin cambios)`
        )
    );
    if (sources.added.length > 0) {
      console.log(chalk.gray(`   Fuentes nuevas    : ${sources.added.join(', ')}`));
    }
    if (sources.removed.length > 0) {
      console.log(chalk.gray(`   Fuentes eliminadas: ${sources.removed.join(', ')}`));
    }
  }

  console.log(chalk.gray(`   Historial completo: npm run history`));
}

async function main() {
  console.log(chalk.blue.bold('\n📝 Exportar corpus a Markdown\n'));

  if (!fs.existsSync(MERGED_PATH)) {
    console.error(chalk.red(`❌ No se encontró: ${MERGED_PATH}`));
    console.error(chalk.yellow('   Ejecuta primero: npm run merge:csv'));
    process.exit(1);
  }

  const rows = await csvService.read(MERGED_PATH);
  if (rows.length === 0) {
    console.error(chalk.red(`❌ ${MERGED_PATH} no contiene filas`));
    process.exit(1);
  }

  const outPath = resolveOutPath();
  const outDir = path.dirname(outPath);

  if (!fs.existsSync(outDir)) {
    console.error(chalk.red(`❌ No existe el directorio destino: ${outDir}`));
    process.exit(1);
  }

  const markdown = buildCorpusMarkdown(rows);
  const previousSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  fs.writeFileSync(outPath, markdown, 'utf-8');

  console.log(chalk.gray(`   Origen  : ${MERGED_PATH}`));
  console.log(chalk.gray(`   Destino : ${outPath}`));
  console.log(chalk.green(`   ✓ ${rows.length} hito(s) de ${groupBySource(rows).size} fuente(s)`));
  console.log(
    chalk.gray(
      `   Tamaño  : ${(markdown.length / 1024).toFixed(1)} KB` +
        (previousSize ? ` (antes ${(previousSize / 1024).toFixed(1)} KB)` : '')
    )
  );

  await saveHistory(outPath, Buffer.byteLength(markdown));

  console.log(chalk.cyan('\n   Luego, en intercorp-adn: node scripts/build-graph.mjs\n'));
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
