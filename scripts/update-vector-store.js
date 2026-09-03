#!/usr/bin/env node

/**
 * update-vector-store.js
 *
 * Reemplaza todos los archivos del vector store de OpenAI con el contenido
 * de output/merged.csv.
 *
 * Nota: el file_search de OpenAI no acepta archivos .csv, por lo que el CSV
 * se convierte a Markdown (una sección por fila) antes de subirlo. Ese formato
 * además se divide en chunks más limpios para la búsqueda semántica.
 *
 * Flujo:
 *   1. Convierte output/merged.csv a Markdown
 *   2. Sube el Markdown y lo asocia al vector store
 *   3. Espera a que termine de procesarse
 *   4. Recién entonces elimina los archivos anteriores del store
 *
 * Uso:
 *   npm run update:vector
 *
 * Variables de entorno requeridas:
 *   OPENAI_API_KEY       - API key de OpenAI
 *
 * Variables opcionales (o editar los defaults abajo):
 *   VECTOR_STORE_ID      - ID del vector store (default: el de Intercorp ADN)
 *   PROMPT_ID            - ID del prompt a publicar (default: el de Intercorp ADN)
 *   OUTPUT_DIR           - Carpeta de salida (default: ./output)
 *   MERGED_NAME          - Nombre del CSV a subir (default: merged.csv)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import OpenAI from 'openai';
import * as csvService from '../src/services/csvService.js';
import { recordVersion } from '../src/services/historyService.js';

dotenv.config();

const VECTOR_STORE_ID =
  process.env.VECTOR_STORE_ID;

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const MERGED_NAME = process.env.MERGED_NAME || 'merged.csv';
const MERGED_PATH = path.join(OUTPUT_DIR, MERGED_NAME);

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

if (!process.env.OPENAI_API_KEY) {
  console.error(chalk.red('❌ OPENAI_API_KEY no está definida en el archivo .env'));
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convierte el CSV combinado a un Markdown con una sección por fila.
 * El file_search de OpenAI no soporta .csv y este formato se divide
 * en chunks más coherentes para la búsqueda semántica.
 * @param {string} csvPath - Ruta del merged.csv
 * @returns {Promise<{filePath: string, rowCount: number}>} Ruta del .md temporal
 */
async function csvToMarkdown(csvPath) {
  const rows = await csvService.read(csvPath);

  if (rows.length === 0) {
    throw new Error(`${csvPath} no contiene filas`);
  }

  const sections = rows.map((row, index) => {
    const title = row.title && row.title !== 'N/A' ? row.title : `Ítem ${index + 1}`;
    const fields = Object.entries(row)
      .filter(([key, value]) => key !== 'title' && value && value !== 'N/A')
      .map(([key, value]) => `- **${key}**: ${String(value).replace(/\s+/g, ' ').trim()}`);

    return `## ${title}\n${fields.join('\n')}`;
  });

  const markdown = `# Base de conocimiento Intercorp ADN\n\n${sections.join('\n\n')}\n`;
  const mdPath = path.join(os.tmpdir(), `${path.basename(csvPath, '.csv')}.md`);
  fs.writeFileSync(mdPath, markdown, 'utf-8');

  return { filePath: mdPath, rowCount: rows.length, bytes: Buffer.byteLength(markdown) };
}


// ─── Listar archivos actuales del vector store ────────────────────────────────

async function listVectorStoreFiles(vectorStoreId) {
  const fileIds = [];
  for await (const file of openai.vectorStores.files.list(vectorStoreId)) {
    fileIds.push(file.id);
  }
  return fileIds;
}

// ─── Paso 3 (final): Eliminar los archivos anteriores ─────────────────────────

async function deleteFiles(vectorStoreId, fileIds) {
  console.log(chalk.cyan('\n4. Eliminando archivos anteriores...'));

  if (fileIds.length === 0) {
    console.log(chalk.gray('   (sin archivos previos)'));
    return;
  }

  for (const fileId of fileIds) {
    await openai.vectorStores.files.del(vectorStoreId, fileId);
    await openai.files.del(fileId);
    console.log(chalk.gray(`   ✓ Eliminado: ${fileId}`));
  }

  console.log(chalk.green(`   ${fileIds.length} archivo(s) eliminado(s)`));
}

// ─── Paso 2: Subir el Markdown ────────────────────────────────────────────────

