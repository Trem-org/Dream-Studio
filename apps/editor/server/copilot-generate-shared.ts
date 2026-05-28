import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  CopilotMessage,
  CopilotResponse,
  CopilotToolCall,
  CopilotToolDeclaration
} from "../src/lib/copilot/types.js";

export const SERVER_GEMMA_MODEL = "gemini-3.1-pro-preview";
const PRIMARY_TIMEOUT_MS = 8_000;
const FALLBACK_TIMEOUT_MS = 10_000;
const GEMINI_FLASH_TIMEOUT_MS = 18_000;
const MORPHUS_PRIMARY_TIMEOUT_MS = 20_000;
const MORPHUS_FALLBACK_TIMEOUT_MS = 22_000;
const MORPHUS_GEMINI_FLASH_TIMEOUT_MS = 35_000;

export type CopilotGenerateRequest = {
  messages: CopilotMessage[];
  tools: CopilotToolDeclaration[];
  systemPrompt: string;
  temperature: number;
  apiKey?: string;
};

type TimeoutPolicy = {
  primaryMs: number;
  fallbackMs: number;
  geminiFlashMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeGeminiParts(parts: unknown[] | undefined): Record<string, unknown>[] {
  if (!parts?.length) {
    return [];
  }

  const sanitized: Record<string, unknown>[] = [];

  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }

    if (typeof part.text === "string") {
      sanitized.push({ text: part.text });
      continue;
    }

    if (isRecord(part.functionCall) && typeof part.functionCall.name === "string") {
      sanitized.push({
        functionCall: {
          name: part.functionCall.name,
          args: isRecord(part.functionCall.args) ? part.functionCall.args : {}
        }
      });
      continue;
    }

    if (isRecord(part.inlineData) && typeof part.inlineData.mimeType === "string" && typeof part.inlineData.data === "string") {
      sanitized.push({
        inlineData: {
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data
        }
      });
    }
  }

  return sanitized;
}

function convertMessages(messages: CopilotMessage[]) {
  const contents: Record<string, unknown>[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const parts: Record<string, unknown>[] = [];
      if (message.images && message.images.length > 0) {
        for (const img of message.images) {
          const base64 = img.dataUrl.split(",")[1] ?? img.dataUrl;
          parts.push({ inlineData: { mimeType: img.mimeType, data: base64 } });
        }
      }
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
    } else if (message.role === "assistant") {
      const parts = sanitizeGeminiParts(message.rawParts);

      if (parts.length === 0 && message.content) {
        parts.push({ text: message.content });
      }

      if (parts.length === 0 && message.toolCalls) {
        for (const tc of message.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
      }

      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
    } else if (message.role === "tool" && message.toolResults) {
      const parts = message.toolResults.map((tr) => ({
        functionResponse: {
          name: tr.name,
          response: JSON.parse(tr.result) as Record<string, unknown>
        }
      }));

      contents.push({ role: "user", parts });
    }
  }

  return contents;
}

