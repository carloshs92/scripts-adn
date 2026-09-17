import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Configuración del proveedor de LLM.
 *
 * OpenRouter expone un API compatible con el de OpenAI, así que basta con
 * cambiar la baseURL y la key: el resto del código (LangChain, prompts,
 * parseo de JSON) no cambia. Verificado: `openai/gpt-4o-mini` por OpenRouter
 * consume los mismos tokens y produce la misma calidad que el directo.
 *
 * Se elige con LLM_PROVIDER en el .env:
 *   openrouter → usa OPENROUTER_API_KEY (default si está definida)
 *   openai     → usa OPENAI_API_KEY
 */
const PROVIDERS = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    // OpenRouter exige el prefijo del proveedor en el nombre del modelo
    defaultModel: 'openai/gpt-4o-mini',
  },
  openai: {
    baseURL: undefined,
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
};

/**
 * Determina el proveedor activo. Sin LLM_PROVIDER explícito se usa OpenRouter
 * si hay key suya, y OpenAI en caso contrario (compatibilidad hacia atrás).
 * @returns {string} 'openrouter' u 'openai'
 */
export function activeProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (PROVIDERS[explicit]) return explicit;
  return process.env.OPENROUTER_API_KEY ? 'openrouter' : 'openai';
}

/**
 * Datos del proveedor activo, ya resueltos
 * @returns {{name: string, apiKey: string, baseURL: string|undefined, model: string}}
 */
export function llmConfig() {
  const name = activeProvider();
  const provider = PROVIDERS[name];
  const apiKey = process.env[provider.envKey];

  if (!apiKey) {
    throw new Error(
      `${provider.envKey} no está definida en el archivo .env (LLM_PROVIDER=${name})`
    );
  }

  return {
    name,
    apiKey,
    baseURL: provider.baseURL,
    model: process.env.LLM_MODEL || provider.defaultModel,
  };
}

/**
 * Crea el modelo de chat apuntando al proveedor configurado
 * @param {Object} [overrides] - Opciones extra para ChatOpenAI
 * @returns {ChatOpenAI}
 */
export function createChatModel(overrides = {}) {
  const { apiKey, baseURL, model } = llmConfig();

  return new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: model,
    // Reintentos ante 429 y errores transitorios. Con los trozos en paralelo
    // el rate limit se toca de vez en cuando, y el SDK espera y reintenta solo.
    maxRetries: config.openai.maxRetries,
    ...(baseURL ? { configuration: { baseURL } } : {}),
    ...overrides,
  });
}

export default { activeProvider, llmConfig, createChatModel };
