#!/usr/bin/env node

/**
 * scrape-web.js
 *
 * Scraping inteligente de sitios web usando LangChain + OpenAI.
 * Por cada URL scrapea la página principal y subpáginas de contenido relevante
 * (blogs, noticias, prensa), extrae ítems estructurados y genera un CSV individual
 * en output/ siguiendo el mismo formato que el procesador de PDFs.
 *
 * Uso:
 *   npm run scrape:web                        # Procesa todas las categorías
 *   npm run scrape:web -- --category financial # Solo la categoría indicada
 *
 * Variables de entorno requeridas:
 *   OPENAI_API_KEY  - API key de OpenAI
 *
 * Variables opcionales:
 *   OPENAI_MODEL    - Modelo a usar (default: gpt-4o-mini)
 *   OUTPUT_DIR      - Carpeta de salida (default: ./output)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { scrapeWebsite, getDomain } from '../src/services/webScraperService.js';
import { extractDataFromWeb, COLUMNS } from '../src/services/webDataService.js';
import * as csvService from '../src/services/csvService.js';
import { logger } from '../src/utils/logger.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

// ─── Configuración de fuentes por categoría ─────────────────────────────────
// Cada categoría agrupa sitios relacionados. Agrega nuevas categorías aquí.
const SOURCES = {
  financial: [
    'https://www.izipay.pe/',
    'https://interfondos.com.pe/home',
    'https://expressnet.pe/', // sin certificado
    'https://www.inteligogroup.com/',
    'https://www.interseguro.pe/',
    'https://interbank.pe/', // da error 403, posiblemente bloquean bots
  ],
  retail: [
    'https://www.inretail.pe/',
  // 'https://www.plazavea.com.pe/',
  // 'https://www.makro.pe/',
  // 'https://www.tiendasmass.com.pe/',
  // 'https://www.vivanda.com.pe/',
  // 'https://www.realplaza.com/',
  // 'https://www.oechsle.pe/',
    'https://app.agora.pe/',
    'https://sip.pe/'

  ],
  health: [
    'https://www.aviva.pe/',
    'https://web.quimicasuiza.com/'
  ],
  education: [
    'https://www.innovaschools.edu.pe/',
    'https://www.utp.edu.pe/',
    'https://www.idat.edu.pe/',
    'https://www.its.edu.pe/',
    'https://www.colectivo23.com/',
    'https://www.corrientealterna.edu.pe/',
    'https://www.zegel.edu.pe/',
    'https://www.peruchamps.org/'
  ],
};

// ─── Parsear argumento --category ────────────────────────────────────────────
function getUrlsToProcess() {
  const args = process.argv.slice(2);
  const catIdx = args.indexOf('--category');

  if (catIdx !== -1) {
    const catName = args[catIdx + 1];
    if (!catName || !SOURCES[catName]) {
      const available = Object.keys(SOURCES).join(', ');
      console.error(
        chalk.red(`❌ Categoría "${catName || ''}" no encontrada. Disponibles: ${available}`)
      );
      process.exit(1);
    }
    return { category: catName, urls: SOURCES[catName] };
  }

  // Sin --category: procesar todas
  const allUrls = Object.values(SOURCES).flat();
  return { category: 'todas', urls: allUrls };
}

async function main() {
  console.log(chalk.blue.bold('\n🌐 Web Scraper Inteligente — LangChain + OpenAI\n'));

  if (!process.env.OPENAI_API_KEY) {
    console.error(chalk.red('❌ OPENAI_API_KEY no está definida en el archivo .env'));
    process.exit(1);
  }

  const { category, urls } = getUrlsToProcess();
  console.log(chalk.cyan(`Categoría  : ${category}`));
  console.log(chalk.cyan(`Sitios     : ${urls.length}`));
  console.log(chalk.cyan(`Output     : ${OUTPUT_DIR}/\n`));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalItems = 0;
  let succeeded = 0;
  let failed = 0;

  for (const url of urls) {
    const domain = getDomain(url);
    const csvName = `web-${domain}.csv`;
    const csvPath = path.join(OUTPUT_DIR, csvName);

    console.log(chalk.blue(`\n┌── ${domain}`));

    // 1. Scraping de la web
    let scraped;
    try {
      process.stdout.write(chalk.yellow(`│  ⏳ Scrapeando...`));
      scraped = await scrapeWebsite(url);
      process.stdout.write(
        `\r${chalk.green(`│  ✅ ${scraped.pagesScraped} página(s) obtenidas`)}\n`
      );
    } catch (err) {
      process.stdout.write(`\r${chalk.red(`│  ❌ Scraping fallido: ${err.message}`)}\n`);
      console.log(chalk.blue(`└──\n`));
      failed++;
      continue;
    }

    // 2. Extracción de ítems con OpenAI
    process.stdout.write(chalk.yellow(`│  ⏳ Extrayendo ítems con OpenAI...`));
    const rows = await extractDataFromWeb(scraped);
    process.stdout.write(
      `\r${chalk.green(`│  ✅ ${rows.length} ítem(s) extraídos`)}\n`
    );

    if (rows.length === 0) {
      logger.warn(`Sin datos extraídos de ${domain}`);
      console.log(chalk.blue(`└──\n`));
      failed++;
      continue;
    }

    // 3. Guardar CSV individual (sobreescribe si ya existe)
    await csvService.create(csvPath, COLUMNS);
    await csvService.addRows(csvPath, rows, COLUMNS);
    console.log(chalk.green(`│  💾 ${csvName}`));
    console.log(chalk.blue(`└──\n`));

    totalItems += rows.length;
    succeeded++;
  }

  // ─── Resumen ───────────────────────────────────────────────────────────────
  console.log(chalk.blue('═'.repeat(50)));
  console.log(chalk.green(`✅ Sitios completados : ${succeeded}/${urls.length}`));
  if (failed > 0) {
    console.log(chalk.red(`❌ Fallidos           : ${failed}`));
  }
  console.log(chalk.cyan(`📊 Total de ítems    : ${totalItems}`));
  console.log(chalk.gray(`\n   Para combinar todos los CSVs: npm run merge:csv\n`));
}

main().catch((err) => {
  console.error(chalk.red('\n❌ Error fatal:'), err.message);
  process.exit(1);
});