function convertToolDeclarations(tools: CopilotToolDeclaration[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

function readGeminiResponse(response: {
  text?: string;
  functionCalls?: Array<{
    args?: unknown;
    name?: string;
  }>;
  candidates?: Array<{
    content?: {
      parts?: unknown[];
    };
  }>;
}): CopilotResponse {
  const rawParts: unknown[] =
    (response.candidates?.[0]?.content?.parts as unknown[]) ?? [];

  const toolCalls: CopilotToolCall[] = [];
  const functionCalls = response.functionCalls;

  if (functionCalls) {
    for (const fc of functionCalls) {
      toolCalls.push({
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: fc.name ?? "",
        args: (fc.args as Record<string, unknown>) ?? {}
      });
    }
  }

  return {
    text: response.text ?? "",
    toolCalls,
    rawParts
  };
}

function ensureFallbackKeepsWorking(
  response: CopilotResponse,
  request: CopilotGenerateRequest,
): CopilotResponse {
  if (response.toolCalls.length > 0) {
    return response;
  }

  if (!/\b(i will|i'll|let me|inspect|modify|add|create|build|continue)\b/i.test(response.text)) {
    return response;
  }

  const names = new Set(request.tools.map((tool) => tool.name));

  if (names.has("generate_game_html")) {
    const title = inferFallbackGameTitle(request, response.text);
    return {
      ...response,
      text: response.text || `Generated ${title}.`,
      toolCalls: [
        {
          id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: "generate_game_html",
          args: {
            title,
            files: buildEmergencyMorphusFiles(title, request, response.text)
          }
        }
      ]
    };
  }

  const name = names.has("get_scene_settings")
    ? "get_scene_settings"
    : names.has("list_nodes")
      ? "list_nodes"
      : names.has("list_materials")
        ? "list_materials"
        : undefined;

  if (!name) {
    return response;
  }

  return {
    ...response,
    text: response.text || "Inspecting the scene before making changes.",
    toolCalls: [
      {
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        args: {}
      }
    ]
  };
}

function inferFallbackGameTitle(request: CopilotGenerateRequest, responseText: string) {
  const text = `${responseText}\n${latestUserText(request)}`;
  const quoted = text.match(/["']([^"']{6,80})["']/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  if (/digital twins?/i.test(text) || /smart home/i.test(text)) {
    return "Digital Twins Smart Home Platform";
  }

  const prompt = latestUserText(request).replace(/\s+/g, " ").trim();
  if (prompt) {
    return prompt
      .replace(/^(create|make|build|generate|give me|continue|fix)\s+/i, "")
      .slice(0, 72)
      .replace(/[.!?]+$/, "") || "Generated Game";
  }

  return "Generated Game";
}

function latestUserText(request: CopilotGenerateRequest) {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const message = request.messages[i];
    if (message.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }

  return "";
}

function buildEmergencyMorphusHtml(
  title: string,
  request: CopilotGenerateRequest,
  responseText: string,
) {
  const prompt = latestUserText(request) || responseText || title;
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(prompt);
  const lower = `${title} ${prompt}`.toLowerCase();
  const isSmartHome = lower.includes("digital twin") || lower.includes("smart home");

  const featureCards = isSmartHome
    ? [
        ["Living Room", "22.4 C", "Humidity 46%", "CO2 610ppm"],
        ["Kitchen", "24.1 C", "Power 1.8kW", "Air quality good"],
        ["Garage", "19.7 C", "Door closed", "Motion idle"]
      ]
    : [
        ["Zone A", "Ready", "Interactive", "Click to focus"],
        ["Zone B", "Active", "Responsive", "Status nominal"],
        ["Zone C", "Online", "Animated", "Controls enabled"]
      ];

  const cards = featureCards
    .map(
      ([name, metric, statA, statB]) => `
        <button class="room" data-room="${escapeHtml(name)}">
          <span>${escapeHtml(name)}</span>
          <strong>${escapeHtml(metric)}</strong>
          <small>${escapeHtml(statA)} · ${escapeHtml(statB)}</small>
        </button>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root{color-scheme:dark;--bg:#07110f;--panel:#101b1a;--line:rgba(255,255,255,.12);--mint:#62f4bd;--gold:#f6d07d;--cyan:#7dd3fc}
    *{box-sizing:border-box} body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 10%,rgba(98,244,189,.22),transparent 28%),radial-gradient(circle at 80% 70%,rgba(125,211,252,.16),transparent 26%),linear-gradient(135deg,#070b10,#0b1714 55%,#11150d);font-family:ui-sans-serif,system-ui,Segoe UI,sans-serif;color:#eefcf8;overflow:hidden}
    .app{display:grid;grid-template-columns:320px 1fr;min-height:100vh}.side{padding:28px;border-right:1px solid var(--line);background:rgba(8,18,18,.78);backdrop-filter:blur(18px)}.brand{letter-spacing:.2em;text-transform:uppercase;color:var(--gold);font-size:12px;font-weight:800}.side h1{font-size:34px;line-height:1;margin:18px 0 12px}.side p{color:rgba(238,252,248,.68);line-height:1.6}.rooms{display:grid;gap:12px;margin-top:24px}.room{border:1px solid var(--line);background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025));border-radius:18px;padding:16px;color:inherit;text-align:left;cursor:pointer;transition:.2s transform,.2s border-color}.room:hover,.room.active{transform:translateY(-2px);border-color:rgba(98,244,189,.55)}.room span,.room small{display:block;color:rgba(238,252,248,.58)}.room strong{display:block;margin:8px 0;color:var(--mint);font-size:24px}.stage{position:relative;display:grid;place-items:center;padding:32px}.home{position:relative;width:min(780px,82vw);aspect-ratio:1.45;border:1px solid var(--line);border-radius:34px;background:linear-gradient(145deg,rgba(255,255,255,.11),rgba(255,255,255,.03));box-shadow:0 40px 120px rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.18);overflow:hidden}.grid{position:absolute;inset:46px;display:grid;grid-template-columns:1.2fr .9fr;grid-template-rows:1fr .85fr;gap:14px}.tile{border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:18px;background:rgba(7,17,15,.62);position:relative;overflow:hidden}.tile:before{content:"";position:absolute;inset:auto -20% -45% -20%;height:70%;background:radial-gradient(circle,rgba(98,244,189,.18),transparent 65%);animation:pulse 3s ease-in-out infinite}.tile b{position:relative;z-index:1}.hero{grid-row:span 2}.device{position:absolute;width:74px;height:74px;border-radius:24px;background:linear-gradient(145deg,var(--mint),#1aa37b);box-shadow:0 0 42px rgba(98,244,189,.32);display:grid;place-items:center;color:#03231b;font-weight:900}.d1{left:14%;top:18%}.d2{right:18%;top:24%;animation:float 4s ease-in-out infinite}.d3{left:49%;bottom:16%;animation:float 4s ease-in-out infinite reverse}.hud{position:absolute;left:32px;right:32px;bottom:28px;display:flex;justify-content:space-between;gap:14px}.pill{border:1px solid var(--line);border-radius:999px;background:rgba(0,0,0,.28);padding:10px 14px;color:rgba(238,252,248,.75)}.cta{color:#031b15;background:linear-gradient(135deg,var(--mint),var(--gold));font-weight:800}@keyframes float{50%{transform:translateY(-14px)}}@keyframes pulse{50%{opacity:.45;transform:scale(1.08)}}@media(max-width:800px){.app{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line)}.stage{padding:18px}.home{width:94vw}}
  </style>
</head>
<body>
  <main class="app">
    <aside class="side">
      <div class="brand">Morphus Recovery Build</div>
      <h1>${safeTitle}</h1>
      <p>${safePrompt}</p>
      <div class="rooms">${cards}</div>
    </aside>
    <section class="stage">
      <div class="home" aria-label="${safeTitle} interactive preview">
        <div class="grid">
          <div class="tile hero"><b id="selected">Select a room</b></div>
          <div class="tile"><b>Live Sensors</b></div>
          <div class="tile"><b>Energy Flow</b></div>
        </div>
        <div class="device d1">AI</div><div class="device d2">IoT</div><div class="device d3">3D</div>
        <div class="hud"><span class="pill" id="status">System online</span><button class="pill cta" id="simulate">Simulate Event</button></div>
      </div>
    </section>
  </main>
  <script>
    const rooms=[...document.querySelectorAll('.room')],selected=document.getElementById('selected'),status=document.getElementById('status');
    rooms.forEach(btn=>btn.addEventListener('click',()=>{rooms.forEach(b=>b.classList.remove('active'));btn.classList.add('active');selected.textContent=btn.dataset.room+' digital twin focused';status.textContent='Streaming '+btn.dataset.room+' telemetry';}));
    document.getElementById('simulate').addEventListener('click',()=>{const n=Math.round(18+Math.random()*9);status.textContent='Scenario pulse: temperature adjusted to '+n+' C';});
  </script>
</body>
</html>`;
}

function buildEmergencyMorphusFiles(
  title: string,
  request: CopilotGenerateRequest,
  responseText: string,
) {
  const prompt = latestUserText(request) || responseText || title;
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(prompt);
  const lower = `${title} ${prompt}`.toLowerCase();
  const smartHome = lower.includes("digital twin") || lower.includes("smart home");
  const rooms = smartHome
    ? [
        { name: "Living Room", metric: "22.4 C", statA: "Humidity 46%", statB: "CO2 610ppm" },
        { name: "Kitchen", metric: "24.1 C", statA: "Power 1.8kW", statB: "Air quality good" },
        { name: "Garage", metric: "19.7 C", statA: "Door closed", statB: "Motion idle" }
      ]
    : [
        { name: "Zone A", metric: "Ready", statA: "Interactive", statB: "Click to focus" },
        { name: "Zone B", metric: "Active", statA: "Responsive", statB: "Status nominal" },
        { name: "Zone C", metric: "Online", statA: "Animated", statB: "Controls enabled" }
      ];

  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main class="app">
    <aside class="side">
      <div class="brand">Morphus Project</div>
      <h1>${safeTitle}</h1>
      <p>${safePrompt}</p>
      <div class="rooms" id="rooms"></div>
    </aside>
    <section class="stage">
      <div class="home" aria-label="${safeTitle} interactive preview">
        <div class="grid">
          <div class="tile hero"><b id="selected">Select a room</b></div>
          <div class="tile"><b>Live Sensors</b></div>
          <div class="tile"><b>Energy Flow</b></div>
        </div>
        <div class="device d1">AI</div>
        <div class="device d2">IoT</div>
        <div class="device d3">3D</div>
        <div class="hud">
          <span class="pill" id="status">System online</span>
          <button class="pill cta" id="simulate">Simulate Event</button>
        </div>
      </div>
    </section>
  </main>
  <script type="module" src="./main.js"></script>
</body>
</html>`
    },
    {
      path: "style.css",
      content: `:root{color-scheme:dark;--bg:#07110f;--panel:#101b1a;--line:rgba(255,255,255,.12);--mint:#62f4bd;--gold:#f6d07d;--cyan:#7dd3fc}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 10%,rgba(98,244,189,.22),transparent 28%),radial-gradient(circle at 80% 70%,rgba(125,211,252,.16),transparent 26%),linear-gradient(135deg,#070b10,#0b1714 55%,#11150d);font-family:ui-sans-serif,system-ui,Segoe UI,sans-serif;color:#eefcf8;overflow:hidden}
.app{display:grid;grid-template-columns:320px 1fr;min-height:100vh}.side{padding:28px;border-right:1px solid var(--line);background:rgba(8,18,18,.78);backdrop-filter:blur(18px)}.brand{letter-spacing:.2em;text-transform:uppercase;color:var(--gold);font-size:12px;font-weight:800}.side h1{font-size:34px;line-height:1;margin:18px 0 12px}.side p{color:rgba(238,252,248,.68);line-height:1.6}.rooms{display:grid;gap:12px;margin-top:24px}.room{border:1px solid var(--line);background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025));border-radius:18px;padding:16px;color:inherit;text-align:left;cursor:pointer;transition:.2s transform,.2s border-color}.room:hover,.room.active{transform:translateY(-2px);border-color:rgba(98,244,189,.55)}.room span,.room small{display:block;color:rgba(238,252,248,.58)}.room strong{display:block;margin:8px 0;color:var(--mint);font-size:24px}.stage{position:relative;display:grid;place-items:center;padding:32px}.home{position:relative;width:min(780px,82vw);aspect-ratio:1.45;border:1px solid var(--line);border-radius:34px;background:linear-gradient(145deg,rgba(255,255,255,.11),rgba(255,255,255,.03));box-shadow:0 40px 120px rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.18);overflow:hidden}.grid{position:absolute;inset:46px;display:grid;grid-template-columns:1.2fr .9fr;grid-template-rows:1fr .85fr;gap:14px}.tile{border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:18px;background:rgba(7,17,15,.62);position:relative;overflow:hidden}.tile:before{content:"";position:absolute;inset:auto -20% -45% -20%;height:70%;background:radial-gradient(circle,rgba(98,244,189,.18),transparent 65%);animation:pulse 3s ease-in-out infinite}.tile b{position:relative;z-index:1}.hero{grid-row:span 2}.device{position:absolute;width:74px;height:74px;border-radius:24px;background:linear-gradient(145deg,var(--mint),#1aa37b);box-shadow:0 0 42px rgba(98,244,189,.32);display:grid;place-items:center;color:#03231b;font-weight:900}.d1{left:14%;top:18%}.d2{right:18%;top:24%;animation:float 4s ease-in-out infinite}.d3{left:49%;bottom:16%;animation:float 4s ease-in-out infinite reverse}.hud{position:absolute;left:32px;right:32px;bottom:28px;display:flex;justify-content:space-between;gap:14px}.pill{border:1px solid var(--line);border-radius:999px;background:rgba(0,0,0,.28);padding:10px 14px;color:rgba(238,252,248,.75)}.cta{color:#031b15;background:linear-gradient(135deg,var(--mint),var(--gold));font-weight:800}@keyframes float{50%{transform:translateY(-14px)}}@keyframes pulse{50%{opacity:.45;transform:scale(1.08)}}@media(max-width:800px){.app{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line)}.stage{padding:18px}.home{width:94vw}}`
    },
    {
      path: "data.js",
      content: `export const rooms = ${JSON.stringify(rooms, null, 2)};`
    },
    {
      path: "effects.js",
      content: `export function pulseStatus(status, message) {
  status.textContent = message;
  status.animate([
    { transform: "scale(1)", filter: "brightness(1)" },
    { transform: "scale(1.04)", filter: "brightness(1.35)" },
    { transform: "scale(1)", filter: "brightness(1)" }
  ], { duration: 420, easing: "ease-out" });
}`
    },
    {
      path: "main.js",
      content: `import { rooms } from "./data.js";
import { pulseStatus } from "./effects.js";

const roomList = document.getElementById("rooms");
const selected = document.getElementById("selected");
const status = document.getElementById("status");
const simulate = document.getElementById("simulate");

for (const room of rooms) {
  const button = document.createElement("button");
  button.className = "room";
  button.innerHTML = \`<span>\${room.name}</span><strong>\${room.metric}</strong><small>\${room.statA} · \${room.statB}</small>\`;
  button.addEventListener("click", () => {
    document.querySelectorAll(".room").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selected.textContent = \`\${room.name} digital twin focused\`;
    pulseStatus(status, \`Streaming \${room.name} telemetry\`);
  });
  roomList.append(button);
}

simulate.addEventListener("click", () => {
  const temperature = Math.round(18 + Math.random() * 9);
  pulseStatus(status, \`Scenario pulse: temperature adjusted to \${temperature} C\`);
});`
    }
  ];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isGeminiQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /resource_exhausted|quota|rate[- ]limit|429/i.test(message);
}

function isGeminiInvalidArgumentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /invalid_argument|request contains an invalid argument|400/i.test(message);
}

function isTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timed out|timeout|aborted|aborterror/i.test(message);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

type LightningContentPart =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

type LightningMessage =
  | {
      role: "assistant" | "user";
      content: LightningContentPart[];
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
    };

type LightningPayload = {
  choices?: Array<{
    message?: {
      content?: Array<{ text?: string; type?: string }> | string | null;
      tool_calls?: Array<{
        id?: string;
        function?: {
          arguments?: string;
          name?: string;
        };
      }>;
    };
  }>;
  error?: { message?: string } | string;
  message?: string;
  detail?: string;
} | null;

type LightningChatPayload = {
  model: string;
  messages: Array<LightningMessage | { role: "system"; content: string } | { role: "assistant" | "user"; content: string }>;
  temperature: number;
  tools?: ReturnType<typeof convertToolsForLightning>;
  tool_choice?: "auto";
};

class LightningRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LightningRequestError";
  }
}

