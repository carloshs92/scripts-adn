# CLAUDE.md — intercorp-adn-scripts

## Propósito del proyecto

Script Node.js que convierte PDFs, Excel y sitios web a CSV usando LangChain sobre OpenRouter, exporta el corpus que consume la app `intercorp-adn` y sincroniza los CSVs a Google Drive. Desarrollado para Intercorp ADN.

## Stack

- **Runtime**: Node.js 16+ con ES Modules (`"type": "module"`)
- **IA**: LangChain (`@langchain/openai`, `@langchain/community`) sobre OpenRouter u OpenAI (intercambiables: OpenRouter expone un API compatible)
- **PDFs**: `pdf-parse`
- **CSV**: `csv-writer`, `csv-parser`
- **Google Drive**: `googleapis` con Service Account
- **CLI**: `inquirer` (v8, CommonJS-compatible), `chalk` v4, `open`
- **Configuración**: `dotenv`

## Estructura clave

```
src/
├── index.js              # Punto de entrada → cli/interactive.js
├── config.js             # Parámetros ajustables (modelos, rutas, límites)
│
├── milestone/            # EL DOMINIO — qué es un hito. No depende de nada externo.
│   ├── schema.js         #   FIELDS, CATEGORIES, MISSING, coerce(), PROMPT_SCHEMA
│   ├── identity.js       #   key() entre versiones · titleKey() dentro de una extracción
│   ├── dedupe.js         #   descarte de repetidos, gana mayor score
│   └── index.js          #   barrel del dominio
│
├── ingest/               # CASOS DE USO — de una fuente salen hitos
│   ├── extractFromDocuments.js  # prompt de documentos + chain
│   ├── extractFromSite.js       # prompt web + chain + dedupe
│   ├── fromModelResponse.js     # respuesta del modelo → hitos (4 compuertas)
│   ├── processed.js             # registro de documentos ya procesados
│   ├── document/
│   │   ├── index.js      #     búsqueda y lectura de documentos
│   │   └── spreadsheet.js#     lectura de Excel con exceljs
│   └── site/
│       ├── crawl.js      #     scraping HTML + presupuesto de contenido
│       └── wordpress.js  #     CMS headless vía REST + ACF
│
├── corpus/               # CASOS DE USO — el corpus se consolida, publica y versiona
│   ├── consolidate.js    #   CSVs por documento → merged.csv
│   ├── publishToApp.js   #   merged.csv → milestones.md + versión
│   ├── publishToDrive.js #   CSVs → Google Drive
│   ├── publish.js        #   consolidar + publicar + VERIFICAR el índice
│   ├── version.js        #   snapshots y diff entre versiones
│   └── markdown.js       #   serialización del hito a Markdown
│
├── platform/             # REEMPLAZABLE — nombrado por la herramienta, a propósito
│   ├── llm.js  csv.js  drive.js  log.js  paths.js
│
└── cli/interactive.js    # Flujo interactivo con inquirer
```

## Comandos disponibles

```bash
npm start              # CLI interactivo: convierte PDFs y Excel → un CSV por documento en output/
npm run merge:csv      # Consolida los CSVs de output/ en output/merged.csv
npm run publish:corpus # Consolida + publica milestones.md en la app + VERIFICA su índice
npm test               # Pruebas con vitest (dominio + contrato del corpus)
npm run test:watch     # Las mismas, en modo watch
npm run check:setup    # Verifica que la instalación esté correcta
npm run example        # Ejemplo de uso programático
npm run sync:spreadsheet  # Sube todos los CSVs de output/ a Google Drive (en proceso)
npm run history        # Muestra el historial de versiones del corpus (--detail, --last)
```

## Variables de entorno requeridas

```
OPENROUTER_API_KEY         # Requerida (LLM_PROVIDER=openrouter, el default)
OPENAI_API_KEY             # Solo si se vuelve a LLM_PROVIDER=openai
LLM_PROVIDER               # Opcional: openrouter | openai. Sin definir usa openrouter si hay key suya
LLM_MODEL                  # Opcional, default: openai/gpt-4o-mini (OpenRouter) o gpt-4o-mini (OpenAI)
GOOGLE_SERVICE_ACCOUNT_KEY # Ruta al JSON de service account (para sync)
GOOGLE_DRIVE_FOLDER_ID     # ID de la carpeta destino en Drive (para sync)
OUTPUT_DIR                 # Opcional, default: ./output
MERGED_NAME                # Opcional, default: merged.csv
```

## Pruebas

```
tests/milestone.test.js        El dominio: coerce, key, titleKey, dedupe, PROMPT_SCHEMA
tests/corpus-contract.test.js  El contrato entre repos, ida y vuelta
```

`corpus-contract` es la que más importa: **no hay API ni base compartida entre los dos
proyectos**, el acoplamiento es un Markdown que este repo escribe y `build-graph.mjs` del vecino
parsea. La prueba lleva una copia literal de ese `parseMarkdown()` y verifica el viaje completo —
si la gramática cambia de un lado, el otro no falla, descarta registros en silencio.