async function uploadMarkdown(mdPath) {
  const fileName = path.basename(mdPath);
  console.log(chalk.cyan(`\n2. Subiendo ${fileName}...`));

  const fileStream = fs.createReadStream(mdPath);

  const uploaded = await openai.files.create({
    file: fileStream,
    purpose: 'assistants',
  });

  console.log(chalk.green(`   ✓ Subido: ${fileName} → ${uploaded.id}`));
  return uploaded.id;
}

// ─── Paso 3: Asociar al vector store y esperar procesamiento ──────────────────

async function addToVectorStore(vectorStoreId, fileId) {
  console.log(chalk.cyan('\n3. Asociando al vector store...'));

  await openai.vectorStores.files.create(vectorStoreId, { file_id: fileId });

  // Esperar a que el archivo esté procesado
  const start = Date.now();
  process.stdout.write(chalk.yellow('   Procesando'));

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const status = await openai.vectorStores.files.retrieve(vectorStoreId, fileId);

    if (status.status === 'completed') {
      process.stdout.write('\n');
      console.log(chalk.green('   ✓ Archivo procesado y listo'));
      return;
    }
    if (status.status === 'failed') {
      process.stdout.write('\n');
      throw new Error(`El archivo falló al procesarse: ${JSON.stringify(status.last_error)}`);
    }
    process.stdout.write(chalk.yellow('.'));
  }

  process.stdout.write('\n');
  throw new Error('Timeout esperando el procesamiento del archivo en el vector store');
}

// ─── Paso 5: Registrar la versión en el historial ─────────────────────────────

async function saveHistory({ fileId, fileName, bytes }) {
  console.log(chalk.cyan('\n5. Registrando versión en el historial...'));

  const entry = await recordVersion({ csvPath: MERGED_PATH, fileId, fileName, bytes });
  const { added, removed, modified, unchanged, sources } = entry.changes;

  if (entry.previousRowCount === 0) {
    console.log(chalk.green(`   ✓ Primera versión registrada: ${entry.rowCount} ítem(s)`));
  } else {
    console.log(
      chalk.green(`   ✓ ${entry.previousRowCount} → ${entry.rowCount} ítem(s)`) +
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

  console.log(chalk.gray(`   Snapshot: ${entry.snapshot}`));
  console.log(chalk.gray(`   Historial completo: npm run history`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(chalk.blue.bold('\n🔄 Actualizar Vector Store\n'));
  console.log(chalk.gray(`   Vector store : ${VECTOR_STORE_ID}`));
  console.log(chalk.gray(`   CSV          : ${MERGED_PATH}`));

  // Verificar que merged.csv existe
  if (!fs.existsSync(MERGED_PATH)) {
    console.error(chalk.red(`\n❌ No se encontró: ${MERGED_PATH}`));
    console.error(chalk.yellow('   Ejecuta primero: npm run merge:csv'));
    process.exit(1);
  }

  const stats = fs.statSync(MERGED_PATH);
  console.log(chalk.gray(`   Tamaño       : ${(stats.size / 1024).toFixed(1)} KB`));

  // Guardar los archivos actuales para eliminarlos recién al final:
  // así el store nunca queda vacío si algo falla a mitad de camino.
  const previousFileIds = await listVectorStoreFiles(VECTOR_STORE_ID);

  console.log(chalk.cyan('\n1. Convirtiendo CSV a Markdown...'));
  const { filePath: mdPath, rowCount, bytes } = await csvToMarkdown(MERGED_PATH);
  console.log(chalk.green(`   ✓ ${rowCount} fila(s) → ${path.basename(mdPath)}`));

  const fileId = await uploadMarkdown(mdPath);

  try {
    await addToVectorStore(VECTOR_STORE_ID, fileId);
  } catch (err) {
    // El archivo quedó subido pero sin asociar: eliminarlo para no dejar basura
    await openai.files.del(fileId).catch(() => {});
    throw err;
  }

  await deleteFiles(VECTOR_STORE_ID, previousFileIds);
  fs.rmSync(mdPath, { force: true });

  await saveHistory({ fileId, fileName: path.basename(mdPath), bytes });

  console.log(chalk.blue('\n' + '─'.repeat(50)));
  console.log(chalk.green.bold('✅ Vector store actualizado — el chat ya usa el nuevo contenido'));
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
