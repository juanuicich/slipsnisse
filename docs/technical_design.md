# Technical Design Document: Slipsnisse (The Subagent MCP)

## 1. Executive Summary

**Slipsnisse** ("Tie Gnome") is a hierarchical Model Context Protocol (MCP) server that acts as a "middle manager" subagent. Its primary purpose is to offload verbose, context-heavy tasks (like documentation research, file reading, and synthesis) from expensive Orchestrator agents (Claude 3.5 Sonnet, GPT-4o) to cheaper, faster models (Gemini Flash), acting as a semantic buffer.

It creates an abstraction layer: the Orchestrator sees a clean "Expert Tool," while Slipsnisse frantically coordinates downstream MCPs and cheaper LLMs in the background to produce the result.

## 2. System Architecture

### 2.1 High-Level Data Flow

```mermaid
graph LR
    Host[Orchestrator Agent] <-->|MCP Protocol| Slipsnisse[Slipsnisse Server]
    
    subgraph "Slipsnisse Runtime"
        Config[YAML Config]
        Manager[Client Manager]
        Registry[Provider Registry]
        Loop[Vercel AI SDK Loop]
    end
    
    Slipsnisse <--> Loop
    Loop <-->|Tool Calls| Manager
    Loop <-->|Inference| Registry
    
    Manager <-->|MCP Protocol| Downstream1[Downstream MCP: Filesystem]
    Manager <-->|MCP Protocol| Downstream2[Downstream MCP: Rust Docs]

```

### 2.2 Core Libraries

* **Protocol Plumbing:** `@modelcontextprotocol/sdk`
* Used for the **Server** (exposed to Host).
* Used for **Clients** (connecting to downstream tools).
* Supports both `Stdio` (default) and `SSE` transports.


* **Intelligence:** `ai` (Vercel AI SDK).
* **Providers:** `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.
* **Validation:** `zod`.
* **Config:** `js-yaml` or native JSON/TS.

## 3. Configuration Schema

The behavior is driven entirely by a configuration file.

**Runtime Requirement:** Slipsnisse **must** be launched with a pointer to this config file.
`slipsnisse --config ./slipsnisse.config.json`

### 3.1 Schema Definition

```yaml
# Downstream MCP Connections
mcps:
  <server_id>:
    command: <string>      # Executable (npx, uvx, python, etc.)
    args: <string[]>       # Arguments for the command
    env: <map>             # Optional environment variables

# Exposed Composite Tools
tools:
  - name: <string>
    description: <string>  # Exposed to the Orchestrator
    arguments:             # JSON Schema/Zod definition for input args
      <arg_name>: <type>   
    
    # Tool Permission Whitelist
    internal_tools:        
      <server_id>: [<tool_name>, <tool_name>]
      
    # Intelligence Configuration
    provider: <string>      # e.g., "google", "openai", "anthropic"
    model: <string>         # e.g., "gemini-2.0-flash-001"
    system_prompt: <string> # Optional override

```

### 3.2 Example Configuration

```yaml
mcps:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/src"]
  
  rust_docs:
    command: uvx
    args: ["mcp-rust-docs"]

tools:
  - name: research_dependency
    description: "Finds optimal libraries and usage examples for a specific programming problem."
    arguments:
      query: { type: "string" }
    internal_tools:
      filesystem: [read_file, list_directory]
      rust_docs: [search, read_page]
    provider: google
    model: gemini-2.0-flash-001
    system_prompt: "You are a Rust expert. Search docs, read files to check compatibility, and synthesize an answer."

```

### 3.3 JSON Schema

For validation and reusability, strict adherence to this schema is required.

```json
{
  "$schema": "[http://json-schema.org/draft-07/schema#](http://json-schema.org/draft-07/schema#)",
  "type": "object",
  "properties": {
    "mcps": {
      "type": "object",
      "description": "Map of downstream MCP server configurations",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "args": { "type": "array", "items": { "type": "string" } },
          "env": { "type": "object", "additionalProperties": { "type": "string" } }
        },
        "required": ["command", "args"]
      }
    },
    "tools": {
      "type": "array",
      "description": "List of composite tools exposed by Slipsnisse",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "arguments": { "type": "object", "description": "Input schema (JSON Schema format)" },
          "internal_tools": {
            "type": "object",
            "description": "Map of server_id to list of allowed tool names",
            "additionalProperties": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "provider": { "type": "string", "enum": ["google", "openai", "anthropic"] },
          "model": { "type": "string" },
          "system_prompt": { "type": "string" }
        },
        "required": ["name", "description", "internal_tools", "provider", "model"]
      }
    }
  },
  "required": ["mcps", "tools"]
}