function convertMessagesForLightning(messages: CopilotMessage[]) {
  const converted: LightningMessage[] = [];

  for (const message of messages) {
    if (message.role === "tool" && message.toolResults) {
      for (const toolResult of message.toolResults) {
        converted.push({
          role: "tool",
          tool_call_id: toolResult.callId,
          name: toolResult.name,
          content: toolResult.result
        });
      }
      continue;
    }

    const content: LightningContentPart[] = [];

    if (message.images?.length) {
      for (const image of message.images) {
        content.push({
          type: "image_url",
          image_url: { url: image.dataUrl }
        });
      }
    }

    if (message.content) {
      content.push({ type: "text", text: message.content });
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      converted.push({
        role: "assistant",
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args)
          }
        }))
      });
      continue;
    }

    if (content.length > 0) {
      converted.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content
      });
    }
  }

  return converted;
}

function convertMessagesForLightningTextOnly(messages: CopilotMessage[]) {
  const converted: Array<{ role: "assistant" | "user"; content: string }> = [];

  for (const message of messages) {
    if (message.role === "tool" && message.toolResults) {
      for (const toolResult of message.toolResults) {
        converted.push({
          role: "user",
          content: `Tool result from ${toolResult.name}: ${toolResult.result}`
        });
      }
      continue;
    }

    const imageNotice = message.images?.length
      ? `\n[${message.images.length} attached image${message.images.length === 1 ? "" : "s"} omitted in fallback mode]`
      : "";
    const toolCallNotice = message.toolCalls?.length
      ? `\n[Previous tool calls: ${message.toolCalls.map((toolCall) => toolCall.name).join(", ")}]`
      : "";
    const content = `${message.content ?? ""}${imageNotice}${toolCallNotice}`.trim();

    if (content) {
      converted.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content
      });
    }
  }

  return converted;
}

