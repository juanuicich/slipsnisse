# Slipsnisse MVP Roadmap

## Phase 0: Project Setup

### 0.1 Initialize Project
- [ ] `pnpm init`
- [ ] Add `.gitignore` (node_modules, dist, .env, etc.)
- [ ] Configure `tsconfig.json` (target ES2022, module NodeNext, strict mode)
- [ ] Add build scripts to `package.json`

### 0.2 Install Core Dependencies
- [ ] `@modelcontextprotocol/sdk` — MCP server + client
- [ ] `ai` — Vercel AI SDK v6
- [ ] `zod` — schema validation
- [ ] `pino` + `pino-pretty` — structured logging

### 0.3 Install Dev Dependencies
- [ ] `typescript`
- [ ] `tsx` — dev runner
- [ ] `vitest` — testing
- [ ] `@types/node`

### 0.4 Install Provider SDKs
- [ ] `@ai-sdk/google`
- [ ] `@ai-sdk/openai`
- [ ] `@ai-sdk/anthropic`
- [ ] Any additional providers exposed by Vercel AI SDK v6 (introspect types to enumerate)

---

## Phase 1: The Office (Infrastructure)

### 1.1 Logger Module
- [ ] Create `src/logger.ts`
- [ ] Initialize Pino logger with configurable level
- [ ] Expose `--log-level` CLI arg (debug, info, warn, error)
- [ ] Support `--log-pretty` flag for human-readable dev output

### 1.2 Config Schema
- [ ] Create `src/config/schema.ts`
- [ ] Define Zod schema matching JSON Schema from section 3.3:
  - `mcps`: Record of `{ command, args, env? }`
  - `tools`: Array of `{ name, description, arguments?, internal_tools, provider, model, system_prompt? }`
- [ ] Export TypeScript types inferred from Zod schema

### 1.3 Config Loader
- [ ] Create `src/config/loader.ts`
- [ ] Read JSON file from path provided via `--config` CLI arg
- [ ] Validate against Zod schema, throw descriptive errors on failure
- [ ] Return typed config object

### 1.4 CLI Entry Point
- [ ] Create `src/cli.ts`
- [ ] Parse args: `--config <path>`, `--log-level`, `--log-pretty`
- [ ] Validate `--config` is provided and file exists
- [ ] Bootstrap application (load config → start server)

### 1.5 Client Manager
- [ ] Create `src/mcp/client-manager.ts`
- [ ] For each entry in `mcps` config:
  - Spawn child process with `command` + `args` + `env`
  - Connect via `StdioClientTransport`
  - Call `client.listTools()` to discover available tools
  - Log errors if spawn fails, mark server as unavailable
- [ ] Store map: `serverId → { client, tools[] }`
- [ ] Implement namespacing: `serverId__toolName` for internal disambiguation
- [ ] Expose method: `getAvailableTools(internal_tools config) → namespaced tool list`
- [ ] Expose method: `callTool(namespacedName, args) → result`

### 1.6 SSE Client Support
- [ ] Extend Client Manager to detect transport type (stdio vs SSE)
- [ ] Add optional `transport: "stdio" | "sse"` and `url` fields to MCP config schema
- [ ] Use `SSEClientTransport` when `transport: "sse"`

---

## Phase 2: The Bureaucracy (Server)

### 2.1 MCP Server Initialization
- [ ] Create `src/server.ts`
- [ ] Initialize `McpServer` from `@modelcontextprotocol/sdk`
- [ ] Configure Stdio transport for host communication

