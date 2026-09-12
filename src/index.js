#!/usr/bin/env node

import { run } from './cli/interactive.js';

// Parsear argumento --pdf <ruta>
const args = process.argv.slice(2);
const pdfFlagIndex = args.indexOf('--pdf');
const pdfArg = pdfFlagIndex !== -1 ? args[pdfFlagIndex + 1] : undefined;

// Ejecutar la CLI interactiva
run({ pdfArg }).catch((error) => {
  console.error('Error fatal:', error.message);
  process.exit(1);
});
