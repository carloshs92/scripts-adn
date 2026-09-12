import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

const FETCH_TIMEOUT_MS = 15000;
const MAX_PAGES = 30;
const MAX_POSTS = 30;

/**
 * Descarga y parsea un JSON del API REST de WordPress
 * @param {string} url
 * @returns {Promise<*>} JSON parseado, o null si falla
 */
async function fetchJSON(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.debug(`  ✗ ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Convierte HTML a texto plano
 * @param {string} html
 * @returns {string}
 */
function stripHTML(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recorre recursivamente los campos ACF y junta el texto útil,
 * descartando URLs, imágenes y valores vacíos.
 * @param {*} value - Valor de ACF (objeto, array o primitivo)
 * @param {Array<string>} collected - Acumulador de textos
 * @returns {Array<string>} Textos encontrados
 */
function collectACFText(value, collected = []) {
  if (value === null || value === undefined) return collected;

  if (typeof value === 'string') {
    const text = stripHTML(value);
    // Descartar URLs, rutas de imágenes y cadenas sin contenido real
    if (text.length < 3) return collected;
    if (/^https?:\/\//i.test(text)) return collected;
    if (/\.(png|jpe?g|gif|svg|webp|pdf|mp4)$/i.test(text)) return collected;
    collected.push(text);
    return collected;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectACFText(item, collected);
    return collected;
  }

  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      // Campos que solo contienen rutas o configuración visual
      if (/^(imagen|image|icono|icon|url|target|no_follow|link)/i.test(key)) continue;
      collectACFText(item, collected);
    }
  }

  return collected;
}

/**
 * Formatea una entrada (página o post) como bloque de texto
 * @param {Object} entry - Entrada del API de WordPress
 * @param {string} type - 'PÁGINA' o 'ARTÍCULO'
 * @returns {string}
 */
function formatEntry(entry, type) {
  const title = stripHTML(entry.title?.rendered || entry.slug || '');
  const content = stripHTML(entry.content?.rendered || '');
  const excerpt = stripHTML(entry.excerpt?.rendered || '');
  const acfText = [...new Set(collectACFText(entry.acf))].join(' · ');

  const body = [content, excerpt, acfText].filter(Boolean).join('\n');

  return `URL: ${entry.link}\nTIPO: ${type}\nTÍTULO: ${title}\nCONTENIDO:\n${body}`;
}

/**
 * Obtiene el contenido de un WordPress headless vía su API REST.
 * Pensado para sitios SPA (Angular/React) cuyo HTML no trae texto:
 * el contenido real vive en el CMS y solo es accesible por API.
 * @param {string} origin - Origen del WordPress (ej: https://cms.sip.pe)
 * @param {Object} options
 * @param {Array<string>} options.prioritySlugs - Slugs que deben ir primero
 * @returns {Promise<{pages: Array<string>, count: number}>}
 */
export async function fetchWordPressContent(origin, { prioritySlugs = [] } = {}) {
  const base = origin.replace(/\/$/, '');
  const fields = 'id,slug,link,title,content,excerpt,acf';

  // Las páginas prioritarias se piden por slug: el listado general viene
  // ordenado por fecha y puede no incluirlas si el sitio tiene muchas páginas
  const prioritySlugQuery =
    prioritySlugs.length > 0
      ? fetchJSON(
          `${base}/wp-json/wp/v2/pages?slug=${prioritySlugs.join(',')}&per_page=${MAX_PAGES}&_fields=${fields}`
        )
      : Promise.resolve([]);

  const [priorityPages, pages, posts] = await Promise.all([
    prioritySlugQuery,
    fetchJSON(`${base}/wp-json/wp/v2/pages?per_page=${MAX_PAGES}&_fields=${fields}`),
    fetchJSON(`${base}/wp-json/wp/v2/posts?per_page=${MAX_POSTS}&_fields=${fields}`),
  ]);

  if (!Array.isArray(pages) && !Array.isArray(posts)) {
    throw new Error(`El API de WordPress de ${base} no respondió`);
  }

  const pageList = Array.isArray(pages) ? pages : [];
  const postList = Array.isArray(posts) ? posts : [];

  // Las páginas prioritarias (ej: quienes-somos) van primero para que no se
  // pierdan al truncar el contenido enviado al modelo
  const priority = Array.isArray(priorityPages) ? priorityPages : [];
  const prioritySeen = new Set(priority.map((p) => p.id));
  const rest = pageList.filter((page) => !prioritySeen.has(page.id));

  if (prioritySlugs.length > 0 && priority.length === 0) {
    logger.warn(`No se encontraron las páginas prioritarias en ${base}: ${prioritySlugs.join(', ')}`);
  }

  const blocks = [
    ...priority.map((p) => formatEntry(p, 'PÁGINA INSTITUCIONAL')),
    ...rest.map((p) => formatEntry(p, 'PÁGINA')),
    ...postList.map((p) => formatEntry(p, 'ARTÍCULO')),
  ].filter((block) => block.split('CONTENIDO:\n')[1]?.trim());

  logger.debug(
    `WordPress ${base}: ${priority.length} prioritaria(s), ${rest.length} página(s), ${postList.length} artículo(s)`
  );

  return { pages: blocks, count: blocks.length };
}

export default { fetchWordPressContent };
