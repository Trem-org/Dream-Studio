export type PreviewNpcChatHistoryTurn = {
  role: "user" | "assistant";
  text: string;
};

export async function generateNpcReply(params: {
  characterPrompt: string;
  history: PreviewNpcChatHistoryTurn[];
  npcName: string;
  userMessage: string;
  apiKey?: string;
  model?: string;
}): Promise<string> {
  const response = await fetch("/api/copilot/npc", {
    body: JSON.stringify(params),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  const payload = (await response.json()) as { text?: string; error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "NPC reply failed.");
  }

  if (!payload.text?.trim()) {
    throw new Error("Gemini returned an empty reply.");
  }

  return payload.text.trim();
}
