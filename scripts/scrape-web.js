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
 *   OPENROUTER_API_KEY u OPENAI_API_KEY, según LLM_PROVIDER
 *
 * Variables opcionales:
 *   LLM_MODEL       - Modelo a usar (default: openai/gpt-4o-mini)
 *   OUTPUT_DIR      - Carpeta de salida (default: ./output)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { scrapeWebsite, getDomain } from '../src/ingest/site/crawl.js';
import { extractDataFromWeb, COLUMNS } from '../src/ingest/extractFromSite.js';
import { dedupe, mergeRuns } from '../src/milestone/index.js';
import * as csvService from '../src/platform/csv.js';
import { logger } from '../src/platform/log.js';
import { llmConfig } from '../src/platform/llm.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

// ─── Configuración de fuentes por categoría ─────────────────────────────────
// Cada categoría agrupa sitios relacionados. Agrega nuevas categorías aquí.
const SOURCES = {
  // El sitio del holding: es la única vía institucional para las empresas que
  // bloquean el scraping. interbank.pe devuelve 403 en todas sus rutas, así que
  // su descripción solo puede venir de acá o de los reportes corporativos.
  holding: [
    'https://www.intercorp.com.pe/',
  ],
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
    // Los e-commerce se apuntan a su página institucional, no a la home: la
    // home ES el catálogo, y de ahí salían hitos como "Jugo Naranja Cold
    // Pressed" o "Back to School" — promociones, no hitos corporativos.
    'https://www.plazavea.com.pe/nosotros',
    'https://www.makro.pe/nosotros',
    'https://www.vivanda.com.pe/nosotros',
    'https://www.oechsle.pe/nosotros',
    'https://www.promart.pe/nosotros',
    // Sin /nosotros útil: se quedan en la home y la regla 11 del prompt filtra
    'https://www.tiendasmass.com.pe/',
    'https://www.realplaza.com/',
    'https://www.supermercadosperuanos.com.pe/',
    'https://app.agora.pe/',
    // sip.pe es una SPA de Angular: su HTML no trae texto (las 3 URLs devuelven
    // el mismo shell vacío). El contenido real vive en su WordPress headless,
    // accesible solo por API REST + ACF.
    {
      urls: ['https://sip.pe/', 'https://sip.pe/blog', 'https://sip.pe/quienes-somos'],
      wordpress: {
        origin: 'https://cms.sip.pe',
        prioritySlugs: ['quienes-somos'],
      },
    },
  ],
  health: [
    'https://www.aviva.pe/',
    'https://web.quimicasuiza.com/',
    'https://www.inkafarma.pe/',
    'https://www.mifarma.com.pe/'
  ],
  entertainment: [
    'https://www.cineplanet.com.pe/',
    'https://www.casa-andina.com/',
    'https://www.latinka.com.pe/'
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

/**
 * Normaliza una entrada de SOURCES a la forma {urls, wordpress}.
 * Acepta un string suelto o un objeto con configuración extra.
 * @param {string|Object} entry
 * @returns {{urls: Array<string>, wordpress: Object|undefined}}
 */
function normalizeEntry(entry) {
  if (typeof entry === 'string') return { urls: [entry], wordpress: undefined };
  return { urls: entry.urls || [entry.url], wordpress: entry.wordpress };
}

/**
 * Agrupa las fuentes por dominio conservando el orden de SOURCES.
 * Varias URLs del mismo sitio (home, /blog, /quienes-somos) se scrapean juntas
 * y producen un único CSV, en vez de sobreescribirse entre sí.
 * @param {Array<string|Object>} entries
 * @returns {Array<{domain: string, urls: Array<string>, wordpress: Object|undefined}>}
 */
function groupByDomain(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const { urls, wordpress } = normalizeEntry(entry);
    const domain = getDomain(urls[0]);

    if (!groups.has(domain)) groups.set(domain, { domain, urls: [], wordpress: undefined });
    const group = groups.get(domain);

    for (const url of urls) {
      if (!group.urls.includes(url)) group.urls.push(url);
    }
    if (wordpress) group.wordpress = wordpress;
  }

  return [...groups.values()];
}