```

## 4. Implementation Details

### 4.1 The Provider Registry

To minimize memory footprint, we strictly load only the providers required by the active configuration using dynamic imports.

```typescript
// Pseudo-implementation of Dynamic Provider Factory
const providerCache = new Map();

async function getModel(providerName: string, modelId: string) {
  if (!providerCache.has(providerName)) {
    // Dynamic import avoids loading unused SDKs (e.g., openai if only using google)
    try {
      const pkgName = `@ai-sdk/${providerName}`; 
      const module = await import(pkgName);
      
      // Vercel SDK providers usually export a function matching the provider name
      // e.g., import { google } from '@ai-sdk/google'
      providerCache.set(providerName, module[providerName] || module.default);
    } catch (e) {
      throw new Error(`Failed to load provider '${providerName}'. Is it installed?`);
    }
  }

  const providerFn = providerCache.get(providerName);
  return providerFn(modelId);
}

```

### 4.2 The Client Manager & Namespacing

To avoid tool name collisions, the Client Manager uses a composite key strategy internally.

* **Config:** `internal_tools: { filesystem: ['read_file'] }`
* **Internal Map:** `filesystem::read_file` -> `ClientInstance`

When the Subagent LLM decides to call `read_file`, it must pick from the tools injected into its context. We will inject them with namespaced names (e.g., `filesystem__read_file`) to ensure the model distinguishes between multiple `search` or `read` tools from different servers.

### 4.3 The Execution Engine (Vercel AI SDK Integration)

When the Orchestrator calls a Slipsnisse tool:

1. **Hydration:**
* Load `system_prompt` (or default generic prompt).
* Resolve `provider` + `model` using the Dynamic Provider Registry.
* Resolve `internal_tools` to a list of executable functions wrapping `client.callTool()`.

2. **The Loop (`generateText`):**
* We use `generateText` with `maxSteps: 10`.
* This built-in loop handles the recursive "Thinking -> Tool Call -> Result -> Thinking" cycle.

3. **Output:**
* The final text generated by the loop is returned to the Orchestrator.
* Intermediate "thinking" steps are discarded (or optionally logged for debug), keeping the Orchestrator's context clean.

### 4.4 Error Handling

* **Process Death:** If a downstream MCP dies, Slipsnisse throws a `ToolExecutionError` to the Orchestrator. (Auto-restart is out of scope for MVP).
* **Context Overflow:** We rely on the large context windows of modern "Flash/Mini" models.
* **Timeout:** A global `AbortSignal` (e.g., 60s) is passed to `generateText`.

## 5. Development Roadmap (MVP)

1. **Phase 1: The Office (Infrastructure)**
* Implement `ConfigLoader` (YAML + Zod validation).
* Implement `ClientManager` using `@modelcontextprotocol/sdk` to connect to `stdio` processes.

2. **Phase 2: The Bureaucracy (Server)**
* Initialize the Slipsnisse `McpServer`.
* Dynamically register tools based on the `tools` array in config.

3. **Phase 3: The Delegation (Intelligence)**
* Implement the `ProviderFactory` with dynamic imports.
* Wire up `generateText` inside the tool handler.
* Implement tool wrapping (converting MCP JSON-RPC calls to Vercel SDK tools).

## 6. Security Considerations

* **Execution Policy:** Slipsnisse executes arbitrary binaries defined in `mcps`. It must strictly run in a trusted environment (e.g., local dev or secured container).
* **Tool Isolation:** The `internal_tools` whitelist is enforced. A subagent strictly cannot access tools not assigned to it, preventing a compromised sub-model from accessing sensitive tools (e.g., file delete) if they aren't explicitly granted.
