# ADR-0001: La procedencia de un hito web es la planilla, no el dominio

**Estado:** Aceptado · publicado el 2026-09-30 (con tres decisiones abiertas)
**Fecha:** 2026-09-30
**Deciders:** Carlos Huamani · cliente (dueño de la planilla de fuentes)

## Contexto

Cada hito lleva un campo `source_file` que la app imprime como `Fuente:` en la
tarjeta y en el panel del grafo. Para un documento es el nombre del archivo
(`Sustainability Report 2024 InRetail.pdf`). Para un sitio web era el dominio
(`promart.pe`), porque el scraper agrupaba las URLs por dominio y usaba ese
dominio como identidad del CSV y del origen.

El cliente entregó una planilla con las fuentes oficiales: 44 filas en tres
niveles —**plataforma / empresa / usuario**— con la URL de cada una. Pidió dos
cosas a la vez: que se scrapeen esas URLs y que esos tres niveles sean lo que se
muestra como procedencia, en lugar del dominio.

Dos hechos del material obligan a separar identidad de dominio:

- `realplaza.com` sirve a **Real Plaza** y a **Don Belisario** (`/marcas/don-belisario`).
  Agrupando por dominio, los hitos de una marca caen bajo la otra.
- Cinco fuentes distintas viven en LinkedIn (UCIC, Oslo, Farmacias Peruanas,
  IDAT, Nexus). Comparten dominio sin tener relación entre sí.

## Decisión

La unidad de scraping pasa a ser **la fila de la planilla**, no el dominio.

1. `SOURCES` en `scripts/scrape-web.js` es una lista plana de entradas
   `{ plataforma, empresa, usuario?, urls[], wordpress? }`, transcripción
   directa de la planilla.
2. `etiqueta(entrada)` compone `plataforma / empresa / usuario` descartando los
   niveles vacíos y las `x` con que la planilla marca "sin usuario propio".
3. Esa etiqueta se escribe en `source_file` y da el nombre del CSV
   (`web-<slug>.csv`). `extractDataFromWeb` acepta un `origen` opcional que por
   defecto sigue siendo el dominio, así que no rompe a otros llamadores.

```
antes                      ahora
promart.pe            →    Retail / Promart
colectivo23.com       →    Educación / Colectivo23
(indistinguible)      →    Entretenimiento y hospitalidad / NGR / Bembos
```

Las 5 filas sin web declarada (Urbi, dos usuarios de Interbank y dos de
Superfood Holding) no se listan: no hay de dónde extraer.

## Lo hallado al ejecutar

Dos corridas completas sobre las 39 filas con web.

| | Antes (dominio) | Ahora (planilla) |
|---|---|---|
| CSVs | 26 | 32 |
| Hitos web | 232 | 146 |
| Corpus total | 1980 | 1894 |

**Más fuentes, menos hitos.** La caída no viene del etiquetado sino de dos
causas independientes que conviene no confundir, porque solo una se arregla
sola. La comparación por empresa las separa:

| Empresa | Antes | Ahora | ¿Cambió la URL? |
|---|---|---|---|
| Colectivo23 | 23 | 8 | no |
| ITS | 20 | 11 | no |
| Innova Schools | 19 | 8 | no |
| SIP | 19 | 11 | no |
| UTP | 12 | 7 | sí, a `/web/nosotros` |
| **Interseguro** | **17** | **1** | sí, a `/nosotros` |
| **InRetail** | **7** | **1** | sí, a `/es` |
| **Makro** | **3** | **1** | sí, a `/nosotros` |
| Aviva | 3 | **7** | sí, a `/nosotros` |

### Causa 1 — acumulación perdida (temporal)

Colectivo23 e ITS apuntan **a la misma URL que antes** y bajaron igual. Los
números viejos eran el acumulado de varias corridas: la extracción no es
determinista —el mismo sitio dio 22, 13 y 10 hitos en pasadas distintas— y
`mergeRuns` las iba sumando. Al cambiar los nombres de archivo no quedó nada
previo con qué fusionar, y los 146 son dos pasadas desde cero (100 + 46).

Se recupera repitiendo la corrida, o de una con el carry-over de lo archivado.

### Causa 2 — la página institucional tiene menos (estructural)

Interseguro cayó de 17 a 1. Antes la semilla era su home, desde donde se
descubrían noticias y blog; la planilla pide `/nosotros`, que es un párrafo de
"quiénes somos". Igual InRetail y Makro.

**Acá está el hallazgo que importa: la URL institucional es la mejor fuente para
decir qué es la empresa y la peor para extraer hitos.** Antes había profundidad
sin ficha; ahora ficha sin profundidad. Son dos necesidades apuntando a páginas
distintas del mismo sitio, y la planilla solo declara una.

No se arregla repitiendo: la página no tiene más que dar. Doce fuentes se
quedaron en un solo hito y no suben entre corridas:

