import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { discoverContentLinks, parsePageContent } from '../src/ingest/site/crawl.js';

/**
 * Los enlaces a blog y noticias viven en la navegación del sitio, y
 * parsePageContent() borra nav, header, footer y todo lo que tenga "menu" en
 * la clase — sobre el documento compartido, no sobre una copia.
 *
 * Mientras el descubrimiento corrió después del parseo, el crawler fue ciego a
 * la navegación: 31 de 36 fuentes reportaron cero subpáginas teniéndolas.
 * Intercorp tiene un único enlace de contenido, /es/noticias-y-contacto, y
 * estaba en el <nav>.
 */
const HTML = `
<html><body>
  <nav><a href="/es/noticias-y-contacto">Noticias y contacto</a></nav>
  <header><a href="/blog">Blog</a></header>
  <main><p>Somos un grupo peruano.</p><a href="/es/quienes-somos">Quiénes somos</a></main>
  <footer class="menu-footer"><a href="/sala-de-prensa">Sala de prensa</a></footer>
</body></html>`;

const BASE = 'https://intercorp.com.pe/es';

describe('discoverContentLinks()', () => {
  it('encuentra los enlaces de contenido que viven en la navegación', () => {
    const $ = cheerio.load(HTML);
    const links = discoverContentLinks($, BASE);
    expect(links).toContain('https://intercorp.com.pe/es/noticias-y-contacto');
    expect(links).toContain('https://intercorp.com.pe/blog');
    expect(links).toContain('https://intercorp.com.pe/sala-de-prensa');
  });

  it('ignora las páginas que no son de contenido', () => {
    const $ = cheerio.load(HTML);
    expect(discoverContentLinks($, BASE)).not.toContain('https://intercorp.com.pe/es/quienes-somos');
  });

  it('no encuentra nada si parsePageContent ya limpió el documento', () => {
    // Esta es la regresión: describe el comportamiento roto para que quede
    // claro por qué el orden de las dos llamadas no es intercambiable.
    const $ = cheerio.load(HTML);
    parsePageContent($, BASE);
    expect(discoverContentLinks($, BASE)).toEqual([]);
  });

  it('se queda solo con el mismo origen', () => {
    const $ = cheerio.load('<a href="https://otro.pe/blog">Blog ajeno</a>');
    expect(discoverContentLinks($, BASE)).toEqual([]);
  });
});
