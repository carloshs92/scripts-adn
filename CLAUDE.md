# CLAUDE.md — intercorp-adn-scripts

## Propósito del proyecto

Script Node.js que convierte PDFs a CSV usando LangChain + OpenAI, con soporte para sincronizar los CSVs generados a Google Drive como Google Sheets. Desarrollado para Intercorp ADN.

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
├── index.js              # Punto de entrada → corre cli/interactive.js
├── config.js             # Configuración centralizada (modelos, rutas, límites)
├── services/
│   ├── pdfService.js     # Búsqueda de documentos y extracción de texto (PDF y Excel)
│   ├── xlsxService.js    # Extracción de texto de archivos Excel (.xlsx/.xlsm/.xls)
│   ├── llmService.js     # Proveedor de LLM (OpenRouter u OpenAI) y creación del modelo
│   ├── markdownService.js # Conversión de filas del CSV a Markdown (por fuente o corpus único)
│   ├── dataService.js    # Extracción de datos con LangChain
│   ├── csvService.js     # Creación y escritura de CSVs
│   ├── webScraperService.js # Scraping de sitios web (agrupa URLs por dominio)
│   ├── wordpressService.js  # Lectura de CMS headless vía REST + ACF (sitios SPA)
│   ├── webDataService.js # Extracción de ítems desde contenido web + dedupe
│   ├── driveService.js   # Upload de CSVs a Google Drive como Sheets
│   └── historyService.js # Snapshots y diff entre versiones del vector store
├── cli/
│   └── interactive.js    # Flujo interactivo CLI con inquirer
└── utils/
    ├── logger.js         # Logging coloreado con chalk
    ├── tracker.js        # Seguimiento de progreso
    └── validator.js      # Validación de rutas y config
scripts/
├── sync-spreadsheet.js   # Sube output/*.csv a Google Drive
├── update-vector-store.js # Actualiza el vector store de OpenAI + registra la versión
├── history.js            # Muestra el historial de versiones del vector store
└── test-setup.js         # Verifica instalación
```

## Comandos disponibles

```bash
npm start              # CLI interactivo: convierte PDFs y Excel → un CSV por documento en output/
npm run merge:csv      # Combina todos los CSVs de output/ en output/merged.csv
npm run export:corpus  # Exporta merged.csv como Markdown (--app lo escribe en intercorp-adn/data/milestones.md)
npm test               # Verifica que la instalación esté correcta
npm run example        # Ejemplo de uso programático
npm run sync:spreadsheet  # Sube todos los CSVs de output/ a Google Drive (en proceso)
npm run update:vector  # Sube output/merged.csv (como Markdown) al vector store de OpenAI
npm run history        # Muestra el historial de versiones del vector store (--detail, --last)
```

## Variables de entorno requeridas

```
OPENAI_API_KEY             # Requerida para update:vector (y para la extracción si LLM_PROVIDER=openai)
OPENROUTER_API_KEY         # Requerida si LLM_PROVIDER=openrouter
LLM_PROVIDER               # Opcional: openrouter | openai. Sin definir usa openrouter si hay key suya
LLM_MODEL                  # Opcional, default: openai/gpt-4o-mini (OpenRouter) o gpt-4o-mini (OpenAI)
GOOGLE_SERVICE_ACCOUNT_KEY # Ruta al JSON de service account (para sync)
GOOGLE_DRIVE_FOLDER_ID     # ID de la carpeta destino en Drive (para sync)
VECTOR_STORE_ID            # ID del vector store de OpenAI (para update:vector)
OUTPUT_DIR                 # Opcional, default: ./output
MERGED_NAME                # Opcional, default: merged.csv
```

## Convenciones de código

- Todo el código es **ESM** (`import`/`export`), nunca `require()`
- Comentarios y mensajes de usuario en **español**
- Nombres de variables y funciones en **camelCase inglés**
- Columnas CSV generadas en **snake_case** (configurable en `config.js`)
- El modelo por defecto es `gpt-4o-mini` para optimizar costos
- Campos sin información se marcan como `N/A`
- El `config.js` es la fuente de verdad para parámetros ajustables

## Flujo principal (PDF/Excel → CSV individual por documento)

1. `pdfService` localiza los documentos soportados en `pdfs/` (`.pdf`, `.xlsx`, `.xlsm`, `.xls`, configurable en `config.paths.supportedExtensions`) y extrae su texto: los PDFs con `pdf-parse`, los Excel con `xlsxService` (una sección `### Hoja: <nombre>` por hoja, columnas separadas por ` | `)
2. El tracker filtra documentos ya procesados (por fingerprint de tamaño + fecha)
3. `dataService.extractDataPerFile()` llama a OpenAI por cada documento y retorna `[{fileName, filePath, rows}]`
4. Por cada documento se crea/sobreescribe `output/<nombre-documento>.csv` con sus filas
5. Cada fila incluye `source_file` con el nombre del documento de origen
6. Los documentos procesados quedan registrados en `.pdf-registry.json`

