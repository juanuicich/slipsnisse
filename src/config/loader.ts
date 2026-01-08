import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import { createLogger } from "../logger.js";
import { type SlipsnisseConfig, SlipsnisseConfigSchema } from "./schema.js";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("config");
  }
  return log;
};

/**
 * Recursively substitutes environment variables in the format ${VAR_NAME}
 * in strings, objects, and arrays.
 * Throws if a variable is referenced but not defined in process.env.
 */
function substituteEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(
      /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (_match, varName) => {
        const envVal = process.env[varName];
        if (envVal === undefined) {
          throw new Error(`Environment variable not found: ${varName}`);
        }
        return envVal;
      },
    );
  }

  if (Array.isArray(value)) {
    return value.map(substituteEnvVars);
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = substituteEnvVars(val);
    }
    return result;
  }

  return value;
}

/**
 * Load and validate configuration from a JSON file.
 * Throws descriptive errors on parse or validation failure.
 */
export const loadConfig = async (
  configPath: string,
): Promise<SlipsnisseConfig> => {
  getLog().debug({ configPath }, "Loading configuration");

  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(`Config file not found: ${configPath}`);
    }
    throw new Error(`Failed to read config file: ${error.message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  // Substitute environment variables before validation
  let substituted: unknown;
  try {
    substituted = substituteEnvVars(json);
  } catch (err) {
    throw new Error(
      `Configuration substitution failed: ${(err as Error).message}`,
    );
  }

  const result = SlipsnisseConfigSchema.safeParse(substituted);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config validation failed:\n${issues}`);
  }

  getLog().info(
    {
      mcpCount: Object.keys(result.data.mcps).length,
      toolCount: result.data.tools.length,
    },
    "Configuration loaded",
  );

  return result.data;
};
