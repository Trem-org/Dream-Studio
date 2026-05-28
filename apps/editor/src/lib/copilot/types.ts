// ── Provider and model IDs ────────────────────────────────────

export type CopilotProviderId = "gemini" | "codex";
export type GeminiModelId = "gemini-3.1-pro-preview" | "gemini-3-flash-preview" | "gemini-3.5-flash";

export type CodexModelId = "gpt-5.4" | "gpt-5.3-codex" | "gpt-5.1-codex-max" | "gpt-4.1" | "gpt-4.1-mini" | "codex-mini-latest" | "o3" | "o4-mini";
export type CopilotModelId = GeminiModelId | CodexModelId;
export type AiAssistantMode = "copilot" | "morphus";

// ── Settings ──────────────────────────────────────────────────

export type CopilotSettings = {
  provider: CopilotProviderId;
  gemini: { model: GeminiModelId };
  codex: { model: CodexModelId };
  temperature: number;
  elevenlabsApiKey: string;
  geminiApiKey: string;
  elevenlabsSpeechEngineId: string;
};

// ── Messages ──────────────────────────────────────────────────

export type CopilotImageAttachment = {
  dataUrl: string;
  mimeType: string;
  name?: string;
};

export type CopilotMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  images?: CopilotImageAttachment[];
  toolCalls?: CopilotToolCall[];
  toolResults?: CopilotToolResult[];
  /** Raw provider response parts — preserved verbatim for thought signatures */
  rawParts?: unknown[];
  timestamp: number;
};

export type CopilotToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type CopilotToolResult = {
  callId: string;
  images?: CopilotImageAttachment[];
  name: string;
  result: string;
};

export type CopilotToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type CopilotProviderConfig = {
  apiKey: string;
  model: string;
  temperature: number;
};

export type CopilotResponse = {
  text: string;
  toolCalls: CopilotToolCall[];
  /** Raw parts from the model response, preserved for thought signatures */
  rawParts: unknown[];
};

export type CopilotSkillMatch = {
  description: string;
  excerpt: string;
  name: string;
  path: string;
  score: number;
};

export type CopilotSkillContext = {
  matchedSkills: CopilotSkillMatch[];
  rootPath: string;
};

export type CopilotSessionStatus =
  | "idle"
  | "thinking"
  | "executing"
  | "error"
  | "aborted";

export type CopilotActivityKind =
  | "session"
  | "step"
  | "tool_call"
  | "tool_result"
  | "assistant"
  | "status"
  | "error";

export type CopilotActivityTone = "info" | "success" | "warning" | "error";

export type CopilotActivityItem = {
  id: string;
  kind: CopilotActivityKind;
  title: string;
  detail?: string;
  iteration?: number;
  status?: CopilotSessionStatus;
  tone?: CopilotActivityTone;
  toolCall?: CopilotToolCall;
  toolResult?: CopilotToolResult;
  elapsedMs?: number;
  timestamp: number;
};

export type CopilotSession = {
  messages: CopilotMessage[];
  activity: CopilotActivityItem[];
  status: CopilotSessionStatus;
  error?: string;
  iterationCount: number;
  activeSkills?: CopilotSkillMatch[];
  providerId?: CopilotProviderId;
  modelId?: string;
  modeLabel?: string;
  skillRootPath?: string;
};

// ── Provider interfaces ───────────────────────────────────────

/** Request-response provider (Gemini) — used with the agentic loop */
export type CopilotProvider = {
  generateContent(
    messages: CopilotMessage[],
    tools: CopilotToolDeclaration[],
    systemPrompt: string,
    config: CopilotProviderConfig,
    signal?: AbortSignal
  ): Promise<CopilotResponse>;
};

/** Session-based provider (Codex) — manages its own tool-calling loop */
export type SessionBasedCopilotProvider = {
  runSession(config: {
    messages: CopilotMessage[];
    activity: CopilotActivityItem[];
    userPrompt: string;
    tools: CopilotToolDeclaration[];
    systemPrompt: string;
    providerConfig: CopilotProviderConfig;
    providerId: CopilotProviderId;
    modeLabel: string;
    skillContext?: CopilotSkillContext;
    threadId?: string;
    onThreadId?: (threadId: string | undefined) => void;
    executeTool: (call: CopilotToolCall) => Promise<CopilotToolResult>;
    onUpdate: (session: CopilotSession) => void;
    signal?: AbortSignal;
  }): Promise<CopilotSession>;
};

/** Discriminated union for provider factory */
export type AnyCopilotProvider =
  | { kind: "request-response"; provider: CopilotProvider }
  | { kind: "session-based"; provider: SessionBasedCopilotProvider };
