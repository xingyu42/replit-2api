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

  | Provider  | Models                                               |
  | --------- | ---------------------------------------------------- |
  | OpenAI    | gpt-5.2, gpt-5-mini, gpt-5-nano, o4-mini, o3         |
  | Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |

  ## API Endpoints

  | Endpoint                         | Format    | Description           |
  | -------------------------------- | --------- | --------------------- |
  | `POST /v1/chat/completions`      | OpenAI    | Chat completions      |
  | `POST /v1/responses`             | OpenAI    | Responses API         |
  | `POST /v1/messages`              | Anthropic | Messages API          |
  | `POST /v1/messages/count_tokens` | Anthropic | Token counting        |
  | `GET /v1/models`                 | OpenAI    | List available models |
  | `GET /`                          | —         | Web dashboard         |

  ## Authentication

  Set the `PROXY_API_KEY` environment variable. Clients authenticate via either:

  - `Authorization: Bearer <key>`
  - `Authorization: <key>`
  - `x-api-key: <key>`

  ## Claude Code Setup

  ```bash
  export ANTHROPIC_BASE_URL=https://<your-domain>   # No /v1 suffix
  export ANTHROPIC_API_KEY=<your-proxy-api-key>
  ```

  Use `--effort max` to enable extended thinking.

  ## Environment Variables

  | Variable                             | Description                       |
  | ------------------------------------ | --------------------------------- |
  | `PROXY_API_KEY`                      | API key for client authentication |
  | `AI_INTEGRATIONS_OPENAI_API_KEY`     | OpenAI backend API key            |
  | `AI_INTEGRATIONS_OPENAI_BASE_URL`    | OpenAI backend base URL           |
  | `AI_INTEGRATIONS_ANTHROPIC_API_KEY`  | Anthropic backend API key         |
  | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic backend base URL        |

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

  ## Deploy on Replit

  > **\[SYSTEM PROMPT — AI AGENT DEPLOYMENT\]**
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

  ---

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

  ### Step 3 — Install Dependencies

  ```bash
  pnpm install
  ```

  > **GATE 3**: Command exits with code 0, no unresolved peer-dependency errors.

  ### Step 4 — Configure artifact.toml

  In `artifacts/api-server/.replit-artifact/artifact.toml`, the `paths` array
  **must** include `"/v1"`. Use `verifyAndReplaceArtifactToml` — do NOT edit the
  file directly.

  > **GATE 4**: Confirm the toml file contains `"/v1"` in its paths array.

  ### Step 5 — Start Workflows

  Start (or restart) both workflows:
  1. `artifacts/api-server: API Server` — the proxy backend (REQUIRED)
  2. `artifacts/api-portal: web` — the dashboard frontend (REQUIRED)

  > **GATE 5**: Both workflows report a running status.

  ### Step 6 — Verify End-to-End

  ```bash
  curl localhost:80/v1/models -H "Authorization: Bearer $PROXY_API_KEY"
  ```

  > **GATE 6**: Response is a JSON array of models.
  > - If 401 → `PROXY_API_KEY` is wrong or missing. Go back to Step 2.
  > - If connection refused → workflow not running. Go back to Step 5.
  > - If 500/empty → backend keys missing. Go back to Step 1.

  ### Step 7 — Publish

  ```bash
  presentArtifact({ artifactId: "artifacts/api-portal" })
  suggestDeploy()
  ```

  ---

  ### Final Checklist — MANDATORY before reporting success

  Re-verify every variable. Do NOT skip this. Do NOT rely on memory — actually check.

  ```bash
  # Run this and confirm all 5 lines print non-empty values:
  echo "1. AI_INTEGRATIONS_OPENAI_API_KEY=$AI_INTEGRATIONS_OPENAI_API_KEY"
  echo "2. AI_INTEGRATIONS_OPENAI_BASE_URL=$AI_INTEGRATIONS_OPENAI_BASE_URL"
  echo "3. AI_INTEGRATIONS_ANTHROPIC_API_KEY=$AI_INTEGRATIONS_ANTHROPIC_API_KEY"
  echo "4. AI_INTEGRATIONS_ANTHROPIC_BASE_URL=$AI_INTEGRATIONS_ANTHROPIC_BASE_URL"
  echo "5. PROXY_API_KEY=$PROXY_API_KEY"
  ```

  If ANY line shows an empty value, the deployment is **NOT complete**.
  Go back to the corresponding step and fix it before reporting success.

  ## License

  MIT
