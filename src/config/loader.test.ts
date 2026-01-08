import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { loadConfig } from "./loader.js";
import { readFile } from "node:fs/promises";
import { initLogger } from "../logger.js";

vi.mock("node:fs/promises");

describe("loadConfig", () => {
    beforeAll(() => {
        initLogger({ level: "silent" });
    });
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

	it("should load and validate a valid config file", async () => {
		const validConfig = {
			mcps: {},
			tools: [],
		};
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(validConfig));

		const config = await loadConfig("config.json");
		expect(config).toEqual(validConfig);
		expect(readFile).toHaveBeenCalledWith("config.json", "utf-8");
	});

	it("should throw error if file not found", async () => {
		const error = new Error("ENOENT") as any;
		error.code = "ENOENT";
		vi.mocked(readFile).mockRejectedValue(error);

		await expect(loadConfig("missing.json")).rejects.toThrow(
			"Config file not found: missing.json",
		);
	});

	it("should throw error on invalid JSON", async () => {
		vi.mocked(readFile).mockResolvedValue("invalid json");

		await expect(loadConfig("invalid.json")).rejects.toThrow(
			"Invalid JSON in config file: invalid.json",
		);
	});

	it("should throw error on validation failure", async () => {
		const invalidConfig = {
			mcps: "invalid", // should be an object
		};
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(invalidConfig));

		await expect(loadConfig("invalid_schema.json")).rejects.toThrow(
			"Config validation failed:",
		);
	});
});
