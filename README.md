# 2API - Dual-Provider AI Reverse Proxy

  A reverse proxy that unifies OpenAI and Anthropic API formats behind a single endpoint. Supports both API formats with automatic routing to the appropriate backend.

  ## Features

  - **Dual API Format Support** — Accept both OpenAI (`/v1/chat/completions`, `/v1/responses`) and Anthropic (`/v1/messages`) request formats
  - **Automatic Model Routing** — Requests are routed to the correct backend based on model name
  - **Streaming Support** — Full SSE streaming for both providers
  - **Claude Code Compatible** — Tested and verified with Claude Code (9/10 compatibility rating)
  - **Beta Header Forwarding** — Supports `anthropic-beta` headers (prompt caching, extended thinking, token counting, etc.)
  - **Token Counting** — Local `/v1/messages/count_tokens` endpoint using tiktoken
  - **Built-in Tool Passthrough** — Web search, code execution and other built-in tools work transparently
  - **200K+ Context** — Validated with large context windows, Opus 1M context supported
  - **Web Dashboard** — React portal showing connection details, models, endpoints, and setup guides

  ## Supported Models

  | Provider | Models |
  |----------|--------|
  | OpenAI | gpt-5.2, gpt-5-mini, gpt-5-nano, o4-mini, o3 |
  | Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |

  ## API Endpoints

  | Endpoint | Format | Description |
  |----------|--------|-------------|
  | `POST /v1/chat/completions` | OpenAI | Chat completions |
  | `POST /v1/responses` | OpenAI | Responses API |
  | `POST /v1/messages` | Anthropic | Messages API |
  | `POST /v1/messages/count_tokens` | Anthropic | Token counting |
  | `GET /v1/models` | OpenAI | List available models |
  | `GET /` | — | Web dashboard |

  ## Authentication

  Set the `PROXY_API_KEY` environment variable. Clients authenticate via either:

  - `Authorization: Bearer <key>`
  - `x-api-key: <key>`

  ## Claude Code Setup

  ```bash
  export ANTHROPIC_BASE_URL=https://<your-domain>   # No /v1 suffix
  export ANTHROPIC_API_KEY=<your-proxy-api-key>
  ```

  Use `--effort max` to enable extended thinking.

  ## Environment Variables

  | Variable | Description |
  |----------|-------------|
  | `PROXY_API_KEY` | API key for client authentication |
  | `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI backend API key |
  | `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI backend base URL |
  | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic backend API key |
  | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic backend base URL |

  ## Tech Stack

  - **Proxy Server**: Express 5, TypeScript, OpenAI SDK, Anthropic SDK, tiktoken
  - **Web Portal**: React, Vite, Tailwind CSS, shadcn/ui

  ## Project Structure

  ```
  artifacts/
  ├── api-server/          # Reverse proxy server
  │   └── src/
  │       ├── app.ts       # Express app setup
  │       ├── index.ts     # Entry point
  │       └── routes/
  │           └── proxy.ts # All proxy routing logic
  └── api-portal/          # React dashboard
      └── src/
          └── App.tsx      # Dashboard UI
  ```

  ## License

  MIT
  