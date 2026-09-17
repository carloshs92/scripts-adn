---
name: pipeline-corpus
description: Procedimiento oficial para regenerar el corpus de Intercorp ADN y publicarlo a la app del kiosko. Úsalo cuando haya que agregar o quitar documentos de pdfs/, cambiar las fuentes web de SOURCES, ajustar las reglas de los prompts de extracción, o cuando la app esté sirviendo datos viejos. También cuando alguien pregunte en qué orden se corren los comandos o por qué el índice no coincide con el corpus.
---

# Pipeline del corpus

El corpus vive en dos repositorios que se acoplan por un archivo, no por una API:
`intercorp-adn-scripts` lo produce e `intercorp-adn` lo indexa y lo sirve.

**Regla primera: usar los comandos de `package.json`.** No editar los CSV de `output/`
ni el registro a mano. Si algo no se puede hacer con un comando, el arreglo es
cambiar el script, no saltárselo — lo que se hace a mano no se reproduce y el
corpus deja de ser trazable a su fuente.

## Orden de ejecución

Siempre de arriba hacia abajo. Cada paso depende del anterior.

```bash
# ── en intercorp-adn-scripts ──────────────────────────────────────────
npm start                      # 1. documentos de pdfs/ → un CSV por documento
npm run scrape:web             # 2. sitios de SOURCES → un CSV por dominio
npm run merge:csv              # 3. todos los CSV → output/merged.csv
npm run publish:corpus         # 4. publica milestones.md y VERIFICA el índice

# ── en intercorp-adn ──────────────────────────────────────────────────
npm run corpus:index           # 5. reconstruye el índice de búsqueda y el grafo
npm run corpus:translate       # 6. traduce al inglés los hitos nuevos

# ── de vuelta en intercorp-adn-scripts ────────────────────────────────
npm run publish:corpus         # 7. confirma que el índice ya coincide
```

Los pasos 1 y 2 son independientes entre sí: se puede correr solo uno. Del 3 en
adelante es una cadena.

## Cuándo correr cada paso

| Cambió | Correr desde |
|---|---|
| Un PDF o Excel en `pdfs/` | 1 |
| Las URLs de `SOURCES` | 2 |
| Un prompt de extracción | 1 y 2, con `--force` |
| Nada, solo republicar | 3 |

### Regenerar cuando cambian los prompts

```bash
npm start -- --force                          # todos los documentos, sin preguntar
npm start -- --pdf "pdfs/archivo.pdf" --force # uno solo
```

Sin `--force`, el registro por huella (`.pdf-registry.json`) salta los documentos
ya procesados. `--force` también evita el diálogo interactivo, así que es la vía
para correrlo desde un script o una tarea programada.

## Qué esperar

La extracción trocea los documentos: un reporte de 400 000 caracteres son unas
30 llamadas al modelo, no una. Una corrida completa de los 13 documentos son
~105 llamadas, unos 8 minutos con la concurrencia en 5, y cuesta unos USD 0,15.
Hay barra de progreso; si la consola queda muda más de un minuto, algo se colgó.

Trocear no es un detalle de rendimiento: mandando el reporte entero, el modelo
resume en vez de extraer y la densidad cae de 147 hitos por cada 10 000
caracteres a 1,6. El corpus pasó de 685 a 1 980 hitos al trocear.

## La verificación del paso 4 y 7

`publish:corpus` compara el corpus publicado contra el índice que la app tiene
commiteado, **por identidad de hito, no por cantidad** — dos corpus pueden tener
el mismo número de filas y no ser el mismo. Si dice que el índice quedó atrás,
falta correr el paso 5. Nunca dar por buena una publicación sin ver:

```
✓ El índice tiene N hitos: coincide con lo publicado
```

Esa verificación existe porque su ausencia costó dos semanas de datos viejos: el
índice quedó en 609 hitos con el CSV en 620, sin una excepción ni una línea de log.

## Medir la calidad

```bash
cd intercorp-adn
node eval/run.mjs                 # mide y guarda la línea base
node eval/run.mjs --compare       # mide y compara contra ella
node eval/run.mjs --generate      # mide el modo con generación
```

Reporta tres varas. **"Estricta"** solo cuenta si el ítem responde la pregunta;
es la de los buscadores y castiga a este producto, porque ante "qué es Promart",
con siete tarjetas fijas y una sola ficha institucional, el techo por
construcción es 1 de 7. **"Merece pantalla"** pregunta lo que decidiría un
curador. Que dé más bajo que "laxa" muestra que no es una vara blanda.

El juez es un modelo y varía entre corridas. El protocolo lo estabiliza —tres
votos y mediana, cada ítem juzgado independiente del resto, pool fijo— pero aun
así **no leer diferencias menores a 5 puntos como señal**.

## Errores conocidos

**El scraping falla en algunos sitios y está bien.** `interbank.pe` y
`supermercadosperuanos.com.pe` devuelven 403, `expressnet.pe` y
`web.quimicasuiza.com` tienen problemas de certificado. El script sigue con el
resto; no es motivo para abortar.

**Las extracciones no son deterministas.** El mismo PDF devolvió 14, 11 y 12
hitos en tres corridas, y una vez un JSON inválido que las compuertas atraparon.
Por eso los scripts **fusionan** en vez de reemplazar: correr dos veces acumula
cobertura. Volver a correr un documento es una forma legítima de mejorar su
extracción.

**Alternar `npm run build` y `npm run dev` en la app cuelga el compilador.**
Borrar `.next` entre uno y otro.

**La app usa pnpm.** Correr `npm install` ahí rompe el árbol de `node_modules`.
