#!/usr/bin/env node

import { run } from './cli/interactive.js';

// Parsear argumentos: --pdf <ruta> y --force
const args = process.argv.slice(2);
const pdfFlagIndex = args.indexOf('--pdf');
const pdfArg = pdfFlagIndex !== -1 ? args[pdfFlagIndex + 1] : undefined;
// --force reprocesa los documentos ya registrados sin preguntar. Es la vía
// oficial para regenerar un documento cuando cambian las reglas del prompt.
const force = args.includes('--force');

// Ejecutar la CLI interactiva
run({ pdfArg, force }).catch((error) => {
  console.error('Error fatal:', error.message);
  process.exit(1);
});
