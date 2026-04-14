# PDF to CSV Converter con LangChain

Script interactivo que transforma archivos PDF a CSV usando LangChain y OpenAI. Define automáticamente las columnas analizando el contenido de los PDFs.

## Requisitos

- Node.js 16+
- API key de OpenAI

## Instalación

```bash
npm install
cp .env.example .env
# Edita .env y añade tu OPENAI_API_KEY
mkdir -p pdfs output
```

O usa el script de instalación:

```bash
./setup.sh
```

## Uso

### Interactivo (recomendado)

```bash
npm start
```

El script pedirá la ruta de los PDFs y del CSV de salida. Si el CSV ya existe, pregunta si añadir datos al existente.

### Programático

```bash
npm run example
```

### Verificar instalación

```bash
npm test
```

## Estructura

```
src/
├── index.js                    # Punto de entrada
├── config.js                   # Configuración centralizada
├── services/
│   ├── pdfService.js           # Búsqueda y extracción de texto de PDFs
│   ├── dataService.js          # Extracción inteligente con LangChain + OpenAI
│   └── csvService.js           # Creación y escritura de CSVs
├── cli/
│   └── interactive.js          # Flujo interactivo CLI
├── utils/
│   ├── logger.js               # Logging coloreado
│   └── validator.js            # Validación de rutas y configuración
└── examples/
    └── programmatic-usage.js   # Ejemplos de uso como librería
scripts/
└── test-setup.js               # Verificador de instalación
pdfs/                           # Coloca tus PDFs aquí
output/                         # Los CSVs se generan aquí
```

## Variables de entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `OPENAI_API_KEY` | Sí | - | Tu API key de OpenAI |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Modelo a usar |

## Uso como librería

```javascript
import * as pdfService from './src/services/pdfService.js';
import * as dataService from './src/services/dataService.js';
import * as csvService from './src/services/csvService.js';

const pdfFiles = await pdfService.findPDFs('./pdfs/*.pdf');
const columns = await dataService.defineColumns(pdfFiles);
const data = await dataService.extractData(pdfFiles, columns);

await csvService.create('./output/datos.csv', columns);
await csvService.addRows('./output/datos.csv', data, columns);
```

## Solución de problemas

**"OPENAI_API_KEY no está definida"** — Crea el archivo `.env` con tu API key.

**"No se encontraron archivos PDF"** — Verifica que los PDFs estén en la ruta indicada y usa barras inclinadas (`/`).

**El CSV aparece vacío** — El PDF puede no tener texto seleccionable (solo imágenes). Verifica que el PDF tenga texto.

**Errores de cuota OpenAI** — Revisa tu uso en platform.openai.com. Cada PDF genera 2 llamadas a la API.

## Notas

- Usa `gpt-4o-mini` por defecto para optimizar costos
- Los campos sin información se marcan como `N/A`
- El CSV se actualiza sin perder datos anteriores

## Licencia

ISC
