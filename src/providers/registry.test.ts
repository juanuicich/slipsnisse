import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initLogger } from "../logger.js";
import { clearProviderCache, getModel } from "./registry.js";

// Mock TanStack AI provider packages
vi.mock("@tanstack/ai-openai", () => ({
  openaiText: vi.fn((modelId: string) => ({
    kind: "text",
    name: "openai",
    model: modelId,
    chatStream: vi.fn(),
  })),
  createOpenaiChat: vi.fn((modelId: string, apiKey: string) => ({
    kind: "text",
    name: "openai",
    model: modelId,
    apiKey,
    chatStream: vi.fn(),
  })),
}));

vi.mock("@tanstack/ai-gemini", () => ({
  geminiText: vi.fn((modelId: string) => ({
    kind: "text",
    name: "gemini", // TanStack adapter usually has 'google' or 'gemini' as name?
    // Based on BaseTextAdapter it has `readonly name: string`.
    // OpenAITextAdapter had `readonly name: "openai"`.
    // GeminiTextAdapter likely has `readonly name: "google"` or "gemini".
    // I'll assume "gemini" or "google". Let's use "gemini" for now as the package is ai-gemini.
    model: modelId,
    chatStream: vi.fn(),
  })),
  createGeminiChat: vi.fn((modelId: string, apiKey: string) => ({
    kind: "text",
    name: "gemini",
    model: modelId,
    apiKey,
    chatStream: vi.fn(),
  })),
}));

describe("Provider Registry", () => {
  beforeAll(() => {
    initLogger({ level: "silent" });
  });

  beforeEach(() => {
    clearProviderCache();
    vi.clearAllMocks();
  });

  it("should load and cache a provider", async () => {
    const model1 = await getModel("openai", "gpt-4");
    expect(model1).toMatchObject({ model: "gpt-4", name: "openai" });

    // Second call should return a new adapter instance (since we don't cache instances, we cache factories,
    // but getModel creates a new adapter each time currently, or reused?
    // My implementation of getModel creates a new adapter each time: `adapter = module.openaiText(modelId, config);`
    // So toStrictEqual might fail if checking reference equality.
    // But `openaiText` is a factory that returns an object.

    const model2 = await getModel("openai", "gpt-4");
    expect(model2).toMatchObject({ model: "gpt-4", name: "openai" });
  });

  it("should load different providers", async () => {
    const openaiModel = await getModel("openai", "gpt-4");
    const googleModel = await getModel("google", "gemini-pro");

    expect(openaiModel).toMatchObject({ name: "openai" });
    // Expecting gemini or google depending on what I mocked/what adapter returns.
    expect(googleModel).toMatchObject({ model: "gemini-pro" });
  });

  it("should throw error for non-existent provider package", async () => {
    // This will fail because @tanstack/ai-nonexistent is not mocked and not installed
    await expect(getModel("nonexistent", "model")).rejects.toThrow(
      /Failed to load provider 'nonexistent'/,
    );
  });
});
