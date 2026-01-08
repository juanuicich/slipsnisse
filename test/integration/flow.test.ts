import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initLogger } from "../../src/logger.js";
import { ClientManager } from "../../src/mcp/client-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SERVER_PATH = path.resolve(__dirname, "../mocks/mock-server.ts");
const TEMP_CONFIG_PATH = path.resolve(__dirname, "temp-config.json");

describe("Full Integration Flow", () => {
  let manager: ClientManager;

  beforeAll(async () => {
    initLogger({ level: "silent" });
    manager = new ClientManager();

    const config = {
      mcps: {
        mock: {
          command: "pnpm",
          args: ["tsx", MOCK_SERVER_PATH],
          transport: "stdio",
        },
      },
      tools: [],
    };

    await writeFile(TEMP_CONFIG_PATH, JSON.stringify(config));
  });

  afterAll(async () => {
    await manager.shutdown();
    try {
      await unlink(TEMP_CONFIG_PATH);
    } catch {}
  });

  it("should connect to mock server and discover tools", async () => {
    const config = {
      mock: {
        command: "pnpm",
        args: ["tsx", MOCK_SERVER_PATH],
        transport: "stdio" as const,
      },
    };

    await manager.init(config);
    const tools = manager.getAvailableTools({ mock: ["echo"] });

    expect(tools).toHaveLength(1);
    expect(tools[0].originalName).toBe("echo");
    expect(tools[0].serverId).toBe("mock");
  }, 20000); // Increase timeout for process spawn and tsx

  it("should call tool on mock server and get response", async () => {
    const result = await manager.callTool("mock__echo", {
      message: "Hello Integration",
    });
    expect(result.content).toHaveLength(1);
    // @ts-expect-error
    expect(result.content[0].text).toBe("Echo: Hello Integration");
  }, 10000);
});
