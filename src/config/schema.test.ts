import { describe, it, expect } from "vitest";
import { SlipsnisseConfigSchema } from "./schema.js";

describe("SlipsnisseConfigSchema", () => {
	it("should validate a valid configuration", () => {
		const validConfig = {
			mcps: {
				testServer: {
					command: "node",
					args: ["test.js"],
					env: { DEBUG: "true" },
					transport: "stdio",
				},
			},
			tools: [
				{
					name: "composite_tool",
					description: "A composite tool",
					provider: "openai",
					model: "gpt-4",
					internal_tools: {
						testServer: ["tool1", "tool2"],
					},
					arguments: {
						type: "object",
						properties: {
							input: { type: "string" },
						},
					},
				},
			],
		};

		const result = SlipsnisseConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it("should fail validation with invalid mcps", () => {
		const invalidConfig = {
			mcps: {
				testServer: {
					// missing command and args
				},
			},
			tools: [],
		};

		const result = SlipsnisseConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
	});

	it("should fail validation with invalid tools", () => {
		const invalidConfig = {
			mcps: {},
			tools: [
				{
					name: "tool",
					// missing description, provider, model, internal_tools
				},
			],
		};

		const result = SlipsnisseConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
	});

    it("should allow optional fields in MCP config", () => {
        const config = {
            mcps: {
                minimal: {
                    command: "cmd",
                    args: []
                }
            },
            tools: []
        };
        const result = SlipsnisseConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
        if (result.success) {
            const minimalMcp = result.data.mcps.minimal as any;
            expect(minimalMcp.transport).toBe("stdio");
        }
    });

    it("should validate SSE transport fields", () => {
        const config = {
            mcps: {
                sse: {
                    command: "none",
                    args: [],
                    transport: "sse",
                    url: "http://localhost:3000"
                }
            },
            tools: []
        };
        const result = SlipsnisseConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
    });
});
