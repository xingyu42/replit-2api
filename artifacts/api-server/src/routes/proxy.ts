import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { get_encoding, type Tiktoken } from "tiktoken";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!,
});

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY!,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL!,
});

const OPENAI_MODELS = ["gpt-5.2", "gpt-5-mini", "gpt-5-nano", "o4-mini", "o3"];
const ANTHROPIC_MODELS = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];

function verifyBearer(req: Request, res: Response): boolean {
  const key = process.env.PROXY_API_KEY;
  if (!key) {
    res.status(401).json({ error: { message: "Unauthorized", type: "auth_error", code: 401 } });
    return false;
  }
  const auth = (req.headers.authorization ?? "").trim();
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const rawAuth = bearerToken || auth;
  const xApiKey = ((req.headers["x-api-key"] as string) ?? "").trim();
  if (rawAuth === key || xApiKey === key) {
    return true;
  }
  res.status(401).json({ error: { message: "Unauthorized", type: "auth_error", code: 401 } });
  return false;
}

function parseBetaHeader(req: Request): string[] | undefined {
  const raw = req.headers["anthropic-beta"];
  if (!raw) return undefined;
  const val = Array.isArray(raw) ? raw.join(",") : raw;
  const betas = val.split(",").map(b => b.trim()).filter(Boolean);
  return betas.length > 0 ? betas : undefined;
}

function betaReqOpts(betas: string[] | undefined) {
  return betas ? { headers: { "anthropic-beta": betas.join(",") } } : undefined;
}

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o");
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

// ── cache_control sanitizer ──────────────────────────────────────────────────
// Strips fields like `scope` that some clients send but Anthropic doesn't accept.

function sanitizeCacheControl(cc: unknown): { type: string } | undefined {
  if (!cc || typeof cc !== "object") return undefined;
  const { type } = cc as { type?: string };
  if (!type) return undefined;
  return { type }; // only keep `type`
}

function sanitizeContentBlock(block: unknown): unknown {
  if (!block || typeof block !== "object") return block;
  const b = block as Record<string, unknown>;
  if (b.cache_control !== undefined) {
    return { ...b, cache_control: sanitizeCacheControl(b.cache_control) };
  }
  return b;
}

function sanitizeAnthropicSystem(system: unknown): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return (system as unknown[]).map((block) => sanitizeContentBlock(block)) as Anthropic.Messages.TextBlockParam[];
  }
  return String(system);
}

function sanitizeAnthropicMessages(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") return msg;
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: (msg.content as unknown[]).map((block) => sanitizeContentBlock(block)) as Anthropic.Messages.ContentBlockParam[],
      };
    }
    return msg;
  });
}

// ── Tool conversion helpers ──────────────────────────────────────────────────

type OAITool = { type: "function"; function: { name: string; description?: string; parameters?: unknown } };
type AnthropicTool = { name: string; description?: string; input_schema: unknown; cache_control?: unknown };

function sanitizeAnthropicTools(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    const raw = t as Record<string, unknown>;
    if (raw.type && typeof raw.type === "string" && raw.type !== "custom") {
      return raw;
    }
    const sanitized: Record<string, unknown> = {
      name: raw.name,
      description: raw.description,
      input_schema: raw.input_schema,
    };
    const cc = sanitizeCacheControl(raw.cache_control);
    if (cc) sanitized.cache_control = cc;
    return sanitized;
  });
}

function oaiToolsToAnthropic(tools: OAITool[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

function anthropicToolsToOAI(tools: AnthropicTool[]): OAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function oaiToolChoiceToAnthropic(tc: unknown): Anthropic.Messages.ToolChoiceAuto | Anthropic.Messages.ToolChoiceAny | Anthropic.Messages.ToolChoiceTool | undefined {
  if (!tc) return undefined;
  if (tc === "none") return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "required") return { type: "any" };
  if (typeof tc === "object" && tc !== null && "function" in tc) {
    const fn = (tc as { function: { name: string } }).function;
    return { type: "tool", name: fn.name };
  }
  return { type: "auto" };
}

function anthropicToolChoiceToOAI(tc: unknown): unknown {
  if (!tc || typeof tc !== "object") return undefined;
  const t = tc as { type: string; name?: string };
  if (t.type === "auto") return "auto";
  if (t.type === "any") return "required";
  if (t.type === "tool") return { type: "function", function: { name: t.name } };
  return "auto";
}

function extractUpstreamError(err: unknown): { status: number; message: string; body?: unknown } {
  const e = err as Record<string, unknown>;
  const status = typeof e?.status === "number" ? e.status : 500;
  let message = "Internal server error";
  let body: unknown = undefined;

  if (e?.error && typeof e.error === "object") {
    const inner = e.error as Record<string, unknown>;
    if (inner.error && typeof inner.error === "object") {
      body = inner;
      const nested = inner.error as Record<string, unknown>;
      message = typeof nested.message === "string" ? nested.message : String(err);
    } else {
      body = { error: inner };
      message = typeof inner.message === "string" ? inner.message : String(err);
    }
  } else if (typeof e?.message === "string") {
    const rawMsg = e.message;
    const jsonMatch = rawMsg.match(/\d+\s+(\{.*\})/s);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.error && typeof parsed.error === "object") {
          body = parsed;
          message = parsed.error.message ?? rawMsg;
        } else {
          message = rawMsg;
        }
      } catch {
        message = rawMsg;
      }
    } else {
      message = rawMsg;
    }
  } else {
    message = String(err);
  }

  console.error("[proxy] upstream error", { status, message });
  return { status, message, body };
}