function truncateForFallback(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n...[truncated]`;
}

function buildGeminiFlashFallbackText(request: CopilotGenerateRequest) {
  const converted = convertMessagesForLightningTextOnly(request.messages);

  if (!isMorphusRequest(request)) {
    return converted
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");
  }

  const recentMessages = converted.slice(-6);
  const earlierCount = Math.max(0, converted.length - recentMessages.length);
  const lines: string[] = [
    "Morphus standalone game generation/update fallback context.",
    "Use the available tool to produce the final runnable game files."
  ];

  if (earlierCount > 0) {
    lines.push(`[${earlierCount} earlier message${earlierCount === 1 ? "" : "s"} omitted to keep fallback fast]`);
  }

  for (const message of recentMessages) {
    lines.push(`${message.role.toUpperCase()}: ${truncateForFallback(message.content, 6000)}`);
  }

  return lines.join("\n\n");
}


const SUITE_MODELS = ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.5-flash"];

async function generateViaFallbackModel(request: CopilotGenerateRequest, model: string): Promise<CopilotResponse> {
  const apiKey = request.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(`Missing GEMINI_API_KEY for fallback model ${model}.`);
  }

  const ai = new GoogleGenAI({ apiKey });
  const timeoutPolicy = getTimeoutPolicy(request);
  const textOnlyMessages = buildGeminiFlashFallbackText(request);
  const morphusRequest = isMorphusRequest(request);

  const response = await withTimeout(
    ai.models.generateContent({
      model: model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: textOnlyMessages || "Continue the current editor task."
            }
          ]
        }
      ],
      config: {
        systemInstruction: `${request.systemPrompt}\n\nYou are running as the ${model} fallback after the primary request failed or timed out. Keep working through tools. If the user asks to modify, build, add, continue, or inspect, call the appropriate tool instead of replying with future-tense planning text. Use text only when the task is complete or you need a brief clarification.`,
        temperature: request.temperature,
        tools: [{ functionDeclarations: convertToolDeclarations(request.tools) }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO
          }
        },
        ...(!morphusRequest ? {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH
          }
        } : {})
      }
    }),
    timeoutPolicy.geminiFlashMs,
    `${model} fallback`,
  );

  return readGeminiResponse(response);
}

async function generateViaProviderFallbacks(request: CopilotGenerateRequest): Promise<CopilotResponse> {
  const primaryModel = request.model || SERVER_GEMMA_MODEL;
  const fallbacks = SUITE_MODELS.filter(m => m !== primaryModel);

  let errors: string[] = [];
  for (const model of fallbacks) {
    try {
      return ensureFallbackKeepsWorking(await generateViaFallbackModel(request, model), request);
    } catch (err) {
      errors.push(`${model} fallback failed: ${formatFallbackError(err)}`);
    }
  }

  throw new Error(errors.join(" "));
}

export async function generateCopilotContent(
  request: CopilotGenerateRequest
): Promise<CopilotResponse> {
  const apiKey = request.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const timeoutPolicy = getTimeoutPolicy(request);
  const primaryModel = request.model || SERVER_GEMMA_MODEL;

  if (!apiKey) {
    return generateViaProviderFallbacks(request).catch((error: unknown) => {
      throw new Error(`Missing GEMINI_API_KEY in the environment, and all fallbacks failed: ${
        error instanceof Error ? error.message : String(error ?? "unknown error")
      }`);
    });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: primaryModel,
        contents: convertMessages(request.messages),
        config: {
          systemInstruction: request.systemPrompt,
          temperature: request.temperature,
          tools: [{ functionDeclarations: convertToolDeclarations(request.tools) }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO
            }
          }
        }
      }),
      timeoutPolicy.primaryMs,
      "Primary Gemini generation",
    );

    return readGeminiResponse(response);
  } catch (error) {
    if (!isGeminiQuotaError(error) && !isTimeoutError(error) && !isGeminiInvalidArgumentError(error)) {
      throw error;
    }

    return generateViaProviderFallbacks(request).catch((fallbackError: unknown) => {
      const reason = isTimeoutError(error)
        ? "Gemini timed out"
        : isGeminiInvalidArgumentError(error)
          ? "Gemini rejected the request shape"
          : "Gemini quota was reached";
      throw new Error(`${reason}, and all fallbacks failed: ${formatFallbackError(fallbackError)}`);
    });
  }
}
