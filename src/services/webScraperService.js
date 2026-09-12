import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { fetchWordPressContent } from './wordpressService.js';

// Patrones de URLs/texto que indican contenido relevante (blogs, noticias, prensa)
const CONTENT_PATTERNS =
  /blog|news|noticias|prensa|press|articul|actualidad|novedades|insights|publicaciones|sala-de-prensa|comunicados|media|magazine/i;

const MAX_SUBPAGES = 16;
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONTENT_CHARS = 30000;
const REQUEST_DELAY_MS = 1200;

// Tope por página, para que una sola página muy larga no consuma el presupuesto
const MAX_PAGE_CHARS = 6000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHTML(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extrae texto limpio y estructurado de un documento cheerio
 */
function parsePageContent($, url) {
  // Eliminar ruido: scripts, estilos, navegación, cookies, etc.
  $(
    'script, style, noscript, nav, footer, header, iframe, ' +
      '[class*="menu"], [class*="cookie"], [class*="banner"], ' +
      '[class*="popup"], [class*="modal"], [class*="overlay"], ' +
      '[role="navigation"], [aria-hidden="true"]'
  ).remove();

  const title = $('title').text().trim();
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() || '';
  const h1s = $('h1')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .join(' | ');
  const h2s = $('h2')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 12)
    .join(' | ');

  // Intentar extraer el contenido principal primero, fallback al body completo
  const mainSelectors = 'main, [role="main"], article, .content, .blog, .post, .news, section';
  const mainContent = $(mainSelectors).text().trim();
  const bodyText = mainContent || $('body').text().trim();
  const clean = bodyText.replace(/\s+/g, ' ').slice(0, 6000);

  return `URL: ${url}\nTÍTULO: ${title}\nDESCRIPCIÓN META: ${metaDesc}\nH1: ${h1s}\nH2: ${h2s}\nCONTENIDO:\n${clean}`;
}

/**
 * Encuentra enlaces que apuntan a secciones de contenido (blog, noticias, prensa)
 * dentro del mismo dominio
 */
function discoverContentLinks($, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const seen = new Set([baseUrl]);
  const links = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:'))
      return;

    let fullUrl;
    try {
      fullUrl = new URL(href, baseUrl).toString().split('#')[0]; // quitar anclas
    } catch {
      return;
    }

    // Solo mismo origen, sin archivos binarios
    if (!fullUrl.startsWith(origin)) return;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|doc|xls|mp4)$/i.test(fullUrl)) return;
    if (seen.has(fullUrl)) return;

    const linkText = $(el).text().trim();
    const signal = fullUrl + ' ' + linkText;

    if (CONTENT_PATTERNS.test(signal)) {
      seen.add(fullUrl);
      links.push(fullUrl);
    }
  });

  return links.slice(0, MAX_SUBPAGES);
}

/**
 * Combina las páginas en un solo texto respetando el límite de caracteres.
 * Se llenan por orden de prioridad: primero las páginas semilla (institucionales
 * y las listadas en SOURCES), después las subpáginas descubiertas. Cada página
 * entra completa hasta MAX_PAGE_CHARS; cuando se agota el presupuesto, se cortan
 * las de menor prioridad, nunca las primeras.
 * @param {Array<string>} seedPages - Contenido prioritario, en orden
 * @param {Array<string>} extraPages - Contenido de las subpáginas descubiertas
 * @returns {string} Contenido combinado
 */
function joinWithinBudget(seedPages, extraPages) {
  const separator = '\n\n═══ SIGUIENTE PÁGINA ═══\n\n';
  const parts = [];
  let used = 0;

  for (const page of [...seedPages, ...extraPages]) {
    const capped = page.slice(0, MAX_PAGE_CHARS);
    const cost = capped.length + (parts.length > 0 ? separator.length : 0);

    if (used + cost > MAX_CONTENT_CHARS) break;

    parts.push(capped);
    used += cost;
  }

  return parts.join(separator);
}

/**
 * Extrae el nombre de dominio limpio de una URL
 * Ejemplo: https://www.izipay.pe/ → izipay.pe
 */
export function getDomain(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

/**
 * Scrapea un sitio web: las URLs indicadas + subpáginas de contenido relevante.
 * Acepta varias URLs del mismo dominio (ej: home, /blog y /quienes-somos) y las
 * devuelve como un único contenido, sin repetir páginas ya visitadas.
 * @param {string|Array<string>} urlOrUrls - URL o URLs del sitio a scrapear
 * @param {Object} [options]
 * @param {Object} [options.wordpress] - {origin, prioritySlugs} para sitios SPA
 *   cuyo HTML no trae texto y cuyo contenido vive en un WordPress headless
 * @returns {Promise<{url, urls, domain, pagesScraped, content}>}
 */
export async function scrapeWebsite(urlOrUrls, { wordpress } = {}) {
  const seedUrls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  logger.debug(`Iniciando scraping de: ${seedUrls.join(', ')}`);

  const visited = new Set();
  const seedPages = [];
  const discovered = [];
  const errors = [];

  // 1. Páginas indicadas explícitamente, en orden
  for (const seedUrl of seedUrls) {
    const normalized = seedUrl.split('#')[0];
    if (visited.has(normalized)) continue;

    if (visited.size > 0) await sleep(REQUEST_DELAY_MS);

    try {
      const html = await fetchHTML(normalized);
      visited.add(normalized);

      const $ = cheerio.load(html);
      seedPages.push(parsePageContent($, normalized));

      // Descubrir subpáginas de contenido desde cada semilla
      for (const link of discoverContentLinks($, normalized)) {
        if (!discovered.includes(link)) discovered.push(link);
      }
    } catch (err) {
      errors.push(`${normalized}: ${err.message}`);
      logger.debug(`  ✗ ${normalized}: ${err.message}`);
    }
  }

  if (seedPages.length === 0 && !wordpress) {
    throw new Error(`No se pudo acceder a ${getDomain(seedUrls[0])} → ${errors.join(' | ')}`);
  }

  // 2. Scrapear las subpáginas descubiertas que no sean ya una semilla
  const subLinks = discovered.filter((link) => !visited.has(link)).slice(0, MAX_SUBPAGES);
  logger.debug(`${subLinks.length} enlace(s) de contenido descubiertos en ${getDomain(seedUrls[0])}`);

  const extraPages = [];
  for (const link of subLinks) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const html = await fetchHTML(link);
      visited.add(link);
      const $sub = cheerio.load(html);
      extraPages.push(parsePageContent($sub, link));
      logger.debug(`  ✓ ${link}`);
    } catch (err) {
      logger.debug(`  ✗ ${link}: ${err.message}`);
    }
  }

  // 3. Sitios SPA: el HTML no trae contenido, traerlo del WordPress headless.
  // Va como semilla porque es la fuente principal de información del sitio.
  let cmsPages = [];
  if (wordpress?.origin) {
    const { pages: blocks } = await fetchWordPressContent(wordpress.origin, {
      prioritySlugs: wordpress.prioritySlugs || [],
    });
    cmsPages = blocks;
  }

  if (seedPages.length === 0 && cmsPages.length === 0) {
    throw new Error(`Sin contenido para ${getDomain(seedUrls[0])} → ${errors.join(' | ')}`);
  }

  return {
    url: seedUrls[0],
    urls: seedUrls,
    domain: getDomain(seedUrls[0]),
    pagesScraped: seedPages.length + cmsPages.length + extraPages.length,
    content: joinWithinBudget([...cmsPages, ...seedPages], extraPages),
  };
}

export default { scrapeWebsite, getDomain };
