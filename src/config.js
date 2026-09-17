/**
 * config.js
 * 
 * Configuración centralizada para el script de conversión PDF a CSV
 */

export const config = {
  // Configuración de OpenAI
  openai: {
    // Modelo a usar para definir columnas
    columnsModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',

    // Modelo a usar para extracción de datos
    extractionModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',

    // Temperatura para las respuestas (0-1, menor = más determinístico)
    columnTemperature: 0.2,
    extractionTemperature: 0.3,

    // Máximo número de intentos de reintentos
    maxRetries: 3,
  },

  // Troceado de documentos para la extracción
  chunking: {
    // Caracteres por llamada al modelo. Un reporte de sostenibilidad puede
    // tener 400.000 caracteres: mandarlo entero entra en el contexto pero el
    // modelo resume en vez de extraer, y la densidad se desploma de 147 hitos
    // por cada 10.000 caracteres a 1,6. Se trocea para que cada llamada vea
    // una porción que pueda agotar.
    maxCharactersPerCall: 15000,

    // Solape entre trozos, para no partir un hito por la mitad
    overlapCharacters: 600,

    // Trozos en vuelo a la vez. En serie, 105 llamadas tardaron 34 minutos.
    // El límite no existe por miedo al rate limit —un 429 se reintenta, no
    // pierde nada— sino para no encolar cien peticiones que el proveedor va a
    // rechazar igual, y para que el progreso avance de forma legible.
    concurrency: 5,
  },

  // Configuración de procesamiento de PDFs
  pdf: {
    // Máximo número de caracteres a usar para definir columnas
    maxCharactersForColumns: 2000,

    // Máximo número de caracteres a usar para extracción por PDF
    maxCharactersForExtraction: 10000,
  },

  // Configuración de procesamiento de Excel
  xlsx: {
    // Máximo número de caracteres a enviar al modelo por archivo Excel
    // (las hojas grandes se truncan para no desbordar el contexto)
    // Sin tope: el troceado de `chunking` se encarga de que cada llamada vea
    // una porción manejable, así que ya no hace falta descartar hojas enteras.
    maxCharactersForExtraction: Number.MAX_SAFE_INTEGER,
  },

  // Configuración de CSV
  csv: {
    // Marcar siempre las celdas con comillas
    alwaysQuote: false,

    // Codificación a usar
    encoding: 'utf8',

    // Separador (por defecto coma)
    delimiter: ',',
  },

  // Configuración de columnas automáticas
  columns: {
    // Número mínimo de columnas a generar
    minColumns: 5,

    // Número máximo de columnas a generar
    maxColumns: 15,

    // Usar snake_case para nombres de columnas
    useSnakeCase: true,

    // Columnas por defecto si hay error
    defaultColumns: ['documento', 'contenido', 'fecha', 'autor', 'resumen'],
  },

  // Rutas por defecto
  paths: {
    pdfsDir: './pdfs',
    // Extensiones aceptadas dentro de pdfsDir
    supportedExtensions: ['.pdf', '.xlsx', '.xlsm', '.xls'],
    outputDir: './output',
    // Snapshots e historial de cada actualización del vector store
    historyDir: './history',
    defaultCSVName: 'datos.csv',
  },

  // Configuración de interfaz
  ui: {
    // Mostrar detalles verbose
    verbose: true,

    // Mostrar tiempo de ejecución
    showExecutionTime: true,
  },
};

export default config;
