import type {
  CopilotMessage,
  CopilotProvider,
  CopilotProviderConfig,
  CopilotResponse,
  CopilotToolDeclaration
} from "./types";

export function createGeminiProvider(): CopilotProvider {
  return {
    async generateContent(
      messages: CopilotMessage[],
      tools: CopilotToolDeclaration[],
      systemPrompt: string,
      config: CopilotProviderConfig,
      signal?: AbortSignal
    ): Promise<CopilotResponse> {
      const response = await fetch("/api/copilot/generate", {
        body: JSON.stringify({
          messages,
          tools,
          systemPrompt,
          temperature: config.temperature,
          apiKey: config.apiKey,
          model: config.model
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        signal
      });

      const payload = await readJsonOrError(response);

      if (!response.ok) {
        throw new Error(normalizeGeminiError("error" in payload ? payload.error : "", response.status));
      }

      if (!("toolCalls" in payload)) {
        throw new Error("Copilot generation failed.");
      }

      return payload;
    }
  };
}

function normalizeGeminiError(error: unknown, status: number) {
  const raw = typeof error === "string" ? error : "";

  if (/all fallbacks failed|gemini flash fallback failed|nvidia fallback failed|lightning fallback failed/i.test(raw)) {
    return raw;
  }

  if (status === 429 || /resource_exhausted|quota|rate-limit|rate limit/i.test(raw)) {
    const retryMatch = raw.match(/Please retry in\s+([0-9.]+)s/i);
    const retryText = retryMatch ? ` Try again in about ${Math.ceil(Number(retryMatch[1]))} seconds.` : "";

    return `Gemini quota was reached for the current model.${retryText} You can wait, switch providers, or reduce the size of the request.`;
  }

  if (status >= 500) {
    return raw || "Gemini is temporarily unavailable. Try again in a moment.";
  }

  return raw || "Copilot generation failed.";
}

async function readJsonOrError(response: Response): Promise<CopilotResponse | { error?: string }> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as CopilotResponse | { error?: string };
  } catch {
    return {
      error: text.replace(/\s+/g, " ").trim() || `HTTP ${response.status}`
    };
  }
}
