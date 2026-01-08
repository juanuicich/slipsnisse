import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { getModel, clearProviderCache } from "./registry.js";
import { initLogger } from "../logger.js";

// We need to mock the dynamic imports. 
// Vitest supports vi.mock with factory function for specific modules.
// However, since the code uses `import(pkgName)` where pkgName is dynamic,
// we might need a different approach if we want to test the `import()` call itself.
// For now, let's mock the expected modules.

vi.mock("@ai-sdk/openai", () => ({
    openai: vi.fn((modelId: string) => ({ modelId, provider: "openai" })),
    createOpenAI: vi.fn(),
    createOpenai: undefined,
}));

vi.mock("@ai-sdk/google", () => ({
    google: vi.fn((modelId: string) => ({ modelId, provider: "google" })),
    createGoogleGenerativeAI: vi.fn(),
    createGoogle: undefined,
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
        expect(model1).toEqual({ modelId: "gpt-4", provider: "openai" });

        // Second call should return an equivalent model
        const model2 = await getModel("openai", "gpt-4");
        expect(model2).toStrictEqual(model1);
    });

    it("should load different providers", async () => {
        const openaiModel = await getModel("openai", "gpt-4");
        const googleModel = await getModel("google", "gemini-pro");

        expect((openaiModel as any).provider).toBe("openai");
        expect((googleModel as any).provider).toBe("google");
    });

    it("should throw error for non-existent provider package", async () => {
        // This will fail because @ai-sdk/nonexistent is not mocked and not installed
        await expect(getModel("nonexistent", "model")).rejects.toThrow(
            /Failed to load provider 'nonexistent'/,
        );
    });
});