Cubre las dos regresiones que ya ocurrieron: el doble espacio en `source_file` que daba identidades
distintas a cada lado, y los saltos de línea dentro de un valor que parten un registro. Esa segunda
defensa vive en dos sitios a propósito —`coerce()` y el serializador— porque `consolidate()` lee las
filas del CSV sin pasar por el dominio.

**Al agregar una prueba, verificá que falle.** Las primeras versiones de estas pasaban con el
código roto: los asserts leían la misma constante que pretendían verificar. La forma de comprobarlo
es mutar el código a mano (anular una constante, quitar un `replace`) y confirmar que la suite se
pone roja.

## Convenciones de código

- Todo el código es **ESM** (`import`/`export`), nunca `require()`
- Comentarios y mensajes de usuario en **español**
- Nombres de variables y funciones en **camelCase inglés**
- Columnas CSV generadas en **snake_case** (configurable en `config.js`)
- El modelo por defecto es `gpt-4o-mini` para optimizar costos
- Campos sin información se marcan como `N/A`
- El `config.js` es la fuente de verdad para parámetros ajustables
- `src/milestone/` es la fuente de verdad de las reglas del hito y **no importa nada de fuera de sí mismo**
- Las dependencias apuntan hacia adentro: `platform/` ← `ingest/` y `corpus/` ← `milestone/`
- Un script de `scripts/` solo parsea argumentos y formatea salida; la lógica vive en un caso de uso

## Flujo principal (PDF/Excel → CSV individual por documento)

1. `pdfService` localiza los documentos soportados en `pdfs/` (`.pdf`, `.xlsx`, `.xlsm`, `.xls`, configurable en `config.paths.supportedExtensions`) y extrae su texto: los PDFs con `pdf-parse`, los Excel con `xlsxService` (una sección `### Hoja: <nombre>` por hoja, columnas separadas por ` | `)
2. El tracker filtra documentos ya procesados (por fingerprint de tamaño + fecha)
3. `dataService.extractDataPerFile()` llama a OpenAI por cada documento y retorna `[{fileName, filePath, rows}]`
4. Por cada documento se crea/sobreescribe `output/<nombre-documento>.csv` con sus filas
5. Cada fila incluye `source_file` con el nombre del documento de origen
6. Los documentos procesados quedan registrados en `.pdf-registry.json`

**Columnas fijas** (definidas en `src/milestone/schema.js` → `FIELDS`):
`title`, `shortDescription`, `category`, `largeDescription`, `company`, `year`, `score`, `source_file`

**Categorías válidas** (`CATEGORIES`): `sustainability`, `talent`, `innovation`, `security`

## El modelo de dominio: `src/milestone/`

El hito es la entidad central. **Todas sus reglas viven en `src/milestone/` y en ningún otro
lugar.** Antes estaban repartidas: el esquema y las categorías en `dataService`, la coerción
duplicada entre `dataService` y `webDataService`, la identidad en `historyService` y la clave de
deduplicación en `webDataService` — seis piezas del mismo concepto en cuatro archivos, con 38
líneas de código idénticas entre los dos extractores.

| Qué | Dónde |
|---|---|
| Campos, categorías y sus fallbacks | `schema.js` → `FIELDS`, `CATEGORIES`, `MISSING` |
| Coerción de la respuesta del modelo | `schema.js` → `coerce(item, sourceFile)` |
| Esquema expresado para el prompt | `schema.js` → `PROMPT_SCHEMA` (llaves dobladas para LangChain) |
| Identidad entre versiones del corpus | `identity.js` → `key()` = `source_file::title` |
| Identidad dentro de una extracción | `identity.js` → `titleKey()` (sin tildes ni puntuación) |
| Descarte de repetidos | `dedupe.js` → `dedupe()`, gana mayor `score` |
| Parseo de la respuesta del modelo | `fromModelResponse.js` → 4 compuertas que degradan a `[]` |

**Reglas al tocar esto:**
- Agregar una columna se hace en `FIELDS` y en `coerce()`, nada más; `PROMPT_SCHEMA` la declara
  para el modelo y `markdownService` la serializa sola.
- `source_file` nunca viene del modelo: lo impone quien conoce el origen.
- Ningún servicio debe volver a escribir `'N/A'` a mano: usar `MISSING` y `hasValue()`.
- `dataService` y `webDataService` solo deben contener su prompt y la invocación de la chain.

## Flujo de merge (CSVs individuales → merged.csv)

1. `scripts/merge-csv.js` busca todos los `*.csv` en `output/` (excepto `merged.csv`)
2. Lee cada CSV y acumula las filas
3. Genera `output/merged.csv` con todas las filas combinadas
4. Respeta el orden de columnas del primer CSV con datos

## Flujo de scraping web (webs → CSV por dominio)

