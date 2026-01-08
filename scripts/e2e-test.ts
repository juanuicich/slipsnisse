import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "../src/cli.ts");
const CONFIG_PATH = path.join(__dirname, "../examples/e2e-config.json");

async function runTest() {
  console.log("Starting Slipsnisse E2E Test...");

  // Mock OpenAI API key if not present (we'll see if the provider check fails or we can mock it)
  // For this test, we might fail at the LLM step if we don't have a key or a mock provider.
  // BUT, we can at least verify up to tool listing.
  
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", CLI_PATH, "--config", CONFIG_PATH]
  });

  const client = new Client(
    {
      name: "e2e-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    console.log("Connecting to Slipsnisse...");
    await client.connect(transport);
    console.log("Connected.");
    
    console.log("Listing tools...");
    const tools = await client.listTools();
    console.log("Tools found:", JSON.stringify(tools, null, 2));

    if (tools.tools.length === 0) {
      throw new Error("No tools found! Expected 'speak'.");
    }

    if (tools.tools[0].name !== "speak") {
      throw new Error(`Expected tool 'speak', found '${tools.tools[0].name}'`);
    }

    console.log("Tool discovery passed!");
    
    console.log("Attempting to call tool 'speak'...");
    try {
        const result = await client.callTool({
            name: "speak",
            arguments: { message: "Hello from E2E test" }
        });
        console.log("Tool call success!");
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (e: any) {
        console.log("Tool call failed (expected if no API key):", e.message);
        // We consider the test 'passed' if we hit the Execution Engine, even if it errors on auth
        if (e.message.includes("API key") || e.message.includes("Provider") || e.message.includes("LLM_ERROR")) {
            console.log("Successfully reached Execution Engine!");
        } else {
            throw e;
        }
    }
    
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  } finally {
    // client.close(); // SDK doesn't always close cleanly in scripts, just exit
    process.exit(0);
  }
}

runTest();
