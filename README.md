# guanmao

A multi-surface intelligent agent application monorepo with:

- `packages/agent`: shared TypeScript agent/chat logic
- `apps/server`: TypeScript + Express chat API
- `apps/web`: TypeScript + React + Ant Design + Tailwind CSS
- `apps/cli`: TypeScript + Ink terminal chat client
- `apps/desktop`: Wails desktop app with React frontend

## Features

- Shared agent profile and conversation handling
- REST chat API: `POST /api/chat`
- Browser UI for interactive chat
- Terminal UI for interactive chat
- Desktop UI for local chat via Wails

## Workspace structure

```text
apps/
  cli/
  desktop/
    frontend/
  server/
  web/
packages/
  agent/
```

## Getting started

Install dependencies:

```bash
pnpm install
```

Run the API server:

```bash
pnpm dev:server
```

Run the web UI:

```bash
pnpm dev:web
```

Run the CLI:

```bash
pnpm dev:cli
```

Run the desktop app:

```bash
pnpm dev:desktop
```

## Build

```bash
pnpm build
```
