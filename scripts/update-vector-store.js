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
import { groupBySource, buildSourceMarkdown } from '../src/services/markdownService.js';
import { recordVersion, loadHistory } from '../src/services/historyService.js';

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
 * Convierte un nombre de fuente en un nombre de archivo seguro
 * @param {string} source - Valor de source_file (ej: "sip.pe", "Reporte 2024.pdf")
 * @returns {string}
 */
function toFileName(source) {
  const base = source.replace(/\.(pdf|xlsx?|xlsm|csv)$/i, '');
  return `${base.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80)}.md`;
}

/**
 * Convierte el CSV combinado en un Markdown POR FUENTE.
 *
 * Un único archivo grande hacía que cada chunk mezclara ítems de empresas
 * distintas (el chunk con "Qué es Sip" empezaba con un ítem de UTP), y el
 * embedding resultante era un promedio de temas inconexos. Con un archivo por
 * documento de origen, cada chunk contiene solo ítems de esa misma fuente.
 *
 * @param {string} csvPath - Ruta del merged.csv
 * @returns {Promise<{files: Array<{filePath, source, rowCount}>, rowCount: number, bytes: number}>}
 */
async function csvToMarkdown(csvPath) {
  const rows = await csvService.read(csvPath);

  if (rows.length === 0) {
    throw new Error(`${csvPath} no contiene filas`);
  }

  const bySource = groupBySource(rows);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-store-'));
  const files = [];
  let bytes = 0;

  for (const [source, sourceRows] of bySource) {
    const markdown = buildSourceMarkdown(source, sourceRows);
    const filePath = path.join(outputDir, toFileName(source));

    fs.writeFileSync(filePath, markdown, 'utf-8');
    bytes += Buffer.byteLength(markdown);
    files.push({ filePath, source, rowCount: sourceRows.length });
  }

  return { files, dir: outputDir, rowCount: rows.length, bytes };
}


// ─── Determinar qué archivos había antes ──────────────────────────────────────

/**
 * Lista los archivos del vector store. El endpoint de OpenAI es incompleto
 * (puede devolver menos archivos de los que reporta file_counts), así que se
 * usa solo como complemento del historial.
 * @param {string} vectorStoreId
 * @returns {Promise<Array<string>>}
 */
async function listVectorStoreFiles(vectorStoreId) {
  const fileIds = [];
  try {
    for await (const file of openai.vectorStores.files.list(vectorStoreId, { limit: 100 })) {
      fileIds.push(file.id);
    }
  } catch (err) {
    logWarn(`No se pudo listar el vector store: ${err.message}`);
  }
  return fileIds;
}

/**
 * IDs registrados en la última versión del historial. Es la fuente confiable:
 * el listado del API puede omitir archivos recién asociados.
 * @returns {Array<string>}
 */
function previousFileIdsFromHistory() {
  const entries = loadHistory();
  const last = entries[entries.length - 1];
  if (!last) return [];
  return last.fileIds || (last.fileId ? [last.fileId] : []);
}

function logWarn(message) {
  console.log(chalk.yellow(`   ⚠️  ${message}`));
}

// ─── Paso 3 (final): Eliminar los archivos anteriores ─────────────────────────

async function deleteFiles(vectorStoreId, fileIds) {
  console.log(chalk.cyan('\n4. Eliminando archivos anteriores...'));

  if (fileIds.length === 0) {
    console.log(chalk.gray('   (sin archivos previos)'));
    return;
  }

  let deleted = 0;
  for (const fileId of fileIds) {
    // Un archivo puede ya no existir (borrado manual, corrida previa a medias)
    await openai.vectorStores.files.del(vectorStoreId, fileId).catch(() => {});
    const ok = await openai.files.del(fileId).then(() => true).catch(() => false);
    if (ok) deleted++;
    console.log(chalk.gray(`   ✓ Eliminado: ${fileId}`));
  }

  console.log(chalk.green(`   ${deleted} archivo(s) eliminado(s)`));
}

