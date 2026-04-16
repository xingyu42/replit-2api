import { useEffect, useState, useCallback } from "react";

const BG = "hsl(222,47%,11%)";
const CARD = "hsl(222,47%,14%)";
const BORDER = "hsl(222,47%,20%)";
const TEXT = "#e2e8f0";
const MUTED = "#94a3b8";
const GREEN = "#22c55e";
const RED = "#ef4444";
const BLUE = "#3b82f6";
const PURPLE = "#a855f7";
const ORANGE = "#f97316";
const GRAY = "#6b7280";

const OPENAI_MODELS = ["gpt-5.2", "gpt-5-mini", "gpt-5-nano", "o4-mini", "o3"];
const ANTHROPIC_MODELS = ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];

const ENDPOINTS = [
  { method: "GET", path: "/v1/models", label: "List Models", type: "both", description: "Returns the list of available OpenAI and Anthropic models." },
  { method: "POST", path: "/v1/chat/completions", label: "Chat Completions", type: "openai", description: "OpenAI-compatible chat API. Routes to OpenAI or Anthropic based on the model prefix. Supports streaming and tool calls." },
  { method: "POST", path: "/v1/responses", label: "Responses", type: "openai", description: "OpenAI Responses API. Supports multi-turn context via previous_response_id, streaming, and tool calls. Also accepts Claude models." },
  { method: "POST", path: "/v1/messages", label: "Messages", type: "anthropic", description: "Anthropic Messages native API. Accepts Anthropic format and routes to Claude or OpenAI models." },
];

