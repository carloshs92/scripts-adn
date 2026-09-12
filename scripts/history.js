#!/usr/bin/env node

/**
 * history.js
 *
 * Muestra el historial de versiones del corpus: cuándo se publicó, cuántos
 * ítems tenía y qué cambió respecto de la versión anterior.
 *
 * Uso:
 *   npm run history                 # Resumen de todas las versiones
 *   npm run history -- --detail     # Incluye el detalle de ítems por versión
 *   npm run history -- --last       # Solo la última versión (con detalle)
 */

import chalk from 'chalk';
import { loadHistory } from '../src/services/historyService.js';

const args = process.argv.slice(2);
const showDetail = args.includes('--detail') || args.includes('--last');
const onlyLast = args.includes('--last');

/**
 * Formatea una fecha ISO como "31/08/2026 16:41"
 * @param {string} isoDate
 * @returns {string}
 */
function formatDate(isoDate) {
  const d = new Date(isoDate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Imprime el detalle de ítems agregados, eliminados y modificados
 * @param {Object} changes
 */
function printDetail(changes) {
  const sections = [
    { label: 'Nuevos', items: changes.added, color: chalk.green, symbol: '+' },
    { label: 'Eliminados', items: changes.removed, color: chalk.red, symbol: '-' },
    { label: 'Modificados', items: changes.modified, color: chalk.yellow, symbol: '~' },
  ];

  for (const { label, items, color, symbol } of sections) {
    if (items.length === 0) continue;

    console.log(color(`\n   ${label} (${items.length}):`));
    for (const item of items) {
      const extra = item.fields ? chalk.gray(` [${item.fields.join(', ')}]`) : '';
      console.log(`     ${color(symbol)} ${item.title} ${chalk.gray(`— ${item.source_file}`)}${extra}`);
    }
  }
}

function main() {
  const entries = loadHistory();

  console.log(chalk.blue.bold('\n📜 Historial del corpus\n'));

  if (entries.length === 0) {
    console.log(chalk.yellow('   Todavía no hay versiones registradas.'));
    console.log(chalk.gray('   Ejecuta: npm run export:corpus\n'));
    return;
  }

  const toShow = onlyLast ? entries.slice(-1) : entries;

  for (const [index, entry] of toShow.entries()) {
    const version = onlyLast ? entries.length : index + 1;
    const { added, removed, modified, unchanged, sources } = entry.changes;

    console.log(chalk.blue(`v${version} — ${formatDate(entry.timestamp)}`));
    console.log(chalk.gray(`   Publicado: ${entry.target ?? entry.fileName ?? 'corpus'}`));
    console.log(chalk.gray(`   Ítems    : ${entry.rowCount}` +
      (entry.previousRowCount > 0 ? ` (antes ${entry.previousRowCount})` : ' — primera versión')));
    console.log(chalk.gray(`   Fuentes  : ${sources.total}`));

    if (entry.previousRowCount > 0) {
      console.log(
        `   Cambios  : ${chalk.green(`+${added.length}`)} / ` +
          `${chalk.red(`-${removed.length}`)} / ` +
          `${chalk.yellow(`~${modified.length}`)} / ` +
          `${chalk.gray(`=${unchanged}`)}`
      );

      if (sources.added.length > 0) {
        console.log(chalk.green(`   Fuentes nuevas    : ${sources.added.join(', ')}`));
      }
      if (sources.removed.length > 0) {
        console.log(chalk.red(`   Fuentes eliminadas: ${sources.removed.join(', ')}`));
      }
    }

    console.log(chalk.gray(`   Snapshot : ${entry.snapshot}`));

    if (showDetail) {
      printDetail(entry.changes);
    }

    console.log('');
  }

  if (!showDetail) {
    console.log(chalk.gray('   Detalle de ítems: npm run history -- --detail\n'));
  }
}

main();