> Promart · Oechsle · Makro · Mass · Real Plaza · InRetail · Interseguro ·
> Interfondos · Cineplanet · Casa Andina · Dunkin · La Victoria Lab

Aviva es el contraejemplo útil: subió de 3 a 7 porque su `/nosotros` es más rica
que la home que usábamos. La planilla acertó ahí, y por eso la solución no es
descartarla sino complementarla.

### Fuentes sin resultado

| Fuente | Causa |
|---|---|
| IFS / Interbank | HTTP 403, también en `/nosotros` |
| Retail / Superfood Holding | HTTP 403 en `sostenibilidadspsa.pe` |
| Educación / IDAT | HTTP 999 — `es.linkedin.com` bloquea |
| Retail / Agora · NGR / Popeyes · Chinawok · Don Belisario | HTML sin texto (SPA) |

Contra lo previsto, **LinkedIn funciona en 4 de 5**: `pe.linkedin.com` y
`www.linkedin.com` responden; solo `es.linkedin.com` devolvió 999.

## Opciones para recuperar la profundidad

### A. Dejarlo como está — solo la URL de la planilla

**A favor:** fidelidad total a lo pedido; cero esfuerzo.
**En contra:** el corpus queda 86 hitos por debajo de lo que la app ya servía, y
doce marcas quedan representadas por una sola tarjeta.

### B. Sumar la home a la entrada, manteniendo la etiqueta

**A favor:** ataca la Causa 2 en su raíz. La ficha institucional sigue saliendo
de `/nosotros` —la regla 9 del prompt le da prioridad máxima— y la profundidad
vuelve de la home. Lo que se muestra en pantalla no cambia en nada. Costo: una
URL más por entrada, ~8 minutos de corrida.
**En contra:** reaparece el riesgo de catálogo en los e-commerce, que la regla
10 filtra pero no perfectamente.

### C. Reetiquetar y fusionar los 232 archivados de `output/_web-anterior/`

**A favor:** ataca la Causa 1 de inmediato y sin llamadas al modelo.
**En contra:** ~40 de esos hitos vienen de sitios que la planilla ya no lista
(plazavea, vivanda, mifarma, inkafarma, química suiza, expressnet).

## Recomendación

**B, más C acotada a las empresas que siguen en la planilla.**

Cada una ataca una causa distinta y por eso no compiten. B es la de mayor efecto
por menor superficie: no toca una línea de lo que el cliente ve. C acotada
recupera lo histórico sin contrabandear empresas que la planilla excluyó
deliberadamente, y debe ser un comando reproducible, no una edición a mano de
`output/` — el proyecto ya paga caro cada vez que algo se hace por fuera de un
script.

A queda descartada: cumple la letra del pedido y falla su intención, que es que
el cliente vea bien representadas sus marcas.

Para las fuentes rotas, por orden de valor: **Interbank y Superfood Holding**
son holdings con peso propio y merecen buscar su contenido por otra ruta
—Interbank hoy solo existe en el corpus a través de los reportes corporativos—.
Las cuatro SPA se resuelven como se resolvió SIP: encontrando el CMS que sirve
el contenido real. **IDAT se arregla cambiando `es.linkedin.com` por
`pe.linkedin.com`**, que sí responde.

## Consecuencias

**Más fácil:** distinguir marcas que comparten dominio; leer la procedencia en
pantalla; agregar una fuente, que es copiar una fila de la planilla.

**Más difícil:** `source_file` ya no permite deducir la URL de origen. Si alguien
renombra una empresa en la planilla, cambia la identidad de todos sus hitos
—`key()` es `source_file::title`— y el historial lo verá como bajas y altas,
igual que al renombrar un PDF.

**A revisar:** `build-graph.mjs` descarta aristas entre hitos del mismo
`source_file`. El agrupamiento cambió y el grafo quedó en 3036 aristas, 55%
entre empresas; falta compararlo contra el valor anterior al cambio.

## Pendiente de decisión

- [ ] ¿Se suma la home a las 12 fuentes de un solo hito? (opción B)
- [ ] Carry-over de `output/_web-anterior/`: ¿todo, o solo lo que sigue en la planilla?
- [ ] ¿Se persiguen las fuentes rotas, y en qué orden?

## Action items

1. [x] Reescribir `SOURCES` como lista de entradas de la planilla
2. [x] `etiqueta()` y `slug()` para procedencia y nombre de archivo
3. [x] `extractDataFromWeb(scraped, { origen })` sin romper llamadores
4. [x] Archivar los CSVs por dominio en `output/_web-anterior/`
5. [x] Pruebas de `etiqueta`, `slug` y unicidad de `SOURCES`, verificadas por mutación
6. [x] Publicar: 1894 hitos, índice y traducciones al día, verificación en verde
7. [ ] Resolver los tres puntos de **Pendiente de decisión**
8. [ ] Medir el efecto en el grafo (`DROP_SAME_SOURCE`)