// ─── Paso 2: Subir los Markdown ───────────────────────────────────────────────

async function uploadMarkdownFiles(files) {
  console.log(chalk.cyan(`\n2. Subiendo ${files.length} archivo(s)...`));

  const fileIds = [];

  for (const { filePath, source, rowCount } of files) {
    const uploaded = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: 'assistants',
    });

    fileIds.push(uploaded.id);
    console.log(chalk.gray(`   ✓ ${source} (${rowCount} ítem(s)) → ${uploaded.id}`));
  }

  console.log(chalk.green(`   ${fileIds.length} archivo(s) subido(s)`));
  return fileIds;
}

// ─── Paso 3: Asociar al vector store y esperar procesamiento ──────────────────

async function addToVectorStore(vectorStoreId, fileIds) {
  console.log(chalk.cyan('\n3. Asociando al vector store...'));

  // Chunks chicos para que cada uno cubra pocos ítems de una misma fuente.
  // Con el chunking por defecto (800 tokens) un chunk mezclaba ítems de varias
  // empresas y su embedding dejaba de representar a ninguna.
  const batch = await openai.vectorStores.fileBatches.create(vectorStoreId, {
    file_ids: fileIds,
    chunking_strategy: {
      type: 'static',
      static: { max_chunk_size_tokens: 400, chunk_overlap_tokens: 100 },
    },
  });

  const start = Date.now();
  process.stdout.write(chalk.yellow('   Procesando'));

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const status = await openai.vectorStores.fileBatches.retrieve(vectorStoreId, batch.id);

    if (status.status === 'completed') {
      process.stdout.write('\n');
      console.log(chalk.green(`   ✓ ${status.file_counts.completed} archivo(s) procesado(s)`));
      return;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      process.stdout.write('\n');
      throw new Error(
        `El lote falló al procesarse: ${JSON.stringify(status.file_counts)}`
      );
    }
    process.stdout.write(chalk.yellow('.'));
  }

  process.stdout.write('\n');
  throw new Error('Timeout esperando el procesamiento del lote en el vector store');
}

// ─── Paso 5: Registrar la versión en el historial ─────────────────────────────

async function saveHistory({ fileIds, fileName, bytes }) {
  console.log(chalk.cyan('\n5. Registrando versión en el historial...'));

  const entry = await recordVersion({ csvPath: MERGED_PATH, fileIds, fileName, bytes });
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
  const previousFileIds = [
    ...new Set([...previousFileIdsFromHistory(), ...(await listVectorStoreFiles(VECTOR_STORE_ID))]),
  ];

  console.log(chalk.cyan('\n1. Convirtiendo CSV a Markdown (uno por fuente)...'));
  const { files, dir, rowCount, bytes } = await csvToMarkdown(MERGED_PATH);
  console.log(chalk.green(`   ✓ ${rowCount} fila(s) → ${files.length} archivo(s)`));

  const fileIds = await uploadMarkdownFiles(files);

  try {
    await addToVectorStore(VECTOR_STORE_ID, fileIds);
  } catch (err) {
    // Los archivos quedaron subidos pero sin asociar: eliminarlos para no dejar basura
    await Promise.all(fileIds.map((id) => openai.files.del(id).catch(() => {})));
    throw err;
  }

  // Nunca borrar los que se acaban de subir
  await deleteFiles(
    VECTOR_STORE_ID,
    previousFileIds.filter((id) => !fileIds.includes(id))
  );
  fs.rmSync(dir, { recursive: true, force: true });

  await saveHistory({ fileIds, fileName: `${files.length} archivo(s) por fuente`, bytes });

  console.log(chalk.blue('\n' + '─'.repeat(50)));
  console.log(chalk.green.bold('✅ Vector store actualizado — el chat ya usa el nuevo contenido'));
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
