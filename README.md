# Agent Bridge (MCP WebSocket Proxy)

A minimal Model Context Protocol (MCP) bridge that exposes an MCP server over WebSocket. It spawns a stdio-based MCP handoff server and proxies traffic to connected WS clients. Designed for lightweight deployments (e.g., Replit) where you want a public WSS endpoint for your MCP tools.

## Features
- WebSocket bridge that spawns the MCP handoff server (`mcp-handoff-server.ts`)
- Configurable command/args for the MCP process (via `MCP_COMMAND` / `MCP_ARGS_JSON`)
- Configurable handoff storage path (`MCP_HANDOFF_PATH`), defaults to `.handoff/messages.json`
- Ready for containerless hosts (binds to `PORT` if provided)

## Quickstart
```bash
npm install
npm run mcp:ws
```
This starts the WebSocket bridge on `PORT` (defaults to `5050`). The bridge will spawn `npx -y tsx scripts/mcp-handoff-server.ts`.

## Configuration
Environment variables:
- `PORT`: WS listen port (host-provided on Replit; defaults to `5050`).
- `MCP_HANDOFF_PATH`: Absolute path to the handoff JSON file (default: `./.handoff/messages.json`).
- `MCP_COMMAND`: Override the spawn command (default: `npx`).
- `MCP_ARGS_JSON`: JSON array of args to the MCP command (default: `["-y", "tsx", "scripts/mcp-handoff-server.ts"]`).

## Endpoints
- WebSocket: `ws://localhost:<PORT>` (or your host’s public WSS domain)
- MCP transport: stdio spawned from the bridge; no direct HTTP routes

## Files
- `scripts/mcp-ws-bridge.js`: WebSocket proxy that spawns the MCP server and relays stdio <-> WS.
- `scripts/mcp-handoff-server.ts`: MCP server implementing handoff tools (write/list/clear/assign/history/attach/analyze).
- `package.json`: Includes `mcp:ws` script and dependencies (`@modelcontextprotocol/sdk`, `ws`, `tsx`, `zod`).

## Security Notes
- If exposing publicly, consider adding a WS auth token check before relaying data.
- Keep `MCP_HANDOFF_PATH` in a non-public location; treat it as workspace state.

## Optional: Flag-Based Notifier Pattern
For lightweight agent-to-agent alerts, you can use flag files plus a watcher:

Scripts (example):
- `npm run notify:cascade` → touch `.handoff/notify-cascade`
- `npm run notify:replit` → touch `.handoff/notify-replit`
- `npm run agent:watch` → run a watcher that prints alerts when the flags appear

Watcher behavior (example):
```
========================================
CASCADE: CHECK MESSAGES!
New message in .ai/dialogue.json or .handoff/collab.json
========================================
```
You can also manually create a flag: `touch .handoff/notify-cascade`.

## Typical Deployment (Replit example)
1) Set secret: `MCP_HANDOFF_PATH=/home/runner/<project>/.handoff/messages.json`
2) Run: `npm install && npm run mcp:ws`
3) Connect your MCP client to `wss://<your-repl-domain>` (Replit provides the domain for the bound `PORT`).

## License
MIT
