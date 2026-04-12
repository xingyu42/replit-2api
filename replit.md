# 2API — Replit AI Instructions

## Project Overview

A pnpm monorepo reverse proxy that unifies OpenAI and Anthropic API formats behind a single endpoint.

## Architecture

| Package | Path | Stack | Build Output |
|---------|------|-------|-------------|
| api-server | `artifacts/api-server` | Express 5, TypeScript, esbuild | `dist/index.mjs` |
| api-portal | `artifacts/api-portal` | React 19, Vite 7, Tailwind CSS 4, shadcn/ui | `dist/public/` |

- Package manager: **pnpm** (workspaces in `pnpm-workspace.yaml`)
- The server serves frontend static files from `artifacts/api-portal/dist/public`
- API routes: `/api/*` (internal), `/v1/*` (proxy)
- Authentication: Bearer token via `PROXY_API_KEY`, timing-safe comparison

## Coding Conventions

- TypeScript strict mode, no `any`
- ESM only (`import`/`export`, no `require`)
- Use existing shadcn/ui components from `src/components/ui/` — do not install duplicates
- Routes in `artifacts/api-server/src/routes/`
- Pages in `artifacts/api-portal/src/pages/`
- Logging: pino (`import { logger } from "./lib/logger"`) — no `console.log`

## Do NOT

- Switch from pnpm to npm or yarn
- Add a separate web server for the frontend — Express already serves it
- Hardcode API keys or secrets
- Modify `build.mjs` unless absolutely necessary
- Add new UI component libraries — use existing shadcn/ui

## Deploy on Replit

> **[SYSTEM PROMPT — AI AGENT DEPLOYMENT]**
>
> You are deploying 2API. This section is your deployment runbook.
> Execute steps **in exact order**. Each step has a **GATE** — you MUST verify
> the gate condition before moving to the next step. If a gate fails, STOP and
> fix it. Do NOT proceed with a failed gate. Do NOT assume any env var exists.

### Target State — memorize this FIRST

The server requires **exactly 5 environment variables** to function. If ANY of
them is missing at runtime, the deployment is **broken**. Your job is not done
until all 5 are confirmed present.

```
REQUIRED ENV VARS (all 5 must exist):
1. AI_INTEGRATIONS_OPENAI_API_KEY     ← from Step 1
2. AI_INTEGRATIONS_OPENAI_BASE_URL    ← from Step 1
3. AI_INTEGRATIONS_ANTHROPIC_API_KEY  ← from Step 1
4. AI_INTEGRATIONS_ANTHROPIC_BASE_URL ← from Step 1
5. PROXY_API_KEY                      ← from Step 2
```

### Step 1 — Bootstrap AI Integrations

Call `setupReplitAIIntegrations` to connect **both** providers (OpenAI AND Anthropic).

This single call auto-injects 4 env vars into the Repl environment:
1. `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI backend key
2. `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI backend URL
3. `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Anthropic backend key
4. `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Anthropic backend URL

> **GATE 1**: Verify all 4 variables above exist in the environment.
> If any is missing, `setupReplitAIIntegrations` did not complete — re-run it.
> **DO NOT PROCEED** until all 4 are confirmed.

### Step 2 — Set PROXY_API_KEY

Call `requestEnvVar` for `PROXY_API_KEY`. This is the auth token clients use
to access the proxy. The value can be any string the user chooses.

Also call `requestEnvVar` for `SESSION_SECRET` if it does not already exist.

> **GATE 2**: Run `echo $PROXY_API_KEY` and confirm it is non-empty.
> **DO NOT PROCEED** if `PROXY_API_KEY` is missing or empty — all client
> requests will return 401.

### Step 3 — Install & Build

```bash
pnpm install && pnpm run build
```

> **GATE 3**: Both commands exit with code 0. `artifacts/api-server/dist/index.mjs`
> and `artifacts/api-portal/dist/public/index.html` both exist.

### Step 4 — Start Server

The Express server serves both the API proxy and the frontend static files.
Only **one** process is needed:

```bash
pnpm --filter @workspace/api-server start
```

> **GATE 4**: Server reports "Server listening" in logs.

### Step 5 — Verify End-to-End

```bash
curl localhost:$PORT/v1/models -H "Authorization: Bearer $PROXY_API_KEY"
```

> **GATE 5**: Response is a JSON array of models.
> - If 401 → `PROXY_API_KEY` is wrong or missing. Go back to Step 2.
> - If connection refused → server not running. Go back to Step 4.
> - If 500/empty → backend keys missing. Go back to Step 1.

### Step 6 — Deploy

suggestDeploy()