1. `scripts/scrape-web.js` define las fuentes en `SOURCES`, agrupadas por categoría.
   Una entrada puede ser un string (`'https://x.pe/'`) o un objeto con varias URLs
   y configuración extra: `{ urls: [...], wordpress: { origin, prioritySlugs } }`
2. `groupByDomain()` junta todas las URLs de un mismo dominio en **una sola pasada**
   y **un solo CSV** (`output/web-<dominio>.csv`). Sin esto, dos URLs del mismo sitio
   generaban el mismo nombre de archivo y se pisaban entre sí
3. `scrapeWebsite(urls, { wordpress })` descarga las URLs indicadas, descubre subpáginas
   de contenido (blog/noticias/prensa) y arma el texto para el modelo
4. **Sitios SPA** (Angular/React) devuelven HTML sin texto. Para esos se declara
   `wordpress.origin` y `wordpressService` trae el contenido real del CMS headless por
   `wp-json/wp/v2/{pages,posts}` + `wp-json/acf/v3/...`. `prioritySlugs` se piden por slug
   (el listado general viene ordenado por fecha y puede no incluirlos)
5. El contenido se arma por prioridad: páginas institucionales y semillas primero,
   subpáginas después, cada una limitada a `MAX_PAGE_CHARS` y el total a `MAX_CONTENT_CHARS`
6. `webDataService.extractDataFromWeb()` extrae los ítems y `dedupeRows()` descarta
   títulos repetidos (normalizando tildes/puntuación), conservando el de mayor `score`

**Ejemplo real**: `sip.pe` es una SPA cuyas 3 URLs devuelven el mismo shell vacío;
su contenido vive en `cms.sip.pe`.

## Proveedor de LLM (OpenRouter u OpenAI)

`llmService.createChatModel()` es el único punto que instancia el modelo; `dataService` y
`webDataService` lo usan. OpenRouter expone un API compatible con el de OpenAI, así que solo
cambian `baseURL` y la key — prompts, parseo de JSON y LangChain quedan igual.

Verificado: `openai/gpt-4o-mini` por OpenRouter consume los mismos tokens y da la misma calidad
que el directo, al mismo precio ($0.15/$0.60 por 1M).

**Cuidado con los modelos de razonamiento**: `gpt-5-nano` parece 3x más barato por token, pero
genera ~8x más tokens de salida y termina costando más. Y los modelos chicos no-OpenAI
(`mistral-nemo`) rompen el JSON que el pipeline necesita.

**El vector store se dio de baja.** OpenRouter no tiene `/vector_stores` (404), pero tampoco hacía
falta: la app dejó de consultarlo al pasar a la búsqueda rápida con índice local. Con él se retiró
`update-vector-store.js`, y el histórico —que colgaba de esa subida— pasó a `export:corpus`.

## Publicar el corpus (merged.csv → la app)

`npm run publish:corpus` encadena tres cosas que antes eran tres comandos sueltos:

1. `corpus/consolidate.js` — combina los `output/*.csv` en `merged.csv`. Ordena los archivos
   alfabéticamente para que el corpus sea reproducible entre máquinas (antes el orden lo daba
   el filesystem vía `glob`)
2. `corpus/publishToApp.js` — escribe `../intercorp-adn/data/milestones.md` y registra la versión
3. `corpus/publish.js` — **verifica** que el índice commiteado de la app cubra exactamente los
   hitos publicados, comparando identidades con `milestone.key()`, no cantidades

**Por qué existe el paso 3.** Su ausencia costó dos semanas de datos viejos: el índice quedó en
609 hitos mientras el CSV tenía 620, sin una excepción ni una línea de log. Un conteo no alcanza
—dos corpus pueden tener 620 filas y no ser el mismo— así que se comparan identidades. Cuando
detecta desfase imprime los hitos que faltan o sobran y el comando exacto para regenerar el
índice; no puede hacerlo solo porque `build-graph.mjs` vive en el otro repositorio.

## Flujo de sincronización (CSV → Google Drive)

1. `sync-spreadsheet.js` busca todos los `*.csv` en `output/`
2. `driveService.uploadCSV()` sube cada uno a la carpeta de Drive indicada
3. Si el archivo ya existe en Drive, lo actualiza en lugar de duplicarlo

## Notas importantes

- `inquirer` es v8 (no v9+) para mantener compatibilidad con la forma de importación usada
- `chalk` es v4 (no v5+) por la misma razón de compatibilidad ESM/CJS
- Las credenciales de Google deben estar en `credentials/` (ignorado por git)
- Los PDFs y Excel van en `pdfs/` y los CSVs se generan en `output/` (ambos ignorados por git)
- Cada PDF genera **2 llamadas a la API** de OpenAI (una para columnas, una para extracción)
- Los Excel se leen con `exceljs`; el texto se trunca en `config.xlsx.maxCharactersForExtraction` (60 000 caracteres por defecto) para no desbordar el contexto del modelo
