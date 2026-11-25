# IrohRedux AI interoperability — candidate v1

Ten platform profiles share the same engine and evidence contract. No vendor account is contacted by this adapter. A platform profile is not a certification of live connectivity.

## Local installation

Use a checkout of this branch with Node 22 or 24, Python 3 and g++ for the applicable language legs. Run `npm ci`. From the checkout:

```sh
echo '{"name":"iroh_capabilities","arguments":{}}' | node integrations/bridge.cjs
node integrations/bridge.cjs --describe chat-completions
node integrations/bridge.cjs --describe responses
node integrations/bridge.cjs --describe gemini
```

Only after a human/operator approves specific trusted source and the host is appropriately restricted, use the local execution adapter:

```sh
echo '{"name":"iroh_run","arguments":{"operation":"trace","language":"javascript","code":"1+2;"}}' | node integrations/bridge.cjs --trusted-code
```

For host-managed function calling, obtain declarations with `--describe STYLE --trusted-code` only when execution is approved. The host must parse model arguments as JSON, allowlist the tool name, apply its own per-call human approval or equivalent trusted policy, and call this adapter via stdin. Do not evaluate model-generated commands or pass arbitrary paths or environment variables. Return the complete JSON result with the corresponding vendor tool-call ID. OpenAI Responses, Chat Completions-style and Gemini declaration formats are provided, not full vendor SDK clients. Provider API credentials, account setup, and response-loop wiring remain with the host.

## Local MCP clients

For Mistral Vibe, Gemini CLI and GitHub Copilot (VS Code), use a local command configuration, replacing the path with your checkout:

```json
{"command":"node","args":["/absolute/path/IrohRedux/integrations/mcp-stdio.cjs"]}
```

Vibe: `vibe mcp add iroh --transport stdio --command node --arg /absolute/path/IrohRedux/integrations/mcp-stdio.cjs`.
Gemini CLI: `gemini mcp add iroh node /absolute/path/IrohRedux/integrations/mcp-stdio.cjs`.
VS Code: add the command under `servers.iroh` with `type: "stdio"` in `.vscode/mcp.json`.
Other MCP clients may use their own configuration format. The adapter implements the legacy initialize/initialized/tools/list/tools/call/ping subset and negotiates versions through 2025-11-25. It is not a full MCP SDK, remote HTTP server, or verified 2026 protocol implementation. If a client no longer accepts legacy negotiation use the JSON path instead.

Default MCP exposes only capabilities. Adding `--trusted-code` to launch args exposes code execution for the entire local session; do not use that mode without a restricted host and per-call operator approval at the client. Never publish this process as an internet-accessible tool.

## Other platforms

See platforms.json for all ten profiles and source links. For ChatGPT consumer chat, Nomi AI, iLands or any text-only client, use HANDOFF.md and the generated AI bundle. ChatGPT web custom MCP requires a separately hosted and authenticated remote service; no such service is supplied. Grok, Qwen, Kimi, Muse and Gemini API hosts can use the function declarations when their selected model/harness supports the format; live compatibility is untested. Muse is ambiguous; the profile assumes a host-managed Muse-style agent, not a verified product-specific installer. iLands BYOA and Nomi message relay are conditional on available account tools and operator permission.

## Evidence and security

Operations trace/analyze/scan/translate may execute arbitrary supplied source, including translation verification. The bridge defaults to deny, rejects unknown arguments and languages, limits source to 64 KiB, frames to 256 KiB, engine timeout to 30 s and response to 512 KiB. These are safeguards, not OS containment. Existing runner limitations remain (including Windows descendants, subprocess trust, and possible spoofing by untrusted source). Never use secret-bearing hosts or execute code received from strangers. No APIsec, external service credentials, or new package dependencies are needed for local use.

OK means the adapter received a normal engine result, not proof of correctness or safety. Inspect translation.report.verify and scan truncation fields. ENGINE_ERROR, OUTPUT_LIMIT, INVALID_REQUEST, UNAVAILABLE and EXECUTION_DISABLED must never be presented as successful execution. Source and distribution hashes describe local inputs, not signatures or attestation. The bundle includes reference documents and contract only; run the executable adapters from the installed repository. No automatic memory injection, model-weight change, or cross-agent communication occurs.