### 2.2 Dynamic Tool Registration (Composite Tools)
- [ ] For each **composite tool** in `tools` config array (e.g., `research_dependency`):
  - These are the tools exposed to the Orchestrator (NOT the downstream MCP tools)
  - Convert `arguments` JSON Schema to Zod schema (or use Zod's JSON Schema compat)
  - Register tool with `server.tool(name, description, schema, handler)`
- [ ] Only register composite tools whose `internal_tools` are fully resolvable (all referenced MCPs available)
- [ ] Log warning for composite tools that cannot be registered due to missing MCPs

### 2.3 Tool Handler Stub
- [ ] Create placeholder handler that logs invocation and returns "not implemented"
- [ ] Wire up to registered tools for Phase 2 testing

---

## Phase 3: The Delegation (Intelligence)

### 3.1 Provider Registry
- [ ] Create `src/providers/registry.ts`
- [ ] Implement dynamic import pattern from section 4.1
- [ ] Cache loaded providers in memory
- [ ] Introspect Vercel AI SDK v6 types to enumerate all available providers
- [ ] Throw descriptive error if requested provider not installed

### 3.2 Tool Wrapper Factory
- [ ] Create `src/execution/tool-wrapper.ts`
- [ ] Convert MCP tool definitions to Vercel AI SDK tool format:
  - `description` from MCP tool
  - `parameters` schema (Zod)
  - `execute` function that calls `ClientManager.callTool()`
- [ ] Handle namespacing (LLM sees `filesystem__read_file`, wrapper resolves to correct client)

### 3.3 Execution Engine
- [ ] Create `src/execution/engine.ts`
- [ ] **At startup**, for each composite tool, pre-build and cache:
  - Resolved model instance (provider + model via Provider Registry)
  - System prompt (tool's `system_prompt` or default)
  - Wrapped Vercel SDK tools (from `internal_tools` config)
- [ ] Store cached context in a `Map<toolName, ToolExecutionContext>`
- [ ] **Per invocation**, the handler only:
  1. Retrieve cached `ToolExecutionContext`
  2. Call `generateText({ model, system, prompt: userArgs, tools, maxSteps: 10, abortSignal })`
  3. Return final text to caller
- [ ] Implement 60s timeout via `AbortSignal.timeout(60000)`

### 3.4 Wire Execution to Tool Handlers
- [ ] Replace stub handlers from 2.3 with actual Execution Engine calls
- [ ] Pass tool arguments as user prompt to subagent

### 3.5 Debug Logging
- [ ] Log intermediate tool calls at `debug` level
- [ ] Log final response at `info` level
- [ ] Log errors with full context

---

## Phase 4: Error Handling & Resilience

### 4.1 Downstream MCP Failures
- [ ] Detect process exit/crash in Client Manager
- [ ] Mark failed MCP as unavailable
- [ ] Return `ToolExecutionError` to orchestrator with clear message
- [ ] Log error with process exit code and stderr

### 4.2 Tool Resolution Failures
- [ ] If tool call references unavailable MCP, return error (don't crash)
- [ ] Include which MCP is unavailable in error message

### 4.3 LLM Errors
- [ ] Catch provider errors (rate limits, auth failures, etc.)
- [ ] Wrap in `ToolExecutionError` with actionable message
- [ ] Log full error details at `error` level

---

## Phase 5: Testing

### 5.1 Unit Tests
- [ ] `src/config/loader.test.ts` — valid/invalid config parsing
- [ ] `src/config/schema.test.ts` — Zod schema edge cases
- [ ] `src/providers/registry.test.ts` — dynamic loading, caching, missing provider errors
- [ ] `src/mcp/client-manager.test.ts` — namespacing logic (mock actual process spawning)

### 5.2 Integration Tests
- [ ] Create mock MCP server for testing (simple echo tool)
- [ ] Test full flow: config → client manager → server → tool call → response
- [ ] Test error scenarios: MCP spawn failure, tool timeout

### 5.3 E2E Smoke Test
- [ ] Create example config with real `@modelcontextprotocol/server-filesystem`
- [ ] Manual test: invoke tool via MCP Inspector or similar
- [ ] Document test procedure in README

---

## Phase 6: Packaging & Distribution

### 6.1 Package Configuration
- [ ] Set `"type": "module"` in `package.json`
- [ ] Configure `"bin": { "slipsnisse": "./dist/cli.js" }`
- [ ] Add `"files"` array for npm publish (dist, README, LICENSE)
- [ ] Add shebang `#!/usr/bin/env node` to CLI entry

### 6.2 Build Script
- [ ] Add `pnpm build` script (tsc compile to dist/)
- [ ] Verify output works with `node dist/cli.js --config ...`

### 6.3 NPX Compatibility
- [ ] Test `npx slipsnisse --config ./example.json`
- [ ] Document usage in README

---

## Phase 7: Documentation

### 7.1 README
- [ ] Project overview and purpose
- [ ] Installation instructions
- [ ] Configuration reference (link to JSON Schema)
- [ ] Usage examples
- [ ] Security considerations

### 7.2 Example Configs
- [ ] Create `examples/` directory
- [ ] Add `research-assistant.json` — filesystem + rust-docs example from design doc
- [ ] Add `minimal.json` — simplest working config

---

## Open Questions / Deferred

- **Auto-restart failed MCPs:** Out of scope per section 4.4. Consider for post-MVP.
- **Context overflow handling:** Relies on Flash/Mini model large contexts. No explicit handling in MVP.
- **Multi-turn conversations:** Current design is single-shot. Evaluate if needed.
