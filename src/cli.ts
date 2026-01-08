#!/usr/bin/env node
/**
 * Slipsnisse CLI entry point
 */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "./config/loader.js";
import { ExecutionEngine } from "./execution/engine.js";
import { createLogger, initLogger, type LogLevel } from "./logger.js";
import { ClientManager } from "./mcp/client-manager.js";
import { createServer, startServer } from "./server.js";

const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

const parseCliArgs = () => {
	const { values } = parseArgs({
		options: {
			config: { type: "string", short: "c" },
			"log-level": { type: "string" },
			"log-pretty": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
		strict: true,
	});

	return values;
};

const printUsage = () => {
	console.log(`
Usage: slipsnisse --config <path> [options]

Options:
  -c, --config <path>    Path to JSON config file (required)
  --log-level <level>    Log level: debug, info, warn, error (default: info)
  --log-pretty           Enable human-readable log output
  -h, --help             Show this help message
`);
};

const main = async () => {
	const args = parseCliArgs();

	if (args.help) {
		printUsage();
		process.exit(0);
	}

	if (!args.config) {
		console.error("Error: --config is required");
		printUsage();
		process.exit(1);
	}

	if (!existsSync(args.config)) {
		console.error(`Error: Config file not found: ${args.config}`);
		process.exit(1);
	}

	const logLevel = (args["log-level"] || "info") as LogLevel;
	if (!LOG_LEVELS.includes(logLevel)) {
		console.error(`Error: Invalid log level: ${logLevel}`);
		console.error(`Valid levels: ${LOG_LEVELS.join(", ")}`);
		process.exit(1);
	}

	// Initialize logger
	initLogger({ level: logLevel, pretty: args["log-pretty"] ?? false });
	const log = createLogger("cli");

	log.info({ config: args.config, logLevel }, "Starting Slipsnisse");

	try {
		// Load configuration
		const config = await loadConfig(args.config);

		// Initialize client manager
		const clientManager = new ClientManager();
		await clientManager.init(config.mcps);

		// Initialize execution engine
		const engine = new ExecutionEngine();
		await engine.init(config, clientManager);

		// Create and start MCP server
		const server = createServer(config, clientManager, engine);
		await startServer(server);

		// Handle shutdown
		const shutdown = async () => {
			log.info("Received shutdown signal");
			await clientManager.shutdown();
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		log.info("Slipsnisse initialized and running");
	} catch (err) {
		log.error({ error: (err as Error).message }, "Failed to start Slipsnisse");
		process.exit(1);
	}
};

main();
