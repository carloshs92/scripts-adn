#!/usr/bin/env node

/**
 * update-vector-store.js
 *
 * Reemplaza todos los archivos del vector store de OpenAI con el merged.csv
 * y publica una nueva versión del prompt asociado.
 *
 * Flujo:
 *   1. Elimina todos los archivos actuales del vector store
 *   2. Sube output/merged.csv como nuevo archivo
 *   3. Lo asocia al vector store y espera a que procese
 *   4. Publica una nueva versión del prompt
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
import path from 'path';
import chalk from 'chalk';
import OpenAI from 'openai';

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


// ─── Paso 1: Limpiar vector store ─────────────────────────────────────────────

async function clearVectorStore(vectorStoreId) {
  console.log(chalk.cyan('\n1. Limpiando vector store...'));

  const filesToDelete = [];
  for await (const file of openai.vectorStores.files.list(vectorStoreId)) {
    filesToDelete.push(file.id);
  }

  if (filesToDelete.length === 0) {
    console.log(chalk.gray('   (sin archivos previos)'));
    return;
  }

  for (const fileId of filesToDelete) {
    await openai.vectorStores.files.del(vectorStoreId, fileId);
    await openai.files.del(fileId);
    console.log(chalk.gray(`   ✓ Eliminado: ${fileId}`));
  }

  console.log(chalk.green(`   ${filesToDelete.length} archivo(s) eliminado(s)`));
}

// ─── Paso 2: Subir merged.csv ─────────────────────────────────────────────────

async function uploadCSV(csvPath) {
  console.log(chalk.cyan('\n2. Subiendo merged.csv...'));

  const fileName = path.basename(csvPath);
  const fileStream = fs.createReadStream(csvPath);

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

  await clearVectorStore(VECTOR_STORE_ID);
  const fileId = await uploadCSV(MERGED_PATH);
  await addToVectorStore(VECTOR_STORE_ID, fileId);

  console.log(chalk.blue('\n' + '─'.repeat(50)));
  console.log(chalk.green.bold('✅ Vector store actualizado — el chat ya usa el nuevo contenido'));
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err.message);
  process.exit(1);
});