function CopyButton({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={copy}
      aria-label={copied ? "已复制" : "复制到剪贴板"}
      style={{
        padding: small ? "3px 10px" : "5px 14px",
        background: copied ? "hsl(142,71%,45%,0.15)" : "hsl(222,47%,20%)",
        border: `1px solid ${copied ? "hsl(142,71%,45%,0.4)" : BORDER}`,
        borderRadius: 6,
        color: copied ? GREEN : MUTED,
        fontSize: small ? 11 : 12,
        cursor: "pointer",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
      }}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function Badge({ color, children }: { color: string; children: string }) {
  return (
    <span style={{
      background: color + "22",
      color,
      border: `1px solid ${color}44`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.03em",
    }}>{children}</span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: TEXT, fontSize: 16, fontWeight: 600, margin: "0 0 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
      {children}
    </h2>
  );
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const baseUrl = window.location.origin;
  const authHeader = `Authorization: Bearer YOUR_PROXY_API_KEY`;

  useEffect(() => {
    fetch("/api/healthz")
      .then(r => r.ok ? setOnline(true) : setOnline(false))
      .catch(() => setOnline(false));
  }, []);

  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'`;

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", padding: "0 0 60px 0" }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "18px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}><span role="img" aria-hidden="true">⚡</span></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: TEXT }}>AI Proxy API</div>
              <div style={{ fontSize: 12, color: MUTED }}>OpenAI + Anthropic dual-compatible</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative", display: "inline-flex" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: online === null ? GRAY : online ? GREEN : RED, position: "relative", zIndex: 1 }} />
              {online && (
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: GREEN, animation: "ping 1.5s ease-in-out infinite", opacity: 0.4 }} />
              )}
            </div>
            <span style={{ fontSize: 12, color: online === null ? MUTED : online ? GREEN : RED }}>
              {online === null ? "Checking..." : online ? "Online" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ping { 0%,100%{transform:scale(1);opacity:.4} 50%{transform:scale(2);opacity:0} }
        code { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
        button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
        button:hover { opacity: 0.85; }
      `}</style>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Connection Details */}
        <Card>
          <SectionTitle><span role="img" aria-hidden="true">🔌</span> Connection Details</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: BG, borderRadius: 8, padding: "10px 14px" }}>
              <div>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>BASE URL</div>
                <code style={{ fontSize: 13, color: BLUE }}>{baseUrl}</code>
              </div>
              <CopyButton text={baseUrl} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: BG, borderRadius: 8, padding: "10px 14px" }}>
              <div>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>AUTH HEADER</div>
                <code style={{ fontSize: 13, color: PURPLE }}>{authHeader}</code>
              </div>
              <CopyButton text={authHeader} />
            </div>
          </div>
        </Card>

        {/* API Endpoints */}
        <Card>
          <SectionTitle><span role="img" aria-hidden="true">🛣️</span> API Endpoints</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ENDPOINTS.map(ep => (
              <div key={ep.path} style={{ background: BG, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <Badge color={ep.method === "GET" ? GREEN : PURPLE}>{ep.method}</Badge>
                  <code style={{ fontSize: 13, color: TEXT, flex: 1 }}>{baseUrl}{ep.path}</code>
                  <Badge color={ep.type === "openai" ? BLUE : ep.type === "anthropic" ? ORANGE : GRAY}>
                    {ep.type === "openai" ? "OpenAI" : ep.type === "anthropic" ? "Anthropic" : "Both"}
                  </Badge>
                  <CopyButton text={baseUrl + ep.path} small />
                </div>
                <p style={{ margin: 0, fontSize: 12, color: MUTED }}>{ep.description}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Available Models */}
        <Card>
          <SectionTitle><span role="img" aria-hidden="true">🤖</span> Available Models</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {OPENAI_MODELS.map(m => (
              <div key={m} style={{ background: BG, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <code style={{ fontSize: 12, color: TEXT }}>{m}</code>
                <Badge color={BLUE}>OpenAI</Badge>
              </div>
            ))}
            {ANTHROPIC_MODELS.map(m => (
              <div key={m} style={{ background: BG, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <code style={{ fontSize: 12, color: TEXT }}>{m}</code>
                <Badge color={ORANGE}>Anthropic</Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* CherryStudio Setup */}
        <Card>
          <SectionTitle><span role="img" aria-hidden="true">🍒</span> CherryStudio Setup Guide</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { n: 1, title: "Open Settings", desc: "Go to CherryStudio → Settings → Model Providers." },
              { n: 2, title: "Add Provider", desc: "Click Add Provider and select OpenAI or Anthropic compatible type. Both work with this proxy." },
              { n: 3, title: "Set Base URL & Key", desc: `Enter Base URL: ${baseUrl}  and API Key: your PROXY_API_KEY value.` },
              { n: 4, title: "Select Models", desc: "Use any model ID from the list above (e.g. claude-sonnet-4-6 or gpt-5.2). The proxy will route automatically." },
            ].map(step => (
              <div key={step.n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{
                  minWidth: 30, height: 30, borderRadius: "50%",
                  background: "linear-gradient(135deg,#3b82f6,#a855f7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0,
                }}>
                  {step.n}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3, color: TEXT }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Quick Test */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <SectionTitle style={{ margin: 0 }}><span role="img" aria-hidden="true">⚡</span> Quick Test (curl)</SectionTitle>
            <CopyButton text={curlExample} />
          </div>
          <div style={{ background: BG, borderRadius: 8, padding: 16, overflowX: "auto" }}>
            <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: MUTED }}>curl </span>
              <span style={{ color: BLUE }}>{baseUrl}/v1/chat/completions</span>
              <span style={{ color: MUTED }}> \{"\n"}  -H </span>
              <span style={{ color: GREEN }}>"Content-Type: application/json"</span>
              <span style={{ color: MUTED }}> \{"\n"}  -H </span>
              <span style={{ color: GREEN }}>"Authorization: Bearer YOUR_PROXY_API_KEY"</span>
              <span style={{ color: MUTED }}> \{"\n"}  -d </span>
              <span style={{ color: ORANGE }}>{`'{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Hello!"}],"stream":false}'`}</span>
            </pre>
          </div>
        </Card>

        {/* Footer */}
        <div style={{ textAlign: "center", color: MUTED, fontSize: 12, marginTop: 8 }}>
          Powered by Replit · OpenAI SDK · Anthropic SDK · Express
        </div>
      </div>
    </div>
  );
}
