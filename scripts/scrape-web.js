#!/usr/bin/env node

/**
 * scrape-web.js
 *
 * Scraping inteligente de sitios web usando LangChain + OpenAI.
 * Por cada empresa de la planilla scrapea sus URLs y las subpáginas de contenido
 * relevante (blogs, noticias, prensa), extrae ítems estructurados y genera un CSV
 * individual en output/ siguiendo el mismo formato que el procesador de PDFs.
 *
 * Uso:
 *   npm run scrape:web                          # Todas las plataformas
 *   npm run scrape:web -- --plataforma retail   # Solo la plataforma indicada
 *   npm run scrape:web -- --empresa promart     # Solo una empresa
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
import { scrapeWebsite } from '../src/ingest/site/crawl.js';
import { extractDataFromWeb, COLUMNS } from '../src/ingest/extractFromSite.js';
import { dedupe, mergeRuns } from '../src/milestone/index.js';
import * as csvService from '../src/platform/csv.js';
import { logger } from '../src/platform/log.js';
import { llmConfig } from '../src/platform/llm.js';

dotenv.config();

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

// ─── Fuentes: una fila de la planilla del cliente, una entrada ───────────────
//
// La planilla es la fuente de verdad de qué se scrapea y de cómo se nombra el
// origen en pantalla. `plataforma / empresa / usuario` reemplaza al dominio como
// `source_file`: la tarjeta de la app muestra "Retail / Promart" donde antes
// decía "promart.pe", igual que un hito de PDF muestra su nombre de archivo.
//
// Agrupar por fila y no por dominio es deliberado: realplaza.com sirve tanto a
// Real Plaza como a Don Belisario, y las cinco fichas de LinkedIn comparten
// dominio sin tener nada que ver entre sí.
//
// Las filas sin web declarada (Urbi, dos usuarios de Interbank y dos de
// Superfood Holding) no se listan acá: no hay de dónde extraer.
const SOURCES = [
  // ── Servicios Corporativos ────────────────────────────────────────────────
  { plataforma: 'Servicios Corporativos', empresa: 'Intercorp', usuario: 'AACC',
    urls: ['https://intercorp.com.pe/es'] },
  { plataforma: 'Servicios Corporativos', empresa: 'Intercorp', usuario: 'UCIC',
    urls: ['https://pe.linkedin.com/company/asocucic'] },
  { plataforma: 'Servicios Corporativos', empresa: 'Intercorp', usuario: 'La Victoria Lab',
    urls: ['https://lavictoria.pe/'] },

  // ── IFS ───────────────────────────────────────────────────────────────────
  // interbank.pe devolvía 403 en todas sus rutas. La planilla pide /nosotros:
  // se intenta igual y el reporte dirá si sigue bloqueando.
  { plataforma: 'IFS', empresa: 'Interbank', urls: ['https://interbank.pe/nosotros'] },
  { plataforma: 'IFS', empresa: 'Interseguro', urls: ['https://www.interseguro.pe/nosotros'] },
  { plataforma: 'IFS', empresa: 'Inteligo', urls: ['https://www.inteligosab.com/es'] },
  { plataforma: 'IFS', empresa: 'Izipay', urls: ['https://www.izipay.pe/somos-izipay/'] },
  { plataforma: 'IFS', empresa: 'Interfondos', urls: ['https://interfondos.com.pe/nosotros'] },

  // ── Retail ────────────────────────────────────────────────────────────────
  { plataforma: 'Retail', empresa: 'Superfood Holding', urls: ['https://sostenibilidadspsa.pe/'] },
  { plataforma: 'Retail', empresa: 'InRetail', urls: ['https://www.inretail.pe/es'] },
  { plataforma: 'Retail', empresa: 'Mass', urls: ['https://www.tiendasmass.com.pe/conoceme/'] },
  { plataforma: 'Retail', empresa: 'Makro', urls: ['https://www.makro.pe/nosotros'] },
  { plataforma: 'Retail', empresa: 'Real Plaza', urls: ['https://www.realplaza.com/'] },
  { plataforma: 'Retail', empresa: 'Oechsle', urls: ['https://www.oechsle.pe/sobre-nosotros'] },
  { plataforma: 'Retail', empresa: 'Agora', urls: ['https://app.agora.pe/'] },
  { plataforma: 'Retail', empresa: 'Oslo', urls: ['https://www.linkedin.com/company/oslo-logistics'] },
  { plataforma: 'Retail', empresa: 'Promart', urls: ['https://www.promart.pe/nosotros'] },
  // SIP es una SPA de Angular: su HTML no trae texto. El contenido real vive en
  // su WordPress headless y solo se alcanza por API REST + ACF.
  { plataforma: 'Retail', empresa: 'SIP', urls: ['https://sip.pe/quienes-somos'],
    wordpress: { origin: 'https://cms.sip.pe', prioritySlugs: ['quienes-somos'] } },
  { plataforma: 'Retail', empresa: 'Farmacias Peruanas',
    urls: ['https://pe.linkedin.com/company/farmacias-peruanas'] },

  // ── Salud ─────────────────────────────────────────────────────────────────
  { plataforma: 'Salud', empresa: 'Aviva', urls: ['https://www.aviva.pe/nosotros'] },

  // ── Educación ─────────────────────────────────────────────────────────────
  { plataforma: 'Educación', empresa: 'Innova Schools', urls: ['https://www.innovaschools.edu.pe/'] },
  { plataforma: 'Educación', empresa: 'Peru Champs', urls: ['https://www.peruchamps.org/quienes-somos'] },
  { plataforma: 'Educación', empresa: 'UTP', urls: ['https://www.utp.edu.pe/web/nosotros'] },
  { plataforma: 'Educación', empresa: 'IDAT', urls: ['https://es.linkedin.com/school/idat/'] },
  { plataforma: 'Educación', empresa: 'Zegel', urls: ['https://www.zegel.edu.pe/'] },
  { plataforma: 'Educación', empresa: 'Corriente Alterna', urls: ['https://www.corrientealterna.edu.pe/'] },
  { plataforma: 'Educación', empresa: 'Colectivo23', urls: ['https://www.colectivo23.com/'] },
  { plataforma: 'Educación', empresa: 'ITS', urls: ['https://www.its.edu.pe/'] },

  // ── Entretenimiento y hospitalidad ────────────────────────────────────────
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'Cineplanet',
    urls: ['https://www.cineplanet.com.pe/nosotros'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'NGR', usuario: 'Bembos',
    urls: ['https://www.bembos.com.pe/sobre-nosotros', 'https://pe.linkedin.com/company/ng-restaurants-s-a-'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'NGR', usuario: 'Papa Johns',
    urls: ['https://www.papajohns.com.pe/conocenos', 'https://www.trabajaenngr.com.pe/'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'NGR', usuario: 'Popeyes',
    urls: ['https://www.popeyes.com.pe/'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'NGR', usuario: 'Chinawok',
    urls: ['https://www.chinawok.com.pe/'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'NGR', usuario: 'Don Belisario',
    urls: ['https://www.realplaza.com/marcas/don-belisario'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'NGR', usuario: 'Dunkin',
    urls: ['https://www.dunkin.pe/sobre-nosotros'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'Casa Andina',
    urls: ['https://www.casa-andina.com/es/quienes-somos'] },
  { plataforma: 'Entretenimiento y hospitalidad', empresa: 'La Tinka',
    urls: ['https://blog.latinka.com.pe/quienes-somos/'] },

  // ── Industrial ────────────────────────────────────────────────────────────
  { plataforma: 'Industrial', empresa: 'SMI', urls: ['https://smisolutions.com/'] },

  // ── Nexus ─────────────────────────────────────────────────────────────────
  { plataforma: 'Nexus', empresa: 'Nexus', urls: ['https://www.linkedin.com/company/nexus-group-s-a/'] },
];

/**
 * Procedencia del hito tal como se muestra en la app: los tres niveles de la
 * planilla, sin los que no aplican. La planilla marca con "x" los usuarios que
 * no tienen nombre propio.
 * @param {Object} entrada
 * @returns {string}
 */
