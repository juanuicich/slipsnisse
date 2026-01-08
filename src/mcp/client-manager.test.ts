import { spawn } from "node:child_process";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initLogger } from "../logger.js";
import { ClientManager } from "./client-manager.js";

// Hoisted mocks
const mockedMethods = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockListTools: vi.fn().mockResolvedValue({
    tools: [{ name: "tool1", description: "desc1", inputSchema: {} }],
  }),
  mockCallTool: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "result" }],
    isError: false,
  }),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    killed: false,
  })),
}));

// Mock MCP SDK Client
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      connect: mockedMethods.mockConnect,
      listTools: mockedMethods.mockListTools,
      callTool: mockedMethods.mockCallTool,
      close: mockedMethods.mockClose,
    })),
  };
});

// Mock transports - must be regular functions to work as constructors
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe("ClientManager", () => {
  let manager: ClientManager;

  beforeAll(() => {
    initLogger({ level: "silent" });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClientManager();

    // Reset mock implementations
    mockedMethods.mockConnect.mockResolvedValue(undefined);
    mockedMethods.mockListTools.mockResolvedValue({
      tools: [{ name: "tool1", description: "desc1", inputSchema: {} }],
    });
    mockedMethods.mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "result" }],
      isError: false,
    });
    mockedMethods.mockClose.mockResolvedValue(undefined);
  });

  it("should initialize connections", async () => {
    const mcpConfigs = {
      testServer: {
        command: "node",
        args: ["test.js"],
        transport: "stdio" as const,
      },
    };

    await manager.init(mcpConfigs);

    expect(spawn).toHaveBeenCalled();
    expect(mockedMethods.mockConnect).toHaveBeenCalled();
  });

  it("should return available tools with namespacing", async () => {
    const mcpConfigs = {
      s1: { command: "c1", args: [], transport: "stdio" as const },
    };
    await manager.init(mcpConfigs);

    const tools = manager.getAvailableTools({ s1: ["tool1"] });
    expect(tools).toHaveLength(1);
    expect(tools[0]!.namespacedName).toBe("s1__tool1");
  });

  it("should call tool through namespaced name", async () => {
    const mcpConfigs = {
      s1: { command: "c1", args: [], transport: "stdio" as const },
    };
    await manager.init(mcpConfigs);

    const result = await manager.callTool("s1__tool1", { arg1: "val1" });
    expect(result.content).toEqual([{ type: "text", text: "result" }]);
    expect(mockedMethods.mockCallTool).toHaveBeenCalledWith({
      name: "tool1",
      arguments: { arg1: "val1" },
    });
  });

  it("should handle missing tool on server", async () => {
    const mcpConfigs = {
      s1: { command: "c1", args: [], transport: "stdio" as const },
    };
    await manager.init(mcpConfigs);

    const tools = manager.getAvailableTools({ s1: ["nonexistent"] });
    expect(tools).toHaveLength(0);
  });

  it("should shutdown all connections and processes", async () => {
    const mcpConfigs = {
      s1: { command: "c1", args: [], transport: "stdio" as const },
    };
    await manager.init(mcpConfigs);

    await manager.shutdown();

    expect(mockedMethods.mockClose).toHaveBeenCalled();

    const spawnResult = vi.mocked(spawn).mock.results[0]!.value;
    expect(spawnResult.kill).toHaveBeenCalled();
  });
});
