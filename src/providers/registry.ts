/**
 * Dynamic Provider Registry for Vercel AI SDK providers.
 * Loads provider packages on-demand and caches them.
 */

import type { LanguageModel } from "ai";
import { createLogger } from "../logger.js";
import type { Logger } from "pino";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("provider-registry");
  }
  return log;
};

type ProviderFunction = (modelId: string) => LanguageModel;

const providerCache = new Map<string, ProviderFunction>();

/**
 * Get a model instance from a Vercel AI SDK provider.
 * Dynamically imports the provider package if not already loaded.
 *
 * @param providerName - Provider name (e.g., "google", "openai", "anthropic")
 * @param modelId - Model identifier (e.g., "gemini-2.0-flash-001")
 * @returns Language model instance
 */
export const getModel = async (
  providerName: string,
  modelId: string
): Promise<LanguageModel> => {
  if (!providerCache.has(providerName)) {
    getLog().debug({ providerName }, "Loading provider");

    const pkgName = `@ai-sdk/${providerName}`;
    try {
      const module = await import(pkgName);
      // Vercel SDK providers export a function matching the provider name
      // e.g., import { google } from '@ai-sdk/google'
      const providerFn = module[providerName] || module.default;

      if (typeof providerFn !== "function") {
        throw new Error(
          `Provider '${providerName}' does not export a valid model function`
        );
      }

      providerCache.set(providerName, providerFn);
      getLog().info({ providerName }, "Provider loaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to load provider '${providerName}'. Is '@ai-sdk/${providerName}' installed? Error: ${message}`
      );
    }
  }

  const providerFn = providerCache.get(providerName)!;
  return providerFn(modelId);
};

/**
 * Clear the provider cache (useful for testing).
 */
export const clearProviderCache = (): void => {
  providerCache.clear();
};