export function etiqueta({ plataforma, empresa, usuario }) {
  return [plataforma, empresa, usuario]
    .filter((parte) => parte && parte.toLowerCase() !== 'x')
    .join(' / ');
}

/**
 * Nombre de archivo derivado de la etiqueta: sin tildes, sin espacios y estable
 * entre corridas, para que el CSV de una empresa sea siempre el mismo.
 * @param {string} texto
 * @returns {string}
 */
export function slug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Parsear argumentos de filtrado ──────────────────────────────────────────
function getEntradasAProcesar() {
  const args = process.argv.slice(2);
  const valorDe = (bandera) => {
    const i = args.indexOf(bandera);
    return i === -1 ? null : args[i + 1];
  };

  // --category se mantiene como alias por compatibilidad con la forma anterior
  const plataforma = valorDe('--plataforma') || valorDe('--category');
  const empresa = valorDe('--empresa');

  let entradas = SOURCES;
  let filtro = 'todas';

  if (plataforma) {
    entradas = entradas.filter((e) => slug(e.plataforma) === slug(plataforma));
    filtro = `plataforma ${plataforma}`;
  }
  if (empresa) {
    entradas = entradas.filter((e) => slug(e.empresa) === slug(empresa));
    filtro = `${filtro === 'todas' ? '' : filtro + ' · '}empresa ${empresa}`;
  }

  if (entradas.length === 0) {
    const plataformas = [...new Set(SOURCES.map((e) => e.plataforma))].join(', ');
    console.error(chalk.red(`❌ Ninguna fuente coincide con el filtro. Plataformas: ${plataformas}`));
    process.exit(1);
  }

  return { filtro, entradas };
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

  const { filtro, entradas } = getEntradasAProcesar();
  const urlCount = entradas.reduce((sum, e) => sum + e.urls.length, 0);

  console.log(chalk.cyan(`Proveedor  : ${provider.name} · ${provider.model}`));
  console.log(chalk.cyan(`Filtro     : ${filtro}`));
  console.log(chalk.cyan(`Fuentes    : ${entradas.length} (${urlCount} URL(s))`));
  console.log(chalk.cyan(`Output     : ${OUTPUT_DIR}/\n`));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalItems = 0;
  let succeeded = 0;
  const fallidos = [];

  for (const [i, entrada] of entradas.entries()) {
    const { urls: siteUrls, wordpress } = entrada;
    const origen = etiqueta(entrada);
    const csvName = `web-${slug(origen)}.csv`;
    const csvPath = path.join(OUTPUT_DIR, csvName);

    console.log(chalk.blue(`\n┌── [${i + 1}/${entradas.length}] ${origen}`));
    console.log(chalk.gray(`│  ${siteUrls.join(', ')}`));
    if (wordpress) {
      console.log(chalk.gray(`│  CMS headless: ${wordpress.origin}`));
    }

    // 1. Scraping de la web (todas las URLs de la empresa en una sola pasada)
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
      fallidos.push({ origen, motivo: err.message });
      continue;
    }

    // 2. Extracción de ítems con el modelo (ya viene sin duplicados)
    process.stdout.write(chalk.yellow(`│  ⏳ Extrayendo ítems...`));
    const extracted = await extractDataFromWeb(scraped, { origen });
    process.stdout.write(
      `\r${chalk.green(`│  ✅ ${extracted.length} ítem(s) extraídos`)}\n`
    );

    // 3. Segunda pasada de deduplicación sobre lo que se va a escribir
    const { milestones: rows, duplicates } = dedupe(extracted);
    if (duplicates > 0) {
      console.log(chalk.yellow(`│  ♻️  ${duplicates} duplicado(s) descartado(s)`));
    }

    if (rows.length === 0) {
      logger.warn(`Sin datos extraídos de ${origen}`);
      console.log(chalk.blue(`└──\n`));
      fallidos.push({ origen, motivo: 'sin ítems extraídos' });
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
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.green(`✅ Fuentes completadas : ${succeeded}/${entradas.length}`));
  if (fallidos.length > 0) {
    console.log(chalk.red(`❌ Sin resultado       : ${fallidos.length}`));
    for (const { origen, motivo } of fallidos) {
      console.log(chalk.red(`   · ${origen} — ${motivo}`));
    }
  }
  console.log(chalk.cyan(`📊 Total de ítems      : ${totalItems}`));
  console.log(chalk.gray(`\n   Para combinar todos los CSVs: npm run merge:csv\n`));
}

// Solo corre cuando se invoca como script; importarlo (tests) no dispara nada.
if (process.argv[1] && process.argv[1].endsWith('scrape-web.js')) {
  main().catch((err) => {
    console.error(chalk.red('\n❌ Error fatal:'), err.message);
    process.exit(1);
  });
}

export { SOURCES };
