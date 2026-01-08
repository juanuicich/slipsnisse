import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initLogger } from "../logger.js";
import { loadConfig } from "./loader.js";

vi.mock("node:fs/promises");

describe("Environment Variable Substitution", () => {
  beforeAll(() => {
    initLogger({ level: "silent" });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear relevant env vars
    delete process.env.TEST_VAR;
    delete process.env.API_KEY;
  });

  it("should substitute simple environment variables", async () => {
    process.env.TEST_VAR = "hello";
    const config = {
      mcps: {
        test: {
          command: "node",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template syntax
          args: ["${TEST_VAR}"],
        },
      },
      tools: [],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

    const loaded = await loadConfig("config.json");
    expect(loaded.mcps.test?.args[0]).toBe("hello");
  });

  it("should substitute environment variables in env records", async () => {
    process.env.API_KEY = "secret-123";
    const config = {
      mcps: {
        test: {
          command: "node",
          args: [],
          env: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template syntax
            AUTH_TOKEN: "Bearer ${API_KEY}",
          },
        },
      },
      tools: [],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

    const loaded = await loadConfig("config.json");
    expect(loaded.mcps.test?.env?.AUTH_TOKEN).toBe("Bearer secret-123");
  });

  it("should substitute multiple environment variables in one string", async () => {
    process.env.HOST = "localhost";
    process.env.PORT = "8080";
    const config = {
      mcps: {
        test: {
          command: "node",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template syntax
          args: ["http://${HOST}:${PORT}"],
        },
      },
      tools: [],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

    const loaded = await loadConfig("config.json");
    expect(loaded.mcps.test?.args[0]).toBe("http://localhost:8080");
  });

  it("should throw error if environment variable is missing", async () => {
    const config = {
      mcps: {
        test: {
          command: "node",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template syntax
          args: ["${MISSING_VAR}"],
        },
      },
      tools: [],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

    await expect(loadConfig("config.json")).rejects.toThrow(
      "Configuration substitution failed: Environment variable not found: MISSING_VAR",
    );
  });

  it("should substitute variables in provider config", async () => {
    process.env.GPT_KEY = "sk-test";
    const config = {
      mcps: {},
      providers: {
        openai: {
          provider: "openai",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template syntax
          apiKey: "${GPT_KEY}",
        },
      },
      tools: [],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

    const loaded = await loadConfig("config.json");
    expect(loaded.providers?.openai?.apiKey).toBe("sk-test");
  });
});