// ── Message conversion: OAI → Anthropic ─────────────────────────────────────

type OAIMessage = {
  role: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  name?: string;
};

function oaiMessagesToAnthropic(messages: OAIMessage[]): { system?: string; messages: Anthropic.Messages.MessageParam[] } {
  let system: string | undefined;
  const out: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      continue;
    }
    if (msg.role === "tool") {
      const last = out[out.length - 1];
      const block: Anthropic.Messages.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.Messages.ContentBlockParam[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const content: Anthropic.Messages.ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: "text", text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      }
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: input as Record<string, unknown> });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    if (msg.role === "user" || msg.role === "assistant") {
      const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      out.push({ role: msg.role as "user" | "assistant", content: textContent });
    }
  }
  return { system, messages: out };
}

// ── Message conversion: Anthropic → OAI ─────────────────────────────────────

type AnthropicMessage = { role: string; content: unknown };

function anthropicMessagesToOAI(messages: AnthropicMessage[]): { system?: string; messages: OpenAI.Chat.ChatCompletionMessageParam[] } {
  let system: string | undefined;
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      continue;
    }
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as { type: string; tool_use_id?: string; content?: unknown; id?: string; name?: string; input?: unknown; text?: string }[];
      if (msg.role === "user") {
        const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
        const textParts: string[] = [];
        for (const b of blocks) {
          if (b.type === "tool_result") {
            toolResults.push({ role: "tool", tool_call_id: b.tool_use_id!, content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
          } else if (b.type === "text" && b.text) {
            textParts.push(b.text);
          }
        }
        if (textParts.length > 0) out.push({ role: "user", content: textParts.join("\n") });
        out.push(...toolResults);
      } else if (msg.role === "assistant") {
        const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
        let text = "";
        for (const b of blocks) {
          if (b.type === "tool_use") {
            toolCalls.push({ id: b.id!, type: "function", function: { name: b.name!, arguments: JSON.stringify(b.input ?? {}) } });
          } else if (b.type === "text" && b.text) {
            text += b.text;
          }
        }
        const m: OpenAI.Chat.ChatCompletionAssistantMessageParam = { role: "assistant", content: text || null };
        if (toolCalls.length > 0) m.tool_calls = toolCalls;
        out.push(m);
      }
    } else {
      const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      if (msg.role === "user") out.push({ role: "user", content: textContent });
      else if (msg.role === "assistant") out.push({ role: "assistant", content: textContent });
    }
  }
  return { system, messages: out };
}

// ── Anthropic response → OAI response ───────────────────────────────────────

function anthropicResponseToOAI(msg: Anthropic.Message, model: string): OpenAI.Chat.ChatCompletion {
  const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
  let text = "";
  let thinkingText = "";
  for (const block of msg.content) {
    if (block.type === "text") text += block.text;
    else if ((block as Record<string, unknown>).type === "thinking") {
      thinkingText += (block as Record<string, unknown>).thinking as string;
    } else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } });
    }
  }
  if (thinkingText) {
    text = `<think>\n${thinkingText}\n</think>\n${text}`;
  }
  const finishReason: OpenAI.Chat.ChatCompletion.Choice["finish_reason"] =
    msg.stop_reason === "tool_use" ? "tool_calls" :
    msg.stop_reason === "end_turn" ? "stop" :
    msg.stop_reason === "max_tokens" ? "length" : "stop";

  const choice: OpenAI.Chat.ChatCompletion.Choice = {
    index: 0,
    message: { role: "assistant", content: text || null, refusal: null },
    finish_reason: finishReason,
    logprobs: null,
  };
  if (toolCalls.length > 0) choice.message.tool_calls = toolCalls;

  return {
    id: msg.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
    usage: {
      prompt_tokens: msg.usage.input_tokens,
      completion_tokens: msg.usage.output_tokens,
      total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
    },
  };
}

// ── OAI response → Anthropic Message format ──────────────────────────────────