async function main() {
  console.log(chalk.blue.bold('\n🌐 Web Scraper Inteligente — LangChain\n'));

  // Validar la key del proveedor activo, no la de OpenAI: la extracción puede
  // correr sobre OpenRouter y exigir OPENAI_API_KEY bloquearía sin motivo.
  let provider;
  try {
    provider = llmConfig();
  } catch (err) {
    console.error(chalk.red(`❌ ${err.message}`));
    process.exit(1);
  }

  const { category, urls } = getUrlsToProcess();
  const sites = groupByDomain(urls);
  const urlCount = sites.reduce((sum, site) => sum + site.urls.length, 0);

  console.log(chalk.cyan(`Proveedor  : ${provider.name} · ${provider.model}`));
  console.log(chalk.cyan(`Categoría  : ${category}`));
  console.log(chalk.cyan(`Sitios     : ${sites.length} (${urlCount} URL(s))`));
  console.log(chalk.cyan(`Output     : ${OUTPUT_DIR}/\n`));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalItems = 0;
  let succeeded = 0;
  let failed = 0;

  for (const { domain, urls: siteUrls, wordpress } of sites) {
    const csvName = `web-${domain}.csv`;
    const csvPath = path.join(OUTPUT_DIR, csvName);

    console.log(chalk.blue(`\n┌── ${domain}`));
    if (siteUrls.length > 1) {
      console.log(chalk.gray(`│  ${siteUrls.length} URLs: ${siteUrls.join(', ')}`));
    }
    if (wordpress) {
      console.log(chalk.gray(`│  CMS headless: ${wordpress.origin}`));
    }

    // 1. Scraping de la web (todas las URLs del dominio en una sola pasada)
    let scraped;
    try {
      process.stdout.write(chalk.yellow(`│  ⏳ Scrapeando...`));
      scraped = await scrapeWebsite(siteUrls, { wordpress });
      process.stdout.write(
        `\r${chalk.green(`│  ✅ ${scraped.pagesScraped} página(s) obtenidas`)}\n`
      );
    } catch (err) {
      process.stdout.write(`\r${chalk.red(`│  ❌ Scraping fallido: ${err.message}`)}\n`);
      console.log(chalk.blue(`└──\n`));
      failed++;
      continue;
    }

    // 2. Extracción de ítems con OpenAI (ya viene sin duplicados)
    process.stdout.write(chalk.yellow(`│  ⏳ Extrayendo ítems con OpenAI...`));
    const extracted = await extractDataFromWeb(scraped);
    process.stdout.write(
      `\r${chalk.green(`│  ✅ ${extracted.length} ítem(s) extraídos`)}\n`
    );

    // 3. Segunda pasada de deduplicación sobre lo que se va a escribir
    const { milestones: rows, duplicates } = dedupe(extracted);
    if (duplicates > 0) {
      console.log(chalk.yellow(`│  ♻️  ${duplicates} duplicado(s) descartado(s)`));
    }

    if (rows.length === 0) {
      logger.warn(`Sin datos extraídos de ${domain}`);
      console.log(chalk.blue(`└──\n`));
      failed++;
      continue;
    }

    // 4. Fusionar con lo que ya había, en vez de reemplazarlo.
    //
    // La extracción no es determinista: el mismo sitio devolvió 22, 13 y 10
    // hitos en corridas distintas, y una tercera vez un JSON inválido. Con
    // sobreescritura, cada re-scrapeo perdía lo que esa corrida no vio —SIP
    // cayó de 15 hitos a 4— así que lo nuevo se suma a lo anterior.
    const previos = await csvService.read(csvPath).catch(() => []);
    const fusionados = mergeRuns(rows, previos);
    const sumados = fusionados.length - previos.length;

    await csvService.create(csvPath, COLUMNS);
    await csvService.addRows(csvPath, fusionados, COLUMNS);
    console.log(
      chalk.green(`│  💾 ${csvName} → ${fusionados.length} ítem(s)`) +
        (previos.length ? chalk.gray(`  (${previos.length} previos, ${sumados >= 0 ? '+' : ''}${sumados})`) : '')
    );
    console.log(chalk.blue(`└──\n`));

    totalItems += rows.length;
    succeeded++;
  }

  // ─── Resumen ───────────────────────────────────────────────────────────────
  console.log(chalk.blue('═'.repeat(50)));
  console.log(chalk.green(`✅ Sitios completados : ${succeeded}/${sites.length}`));
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
