import { GoogleGenAI } from "@google/genai";
import { SERVER_GEMMA_MODEL } from "./copilot-generate-shared";

export type NpcChatRequest = {
  characterPrompt: string;
  history: { role: "user" | "assistant"; text: string }[];
  npcName: string;
  userMessage: string;
  apiKey?: string;
  model?: string;
};

export async function generateNpcChatReply(params: NpcChatRequest) {
  const apiKey = params.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY/API key configuration.");
  }

  const model = params.model || SERVER_GEMMA_MODEL;

  const systemInstruction = [
    `You are "${params.npcName}" in a real-time 3D game the designer is building.`,
    params.characterPrompt.trim() || "Stay in character. Keep answers to about 2-4 short sentences unless the player clearly wants more.",
    "Reply with spoken dialogue only: no asterisks, no stage directions, no markdown."
  ].join("\n");

  const contents: { parts: { text: string }[]; role: string }[] = [];

  for (const turn of params.history) {
    contents.push({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.text }]
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: params.userMessage }]
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
