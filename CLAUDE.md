# CLAUDE.md — intercorp-adn-scripts

## Propósito del proyecto

Script Node.js que convierte PDFs a CSV usando LangChain + OpenAI, con soporte para sincronizar los CSVs generados a Google Drive como Google Sheets. Desarrollado para Intercorp ADN.

## Stack

- **Runtime**: Node.js 16+ con ES Modules (`"type": "module"`)
- **IA**: LangChain (`@langchain/openai`, `@langchain/community`) + OpenAI GPT
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
│   ├── dataService.js    # Extracción de datos con LangChain + OpenAI
│   ├── csvService.js     # Creación y escritura de CSVs
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
npm test               # Verifica que la instalación esté correcta
npm run example        # Ejemplo de uso programático
npm run sync:spreadsheet  # Sube todos los CSVs de output/ a Google Drive (en proceso)
npm run update:vector  # Sube output/merged.csv (como Markdown) al vector store de OpenAI
npm run history        # Muestra el historial de versiones del vector store (--detail, --last)
```

## Variables de entorno requeridas

```
OPENAI_API_KEY             # Requerida para la conversión PDF → CSV
OPENAI_MODEL               # Opcional, default: gpt-4o-mini
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

## Flujo de actualización del vector store (merged.csv → OpenAI)

1. `update-vector-store.js` convierte `output/merged.csv` a Markdown (`## <title>` por fila).
   **El `file_search` de OpenAI no acepta `.csv`**, por eso la conversión es obligatoria;
   además el Markdown se divide en chunks más coherentes para la búsqueda semántica.
2. Sube el `.md` (a un temporal del sistema, no a `output/`), lo asocia al store y espera el `completed`
3. **Recién entonces** elimina los archivos anteriores, para que el store nunca quede vacío si algo falla
4. `historyService.recordVersion()` guarda un snapshot del CSV en `history/snapshots/` y anota en
   `history/history.json` qué cambió respecto de la versión anterior
5. `npm run history` muestra esa línea de tiempo

El diff identifica cada ítem por `source_file` + `title`, y para los modificados registra qué campos
cambiaron. `history/` está ignorado por git.

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
