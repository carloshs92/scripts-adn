import fs from 'fs';
import path from 'path';
import * as csvService from './csvService.js';
import { config } from '../config.js';

const HISTORY_DIR = config.paths.historyDir;
const SNAPSHOTS_DIR = path.join(HISTORY_DIR, 'snapshots');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');

/**
 * Clave única de una fila: un mismo ítem se identifica por su documento
 * de origen más su título.
 * @param {Object} row - Fila del CSV
 * @returns {string}
 */
function rowKey(row) {
  return `${row.source_file || 'N/A'}::${row.title || 'N/A'}`;
}

/**
 * Campos que cambiaron entre dos versiones de la misma fila
 * @param {Object} before
 * @param {Object} after
 * @returns {Array<string>} Nombres de los campos distintos
 */
function changedFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => (before[key] || '') !== (after[key] || ''));
}

/**
 * Compara dos conjuntos de filas y resume qué cambió
 * @param {Array<Object>} previous - Filas de la corrida anterior
 * @param {Array<Object>} current - Filas actuales
 * @returns {Object} Resumen de cambios
 */
export function diffRows(previous, current) {
  const prevMap = new Map(previous.map((row) => [rowKey(row), row]));
  const currMap = new Map(current.map((row) => [rowKey(row), row]));

  const added = [];
  const removed = [];
  const modified = [];
  let unchanged = 0;

  for (const [key, row] of currMap) {
    const before = prevMap.get(key);

    if (!before) {
      added.push({ title: row.title, company: row.company, source_file: row.source_file });
      continue;
    }

    const fields = changedFields(before, row);
    if (fields.length > 0) {
      modified.push({ title: row.title, source_file: row.source_file, fields });
    } else {
      unchanged++;
    }
  }

  for (const [key, row] of prevMap) {
    if (!currMap.has(key)) {
      removed.push({ title: row.title, company: row.company, source_file: row.source_file });
    }
  }

  const prevSources = new Set(previous.map((r) => r.source_file));
  const currSources = new Set(current.map((r) => r.source_file));

  return {
    added,
    removed,
    modified,
    unchanged,
    sources: {
      total: currSources.size,
      added: [...currSources].filter((s) => !prevSources.has(s)),
      removed: [...prevSources].filter((s) => !currSources.has(s)),
    },
  };
}

/**
 * Lee el historial completo (más antiguo primero)
 * @returns {Array<Object>} Entradas del historial
 */
export function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Filas del último snapshot registrado
 * @returns {Promise<Array<Object>>} Filas anteriores (vacío si no hay historial)
 */
export async function loadLastSnapshotRows() {
  const entries = loadHistory();
  if (entries.length === 0) return [];

  const last = entries[entries.length - 1];
  if (!last.snapshot || !fs.existsSync(last.snapshot)) return [];

  return csvService.read(last.snapshot);
}

/**
 * Registra una nueva versión: guarda el CSV como snapshot y anota en el
 * historial qué cambió respecto de la versión anterior.
 * @param {Object} params
 * @param {string} params.csvPath - CSV que se subió al vector store
 * @param {Array<string>} params.fileIds - IDs de los archivos en OpenAI
 * @param {string} params.fileName - Descripción de lo subido
 * @param {number} params.bytes - Tamaño del contenido subido
 * @returns {Promise<Object>} Entrada creada
 */
export async function recordVersion({ csvPath, fileIds, fileName, bytes }) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const previousRows = await loadLastSnapshotRows();
  const currentRows = await csvService.read(csvPath);
  const changes = diffRows(previousRows, currentRows);

  const timestamp = new Date().toISOString();
  const snapshotName = `${timestamp.replace(/[:.]/g, '-')}-${path.basename(csvPath)}`;
  const snapshotPath = path.join(SNAPSHOTS_DIR, snapshotName);
  fs.copyFileSync(csvPath, snapshotPath);

  const entry = {
    timestamp,
    fileIds,
    fileName,
    bytes,
    rowCount: currentRows.length,
    previousRowCount: previousRows.length,
    snapshot: snapshotPath,
    changes,
  };

  const entries = loadHistory();
  entries.push(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf-8');

  return entry;
}

export default { diffRows, loadHistory, loadLastSnapshotRows, recordVersion };
