import { readFile } from "node:fs/promises";
import { SlipsnisseConfigSchema, type SlipsnisseConfig } from "./schema.js";
import { createLogger } from "../logger.js";
import type { Logger } from "pino";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("config");
  }
  return log;
};

/**
 * Load and validate configuration from a JSON file.
 * Throws descriptive errors on parse or validation failure.
 */
export const loadConfig = async (configPath: string): Promise<SlipsnisseConfig> => {
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

  const result = SlipsnisseConfigSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config validation failed:\n${issues}`);
  }

  getLog().info(
    { mcpCount: Object.keys(result.data.mcps).length, toolCount: result.data.tools.length },
    "Configuration loaded"
  );

  return result.data;
};
