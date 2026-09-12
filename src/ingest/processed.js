import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = '.pdf-registry.json';

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

function fingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}-${stat.mtimeMs}`;
}

export function isProcessed(filePath) {
  const registry = loadRegistry();
  const key = path.resolve(filePath);
  const entry = registry[key];
  if (!entry) return false;
  return entry.fingerprint === fingerprint(filePath);
}

export function markProcessed(filePaths) {
  const registry = loadRegistry();
  for (const filePath of filePaths) {
    const key = path.resolve(filePath);
    registry[key] = {
      fingerprint: fingerprint(filePath),
      fileName: path.basename(filePath),
      processedAt: new Date().toISOString(),
    };
  }
  saveRegistry(registry);
}

export function filterUnprocessed(filePaths) {
  const unprocessed = [];
  const alreadyProcessed = [];
  for (const filePath of filePaths) {
    if (isProcessed(filePath)) {
      alreadyProcessed.push(filePath);
    } else {
      unprocessed.push(filePath);
    }
  }
  return { unprocessed, alreadyProcessed };
}

export default { isProcessed, markProcessed, filterUnprocessed };