**Columnas fijas** (definidas en `dataService.COLUMNS`):
`title`, `shortDescription`, `category`, `largeDescription`, `company`, `year`, `score`, `source_file`

**Categorías válidas**: `sustainability`, `talent`, `innovation`, `security`

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

## Flujo de actualización del vector store (merged.csv → OpenAI)

1. `update-vector-store.js` convierte `output/merged.csv` a Markdown, **un archivo por
   `source_file`** (`## <title>` por fila). Dos razones:
   - **El `file_search` de OpenAI no acepta `.csv`**, así que convertir es obligatorio
   - Con un único `.md` grande, cada chunk mezclaba ítems de empresas distintas (el chunk
     con "Qué es Sip" empezaba con un ítem de UTP) y su embedding dejaba de representar a
     ninguna. Un archivo por fuente mantiene cada chunk dentro de un mismo contexto
2. Sube los `.md` (a un temporal del sistema, no a `output/`) y los asocia con
   `fileBatches` usando chunking `static` de 400 tokens / 100 de solape
3. **Recién cuando el lote está `completed`** elimina los archivos anteriores, para que el
   store nunca quede vacío si algo falla
4. `historyService.recordVersion()` guarda un snapshot del CSV en `history/snapshots/` y anota en
   `history/history.json` qué cambió respecto de la versión anterior, junto con los `fileIds` subidos
5. `npm run history` muestra esa línea de tiempo

El diff identifica cada ítem por `source_file` + `title`, y para los modificados registra qué campos
cambiaron. `history/` está ignorado por git.

**Cuidado con el listado de archivos del store**: `vectorStores.files.list()` devuelve menos
archivos de los que reporta `file_counts` (verificado: 24 de 31). Por eso los archivos a eliminar
salen de los `fileIds` guardados en el historial, unidos a lo que devuelva el listado.

## Proveedor de LLM (OpenRouter u OpenAI)

`llmService.createChatModel()` es el único punto que instancia el modelo; `dataService` y
`webDataService` lo usan. OpenRouter expone un API compatible con el de OpenAI, así que solo
cambian `baseURL` y la key — prompts, parseo de JSON y LangChain quedan igual.

Verificado: `openai/gpt-4o-mini` por OpenRouter consume los mismos tokens y da la misma calidad
que el directo, al mismo precio ($0.15/$0.60 por 1M).

**Cuidado con los modelos de razonamiento**: `gpt-5-nano` parece 3x más barato por token, pero
genera ~8x más tokens de salida y termina costando más. Y los modelos chicos no-OpenAI
(`mistral-nemo`) rompen el JSON que el pipeline necesita.

**El vector store sigue en OpenAI**: OpenRouter no tiene `/vector_stores` (404), así que
`update-vector-store.js` usa `OPENAI_API_KEY` sin importar `LLM_PROVIDER`.

## Exportar el corpus para la app (merged.csv → milestones.md)

`npm run export:corpus -- --app` escribe `../intercorp-adn/data/milestones.md`, que es la entrada
de `build-graph.mjs` y por lo tanto del índice de búsqueda rápida de la app.

Antes ese archivo se exportaba a mano desde el vector store y quedaba desactualizado en silencio:
la app respondía con datos viejos sin que nada fallara. Después de cada `merge:csv` conviene
correr también este export y regenerar el índice en la app.

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
