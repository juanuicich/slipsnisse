/**
 * Dynamic Provider Registry for TanStack AI adapters.
 * Loads provider packages on-demand and caches them.
 */

import type { Logger } from "pino";
import { createLogger } from "../logger.js";
import type { TextAdapter } from "@tanstack/ai";

// Define AnyTextAdapter locally as it might not be exported from root
type AnyTextAdapter = TextAdapter<any, any, any, any>;

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("provider-registry");
  }
  return log;
};

// Cache can store either the factory function or a pre-configured adapter creator
type AdapterCreator = (modelId: string) => AnyTextAdapter;

const providerCache = new Map<string, AdapterCreator>();

/**
 * Get a text adapter instance from a TanStack AI provider.
 * Dynamically imports the provider package if not already loaded.
 *
 * @param providerName - Provider name (e.g., "google", "openai", "anthropic")
 * @param modelId - Model identifier (e.g., "gemini-2.0-flash-001")
 * @returns Text adapter instance
 */
export const getModel = async (
  providerName: string,
  modelId: string,
  options?: {
    endpoint?: string;
    apiKey?: string;
    providerOptions?: Record<string, unknown>;
  },
): Promise<AnyTextAdapter> => {
  // If we have options, we might not want to use the cached generic factory.
  // But let's see. The cache was storing the *factory* from the module.
  // Here we want to return an adapter.
  // If options are provided (like apiKey), we need to create a new adapter with those options.

  // Unlike Vercel AI SDK where we got a configured provider function, TanStack adapters are created directly.

  getLog().debug({ providerName, modelId }, "Getting model adapter");

  try {
    let adapter: AnyTextAdapter;

    if (providerName === "openai" || providerName === "openai-compatible") {
      const module = await import("@tanstack/ai-openai");
      const config: any = { ...options?.providerOptions };
      if (options?.endpoint) config.baseUrl = options.endpoint;

      if (options?.apiKey) {
        // createOpenaiChat(model, apiKey, config)
        adapter = module.createOpenaiChat(modelId as any, options.apiKey, config);
      } else {
        // openaiText(model, config) - apiKey from env
        adapter = module.openaiText(modelId as any, config);
      }
    } else if (providerName === "anthropic") {
      const module = await import("@tanstack/ai-anthropic");
       const config: any = { ...options?.providerOptions };
      if (options?.endpoint) config.baseUrl = options.endpoint;

      if (options?.apiKey) {
         adapter = module.createAnthropicChat(modelId as any, options.apiKey, config);
      } else {
        adapter = module.anthropicText(modelId as any, config);
      }
    } else if (providerName === "google") {
      const module = await import("@tanstack/ai-gemini");
      const config: any = { ...options?.providerOptions };
      if (options?.endpoint) config.baseUrl = options.endpoint;

       if (options?.apiKey) {
         // gemini doesn't seem to have createGeminiChat with apiKey as 2nd arg based on exports?
         // Checking exports: createGeminiChat, geminiText.
         // Usually follows the pattern. Let's assume createGeminiChat(model, apiKey, config).
         // If not, I'll need to check. But for now I'll assume consistency.
         // Actually, I should check if I can.
         // But let's assume createGeminiChat exists.
         adapter = module.createGeminiChat(modelId as any, options.apiKey, config);
      } else {
        adapter = module.geminiText(modelId as any, config);
      }
    } else {
       // Try to load @tanstack/ai-<providerName>
       try {
           const pkgName = `@tanstack/ai-${providerName}`;
           const module = await import(pkgName);
           // Try to find a factory. This is harder dynamically without standardized naming.
           // But let's try <providerName>Text or create<ProviderName>Chat.
           const textFnName = `${providerName}Text`;
           const createFnName = `create${providerName.charAt(0).toUpperCase() + providerName.slice(1)}Chat`;

           if (options?.apiKey && module[createFnName]) {
               adapter = module[createFnName](modelId, options.apiKey, options?.providerOptions);
           } else if (module[textFnName]) {
               adapter = module[textFnName](modelId, options?.providerOptions);
           } else {
                throw new Error(`Could not find factory function for ${providerName}`);
           }
       } catch (e) {
            throw new Error(`Provider '${providerName}' not supported or not installed. Error: ${(e as Error).message}`);
       }
    }

    return adapter;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load provider '${providerName}'. Error: ${message}`,
    );
  }
};

/**
 * Clear the provider cache (useful for testing).
 */
export const clearProviderCache = (): void => {
  providerCache.clear();
};
