import { GoogleGenAI } from "@google/genai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SERVER_GEMMA_MODEL = "gemini-3.5-flash";

type NpcChatRequest = {
  characterPrompt?: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  npcName?: string;
  userMessage?: string;
  apiKey?: string;
  model?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const payload = (req.body ?? {}) as NpcChatRequest;
    const apiKey = payload.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY/API key configuration." });
    }

    const text = await generateNpcReply(apiKey, payload);
    return res.status(200).json({ text });
  } catch (error) {
    console.error("[copilot/npc] error", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "NPC reply failed."
    });
  }
}

async function generateNpcReply(apiKey: string, params: NpcChatRequest) {
  const npcName = params.npcName?.trim() || "NPC";
  const model = params.model || SERVER_GEMMA_MODEL;
  const systemInstruction = [
    `You are "${npcName}" in a real-time 3D game the designer is building.`,
    params.characterPrompt?.trim() || "Stay in character. Keep answers to about 2-4 short sentences unless the player clearly wants more.",
    "Reply with spoken dialogue only: no asterisks, no stage directions, no markdown."
  ].join("\n");

  const contents: { parts: { text: string }[]; role: string }[] = [];
  for (const turn of params.history ?? []) {
    contents.push({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.text }]
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: params.userMessage?.trim() || "Hello." }]
  });

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      maxOutputTokens: 512,
      systemInstruction,
      temperature: 0.78
    }
  });

  const text = (response.text ?? "").trim();
  if (!text) {
    throw new Error("Gemma returned an empty reply.");
  }

  return text;
}
