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
│   ├── pdfService.js     # Búsqueda y extracción de texto de PDFs
│   ├── dataService.js    # Extracción de datos con LangChain + OpenAI
│   ├── csvService.js     # Creación y escritura de CSVs
│   └── driveService.js   # Upload de CSVs a Google Drive como Sheets
├── cli/
│   └── interactive.js    # Flujo interactivo CLI con inquirer
└── utils/
    ├── logger.js         # Logging coloreado con chalk
    ├── tracker.js        # Seguimiento de progreso
    └── validator.js      # Validación de rutas y config
scripts/
├── sync-spreadsheet.js   # Sube output/*.csv a Google Drive
└── test-setup.js         # Verifica instalación
```

## Comandos disponibles

```bash
npm start              # CLI interactivo: convierte PDFs → un CSV por PDF en output/
npm run merge:csv      # Combina todos los CSVs de output/ en output/merged.csv
npm test               # Verifica que la instalación esté correcta
npm run example        # Ejemplo de uso programático
npm run sync:spreadsheet  # Sube todos los CSVs de output/ a Google Drive (en proceso)
```

## Variables de entorno requeridas

```
OPENAI_API_KEY             # Requerida para la conversión PDF → CSV
OPENAI_MODEL               # Opcional, default: gpt-4o-mini
GOOGLE_SERVICE_ACCOUNT_KEY # Ruta al JSON de service account (para sync)
GOOGLE_DRIVE_FOLDER_ID     # ID de la carpeta destino en Drive (para sync)
OUTPUT_DIR                 # Opcional, default: ./output
```

## Convenciones de código

- Todo el código es **ESM** (`import`/`export`), nunca `require()`
- Comentarios y mensajes de usuario en **español**
- Nombres de variables y funciones en **camelCase inglés**
- Columnas CSV generadas en **snake_case** (configurable en `config.js`)
- El modelo por defecto es `gpt-4o-mini` para optimizar costos
- Campos sin información se marcan como `N/A`
- El `config.js` es la fuente de verdad para parámetros ajustables

## Flujo principal (PDF → CSV individual por PDF)

1. `pdfService` localiza y extrae texto de los PDFs
2. El tracker filtra PDFs ya procesados (por fingerprint de tamaño + fecha)
3. `dataService.extractDataPerFile()` llama a OpenAI por cada PDF y retorna `[{fileName, filePath, rows}]`
4. Por cada PDF se crea/sobreescribe `output/<nombre-pdf>.csv` con sus filas
5. Cada fila incluye `source_file` con el nombre del PDF de origen
6. Los PDFs procesados quedan registrados en `.pdf-registry.json`

**Columnas fijas** (definidas en `dataService.COLUMNS`):
`title`, `shortDescription`, `category`, `largeDescription`, `company`, `year`, `score`, `source_file`

**Categorías válidas**: `sustainability`, `talent`, `innovation`, `security`

## Flujo de merge (CSVs individuales → merged.csv)

1. `scripts/merge-csv.js` busca todos los `*.csv` en `output/` (excepto `merged.csv`)
2. Lee cada CSV y acumula las filas
3. Genera `output/merged.csv` con todas las filas combinadas
4. Respeta el orden de columnas del primer CSV con datos

## Flujo de sincronización (CSV → Google Drive)

1. `sync-spreadsheet.js` busca todos los `*.csv` en `output/`
2. `driveService.uploadCSV()` sube cada uno a la carpeta de Drive indicada
3. Si el archivo ya existe en Drive, lo actualiza en lugar de duplicarlo

## Notas importantes

- `inquirer` es v8 (no v9+) para mantener compatibilidad con la forma de importación usada
- `chalk` es v4 (no v5+) por la misma razón de compatibilidad ESM/CJS
- Las credenciales de Google deben estar en `credentials/` (ignorado por git)
- Los PDFs van en `pdfs/` y los CSVs se generan en `output/` (ambos ignorados por git)
- Cada PDF genera **2 llamadas a la API** de OpenAI (una para columnas, una para extracción)
