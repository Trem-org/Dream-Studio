import type { CopilotSettings, CodexModelId, GeminiModelId } from "./types";

const STORAGE_KEY = "web-hammer:copilot";

const CODEX_MODELS: CodexModelId[] = ["gpt-5.4", "gpt-5.3-codex", "gpt-5.1-codex-max", "gpt-4.1", "gpt-4.1-mini", "codex-mini-latest", "o3", "o4-mini"];
const GEMINI_MODELS: GeminiModelId[] = ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.5-flash"];
const SERVER_GEMMA_MODEL: GeminiModelId = "gemini-3.1-pro-preview";

const DEFAULT_SETTINGS: CopilotSettings = {
  provider: "gemini",
  gemini: { model: SERVER_GEMMA_MODEL },
  codex: { model: "gpt-5.4" },
  temperature: 0.3,
  elevenlabsApiKey: "",
  geminiApiKey: ""
};

export function loadCopilotSettings(): CopilotSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw);

    return {
      provider: "gemini",
      gemini: {
        model: isGeminiModel(parsed.gemini?.model) ? parsed.gemini.model : SERVER_GEMMA_MODEL
      },
      codex: {
        model: isCodexModel(parsed.codex?.model) ? parsed.codex.model : DEFAULT_SETTINGS.codex.model
      },
      temperature: validTemperature(parsed.temperature),
      elevenlabsApiKey: typeof parsed.elevenlabsApiKey === "string" ? parsed.elevenlabsApiKey : "",
      geminiApiKey: typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : ""
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveCopilotSettings(settings: CopilotSettings): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      provider: "gemini"
    })
  );
}

export function isCopilotConfigured(settings?: CopilotSettings): boolean {
  settings ?? loadCopilotSettings();
  // Gemini/Gemma is configured server-side through Vercel environment variables.
  // The browser never receives or stores the API key.
  return true;
}

function isGeminiModel(v: unknown): v is GeminiModelId {
  return typeof v === "string" && (GEMINI_MODELS as string[]).includes(v);
}

function isCodexModel(v: unknown): v is CodexModelId {
  return typeof v === "string" && (CODEX_MODELS as string[]).includes(v);
}

function validTemperature(v: unknown): number {
  return typeof v === "number" && v >= 0 && v <= 1 ? v : DEFAULT_SETTINGS.temperature;
}
