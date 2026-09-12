#!/usr/bin/env node

/**
 * publish-corpus.js
 *
 * Publica el corpus de punta a punta: consolida los CSVs, escribe el Markdown
 * que indexa la app, registra la versión y verifica que el índice servido
 * corresponda a lo publicado.
 *
 * Uso:
 *   npm run publish:corpus                  # al proyecto vecino intercorp-adn
 *   npm run publish:corpus -- --out <ruta>   # a una ruta específica
 */

import dotenv from 'dotenv';
import path from 'path';
import chalk from 'chalk';
import { publish, REBUILD_COMMAND } from '../src/corpus/publish.js';
import { APP_CORPUS } from '../src/corpus/publishToApp.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const MERGED_NAME = process.env.MERGED_NAME || 'merged.csv';

function outPath() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  if (i === -1) return APP_CORPUS;
  if (!args[i + 1]) {
    console.error(chalk.red('❌ --out requiere una ruta'));
    process.exit(1);
  }
  return args[i + 1];
}

function reportar({ step, state, result, outPath: destino }) {
  if (state !== 'done') {
    const titulos = { consolidate: '1. Consolidando CSVs...', publish: `2. Publicando en ${destino}...` };
    if (titulos[step]) console.log(chalk.cyan(`\n${titulos[step]}`));
    return;
  }

  if (step === 'consolidate') {
    console.log(chalk.green(`   ✓ ${result.milestones} hito(s) de ${result.sources} archivo(s)`));
    for (const f of result.skipped) console.log(chalk.yellow(`   ⚠️  ${f}: vacío, se omitió`));
    for (const f of result.failed) console.log(chalk.red(`   ❌ ${f.fileName}: ${f.message}`));
  }

  if (step === 'publish') {
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(chalk.green(`   ✓ ${result.milestones} hito(s) de ${result.sources} fuente(s) → ${kb(result.bytes)}`) +
      (result.previousBytes ? chalk.gray(` (antes ${kb(result.previousBytes)})`) : ''));

    const { added, removed, modified, unchanged, sources } = result.entry.changes;
    if (result.entry.previousRowCount === 0) {
      console.log(chalk.green(`   ✓ Primera versión registrada`));
    } else {
      console.log(
        chalk.green(`   ✓ ${result.entry.previousRowCount} → ${result.entry.rowCount} ítem(s)`) +
          chalk.gray(`  (+${added.length} / -${removed.length} / ~${modified.length} / =${unchanged})`)
      );
      if (sources.added.length) console.log(chalk.gray(`   Fuentes nuevas    : ${sources.added.join(', ')}`));
      if (sources.removed.length) console.log(chalk.gray(`   Fuentes eliminadas: ${sources.removed.join(', ')}`));
    }
  }

  if (step === 'verify') {
    console.log(chalk.cyan('\n3. Verificando el índice de la app...'));
    const { state: s, indexed, published } = result;
    if (s === 'current') {
      console.log(chalk.green(`   ✓ El índice tiene ${indexed} hitos: coincide con lo publicado`));
    } else if (s === 'stale') {
      console.log(chalk.red(`   ⚠️  El índice tiene ${indexed} hitos y el corpus ${published}`));
      const muestra = (xs) => xs.slice(0, 5).map((k) => `        · ${k}`).join('\n') +
        (xs.length > 5 ? `\n        … y ${xs.length - 5} más` : '');
      if (result.missing.length) {
        console.log(chalk.red(`   ${result.missing.length} hito(s) publicados que el índice no tiene:`));
        console.log(chalk.gray(muestra(result.missing)));
      }
      if (result.extra.length) {
        console.log(chalk.red(`   ${result.extra.length} hito(s) indexados que ya no están en el corpus:`));
        console.log(chalk.gray(muestra(result.extra)));
      }
      console.log(chalk.yellow(`   La app está sirviendo datos viejos. Para actualizarla:`));
      console.log(chalk.yellow(`     ${REBUILD_COMMAND}`));
    } else if (s === 'missing') {
      console.log(chalk.yellow(`   ⚠️  No se encontró el índice en ${result.path}`));
    } else {
      console.log(chalk.yellow(`   ⚠️  No se pudo leer el índice en ${result.path}`));
    }
  }
}

async function main() {
  console.log(chalk.blue.bold('\n📦 Publicar el corpus\n'));
  console.log(chalk.gray(`   Origen : ${path.join(OUTPUT_DIR, MERGED_NAME)}`));

  const { index } = await publish({
    outputDir: OUTPUT_DIR,
    mergedName: MERGED_NAME,
    corpusPath: outPath(),
    onStep: reportar,
  });

  console.log(chalk.blue('\n' + '─'.repeat(52)));
  if (index.state === 'stale') {
    console.log(chalk.yellow.bold('⚠️  Corpus publicado, pero el índice de la app quedó atrás'));
  } else {
    console.log(chalk.green.bold('✅ Corpus publicado'));
  }
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
