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
    maxCharactersForExtraction: 60000,
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
