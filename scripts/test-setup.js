/**
 * test-setup.js
 * 
 * Script para verificar que la instalación está correcta
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

async function verificarInstalacion() {
  console.log(chalk.blue.bold('\n🔍 Verificando instalación...\n'));

  let todoOk = true;

  // Verificar archivos principales
  const archivos = [
    { archivo: 'src/index.js', descripcion: 'Script principal' },
    { archivo: 'src/config.js', descripcion: 'Configuración' },
    { archivo: 'src/services/pdfService.js', descripcion: 'Servicio de PDF' },
    { archivo: 'src/services/xlsxService.js', descripcion: 'Servicio de Excel' },
    { archivo: 'src/services/dataService.js', descripcion: 'Servicio de datos' },
    { archivo: 'src/services/csvService.js', descripcion: 'Servicio de CSV' },
    { archivo: 'src/cli/interactive.js', descripcion: 'CLI interactiva' },
    { archivo: 'package.json', descripcion: 'Dependencias' },
  ];

  console.log(chalk.cyan('📁 Archivos principales:'));
  for (const { archivo, descripcion } of archivos) {
    const existe = fs.existsSync(archivo);
    const icon = existe ? '✅' : '❌';
    const color = existe ? chalk.green : chalk.red;
    console.log(`  ${icon} ${color(archivo)} - ${descripcion}`);
    if (!existe) todoOk = false;
  }
  console.log('');

  // Verificar directorios
  const directorios = ['pdfs', 'output', 'src'];
  console.log(chalk.cyan('📂 Directorios:'));
  for (const dir of directorios) {
    const existe = fs.existsSync(dir);
    const icon = existe ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${dir}`);
  }
  console.log('');

  // Verificar .env
  console.log(chalk.cyan('🔑 Configuración:'));
  const envExiste = fs.existsSync('.env');
  const envExampleExiste = fs.existsSync('.env.example');

  if (envExiste) {
    console.log('  ✅ Archivo .env encontrado');
    const envContent = fs.readFileSync('.env', 'utf-8');
    const tieneKey = (nombre) => new RegExp(`^${nombre}=\\s*\\S+`, 'm').test(envContent);

    // La extracción corre sobre el proveedor que indique LLM_PROVIDER
    if (tieneKey('OPENROUTER_API_KEY')) {
      console.log('  ✅ OPENROUTER_API_KEY configurada');
    }
    if (tieneKey('OPENAI_API_KEY')) {
      console.log('  ✅ OPENAI_API_KEY configurada (alternativa)');
    }
    if (!tieneKey('OPENROUTER_API_KEY') && !tieneKey('OPENAI_API_KEY')) {
      console.log('  ⚠️  Sin key de LLM: define OPENROUTER_API_KEY u OPENAI_API_KEY');
      console.log('     Edita .env y añade tu API key');
    }
  } else {
    console.log('  ⚠️  Archivo .env no encontrado');
    console.log('     Ejecuta: cp .env.example .env');
    if (envExampleExiste) {
      console.log('  ✅ Archivo .env.example encontrado');
    }
  }
  console.log('');

  // Verificar node_modules
  console.log(chalk.cyan('📦 Dependencias:'));
  if (fs.existsSync('node_modules')) {
    console.log('  ✅ node_modules encontrado');
    const requiredModules = [
      'langchain',
      '@langchain/openai',
      'pdf-parse',
      'csv-writer',
    ];
    for (const mod of requiredModules) {
      const modPath = path.join('node_modules', mod);
      if (fs.existsSync(modPath)) {
        console.log(`  ✅ ${mod}`);
      } else {
        console.log(`  ❌ ${mod} - Ejecuta: npm install`);
        todoOk = false;
      }
    }
  } else {
    console.log('  ❌ node_modules no encontrado');
    console.log('     Ejecuta: npm install');
    todoOk = false;
  }
  console.log('');

  // Resultado final
  if (todoOk) {
    console.log(chalk.green.bold('✅ ¡Todo está listo!'));
    console.log(chalk.green('\nPuedes ejecutar: npm start\n'));
  } else {
    console.log(chalk.yellow.bold('⚠️  Hay algunos problemas que resolver'));
    console.log(chalk.yellow('\nSigue los pasos indicados arriba\n'));
  }
}

verificarInstalacion().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
});
