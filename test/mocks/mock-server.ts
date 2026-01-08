import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
	{
		name: "mock-server",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "echo",
				description: "Echoes the input",
				inputSchema: {
					type: "object",
					properties: {
						message: { type: "string" },
					},
					required: ["message"],
				},
			},
		],
	};
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	if (request.params.name === "echo") {
		const message = (request.params.arguments?.message as string) || "nothing";
		return {
			content: [
				{
					type: "text",
					text: `Echo: ${message}`,
				},
			],
		};
	}
	throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(console.error);
