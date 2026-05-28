import type { VercelRequest, VercelResponse } from "@vercel/node";

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-elevenlabs-api-key");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = req.headers["x-elevenlabs-api-key"] as string | undefined;
  if (!apiKey) return res.status(401).json({ error: "No ElevenLabs API key provided. Set it in Vibe Settings." });

  try {
    const response = await fetch(`${ELEVENLABS_BASE}/v1/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { 
        "xi-api-key": apiKey,
        "accept": "application/json"
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[elevenlabs/scribe-token] upstream error", response.status, errorText);
      return res.status(response.status).json({ error: "Upstream token creation failed", detail: errorText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("[elevenlabs/scribe-token] error", err);
    return res.status(500).json({ error: "Failed to generate Scribe token." });
  }
}
