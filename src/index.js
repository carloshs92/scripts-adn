#!/usr/bin/env node

import { run } from './cli/interactive.js';

// Ejecutar la CLI interactiva
run().catch((error) => {
  console.error('Error fatal:', error.message);
  process.exit(1);
});
