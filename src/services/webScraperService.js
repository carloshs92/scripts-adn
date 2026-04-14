import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

// Patrones de URLs/texto que indican contenido relevante (blogs, noticias, prensa)
const CONTENT_PATTERNS =
  /blog|news|noticias|prensa|press|articul|actualidad|novedades|insights|publicaciones|sala-de-prensa|comunicados|media|magazine/i;

const MAX_SUBPAGES = 6;
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONTENT_CHARS = 14000;
const REQUEST_DELAY_MS = 1200;

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
 * Extrae el nombre de dominio limpio de una URL
 * Ejemplo: https://www.izipay.pe/ → izipay.pe
 */
export function getDomain(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

/**
 * Scrapea un sitio web: página principal + subpáginas de contenido relevante
 * @param {string} url - URL del sitio a scrapear
 * @returns {Promise<{url, domain, pagesScraped, content}>}
 */
export async function scrapeWebsite(url) {
  logger.debug(`Iniciando scraping de: ${url}`);

  // 1. Página principal
  let mainHtml;
  try {
    mainHtml = await fetchHTML(url);
  } catch (err) {
    throw new Error(`No se pudo acceder a ${url}: ${err.message}`);
  }

  const $ = cheerio.load(mainHtml);
  const pages = [parsePageContent($, url)];

  // 2. Descubrir y scrapear subpáginas de contenido
  const subLinks = discoverContentLinks($, url);
  logger.debug(`${subLinks.length} enlace(s) de contenido descubiertos en ${getDomain(url)}`);

  for (const link of subLinks) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const html = await fetchHTML(link);
      const $sub = cheerio.load(html);
      pages.push(parsePageContent($sub, link));
      logger.debug(`  ✓ ${link}`);
    } catch (err) {
      logger.debug(`  ✗ ${link}: ${err.message}`);
    }
  }

  // 3. Combinar y truncar al límite de caracteres
  const rawContent = pages.join('\n\n═══ SIGUIENTE PÁGINA ═══\n\n');
  const content = rawContent.slice(0, MAX_CONTENT_CHARS);

  return {
    url,
    domain: getDomain(url),
    pagesScraped: pages.length,
    content,
  };
}

export default { scrapeWebsite, getDomain };
