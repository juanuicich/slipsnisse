import pino, { type Logger, type LoggerOptions } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LoggerConfig {
	level: LogLevel;
	pretty: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
	level: "info",
	pretty: false,
};

let rootLogger: Logger | null = null;

/**
 * Initialize the root logger. Must be called once at startup.
 */
export const initLogger = (config: Partial<LoggerConfig> = {}): Logger => {
	const { level, pretty } = { ...DEFAULT_CONFIG, ...config };

	const options: LoggerOptions = {
		level,
		...(pretty && {
			transport: {
				target: "pino-pretty",
				options: {
					colorize: true,
					destination: 2, // Log to stderr
				},
			},
		}),
	};

	rootLogger = pino(options, pino.destination(2)); // Force destination for standard logs too
	return rootLogger;
};

/**
 * Get the root logger. Throws if not initialized.
 */
export const getLogger = (): Logger => {
	if (!rootLogger) {
		throw new Error("Logger not initialized. Call initLogger() first.");
	}
	return rootLogger;
};

/**
 * Create a child logger with a component name.
 */
export const createLogger = (component: string): Logger =>
	getLogger().child({ component });
