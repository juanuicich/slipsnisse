/**
 * Dynamic Provider Registry for Vercel AI SDK providers.
 * Loads provider packages on-demand and caches them.
 */

import type { LanguageModel } from "ai";
import type { Logger } from "pino";
import { createLogger } from "../logger.js";

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
	modelId: string,
	options?: {
		endpoint?: string;
		apiKey?: string;
		providerOptions?: Record<string, unknown>;
	},
): Promise<LanguageModel> => {
	if (!providerCache.has(providerName)) {
		getLog().debug({ providerName }, "Loading provider");

		const pkgName = `@ai-sdk/${providerName}`;
		try {
			const module = await import(pkgName);

			// Check for factory function for custom configuration
			// e.g., createOpenAI, createAnthropic
			let factoryFnName = `create${providerName.charAt(0).toUpperCase() + providerName.slice(1)}`;
			let factoryFn = module[factoryFnName];

			// Handle special naming cases
			if (!factoryFn && providerName === "openai") {
				factoryFn = module.createOpenAI;
			} else if (!factoryFn && providerName === "google") {
				factoryFn = module.createGoogleGenerativeAI;
			} else if (!factoryFn && providerName === "openai-compatible") {
				factoryFn = module.createOpenAICompatible;
			}

			// Default provider function (usually environment-based)
			const defaultProviderFn = module[providerName] || module.default;

			if (options && typeof factoryFn === "function") {
				// Use factory with configuration
				const config: Record<string, unknown> = {
					...options.providerOptions,
				};

				if (options.endpoint) config.baseURL = options.endpoint;
				if (options.apiKey) config.apiKey = options.apiKey;

				const configuredProvider = factoryFn(config);
				providerCache.set(providerName, configuredProvider);
				getLog().info({ providerName, ...options }, "Provider loaded with config");
			} else if (typeof defaultProviderFn === "function") {
				// Fallback to default provider
				providerCache.set(providerName, defaultProviderFn);
				getLog().info({ providerName }, "Provider loaded (default)");
			} else {
				throw new Error(
					`Provider '${providerName}' does not export a valid model function or factory`,
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Failed to load provider '${providerName}'. Is '@ai-sdk/${providerName}' installed? Error: ${message}`,
			);
		}
	}

	const providerFn = providerCache.get(providerName);
	if (!providerFn) {
		throw new Error(`Provider '${providerName}' not found in cache`);
	}
	return providerFn(modelId);
};

/**
 * Clear the provider cache (useful for testing).
 */
export const clearProviderCache = (): void => {
	providerCache.clear();
};