function oaiResponseToAnthropic(resp: OpenAI.Chat.ChatCompletion): Anthropic.Message {
  const choice = resp.choices[0];
  const content: Anthropic.Messages.ContentBlock[] = [];
  if (choice.message.content) content.push({ type: "text", text: choice.message.content });
  for (const tc of choice.message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }
  const stopReason: Anthropic.Message["stop_reason"] =
    choice.finish_reason === "tool_calls" ? "tool_use" :
    choice.finish_reason === "length" ? "max_tokens" : "end_turn";

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    content,
    model: resp.model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

// ── Responses API: input → chat messages ─────────────────────────────────────

type ResponsesInput = string | Array<{
  type: string;
  role?: string;
  content?: unknown;
  text?: string;
  [k: string]: unknown;
}>;

function responsesInputToChatMessages(input: ResponsesInput, instructions?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (instructions) msgs.push({ role: "system", content: instructions });
  if (typeof input === "string") {
    msgs.push({ role: "user", content: input });
    return msgs;
  }
  for (const item of input) {
    const role = (item.role ?? "user") as "user" | "assistant" | "system";
    if (item.type === "message") {
      const content = item.content;
      if (typeof content === "string") {
        msgs.push({ role, content });
      } else if (Array.isArray(content)) {
        const text = (content as { type: string; text?: string }[])
          .filter(b => b.type === "input_text" || b.type === "text")
          .map(b => b.text ?? "")
          .join("");
        msgs.push({ role, content: text });
      }
    } else if (item.type === "input_text" || item.type === "text") {
      msgs.push({ role: "user", content: (item.text ?? "") as string });
    }
  }
  return msgs;
}

function responsesInputToAnthropicMessages(input: ResponsesInput, instructions?: string): { system?: string; messages: Anthropic.Messages.MessageParam[] } {
  const oaiMsgs = responsesInputToChatMessages(input, instructions);
  const oaiForConvert = oaiMsgs.map(m => ({
    role: m.role,
    content: typeof m === "object" && "content" in m ? m.content : "",
  })) as OAIMessage[];
  return oaiMessagesToAnthropic(oaiForConvert);
}

// ── OpenAI Responses API → chat completion format conversion ─────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function responsesRespToOAI(resp: any, model: string): OpenAI.Chat.ChatCompletion {
  let text = "";
  const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];

  const output = resp.output ?? [];
  for (const item of output) {
    if (item.type === "message") {
      for (const block of item.content ?? []) {
        if (block.type === "output_text" || block.type === "text") text += block.text ?? "";
        if (block.type === "refusal") text += block.refusal ?? "";
      }
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${Date.now()}`,
        type: "function",
        function: { name: item.name ?? "", arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}) },
      });
    }
  }

  const rawStatus = resp.status ?? "completed";
  const finishReason: OpenAI.Chat.ChatCompletion.Choice["finish_reason"] =
    rawStatus === "incomplete" ? "length" :
    toolCalls.length > 0 ? "tool_calls" : "stop";

  const choice: OpenAI.Chat.ChatCompletion.Choice = {
    index: 0,
    message: { role: "assistant", content: text || null, refusal: null },
    finish_reason: finishReason,
    logprobs: null,
  };
  if (toolCalls.length > 0) choice.message.tool_calls = toolCalls;

  return {
    id: resp.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
    usage: {
      prompt_tokens: resp.usage?.input_tokens ?? 0,
      completion_tokens: resp.usage?.output_tokens ?? 0,
      total_tokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    },
  };
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

function setupSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function sendSSE(res: Response, data: string): void {
  res.write(data);
  if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
    (res as unknown as { flush: () => void }).flush();
  }
}

function startKeepalive(res: Response, req: Request): ReturnType<typeof setInterval> {
  const interval = setInterval(() => sendSSE(res, ": keepalive\n\n"), 5000);
  req.on("close", () => clearInterval(interval));
  return interval;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/models
// ─────────────────────────────────────────────────────────────────────────────

router.get("/models", (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;
  const now = Math.floor(Date.now() / 1000);
  const models = [
    ...OPENAI_MODELS.map((id) => ({ id, object: "model", created: now, owned_by: "openai" })),
    ...ANTHROPIC_MODELS.map((id) => ({ id, object: "model", created: now, owned_by: "anthropic" })),
  ];
  res.json({ object: "list", data: models });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/chat/completions  (OpenAI-compatible)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as {
    model: string;
    messages: OAIMessage[];
    stream?: boolean;
    tools?: OAITool[];
    tool_choice?: unknown;
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    [key: string]: unknown;
  };

  const { model, messages, stream = false, tools, tool_choice, ...rest } = body;

  const thinkingParam = body.thinking as { type: string; budget_tokens: number } | undefined;

  try {
    if (isOpenAIModel(model)) {
      // ── OpenAI path ──────────────────────────────────────────────────────
      const params: OpenAI.Chat.ChatCompletionCreateParams = {
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        stream,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(tool_choice ? { tool_choice: tool_choice as OpenAI.Chat.ChatCompletionToolChoiceOption } : {}),
        ...(rest.temperature !== undefined ? { temperature: rest.temperature as number } : {}),
        ...(rest.max_completion_tokens !== undefined ? { max_completion_tokens: rest.max_completion_tokens as number } : {}),
      };

      if (stream) {
        setupSSE(res);
        const interval = startKeepalive(res, req);
        try {
          const oaiStream = await openai.chat.completions.create({ ...params, stream: true });
          for await (const chunk of oaiStream) {
            sendSSE(res, `data: ${JSON.stringify(chunk)}\n\n`);
          }
          sendSSE(res, "data: [DONE]\n\n");
        } finally {
          clearInterval(interval);
          res.end();
        }
      } else {
        const completion = await openai.chat.completions.create({ ...params, stream: false });
        res.json(completion);
      }
    } else if (isAnthropicModel(model)) {
      // ── Anthropic path ────────────────────────────────────────────────────
      const { system, messages: anthropicMessages } = oaiMessagesToAnthropic(messages);
      const anthropicTools = tools && tools.length > 0 ? oaiToolsToAnthropic(tools) : undefined;
      const anthropicToolChoice = tool_choice ? oaiToolChoiceToAnthropic(tool_choice) : undefined;

      const betas = parseBetaHeader(req);
      const reqOpts = betaReqOpts(betas);

      const anthropicParams: Record<string, unknown> = {
        model,
        messages: sanitizeAnthropicMessages(anthropicMessages),
        max_tokens: (rest.max_tokens as number | undefined) ?? (rest.max_completion_tokens as number | undefined) ?? 8192,
        ...(system ? { system: sanitizeAnthropicSystem(system) } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
        ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
        ...(rest.temperature !== undefined ? { temperature: rest.temperature as number } : {}),
        ...(rest.top_p !== undefined ? { top_p: rest.top_p as number } : {}),
        ...(rest.top_k !== undefined ? { top_k: rest.top_k as number } : {}),
        ...(rest.stop !== undefined ? { stop_sequences: Array.isArray(rest.stop) ? rest.stop : [rest.stop] } : {}),
        ...(rest.metadata !== undefined ? { metadata: rest.metadata } : {}),
      };

      if (thinkingParam) {
        if (thinkingParam.type === "enabled" && thinkingParam.budget_tokens > 0) {
          anthropicParams.thinking = { type: "enabled", budget_tokens: thinkingParam.budget_tokens };
        } else if (thinkingParam.type === "adaptive") {
          anthropicParams.thinking = { type: "adaptive" };
        }
        if (anthropicParams.thinking) {
          delete anthropicParams.temperature;
        }
      }

      if (stream) {
        setupSSE(res);
        const interval = startKeepalive(res, req);
        try {
          const msgStream = reqOpts
            ? anthropic.messages.stream(anthropicParams as Anthropic.Messages.MessageCreateParamsNonStreaming, reqOpts)
            : anthropic.messages.stream(anthropicParams as Anthropic.Messages.MessageCreateParamsNonStreaming);
          let inputTokens = 0;
          let outputTokens = 0;
          const completionId = `chatcmpl-${Date.now()}`;
          const created = Math.floor(Date.now() / 1000);
          let currentToolCallIndex = -1;
          let currentToolCallId = "";
          let currentToolCallName = "";
          let insideThinking = false;

          const startChunk: OpenAI.Chat.ChatCompletionChunk = {
            id: completionId, object: "chat.completion.chunk", created, model,
            choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null, logprobs: null }],
          };
          sendSSE(res, `data: ${JSON.stringify(startChunk)}\n\n`);

          for await (const event of msgStream) {
            if (event.type === "message_start") {
              inputTokens = event.message.usage.input_tokens;
            } else if (event.type === "content_block_start") {
              if ((event.content_block as Record<string, unknown>).type === "thinking") {
                insideThinking = true;
                const thinkStartChunk: OpenAI.Chat.ChatCompletionChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model,
                  choices: [{ index: 0, delta: { content: "<think>\n" }, finish_reason: null, logprobs: null }],
                };
                sendSSE(res, `data: ${JSON.stringify(thinkStartChunk)}\n\n`);
              } else if (event.content_block.type === "tool_use") {
                insideThinking = false;
                currentToolCallIndex++;
                currentToolCallId = event.content_block.id;
                currentToolCallName = event.content_block.name;
                const toolStartChunk: OpenAI.Chat.ChatCompletionChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: currentToolCallIndex,
                        id: currentToolCallId,
                        type: "function",
                        function: { name: currentToolCallName, arguments: "" },
                      }],
                    },
                    finish_reason: null, logprobs: null,
                  }],
                };
                sendSSE(res, `data: ${JSON.stringify(toolStartChunk)}\n\n`);
              } else {
                insideThinking = false;
              }
            } else if (event.type === "content_block_stop") {
              if (insideThinking) {
                insideThinking = false;
                const thinkEndChunk: OpenAI.Chat.ChatCompletionChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model,
                  choices: [{ index: 0, delta: { content: "\n</think>\n" }, finish_reason: null, logprobs: null }],
                };
                sendSSE(res, `data: ${JSON.stringify(thinkEndChunk)}\n\n`);
              }
            } else if (event.type === "content_block_delta") {
              if ((event.delta as Record<string, unknown>).type === "thinking_delta") {
                const thinkingText = (event.delta as Record<string, unknown>).thinking as string;
                const thinkChunk: OpenAI.Chat.ChatCompletionChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model,
                  choices: [{ index: 0, delta: { content: thinkingText }, finish_reason: null, logprobs: null }],
                };
                sendSSE(res, `data: ${JSON.stringify(thinkChunk)}\n\n`);
              } else if (event.delta.type === "text_delta") {
                const textChunk: OpenAI.Chat.ChatCompletionChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model,
                  choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null, logprobs: null }],
                };
                sendSSE(res, `data: ${JSON.stringify(textChunk)}\n\n`);
              } else if (event.delta.type === "input_json_delta") {
                const argChunk: OpenAI.Chat.ChatCompletionChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model,
                  choices: [{
                    index: 0,
                    delta: { tool_calls: [{ index: currentToolCallIndex, function: { arguments: event.delta.partial_json } }] },
                    finish_reason: null, logprobs: null,
                  }],
                };
                sendSSE(res, `data: ${JSON.stringify(argChunk)}\n\n`);
              }
            } else if (event.type === "message_delta") {
              outputTokens = event.usage.output_tokens;
              const finishReason: OpenAI.Chat.ChatCompletionChunk.Choice["finish_reason"] =
                event.delta.stop_reason === "tool_use" ? "tool_calls" :
                event.delta.stop_reason === "max_tokens" ? "length" : "stop";
              const finalChunk: OpenAI.Chat.ChatCompletionChunk = {
                id: completionId, object: "chat.completion.chunk", created, model,
                choices: [{ index: 0, delta: {}, finish_reason: finishReason, logprobs: null }],
                usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
              };
              sendSSE(res, `data: ${JSON.stringify(finalChunk)}\n\n`);
            }
          }
          sendSSE(res, "data: [DONE]\n\n");
        } finally {
          clearInterval(interval);
          res.end();
        }
      } else {
        const chatMsgStream = reqOpts
          ? anthropic.messages.stream(anthropicParams as Anthropic.Messages.MessageCreateParamsNonStreaming, reqOpts)
          : anthropic.messages.stream(anthropicParams as Anthropic.Messages.MessageCreateParamsNonStreaming);
        const finalMsg = await chatMsgStream.finalMessage();
        res.json(anthropicResponseToOAI(finalMsg, model));
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error", code: 400 } });
    }
  } catch (err) {
    const { status, message, body } = extractUpstreamError(err);
    if (!res.headersSent) {
      res.status(status).json(body ?? { error: { message, type: "server_error", code: status } });
    } else {
      res.end();
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/responses  (OpenAI Responses API)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/responses", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as {
    model: string;
    input: ResponsesInput;
    instructions?: string;
    stream?: boolean;
    tools?: unknown[];
    tool_choice?: unknown;
    max_output_tokens?: number;
    temperature?: number;
    previous_response_id?: string;
    [key: string]: unknown;
  };

  const { model, input, instructions, stream = false, tools, tool_choice, max_output_tokens, ...rest } = body;

  try {
    if (isOpenAIModel(model)) {
      // ── Direct Responses API pass-through ────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oaiResponses = (openai as any).responses;
      if (!oaiResponses) {
        // Fallback: convert to chat completions
        const msgs = responsesInputToChatMessages(input, instructions);
        const oaiTools = tools && tools.length > 0
          ? (tools as OAITool[])
          : undefined;

        if (stream) {
          setupSSE(res);
          const interval = startKeepalive(res, req);
          try {
            const oaiStream = await openai.chat.completions.create({
              model, messages: msgs, stream: true,
              ...(oaiTools ? { tools: oaiTools } : {}),
              ...(tool_choice ? { tool_choice: tool_choice as OpenAI.Chat.ChatCompletionToolChoiceOption } : {}),
              ...(max_output_tokens ? { max_completion_tokens: max_output_tokens } : {}),
            });
            for await (const chunk of oaiStream) {
              sendSSE(res, `data: ${JSON.stringify(chunk)}\n\n`);
            }
            sendSSE(res, "data: [DONE]\n\n");
          } finally {
            clearInterval(interval);
            res.end();
          }
        } else {
          const completion = await openai.chat.completions.create({
            model, messages: msgs, stream: false,
            ...(oaiTools ? { tools: oaiTools } : {}),
            ...(tool_choice ? { tool_choice: tool_choice as OpenAI.Chat.ChatCompletionToolChoiceOption } : {}),
            ...(max_output_tokens ? { max_completion_tokens: max_output_tokens } : {}),
          });
          res.json(completion);
        }
        return;
      }

      // Native Responses API
      const responsesParams: Record<string, unknown> = {
        model,
        input,
        ...(instructions ? { instructions } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...(max_output_tokens ? { max_output_tokens } : {}),
        ...(rest.temperature !== undefined ? { temperature: rest.temperature } : {}),
        ...(rest.previous_response_id ? { previous_response_id: rest.previous_response_id } : {}),
        stream,
      };

      if (stream) {
        setupSSE(res);
        const interval = startKeepalive(res, req);
        try {
          const oaiStream = await oaiResponses.create(responsesParams);
          for await (const event of oaiStream) {
            sendSSE(res, `data: ${JSON.stringify(event)}\n\n`);
          }
          sendSSE(res, "data: [DONE]\n\n");
        } finally {
          clearInterval(interval);
          res.end();
        }
      } else {
        const resp = await oaiResponses.create(responsesParams);
        res.json(resp);
      }
    } else if (isAnthropicModel(model)) {
      // ── Convert Responses format → Anthropic Messages ─────────────────────
      const { system, messages: anthropicMessages } = responsesInputToAnthropicMessages(input, instructions);
      const anthropicTools = tools && tools.length > 0 ? oaiToolsToAnthropic(tools as OAITool[]) : undefined;
      const anthropicToolChoice = tool_choice ? oaiToolChoiceToAnthropic(tool_choice) : undefined;

      const betas = parseBetaHeader(req);
      const reqOpts = betaReqOpts(betas);

      const anthropicParams: Record<string, unknown> = {
        model,
        messages: sanitizeAnthropicMessages(anthropicMessages),
        max_tokens: max_output_tokens ?? 8192,
        ...(system ? { system: sanitizeAnthropicSystem(system) } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
        ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
      };

      if (stream) {
        setupSSE(res);
        const interval = startKeepalive(res, req);
        try {
          const completionId = `resp_${Date.now()}`;
          const created = Math.floor(Date.now() / 1000);
          let currentToolCallIndex = -1;
          let inputTokens = 0;
          let outputTokens = 0;
          let finishReason = "stop";

          sendSSE(res, `data: ${JSON.stringify({ type: "response.created", response: { id: completionId, object: "response", created_at: created, model, status: "in_progress", output: [] } })}\n\n`);

          const msgStream = reqOpts
            ? anthropic.messages.stream(anthropicParams, reqOpts)
            : anthropic.messages.stream(anthropicParams);

          for await (const event of msgStream) {
            if (event.type === "message_start") {
              inputTokens = event.message.usage.input_tokens;
            } else if (event.type === "content_block_start") {
              if (event.content_block.type === "tool_use") {
                currentToolCallIndex++;
                sendSSE(res, `data: ${JSON.stringify({ type: "response.output_item.added", output_index: currentToolCallIndex + 1, item: { type: "function_call", id: event.content_block.id, name: event.content_block.name, arguments: "" } })}\n\n`);
              } else if (event.content_block.type === "text") {
                sendSSE(res, `data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: completionId, role: "assistant", content: [] } })}\n\n`);
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                sendSSE(res, `data: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: event.delta.text })}\n\n`);
              } else if (event.delta.type === "input_json_delta") {
                sendSSE(res, `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: currentToolCallIndex + 1, delta: event.delta.partial_json })}\n\n`);
              }
            } else if (event.type === "message_delta") {
              outputTokens = event.usage.output_tokens;
              finishReason = event.delta.stop_reason === "tool_use" ? "tool_calls" : event.delta.stop_reason === "max_tokens" ? "length" : "stop";
            }
          }

          sendSSE(res, `data: ${JSON.stringify({ type: "response.completed", response: { id: completionId, object: "response", created_at: created, model, status: "completed", output: [], usage: { input_tokens: inputTokens, output_tokens: outputTokens }, incomplete_details: finishReason === "length" ? { reason: "max_tokens" } : null } })}\n\n`);
          sendSSE(res, "data: [DONE]\n\n");
        } finally {
          clearInterval(interval);
          res.end();
        }
      } else {
        const respMsgStream = reqOpts
          ? anthropic.messages.stream(anthropicParams, reqOpts)
          : anthropic.messages.stream(anthropicParams);
        const finalMsg = await respMsgStream.finalMessage();
        const outputItems: unknown[] = [];
        let text = "";
        const toolCalls: { type: string; id: string; name: string; arguments: string }[] = [];

        for (const block of finalMsg.content) {
          if (block.type === "text") text += block.text;
          else if (block.type === "tool_use") {
            toolCalls.push({ type: "function_call", id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
          }
        }

        if (text) outputItems.push({ type: "message", id: `msg_${Date.now()}`, role: "assistant", content: [{ type: "output_text", text }] });
        outputItems.push(...toolCalls);

        const stopReason = finalMsg.stop_reason === "tool_use" ? "tool_calls" : finalMsg.stop_reason === "max_tokens" ? "incomplete" : "stop";
        res.json({
          id: finalMsg.id,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          model,
          status: stopReason === "incomplete" ? "incomplete" : "completed",
          output: outputItems,
          usage: { input_tokens: finalMsg.usage.input_tokens, output_tokens: finalMsg.usage.output_tokens },
          incomplete_details: stopReason === "incomplete" ? { reason: "max_tokens" } : null,
        });
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error", code: 400 } });
    }
  } catch (err) {
    const { status, message, body } = extractUpstreamError(err);
    if (!res.headersSent) {
      res.status(status).json(body ?? { error: { message, type: "server_error", code: status } });
    } else {
      res.end();
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/messages  (Anthropic Messages native)
// ─────────────────────────────────────────────────────────────────────────────

let tiktokenEncoder: Tiktoken | null = null;
function getEncoder(): Tiktoken {
  if (!tiktokenEncoder) {
    tiktokenEncoder = get_encoding("cl100k_base");
  }
  return tiktokenEncoder;
}

function countTikTokens(text: string): number {
  return getEncoder().encode(text).length;
}

function countRequestTokens(body: {
  messages?: unknown[];
  system?: unknown;
  tools?: unknown[];
}): number {
  let total = 0;
  const enc = getEncoder();

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      const m = msg as Record<string, unknown>;
      if (typeof m.content === "string") {
        total += enc.encode(m.content).length;
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          const p = part as Record<string, unknown>;
          if (p.type === "text" && typeof p.text === "string") {
            total += enc.encode(p.text).length;
          } else if (p.type === "tool_use" && p.input) {
            total += enc.encode(JSON.stringify(p.input)).length;
          } else if (p.type === "tool_result") {
            const c = typeof p.content === "string" ? p.content : JSON.stringify(p.content);
            total += enc.encode(c).length;
          }
        }
      }
    }
  }

  if (typeof body.system === "string") {
    total += enc.encode(body.system).length;
  } else if (Array.isArray(body.system)) {
    for (const item of body.system) {
      const s = item as Record<string, unknown>;
      if (s.type === "text" && typeof s.text === "string") {
        total += enc.encode(s.text).length;
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      const t = tool as Record<string, unknown>;
      if (t.name) total += enc.encode(String(t.name)).length;
      if (t.description) total += enc.encode(String(t.description)).length;
      if (t.input_schema) total += enc.encode(JSON.stringify(t.input_schema)).length;
    }
  }

  return Math.max(total, 1);
}

router.post("/messages/count_tokens", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as {
    model?: string;
    messages?: unknown[];
    system?: unknown;
    tools?: unknown[];
    [key: string]: unknown;
  };

  try {
    const total = countRequestTokens(body);
    res.json({ input_tokens: total });
  } catch {
    const text = JSON.stringify(body);
    res.json({ input_tokens: Math.ceil(text.length / 4) });
  }
});

router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as {
    model: string;
    messages: AnthropicMessage[];
    system?: unknown;
    max_tokens?: number;
    stream?: boolean;
    tools?: AnthropicTool[];
    tool_choice?: unknown;
    [key: string]: unknown;
  };

  const { model, messages, system, max_tokens = 8192, stream = false, tools, tool_choice } = body;
  const thinkingMsg = body.thinking as { type: string; budget_tokens: number } | undefined;

  const betas = parseBetaHeader(req);
  const reqOpts = betaReqOpts(betas);

  try {
    if (isAnthropicModel(model)) {
      // ── Direct Anthropic path ─────────────────────────────────────────────
      const rawMessages = messages as Anthropic.Messages.MessageParam[];
      const sanitizedMessages = sanitizeAnthropicMessages(rawMessages);
      const sanitizedSystem = sanitizeAnthropicSystem(system);

      const params: Record<string, unknown> = {
        model,
        messages: sanitizedMessages,
        max_tokens,
        ...(sanitizedSystem !== undefined ? { system: sanitizedSystem } : {}),
        ...(tools && tools.length > 0 ? { tools: sanitizeAnthropicTools(tools) } : {}),
        ...(tool_choice ? { tool_choice: tool_choice as Anthropic.Messages.ToolChoice } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
        ...(body.top_k !== undefined ? { top_k: body.top_k } : {}),
        ...(body.stop_sequences !== undefined ? { stop_sequences: body.stop_sequences } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      };

      if (thinkingMsg) {
        if (thinkingMsg.type === "enabled" && thinkingMsg.budget_tokens > 0) {
          params.thinking = { type: "enabled", budget_tokens: thinkingMsg.budget_tokens };
        } else if (thinkingMsg.type === "adaptive") {
          params.thinking = { type: "adaptive" };
        }
        if (params.thinking) {
          delete params.temperature;
        }
      }

      if (stream) {
        setupSSE(res);
        const interval = startKeepalive(res, req);
        try {
          const msgStream = reqOpts
            ? anthropic.messages.stream(params, reqOpts)
            : anthropic.messages.stream(params);
          for await (const event of msgStream) {
            sendSSE(res, `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
          sendSSE(res, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
        } finally {
          clearInterval(interval);
          res.end();
        }
      } else {
        const msgStream = reqOpts
          ? anthropic.messages.stream(params, reqOpts)
          : anthropic.messages.stream(params);
        const msg = await msgStream.finalMessage();
        res.json(msg);
      }
    } else if (isOpenAIModel(model)) {
      // ── OpenAI path (convert Anthropic format → OAI format) ───────────────
      const { system: sysFromMsgs, messages: oaiMessages } = anthropicMessagesToOAI(messages as AnthropicMessage[]);
      const finalSystem = (system ? (typeof system === "string" ? system : JSON.stringify(system)) : undefined) ?? sysFromMsgs;
      if (finalSystem) {
        oaiMessages.unshift({ role: "system", content: finalSystem });
      }
      const oaiTools = tools && tools.length > 0 ? anthropicToolsToOAI(tools) : undefined;
      const oaiToolChoice = tool_choice ? anthropicToolChoiceToOAI(tool_choice) : undefined;

      const oaiParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model,
        messages: oaiMessages,
        max_completion_tokens: max_tokens,
        stream: false,
        ...(oaiTools ? { tools: oaiTools } : {}),
        ...(oaiToolChoice ? { tool_choice: oaiToolChoice as OpenAI.Chat.ChatCompletionToolChoiceOption } : {}),
      };

      if (stream) {
        setupSSE(res);
        const interval = startKeepalive(res, req);
        try {
          const msgId = `msg_${Date.now()}`;
          const created = Math.floor(Date.now() / 1000);

          sendSSE(res, `event: message_start\ndata: ${JSON.stringify({
            type: "message_start",
            message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
          })}\n\n`);
          sendSSE(res, `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
          sendSSE(res, `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`);

          const oaiStreamParams = { ...oaiParams, stream: true as const };
          const oaiStream = await openai.chat.completions.create(oaiStreamParams);
          const toolCallBuffers: Record<number, { id: string; name: string; arguments: string }> = {};
          const toolCallIndexStarted: Record<number, boolean> = {};
          let inputTokens = 0;
          let outputTokens = 0;
          let finishReason: string | null = null;

          for await (const chunk of oaiStream) {
            const choice = chunk.choices[0];
            if (!choice) continue;
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0;
              outputTokens = chunk.usage.completion_tokens ?? 0;
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (delta.content) {
              sendSSE(res, `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } })}\n\n`);
            }
            for (const tc of delta.tool_calls ?? []) {
              const idx = tc.index;
              if (!toolCallBuffers[idx]) toolCallBuffers[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
              if (tc.id) toolCallBuffers[idx].id = tc.id;
              if (tc.function?.name) toolCallBuffers[idx].name += tc.function.name;
              if (tc.function?.arguments) {
                if (!toolCallIndexStarted[idx]) {
                  toolCallIndexStarted[idx] = true;
                  const blockIdx = idx + 1;
                  sendSSE(res, `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
                  sendSSE(res, `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: blockIdx, content_block: { type: "tool_use", id: toolCallBuffers[idx].id, name: toolCallBuffers[idx].name, input: {} } })}\n\n`);
                }
                const blockIdx = idx + 1;
                sendSSE(res, `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: blockIdx, delta: { type: "input_json_delta", partial_json: tc.function.arguments } })}\n\n`);
                toolCallBuffers[idx].arguments += tc.function.arguments;
              }
            }
          }

          const hasToolCalls = Object.keys(toolCallBuffers).length > 0;
          const lastBlockIdx = hasToolCalls ? Object.keys(toolCallBuffers).length : 0;
          sendSSE(res, `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: lastBlockIdx })}\n\n`);

          const anthropicStopReason = finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "max_tokens" : "end_turn";
          sendSSE(res, `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: anthropicStopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
          sendSSE(res, `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        } finally {
          clearInterval(interval);
          res.end();
        }
      } else {
        const oaiResp = await openai.chat.completions.create({ ...oaiParams, stream: false });
        res.json(oaiResponseToAnthropic(oaiResp));
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error", code: 400 } });
    }
  } catch (err) {
    const { status, message, body } = extractUpstreamError(err);
    if (!res.headersSent) {
      res.status(status).json(body ?? { error: { message, type: "server_error", code: status } });
    } else {
      res.end();
    }
  }
});

export default router;
