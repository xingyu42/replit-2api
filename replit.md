# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

### API Server (`artifacts/api-server`)
Express 5 server serving:
- `/api/*` — standard REST API (health check, etc.)
- `/v1/*` — AI proxy endpoints (OpenAI + Anthropic compatible)

### API Portal (`artifacts/api-portal`)
React + Vite frontend at `/` showing connection details, model list, endpoint docs, CherryStudio setup guide, and curl examples.

## AI Proxy (`/v1`)

Dual-compatible reverse proxy for OpenAI and Anthropic, secured by `PROXY_API_KEY` (via `Authorization: Bearer` or `x-api-key` header).

### Endpoints
- `GET /v1/models` — list all available models
- `POST /v1/chat/completions` — OpenAI-compatible chat completions (routes by model prefix)
- `POST /v1/responses` — OpenAI Responses API
- `POST /v1/messages` — Anthropic Messages native API

### Authentication
Accepts both `Authorization: Bearer <key>` (OpenAI style) and `x-api-key: <key>` (Anthropic/Claude Code style).

### Model routing
- `gpt-*` / `o*` prefixes → OpenAI via Replit AI Integrations (`AI_INTEGRATIONS_OPENAI_*`)
- `claude-*` prefix → Anthropic via Replit AI Integrations (`AI_INTEGRATIONS_ANTHROPIC_*`)

### Features
- Full tool call / function calling support (with `cache_control` sanitization)
- Built-in Anthropic tool passthrough (web_search, etc. — tools with non-"custom" type pass through unmodified)
- Streaming SSE (OpenAI + Anthropic formats)
- Extended thinking support (`enabled` + `adaptive` modes, interleaved thinking)
- Anthropic Beta header forwarding (`anthropic-beta` header parsed and forwarded to SDK via request options on all endpoints)
- Keepalive pings every 5 seconds for long requests
- Anthropic ↔ OpenAI message format conversion for cross-provider routing
- Parameter forwarding: temperature, top_p, top_k, stop_sequences, metadata
- Upstream error passthrough with clean formatting
- Body limit: 50MB (supports large image/PDF payloads)
- Token counting endpoint (`/v1/messages/count_tokens`) using tiktoken `cl100k_base` encoding, with char-based fallback
- Claude Code compatible (x-api-key auth, tools with cache_control, system arrays, beta headers)

### Replit AI Integrations Limitations
**Anthropic** — Batch API and Files API not supported.
**OpenAI** — Embeddings, Fine-tuning, Files, Image Variations, Video I/O, Speech (TTS), Realtime API not supported. GPT-5+ models: temperature not specifiable (always 1), use `max_completion_tokens` instead of `max_tokens`.

### Environment Variables
- `PROXY_API_KEY` — Bearer/x-api-key token for authenticating all `/v1` requests
- `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` — auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — auto-set by Replit AI Integrations

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
