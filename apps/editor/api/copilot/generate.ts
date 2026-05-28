import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  generateCopilotContent,
  type CopilotGenerateRequest
} from "../../server/copilot-generate-shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const payload = parsePayload(req.body);
    const response = await generateCopilotContent(payload);
    return res.status(200).json(response);
  } catch (error) {
    console.error("[copilot/generate] error", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error || "Copilot generation failed.")
    });
  }
}

function parsePayload(body: unknown): CopilotGenerateRequest {
  const payload = typeof body === "string"
    ? JSON.parse(body) as Partial<CopilotGenerateRequest>
    : body as Partial<CopilotGenerateRequest> | null | undefined;

  return {
    messages: payload?.messages ?? [],
    tools: payload?.tools ?? [],
    systemPrompt: payload?.systemPrompt ?? "",
    temperature: typeof payload?.temperature === "number" ? payload.temperature : 0.3,
    apiKey: typeof payload?.apiKey === "string" ? payload.apiKey : undefined,
    model: typeof payload?.model === "string" ? payload.model : undefined
  };
}
